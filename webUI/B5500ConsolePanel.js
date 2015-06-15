/***********************************************************************
* retro-b5500/emulator B5500ConsolePanel.js
************************************************************************
* Copyright (c) 2015, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Operations Console Panel Javascript module.
*
* Implements event handlers and control functions for the B5500 emulator
* operations console.
*
************************************************************************
* 2015-01-24  P.Kimpel
*   Original version, split off from B5500Console.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500ConsolePanel(global, autoPowerUp, shutDown) {
    /* Constructor for the Console Panel object. "global" must be the
    global window object; "autoPowerUp" indicates whether the system should
    be powered on automatically; "shutDown" is a function to be called back
    when the window closes */
    var height = 144;
    var width = 1133;
    var left = screen.availWidth - width;

    this.autoPowerUp = autoPowerUp;     // Automatically power on during onload event
    this.aControl;                      // A-Control button/light
    this.aNormal;                       // A-Normal button/light
    this.bControl;                      // B-Control button/light
    this.bNormal;                       // B-Normal button/light
    this.cc;                            // B5500CentralControl object
    this.ccLatches = [0, 0, 0];         // I/O- & interrupt-reporting latches
    this.ccLightsMap = new Array(6);    // Misc annunciator DOM objects
    this.global = global;               // Global window object
    this.intLightsMap = new Array(48);  // Interrupt annunciator DOM objects
    this.lastInterruptMask = 0;         // Prior mask of interrupt annunciator lights
    this.lastCCMask = 0;                // Prior mask of misc annunciator lights
    this.lastUnitBusyMask = 0;          // Prior mask of unit-busy annunciator lights
    this.lastPANormalRate = -1;         // Prior PA normal-state busy rate
    this.lastPAControlRate = -1;        // Prior PA control-state busy rate
    this.lastPBNormalRate = -1;         // Prior PB normal-state busy rate
    this.lastPBControlRate = -1;        // Prior PB normal-state busy rate
    this.perf = performance;            // (it's faster if locally cached)
    this.perLightsMap = new Array(48);  // Peripheral I/O annunciator DOM objects
    this.procDelay;                     // Current average P1 delay [ms]
    this.procSlack;                     // Current average P1 slack time [%]
    this.showAnnunciators = true;       // Display non-purist console mode (annunciators)
    this.shutDown = shutDown;           // Function to be called back when the panel closes
    this.statusLabelTimer = 0;          // Status label display timer control token
    this.timer = 0;                     // Console display update timer control token
    this.timerInterval = 50;            // Console display update interval [ms]

    this.window = window.open("", "B5500Console");
    if (this.window) {
        this.window.close();
        this.window = null;
    }

    this.doc = null;
    this.window = window.open("../webUI/B5500ConsolePanel.html", "B5500Console",
            "location=no,scrollbars=no,resizable,top=0,left=" + left +
            ",width=" + width + ",height=" + height);
    this.window.addEventListener("load",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.consoleOnload));
}

/**************************************/
B5500ConsolePanel.prototype.$$ = function $$(id) {
    return this.doc.getElementById(id);
}

/**************************************/
B5500ConsolePanel.prototype.setAnnunciators = function setAnnunciators(showEm) {
    /* Sets the visibility of the annunciators based on "showEm" */

    this.$$("CentralControl").style.display = (showEm && this.cc.poweredUp ? "block" : "none");
    this.$$("RetroVersion").style.visibility = (showEm ? "visible" : "hidden");
    this.$$("RetroLogoImage").style.display = (showEm ? "inline" : "none");
    this.$$("B5500LogoImage").style.display = (showEm ? "none" : "inline");
    this.$$("ConfigLabel").style.display = (showEm ? "inline" : "none");
}

/**************************************/
B5500ConsolePanel.prototype.evaluateNotReady = function evaluateNotReady(config) {
    /* Evaluates the system configuration to determine whether the
    NOT READY lamp should be illuminated */
    var lampClass = "whiteButton";

    switch (false) {
    case config.PA.enabled || config.PA.enabled:
    case (config.PA.enabled && !config.PB1L) || (config.PB.enabled && config.PB1L):
    case config.IO1.enabled || config.IO2.enabled || config.IO3.enabled || config.IO4.enabled:
    case config.memMod[0].enabled:
    case config.units.SPO.enabled:
    case config.units.DKA.enabled:
        lampClass += " whiteLit";
    }

    this.$$("NotReadyBtn").className = lampClass;
}

/**************************************/
B5500ConsolePanel.prototype.BurroughsLogo_Click = function BurroughsLogo_Click(ev) {
    /* Toggles the annunciator display state on the panel */

    this.showAnnunciators = !this.showAnnunciators;
    this.setAnnunciators(this.showAnnunciators);
}

/**************************************/
B5500ConsolePanel.prototype.B5500Logo_Click = function B5500Logo_Click(ev) {
    /* Opens the configuration window if the system is powered off */
    var sysConfig = new B5500SystemConfig();

    if (this.cc.poweredUp) {
        this.$$("StatusLabel").textContent = "System configuration changes are not allowed while power is on.";
        this.clearStatusLabel(15);
    } else {
        this.$$("ConfigLabel").style.display = "none";
        sysConfig.openConfigUI();
    }
}

/**************************************/
B5500ConsolePanel.prototype.PowerOnBtn_Click = function PowerOnBtn_Click(ev) {
    /* Powers on the system */
    var sysConfig = new B5500SystemConfig();
    var that = this;

    function applyPower(config) {
        that.$$("HaltBtn").className = "redButton redLit";
        that.$$("PowerOnBtn").disabled = true;
        that.$$("PowerOffBtn").disabled = false;
        that.$$("LoadSelectBtn").disabled = false;
        that.$$("LoadBtn").disabled = false;
        that.$$("HaltBtn").disabled = true;
        that.$$("MemoryCheckBtn").disabled = false;
        that.cc.powerOn(config);
        that.$$("LoadSelectBtn").className = "yellowButton" + (that.cc.cardLoadSelect ? " yellowLit" : "");
        that.evaluateNotReady(config);
        that.setAnnunciators(that.showAnnunciators);
        that.window.addEventListener("beforeunload", that.beforeUnload);
    }

    function youMayPowerOnWhenReady_Gridley(config) {
        /* Called-back by sysConfig.getSystemConfig with the requested configuration */

        if (!config) {
            that.window.alert("No System Configuration found\nCANNOT POWER ON.");
        } else {
            that.$$("PowerOnBtn").className = "greenButton greenLit";
            that.$$("SysConfigName").textContent = config.configName;
            that.$$("StorageName").textContent = config.units.DKA.storageName;
            if (that.showAnnunciators) {
                that.lampTest(B5500CentralControl.bindMethod(that, applyPower), config);
            } else {
                applyPower(config);
            }
        }
    }

    sysConfig.getSystemConfig(null, youMayPowerOnWhenReady_Gridley); // get current system config
    return true;
}

/**************************************/
B5500ConsolePanel.prototype.PowerOffBtn_Click = function PowerOffBtn_Click(ev) {
    /* Powers off the system, halting it first if necessary */

    this.$$("PowerOnBtn").className = "greenButton";
    this.$$("ANormalBtn").className = "yellowButton";
    this.$$("AControlBtn").className = "yellowButton";
    this.$$("BNormalBtn").className = "yellowButton";
    this.$$("BControlBtn").className = "yellowButton";
    this.$$("LoadSelectBtn").className = "yellowButton";
    this.$$("MemoryCheckBtn").className = "redButton";
    this.$$("NotReadyBtn").className = "whiteButton";
    this.$$("HaltBtn").className = "redButton";
    this.cc.powerOff();
    this.$$("PowerOnBtn").disabled = false;
    this.$$("PowerOffBtn").disabled = true;
    this.$$("LoadSelectBtn").disabled = true;
    this.$$("LoadBtn").disabled = true;
    this.$$("HaltBtn").disabled = true;
    this.$$("MemoryCheckBtn").disabled = true;
    this.$$("CentralControl").style.display = "none";
    this.window.removeEventListener("beforeunload", this.beforeUnload);
    if (this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
    }
    return true;
}

/**************************************/
B5500ConsolePanel.prototype.HaltBtn_Click = function HaltBtn_Click(ev) {
    /* Halts the system */

    this.$$("HaltBtn").className = "redButton redLit";
    this.cc.halt();
    this.$$("HaltBtn").disabled = true;
    this.$$("LoadBtn").disabled = false;
    this.dasBlinkenlichten();
    if (this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
    }
}

/**************************************/
B5500ConsolePanel.prototype.LoadBtn_Click = function LoadBtn_Click(ev) {
    /* Initiates a program load for the system */
    var result;

    window.open("", "SPO").focus(); // re-focus the SPO window
    result = this.cc.load(false);
    switch (result) {
    case 0:                         // load initiated successfully
        this.$$("HaltBtn").className = "redButton";
        this.$$("HaltBtn").disabled = false;
        this.$$("LoadBtn").disabled = true;
        this.timer = setInterval(
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.dasBlinkenlichten),
            this.timerInterval);
        break;
    case 1:
        this.window.alert("P1 busy or not available");
        break;
    case 2:
        this.window.alert("SPO is not ready");
        break;
    case 3:
        this.window.alert("SPO is busy");
        break;
    case 4:
        this.window.alert("DKA is not ready");
        break;
    case 5:
        this.window.alert("DKA is busy");
        break;
    default:
        this.window.alert("cc.load() result = " + result);
        break;
    }
}

/**************************************/
B5500ConsolePanel.prototype.LoadSelectBtn_Click = function LoadSelectBtn_Click(ev) {
    /* Toggles the Card Load Select button state */

    if (this.cc.cardLoadSelect) {
        this.cc.cardLoadSelect = 0;
        this.$$("LoadSelectBtn").className = "yellowButton";
    } else {
        this.cc.cardLoadSelect = 1;
        this.$$("LoadSelectBtn").className = "yellowButton yellowLit";
    }
}

/**************************************/
B5500ConsolePanel.prototype.dumpState = function dumpState(caption) {
    /* Generates a dump of the processor states and all of memory */
    var doc;
    var lastPhase = -2;
    var win = window.open("", "", "location=no,resizable,scrollbars,status");
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
        case 0:         // Initialization and heading line
            lastPhase = phase;
            doc.writeln(escapeHTML(text));
            doc.writeln("User Agent: " + navigator.userAgent);
            break;

        case 1:         // Processor 1 state
        case 2:         // Processor 2 state
            if (phase == lastPhase) {
                doc.writeln(escapeHTML(text));
            } else {
                lastPhase = phase;
                doc.writeln();
                doc.writeln(escapeHTML(text));
                doc.writeln();
            }
            break;

        case 32:        // Memory lines
            if (phase != lastPhase) {
                lastPhase = phase;
                doc.writeln();
            }
            doc.writeln();
            doc.writeln(escapeHTML(text));
            break;

        case -1:        // Termination
            break;
        } // switch
    }

    doc = win.document;
    doc.open();
    doc.writeln("<html><head><title>retro-B5500 Console State Dump</title>");
    doc.writeln("</head><body>");
    doc.write("<pre>");

    this.cc.dumpSystemState(caption, writer);

    doc.writeln("</pre></body></html>")
    doc.close();
    win.focus();
}

/**************************************/
B5500ConsolePanel.prototype.dumpTape = function dumpTape(caption) {
    /* Generates a dump of all of memory to a MEMORY/DUMP tape image */
    var doc;
    var win = window.open("", "", "location=no,resizable,scrollbars,status");
    var x;

    var htmlMatch = /[<>&"]/g;          // regular expression for escaping HTML text
    var tapeLabel = " LABEL  0MEMORY 0DUMP00100175001019936500000000000000000000000000000000000000000";

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
        /* Call-back function for cc.dumpSystemTape */

        switch (phase) {
        case 0:         // Initialization, write tape label
            doc.writeln(tapeLabel);
            doc.writeln("}");   // tape mark
            break;

        case 32:        // Dump data
            doc.writeln(escapeHTML(text));
            break;

        case -1:        // Termination, write tape label
            doc.writeln(text);
            doc.writeln("}");   // tape mark
            doc.writeln(tapeLabel);
            break;
        } // switch
    }

    doc = win.document;
    doc.open();
    doc.writeln("<html><head><title>retro-B5500 Console Tape Dump</title>");
    doc.writeln("</head><body>");
    doc.write("<pre>");

    this.cc.dumpSystemTape(caption, writer);

    doc.writeln("</pre></body></html>")
    doc.close();
    win.focus();
}

/**************************************/
B5500ConsolePanel.prototype.displayCallbackState = function displayCallbackState() {
    /* Builds a table of outstanding callback state */
    var cb;
    var cbs;
    var e;
    var body = document.createElement("tbody");
    var oldBody = document.getElementById("CallbackBody");
    var row;
    var state = getCallbackState(0x03);
    var token;

    cbs = state.delayDev;
    for (token in cbs) {
        row = document.createElement("tr");

        e = document.createElement("td");
        e.appendChild(document.createTextNode(token));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode((cbs[token]||0).toFixed(2)));
        row.appendChild(e);

        e = document.createElement("td");
        e.colSpan = 2;
        row.appendChild(e);
        body.appendChild(row);
    }

    cbs = state.pendingCallbacks;
    for (token in cbs) {
        cb = cbs[token];
        row = document.createElement("tr");

        e = document.createElement("td");
        e.appendChild(document.createTextNode(token.toString()));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode(cb.delay.toFixed(2)));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode((cb.context && cb.context.mnemonic) || "??"));
        row.appendChild(e);

        e = document.createElement("td");
        e.appendChild(document.createTextNode((cb.args ? cb.args.length : 0).toString()));
        row.appendChild(e);
        body.appendChild(row);
    }

    body.id = oldBody.id;
    oldBody.parentNode.replaceChild(body, oldBody);
}

/**************************************/
B5500ConsolePanel.prototype.displayCentralControl = function displayCentralControl() {
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

    this.cc.fetchCCLatches(this.ccLatches);
    ccMask = this.ccLatches[0];
    ccChange = this.lastCCMask ^ ccMask;
    this.lastCCMask = ccMask;

    interruptMask = this.ccLatches[1] % 0x4000;
    interruptChange = this.lastInterruptMask ^ interruptMask;
    this.lastInterruptMask = interruptMask;

    unitBusyMask = this.ccLatches[2];
    unitBusyChange = this.lastUnitBusyMask ^ unitBusyMask;
    this.lastUnitBusyMask = unitBusyMask;

    x = 0;
    while (ccChange) {
        if (ccChange & 0x01) {
            if (this.ccLightsMap[x]) {
                this.ccLightsMap[x].style.visibility = (ccMask & 0x01 ? "visible" : "hidden");
            }
        }
        ccMask >>>= 1;
        ccChange >>>= 1;
        x++;
    }

    x = 47;
    while (interruptChange) {
        if (interruptChange & 0x01) {
            if (this.intLightsMap[x]) {
                this.intLightsMap[x].style.visibility = (interruptMask & 0x01 ? "visible" : "hidden");
            }
        }
        interruptMask >>>= 1;
        interruptChange >>>= 1;
        x--;
    }

    x = 47;
    while (unitBusyChange) {
        if (unitBusyChange & 0x01) {
            if (this.perLightsMap[x]) {
                this.perLightsMap[x].style.visibility = (unitBusyMask & 0x01 ? "visible" : "hidden");
            }
        }
        unitBusyMask >>>= 1;
        unitBusyChange >>>= 1;
        x--;
    }
}

/**************************************/
B5500ConsolePanel.prototype.dasBlinkenlichten = function dasBlinkenlichten() {
    /* Updates the panel display from current system state */
    var cycles;
    var pa = this.cc.PA;
    var pb = this.cc.PB;
    var p1 = this.cc.P1;
    var stateRate;

    cycles = p1.normalCycles+p1.controlCycles;

    if (pa) {
        if (pa.normalCycles+pa.controlCycles <= 0) {
            if (this.lastPAControlRate != -1) {
                this.lastPAControlRate = -1;
                this.aControl.className = "yellowButton";
                this.aNormal.className = "yellowButton";
            }
        } else {
            stateRate = Math.round(pa.normalCycles/cycles*6 + 0.25);
            if (stateRate != this.lastPANormalRate) {
                this.lastPANormalRate = stateRate;
                switch (stateRate) {
                case 0:
                    this.aNormal.className = "yellowButton";
                    break;
                case 1:
                    this.aNormal.className = "yellowButton yellowLit1";
                    break;
                case 2:
                    this.aNormal.className = "yellowButton yellowLit2";
                    break;
                case 3:
                    this.aNormal.className = "yellowButton yellowLit3";
                    break;
                case 4:
                    this.aNormal.className = "yellowButton yellowLit4";
                    break;
                case 5:
                    this.aNormal.className = "yellowButton yellowLit5";
                    break;
                default:
                    this.aNormal.className = "yellowButton yellowLit";
                    break;
                }
            }

            stateRate = Math.round(pa.controlCycles/cycles*6 + 0.25);
            if (stateRate != this.lastPAControlRate) {
                this.lastPAControlRate = stateRate;
                switch (stateRate) {
                case 0:
                    this.aControl.className = "yellowButton";
                    break;
                case 1:
                    this.aControl.className = "yellowButton yellowLit1";
                    break;
                case 2:
                    this.aControl.className = "yellowButton yellowLit2";
                    break;
                case 3:
                    this.aControl.className = "yellowButton yellowLit3";
                    break;
                case 4:
                    this.aControl.className = "yellowButton yellowLit4";
                    break;
                case 5:
                    this.aControl.className = "yellowButton yellowLit5";
                    break;
                default:
                    this.aControl.className = "yellowButton yellowLit";
                    break;
                }
            }

            pa.controlCycles = pa.normalCycles = 0;
        }
    }

    if (pb) {
        if (pb.normalCycles+pb.controlCycles <= 0) {
            if (this.lastPBControlRate != -1) {
                this.bControl.className = "yellowButton";
                this.bNormal.className = "yellowButton";
                this.lastPBControlRate = -1;
            }
        } else {
            stateRate = Math.round(pb.normalCycles/cycles*6 + 0.25);
            if (stateRate != this.lastPBNormalRate) {
                this.lastPBNormalRate = stateRate;
                switch (stateRate) {
                case 0:
                    this.bNormal.className = "yellowButton";
                    break;
                case 1:
                    this.bNormal.className = "yellowButton yellowLit1";
                    break;
                case 2:
                    this.bNormal.className = "yellowButton yellowLit2";
                    break;
                case 3:
                    this.bNormal.className = "yellowButton yellowLit3";
                    break;
                case 4:
                    this.bNormal.className = "yellowButton yellowLit4";
                    break;
                case 5:
                    this.bNormal.className = "yellowButton yellowLit5";
                    break;
                default:
                    this.bNormal.className = "yellowButton yellowLit";
                    break;
                }
            }

            stateRate = Math.round(pb.controlCycles/cycles*6 + 0.25);
            if (stateRate != this.lastPBControlRate) {
                this.lastPBControlRate = stateRate;
                switch (stateRate) {
                case 0:
                    this.bControl.className = "yellowButton";
                    break;
                case 1:
                    this.bControl.className = "yellowButton yellowLit1";
                    break;
                case 2:
                    this.bControl.className = "yellowButton yellowLit2";
                    break;
                case 3:
                    this.bControl.className = "yellowButton yellowLit3";
                    break;
                case 4:
                    this.bControl.className = "yellowButton yellowLit4";
                    break;
                case 5:
                    this.bControl.className = "yellowButton yellowLit5";
                    break;
                default:
                    this.bControl.className = "yellowButton yellowLit";
                    break;
                }
            }

            pb.controlCycles = pb.normalCycles = 0;
        }
    }

    this.procDelay.textContent = p1.delayDeltaAvg.toFixed(1);
    this.procSlack.textContent = (p1.procSlackAvg/p1.procRunAvg*100).toFixed(1);

    if (this.showAnnunciators) {
        this.displayCentralControl();
    }
    //this.displayCallbackState();
}

/**************************************/
B5500ConsolePanel.prototype.buildLightMaps = function buildLightMaps() {
    /* Builds tables of the DOM entries for the annunciator lights, for efficient access */
    var mnem;
    var spec;
    var x;

    this.ccLightsMap[0] = this.$$("AD1F");
    this.ccLightsMap[1] = this.$$("AD2F");
    this.ccLightsMap[2] = this.$$("AD3F");
    this.ccLightsMap[3] = this.$$("AD4F");
    this.ccLightsMap[4] = this.$$("P2BF");
    this.ccLightsMap[5] = this.$$("HP2F");

    for (x=3; x<=16; x++) {
        this.intLightsMap[50-x] = this.$$("CCI" + (x+100).toString().substring(1) + "F");
    }

    for (mnem in B5500CentralControl.unitSpecs) {
        spec = B5500CentralControl.unitSpecs[mnem];
        this.perLightsMap[spec.unitIndex] = this.$$(mnem);
    }
}

/**************************************/
B5500ConsolePanel.prototype.lampTest = function lampTest(callback, callbackParam) {
    /* Lights up the operator console, waits a bit, then turns everything
    off and calls the "callback" function, passing "callbackParam".
    The Power On lamp is not affected */
    var that = this;

    function switchEm(mode) {
        var visibility = (mode ? "visible" : "hidden");
        var x;

        that.$$("ANormalBtn").className = "yellowButton" + (mode ? " yellowLit" : "");
        that.$$("AControlBtn").className = "yellowButton" + (mode ? " yellowLit" : "");
        that.$$("BNormalBtn").className = "yellowButton" + (mode ? " yellowLit" : "");
        that.$$("BControlBtn").className = "yellowButton" + (mode ? " yellowLit" : "");
        that.$$("LoadSelectBtn").className = "yellowButton" + (mode ? " yellowLit" : "");
        that.$$("MemoryCheckBtn").className = "redButton" + (mode ? " redLit" : "");
        that.$$("NotReadyBtn").className = "whiteButton" + (mode ? " whiteLit" : "");
        that.$$("HaltBtn").className = "redButton" + (mode ? " redLit" : "");

        for (x in that.ccLightsMap) {
            if (that.ccLightsMap[x]) {
                that.ccLightsMap[x].style.visibility = visibility;
            }
        }

        for (x in that.intLightsMap) {
            if (that.intLightsMap[x]) {
                that.intLightsMap[x].style.visibility = visibility;
            }
        }

        for (x in that.perLightsMap) {
            if (that.perLightsMap[x]) {
                that.perLightsMap[x].style.visibility = visibility;
            }
        }

        if (!mode) {
            that.setAnnunciators(that.showAnnunciators);
            setCallback(null, that, 250, callback, callbackParam);
        }
    }

    this.setAnnunciators(true);
    this.$$("CentralControl").style.display = "block";   // overrides if !this.cc.poweredUp
    switchEm(1);
    setCallback(null, this, 2000, switchEm, 0);
}

/**************************************/
B5500ConsolePanel.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the emulator unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500ConsolePanel.prototype.consoleUnload = function consoleUnload(ev) {
    /* Called when the ConsolePanel window unloads or is closed */

    if (this.cc && this.cc.poweredUp) {
        this.cc.powerOff();
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = 0;
        }
    }

    this.shutDown();
};

/**************************************/
B5500ConsolePanel.prototype.clearStatusLabel = function clearStatusLabel(inSeconds) {
    /* Delays for "inSeconds" seconds, then clears the StatusLabel element */

    if (this.statusLabelTimer) {
        clearTimeout(this.statusLabelTimer);
    }

    this.statusLabelTimer = setCallback(null, this, inSeconds*1000, function(ev) {
        this.$$("StatusLabel").textContent = "";
        this.statusLabelTimer = 0;
    });
}

/**************************************/
B5500ConsolePanel.prototype.consoleOnload = function consoleOnload(ev) {
    /* Initialization function called when window finishes loading */

    this.doc = this.window.document;
    this.$$("RetroVersion").textContent = B5500CentralControl.version;
    this.window.name = "B5500Console";
    this.window.addEventListener("unload",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.consoleUnload));
    this.$$("BurroughsLogo").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.BurroughsLogo_Click));
    this.$$("B5500Logo").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.B5500Logo_Click));
    this.$$("PowerOnBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.PowerOnBtn_Click));
    this.$$("PowerOffBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.PowerOffBtn_Click));
    this.$$("HaltBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.HaltBtn_Click));
    this.$$("LoadBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.LoadBtn_Click));
    this.$$("LoadSelectBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500ConsolePanel.prototype.LoadSelectBtn_Click));
    this.$$("MemoryCheckBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, function(ev) {
                this.dumpState("Memory-Check Button");
    }));
    this.$$("NotReadyBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, function(ev) {
                this.dumpTape("Not-Ready Button");
    }));

    this.aControl = this.$$("AControlBtn");
    this.aNormal  = this.$$("ANormalBtn");
    this.bControl = this.$$("BControlBtn");
    this.bNormal  = this.$$("BNormalBtn");
    this.procDelay = this.$$("procDelay");
    this.procSlack = this.$$("procSlack");
    this.buildLightMaps();

    this.cc = new B5500CentralControl(this.global);
    this.global.B5500DumpState = this.dumpState;        // for use by Processor
    this.global.B5500DumpState = this.dumpTape;         // for use by Processor
    this.window.resizeTo(this.doc.documentElement.scrollWidth + this.window.outerWidth - this.window.innerWidth + 2, // kludge +2, dunno why
                         this.doc.documentElement.scrollHeight + this.window.outerHeight - this.window.innerHeight);
    this.window.moveTo(screen.availWidth - this.window.outerWidth, 0);
    this.window.focus();
    this.setAnnunciators(this.showAnnunciators);

    if (this.autoPowerUp) {
        setCallback(null, this, 1000, this.PowerOnBtn_Click, ev);
    }
};
