/***********************************************************************
* retro-b5500/emulator B5500Console.js
************************************************************************
* Copyright (c) 2012,2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Operations Console Javascript module.
*
* Implements event handlers and control functions for the B5500 emulator
* operations console.
*
************************************************************************
* 2014-07-20  P.Kimpel
*   Original version, extracted from B5500Console.html.
***********************************************************************/
"use strict";

window.addEventListener("load", function() {
    var aControl;
    var aNormal;
    var bControl;
    var bNormal;
    var cc = new B5500CentralControl(window);
    var ccLatches = [0, 0, 0];
    var ccLightsMap = new Array(6);
    var elapsedAverage = 0;
    var elapsedLast = 0;
    var intLightsMap = new Array(48);
    var lastInterruptMask = 0;
    var lastCCMask = 0;
    var lastUnitBusyMask = 0;
    var lastPANormalRate = -1;
    var lastPAControlRate = -1;
    var lastPBNormalRate = -1;
    var lastPBControlRate = -1;
    var perf = performance;             // it's faster if locally cached
    var perLightsMap = new Array(48);
    var procDelay;
    var procSlack;
    var showAnnunciators = true;
    var slackAlpha = 0.990;             // decay factor for exponential weighted avg.
    var slackAverage = 0;               // average P1 slack time
    var slackLast = 0;                  // last P1 total slack time
    var timer = 0;                      // timing cookie
    var timerInterval = 50;             // milliseconds

    function $$(id) {
        return document.getElementById(id);
    }

    function BurroughsLogo_Click(ev) {
        showAnnunciators = !showAnnunciators;
        $$("CentralControl").style.visibility = (showAnnunciators ? "visible" : "hidden");
        $$("RetroVersion").style.visibility = (showAnnunciators ? "visible" : "hidden");
        $$("RetroLogoImage").style.display = (showAnnunciators ? "inline" : "none");
        $$("B5500LogoImage").style.display = (showAnnunciators ? "none" : "inline");
    }

    function PowerOnBtn_Click(ev) {
        $$("PowerOnBtn").className = "greenButton greenLit";
        $$("HaltBtn").className = "redButton redLit";
        cc.powerOn();
        $$("PowerOnBtn").disabled = true;
        $$("PowerOffBtn").disabled = false;
        $$("LoadSelectBtn").disabled = false;
        $$("LoadBtn").disabled = false;
        $$("HaltBtn").disabled = true;
        $$("MemoryCheckBtn").disabled = false;
        if (showAnnunciators) {
            $$("CentralControl").style.visibility = "visible";
        }
        return true;
    }

    function PowerOffBtn_Click(ev) {
        $$("PowerOnBtn").className = "greenButton";
        $$("ANormalBtn").className = "yellowButton";
        $$("AControlBtn").className = "yellowButton";
        $$("BNormalBtn").className = "yellowButton";
        $$("BControlBtn").className = "yellowButton";
        $$("LoadSelectBtn").className = "yellowButton";
        $$("MemoryCheckBtn").className = "redButton";
        $$("NotReadyBtn").className = "whiteButton";
        $$("HaltBtn").className = "redButton";
        $$("CentralControl").style.visibility = "hidden";
        cc.powerOff();
        $$("PowerOnBtn").disabled = false;
        $$("PowerOffBtn").disabled = true;
        $$("LoadSelectBtn").disabled = true;
        $$("LoadBtn").disabled = true;
        $$("HaltBtn").disabled = true;
        $$("MemoryCheckBtn").disabled = true;
        if (timer) {
            clearInterval(timer);
            timer = 0;
        }
        return true;
    }

    function HaltBtn_Click(ev) {
        $$("HaltBtn").className = "redButton redLit";
        cc.halt();
        $$("HaltBtn").disabled = true;
        $$("LoadBtn").disabled = false;
        if (timer) {
            clearInterval(timer);
            timer = 0;
        }
    }

    function LoadBtn_Click(ev) {
        var result;

        window.open("", "SPO").focus(); // re-focus the SPO window
        result = cc.load(false);
        switch (result) {
        case 0:                         // load initiated successfully
            $$("HaltBtn").className = "redButton";
            $$("HaltBtn").disabled = false;
            $$("LoadBtn").disabled = true;
            elapsedLast = 0;
            slackLast = slackAverage = 0;
            timer = setInterval(dasBlinkenlicht, timerInterval);
            break;
        case 1:
            alert("P1 busy or not available");
            break;
        case 2:
            alert("SPO is not ready");
            break;
        case 3:
            alert("SPO is busy");
            break;
        default:
            alert("cc.load() result = " + result);
            break;
        }
    }

    function LoadSelectBtn_Click(ev) {
        if (cc.cardLoadSelect) {
            cc.cardLoadSelect = 0;
            $$("LoadSelectBtn").className = "yellowButton";
        } else {
            cc.cardLoadSelect = 1;
            $$("LoadSelectBtn").className = "yellowButton yellowLit";
        }
    }

    function dumpState(caption) {
        /* Generates a dump of the processor states and all of memory */
        var doc;
        var lastPhase = -2;
        var win = window.open("", "", "resizable,scrollbars,status");
        var x;

        var htmlMatch = /[<>&"]/g;          // regular expression for escaping HTML text

        function htmlFilter(c) {
            /* Used to escape HTML-sensitive characters in a string */
            switch (c) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case "\"":
                return "&quot;";
            default:
                return c;
            }
        }

        function escapeHTML(text) {
            /* Returns "text" as escaped HTML */

            return text.replace(htmlMatch, htmlFilter);
        }

        function writer(phase, text) {
            /* Call-back function for cc.dumpSystemState */

            switch (phase) {
            case 0:
                lastPhase = phase;
                doc.writeln(escapeHTML(text));
                doc.writeln("User Agent: " + navigator.userAgent);
                break;

            case 1:
            case 2:
                if (phase == lastPhase) {
                    doc.writeln(escapeHTML(text));
                } else {
                    lastPhase = phase;
                    doc.writeln();
                    doc.writeln(escapeHTML(text));
                    doc.writeln();
                }
                break;

            case 32:
                if (phase != lastPhase) {
                    lastPhase = phase;
                    doc.writeln();
                }
                doc.writeln();
                doc.writeln(escapeHTML(text));
                break;

            case -1:
                break;
            } // switch
        }

        doc = win.document;
        doc.open();
        doc.writeln("<html><head><title>B5500 Console State Dump</title>");
        doc.writeln("</head><body>");
        doc.write("<pre>");

        cc.dumpSystemState(caption, writer);

        doc.writeln("</pre></body></html>")
        doc.close();
        win.focus();
    }

    function displayCallbacks() {
        /* Builds a table of outstanding callbacks */
        var cb;
        var cbs = clearCallback(0);
        var cookie;
        var e;
        var body = document.createElement("tbody");
        var oldBody = $$("CallbackBody");
        var row;

        for (cookie in cbs) {
            cb = cbs[cookie];
            row = document.createElement("tr");

            e = document.createElement("td");
            e.appendChild(document.createTextNode(cookie.toString()));
            row.appendChild(e);

            e = document.createElement("td");
            e.appendChild(document.createTextNode(cb.delay.toFixed(2)));
            row.appendChild(e);

            e = document.createElement("td");
            e.appendChild(document.createTextNode(cb.context.mnemonic || "??"));
            row.appendChild(e);

            e = document.createElement("td");
            e.appendChild(document.createTextNode((cb.args ? cb.args.length : 0).toString()));
            row.appendChild(e);
            body.appendChild(row);
        }

        body.id = oldBody.id;
        oldBody.parentNode.replaceChild(body, oldBody);
    }

    function displayCentralControl() {
        /* Displays the I/O and interrupt status in CentralControl */
        var cells;
        var s;
        var interruptMask;
        var interruptChange;
        var ccMask;
        var ccChange;
        var unitBusyMask;
        var unitBusyChange;
        var x;

        cc.fetchCCLatches(ccLatches);
        ccMask = ccLatches[0];
        ccChange = lastCCMask ^ ccMask;
        lastCCMask = ccMask;

        interruptMask = ccLatches[1] % 0x4000;
        interruptChange = lastInterruptMask ^ interruptMask;
        lastInterruptMask = interruptMask;

        unitBusyMask = ccLatches[2];
        unitBusyChange = lastUnitBusyMask ^ unitBusyMask;
        lastUnitBusyMask = unitBusyMask;

        x = 0;
        while (ccChange) {
            if (ccChange & 0x01) {
                ccLightsMap[x].style.visibility = (ccMask & 0x01 ? "visible" : "hidden");
            }
            ccMask >>>= 1;
            ccChange >>>= 1;
            x++;
        }

        x = 47;
        while (interruptChange) {
            if (interruptChange & 0x01) {
                intLightsMap[x].style.visibility = (interruptMask & 0x01 ? "visible" : "hidden");
            }
            interruptMask >>>= 1;
            interruptChange >>>= 1;
            x--;
        }

        x = 47;
        while (unitBusyChange) {
            if (unitBusyChange & 0x01) {
                perLightsMap[x].style.visibility = (unitBusyMask & 0x01 ? "visible" : "hidden");
            }
            unitBusyMask >>>= 1;
            unitBusyChange >>>= 1;
            x--;
        }
    }

    function dasBlinkenlicht() {
        var cycles;
        var pa = cc.PA;
        var pb = cc.PB;
        var p1 = cc.P1;
        var stateRate;

        cycles = p1.normalCycles+p1.controlCycles;

        if (pa) {
            if (pa.normalCycles+pa.controlCycles <= 0) {
                if (lastPAControlRate != -1) {
                    lastPAControlRate = -1;
                    aControl.className = "yellowButton";
                    aNormal.className = "yellowButton";
                }
            } else {
                stateRate = Math.round(pa.normalCycles/cycles*6 + 0.25);
                if (stateRate != lastPANormalRate) {
                    lastPANormalRate = stateRate;
                    switch (stateRate) {
                    case 0:
                        aNormal.className = "yellowButton";
                        break;
                    case 1:
                        aNormal.className = "yellowButton yellowLit1";
                        break;
                    case 2:
                        aNormal.className = "yellowButton yellowLit2";
                        break;
                    case 3:
                        aNormal.className = "yellowButton yellowLit3";
                        break;
                    case 4:
                        aNormal.className = "yellowButton yellowLit4";
                        break;
                    case 5:
                        aNormal.className = "yellowButton yellowLit5";
                        break;
                    default:
                        aNormal.className = "yellowButton yellowLit";
                        break;
                    }
                }

                stateRate = Math.round(pa.controlCycles/cycles*6 + 0.25);
                if (stateRate != lastPAControlRate) {
                    lastPAControlRate = stateRate;
                    switch (stateRate) {
                    case 0:
                        aControl.className = "yellowButton";
                        break;
                    case 1:
                        aControl.className = "yellowButton yellowLit1";
                        break;
                    case 2:
                        aControl.className = "yellowButton yellowLit2";
                        break;
                    case 3:
                        aControl.className = "yellowButton yellowLit3";
                        break;
                    case 4:
                        aControl.className = "yellowButton yellowLit4";
                        break;
                    case 5:
                        aControl.className = "yellowButton yellowLit5";
                        break;
                    default:
                        aControl.className = "yellowButton yellowLit";
                        break;
                    }
                }

                pa.controlCycles = pa.normalCycles = 0;
            }
        }

        if (pb) {
            if (pb.normalCycles+pb.controlCycles <= 0) {
                if (lastPBControlRate != -1) {
                    bControl.className = "yellowButton";
                    bNormal.className = "yellowButton";
                    lastPBControlRate = -1;
                }
            } else {
                stateRate = Math.round(pb.normalCycles/cycles*6 + 0.25);
                if (stateRate != lastPBNormalRate) {
                    lastPBNormalRate = stateRate;
                    switch (stateRate) {
                    case 0:
                        bNormal.className = "yellowButton";
                        break;
                    case 1:
                        bNormal.className = "yellowButton yellowLit1";
                        break;
                    case 2:
                        bNormal.className = "yellowButton yellowLit2";
                        break;
                    case 3:
                        bNormal.className = "yellowButton yellowLit3";
                        break;
                    case 4:
                        bNormal.className = "yellowButton yellowLit4";
                        break;
                    case 5:
                        bNormal.className = "yellowButton yellowLit5";
                        break;
                    default:
                        bNormal.className = "yellowButton yellowLit";
                        break;
                    }
                }

                stateRate = Math.round(pb.controlCycles/cycles*6 + 0.25);
                if (stateRate != lastPBControlRate) {
                    lastPBControlRate = stateRate;
                    switch (stateRate) {
                    case 0:
                        bControl.className = "yellowButton";
                        break;
                    case 1:
                        bControl.className = "yellowButton yellowLit1";
                        break;
                    case 2:
                        bControl.className = "yellowButton yellowLit2";
                        break;
                    case 3:
                        bControl.className = "yellowButton yellowLit3";
                        break;
                    case 4:
                        bControl.className = "yellowButton yellowLit4";
                        break;
                    case 5:
                        bControl.className = "yellowButton yellowLit5";
                        break;
                    default:
                        bControl.className = "yellowButton yellowLit";
                        break;
                    }
                }

                pb.controlCycles = pb.normalCycles = 0;
            }
        }

        procDelay.innerHTML = p1.delayDeltaAvg.toFixed(1);
        procSlack.innerHTML = (p1.procSlackAvg/p1.procRunAvg*100).toFixed(1);

        if (showAnnunciators) {
            displayCentralControl();
        }
        // displayCallbacks();
    }

    function buildLightMaps() {
        /* Builds tables of the DOM entries for the annunciator lights, for efficient access */
        var mnem;
        var spec;
        var x;

        ccLightsMap[0] = $$("AD1F");
        ccLightsMap[1] = $$("AD2F");
        ccLightsMap[2] = $$("AD3F");
        ccLightsMap[3] = $$("AD4F");
        ccLightsMap[4] = $$("P2BF");
        ccLightsMap[5] = $$("HP2F");

        for (x=3; x<=16; x++) {
            intLightsMap[50-x] = $$("CCI" + (x+100).toString().substring(1) + "F");
        }

        for (mnem in B5500CentralControl.unitSpecs) {
            spec = B5500CentralControl.unitSpecs[mnem];
            perLightsMap[spec.unitIndex] = $$(mnem);
        }
    }

    function checkBrowser() {
        /* Checks whether this browser can support the necessary stuff */
        var missing = "";

        if (!window.indexedDB) {missing += ", IndexedDB"}
        if (!window.ArrayBuffer) {missing += ", ArrayBuffer"}
        if (!window.DataView) {missing += ", DataView"}
        if (!window.Blob) {missing += ", Blob"}
        if (!window.File) {missing += ", File"}
        if (!window.FileReader) {missing += ", FileReader"}
        if (!window.FileList) {missing += ", FileList"}
        if (!window.postMessage) {missing += ", window.postMessage"}
        if (!(window.performance && "now" in performance)) {missing += ", performance.now"}

        if (missing.length == 0) {
            return false;
        } else {
            alert("No can do... your browser does not support the following features:\n" +
                missing.substring(2));
            return true;
        }
    }

    /***** window.onload() outer block *****/

    $$("RetroVersion").innerHTML = B5500CentralControl.version;
    if (!checkBrowser()) {
        $$("BurroughsLogo").addEventListener("click", BurroughsLogo_Click, false);
        $$("B5500Logo").addEventListener("click", function(ev) {
            alert("Dynamic configuration management is not yet implemented");
        });

        $$("PowerOnBtn").addEventListener("click", PowerOnBtn_Click, false);
        $$("PowerOffBtn").addEventListener("click", PowerOffBtn_Click, false);
        $$("HaltBtn").addEventListener("click", HaltBtn_Click, false);
        $$("LoadBtn").addEventListener("click", LoadBtn_Click, false);
        $$("LoadSelectBtn").addEventListener("click", LoadSelectBtn_Click, false);

        // A kludge, for sure
        $$("NotReadyBtn").addEventListener("click", function(ev) {
            B5500SystemConfiguration.PB ^= true;
            $$("RetroVersion").style.color = (B5500SystemConfiguration.PB ? "yellow" : "white");
        });
        $$("MemoryCheckBtn").addEventListener("click", function(ev) {
            dumpState("Memory-Check Button");
        });

        aControl = $$("AControlBtn");
        aNormal  = $$("ANormalBtn");
        bControl = $$("BControlBtn");
        bNormal  = $$("BNormalBtn");
        procDelay = $$("procDelay");
        procSlack = $$("procSlack");
        buildLightMaps();

        window.dumpState = dumpState;
    }
}, false);
