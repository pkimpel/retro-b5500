/***********************************************************************
* retro-b5500/emulator B5500LinePrinter.js
************************************************************************
* Copyright (c) 2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Line Printer Peripheral Unit module.
*
* Defines a Line Printer peripheral unit type.
*
************************************************************************
* 2014-08-31  P.Kimpel
*   Original version, cloned from B5500DummyPrinter.js and B5500CardPunch.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500LinePrinter(mnemonic, unitIndex, designate, statusChange, signal, options) {
    /* Constructor for the LinePrinter object */
    var h = screen.availHeight*0.60;
    var w = 900;

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. Printer Finished)

    this.timer = 0;                     // setCallback() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)
    this.useAlgolGlyphs = options.algolGlyphs; // format Unicode for special Algol chars
    this.lpi = 6;                       // lines/inch (actually, lines per greenbar group, should be even)

    this.clear();

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.barGroup = null;               // current greenbar line group
    this.paper = null;                  // the "paper" we print on
    this.endOfPaper = null;             // dummy element used to control scrolling
    this.paperMeter = null;             // <meter> element showing amount of paper remaining
    this.window = window.open("../webUI/B5500LinePrinter.html", mnemonic,
            "location=no,scrollbars,resizable,width=" + w + ",height=" + h +
            ",left=0,top=" + (screen.availHeight - h));
    this.window.addEventListener("load",
        B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.printerOnload), false);
}
B5500LinePrinter.prototype.linesPerMinute = 1040;       // B329 line printer
B5500LinePrinter.prototype.maxPaperLines = 150000;      // maximum printer scrollback (about a box of paper)
B5500LinePrinter.prototype.rtrimRex = /\s+$/g;          // regular expression for right-trimming lines

/**************************************/
B5500LinePrinter.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500LinePrinter.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the printer unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion

    this.paperLeft = this.maxPaperLines;// lines remaining in paper supply
    this.formFeedCount = 0;             // counter for triple-formfeed => rip paper
    this.groupLinesLeft = 0;            // lines remaining in current greenbar group
    this.topOfForm = false;             // start new page flag
};

/**************************************/
B5500LinePrinter.prototype.setPrinterReady = function setPrinterReady(ready) {
    /* Controls the ready-state of the line printer */

    this.formFeedCount = 0;
    if (ready && !this.ready) {
        this.statusChange(1);
        B5500Util.addClass(this.$$("LPStartBtn"), "greenLit")
        B5500Util.removeClass(this.$$("LPNotReadyLight"), "whiteLit");
        this.ready = true;
    } else if (!ready && this.ready) {
        this.statusChange(0);
        B5500Util.removeClass(this.$$("LPStartBtn"), "greenLit")
        B5500Util.addClass(this.$$("LPNotReadyLight"), "whiteLit");
        this.ready = false;
    }
};

/**************************************/
B5500LinePrinter.prototype.ripPaper = function ripPaper(ev) {
    /* Handles an event to clear the "paper" from the printer */

    this.formFeedCount = 0;
    if (this.window.confirm("Do you want to clear the \"paper\" from the printer?")) {
        B5500Util.removeClass(this.$$("LPEndOfPaperBtn"), "whiteLit");
        this.paperMeter.value = this.paperLeft = this.maxPaperLines;
        while (this.paper.firstChild) {
            this.paper.removeChild(this.paper.firstChild);
        }
    }
};

/**************************************/
B5500LinePrinter.prototype.appendLine = function appendLine(text) {
    /* Appends one line, with a trailing new-line character, to the current
    greenbar group, this.barGroup. This handles top-of-form and greenbar
    highlighting */
    var feed = "\n";

    if (this.groupLinesLeft <= 0) {
        // Start the green half of a greenbar group
        this.barGroup = this.doc.createElement("pre");
        this.paper.appendChild(this.barGroup);
        this.groupLinesLeft = this.lpi;
        if (!this.atTopOfForm) {
            this.barGroup.className = "paper greenBar";
        } else {
            this.atTopOfForm = false;
            this.barGroup.className = "paper greenBar topOfForm";
        }
    } else if (this.groupLinesLeft*2 == this.lpi) {
        // Start the white half of a greenbar group
        this.barGroup = this.doc.createElement("pre");
        this.paper.appendChild(this.barGroup);
        this.barGroup.className = "paper whiteBar";
    } else if (this.groupLinesLeft == 1) {
        feed = "";                      // no linefeed at end of a bar group
    } else if ((this.groupLinesLeft-1)*2 == this.lpi) {
        feed = "";                      // ditto
    }

    this.barGroup.appendChild(this.doc.createTextNode(text + feed));
    --this.groupLinesLeft;
};

/**************************************/
B5500LinePrinter.prototype.printLine = function printLine(text, control) {
    /* Prints one line to the "paper", handling carriage control and greenbar
    group completion. For now, SPACE 0 (overprintng) is treated as single-spacing */
    var lines = 1;

    this.appendLine(text || "");
    if (control > 1) {
        ++lines;
        this.appendLine("");
    } else if (control < 0) {
        while(this.groupLinesLeft > 0) {
            ++lines;
            this.appendLine("");
        }
        this.atTopOfForm = true;
    }

    if (this.paperLeft > 0) {
        this.paperMeter.value = this.paperLeft -= lines;
    } else {
        this.setPrinterReady(false);
        B5500Util.addClass(this.$$("LPEndOfPaperBtn"), "whiteLit");
    }
};

/**************************************/
B5500LinePrinter.prototype.setAlgolGlyphs = function setAlgolGlyphs(makeItPretty) {
    /* Controls the arming/disarming of the EOF signal when starting with
    an empty input Paper */

    if (makeItPretty) {
        B5500Util.addClass(this.$$("LPAlgolGlyphsBtn"), "whiteLit");
        if (!this.useAlgolGlyphs) {
            B5500Util.xlateDOMTreeText(this.paper, B5500Util.xlateASCIIToAlgol);
        }
    } else {
        B5500Util.removeClass(this.$$("LPAlgolGlyphsBtn"), "whiteLit");
        if (this.useAlgolGlyphs) {
            B5500Util.xlateDOMTreeText(this.paper, B5500Util.xlateAlgolToASCII);
        }
    }
    this.useAlgolGlyphs = makeItPretty;
};

/**************************************/
B5500LinePrinter.prototype.LPStartBtn_onclick = function LPStartBtn_onclick(ev) {
    /* Handle the click event for the START button */

    if (!this.ready && this.paperLeft > 0) {
        this.setPrinterReady(true);
    }
};

/**************************************/
B5500LinePrinter.prototype.LPStopBtn_onclick = function LPStopBtn_onclick(ev) {
    /* Handle the click event for the STOP button */

    if (this.ready) {
        this.setPrinterReady(false);
    }
};

/**************************************/
B5500LinePrinter.prototype.LPSpaceBtn_onclick = function LPSpaceBtn_onclick(ev) {
    /* Handle the click event for the Skip To Heading button */

    if (!this.ready) {
        this.printLine("", 1);
        this.endOfPaper.scrollIntoView();
    }
};

/**************************************/
B5500LinePrinter.prototype.LPFormFeedBtn_onclick = function LPFormFeedBtn_onclick(ev) {
    /* Handle the click event for the Skip To Heading button */

    if (!this.ready) {
        this.printLine("", -1);
        this.endOfPaper.scrollIntoView();
        if (++this.formFeedCount >= 3) {
            this.ripPaper();
        }
    }
};

/**************************************/
B5500LinePrinter.prototype.LPEndOfPaperBtn_onclick = function LPEndOfPaperBtn_onclick(ev) {
    /* Handle the click event for the End Of Paper button. If the printer is in
    and end-of-paper condition, this will make the printer ready, but it will
    still be in an EOP condition. The next time a print line is received, the
    EOP condition will force it not-ready again. You can print only one line
    at a time (presumably to the end of the current page. The EOP condition can
    be cleared by clicking Skip To Heading three times to "rip" the paper */

    if (this.paperLeft <= 0 && !this.ready) {
        this.formFeedCount = 0;
        B5500Util.removeClass(this.$$("LPEndOfPaperBtn"), "whiteLit");
        this.setPrinterReady(true);
    }
};

/**************************************/
B5500LinePrinter.prototype.LPAlgolGlyphsBtn_onclick = function LPAlgolGlyphsBtn_onclick(ev) {
    /* Handle the click event for the Algol Glyphs button */

    this.setAlgolGlyphs(!this.useAlgolGlyphs);
};

/**************************************/
B5500LinePrinter.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500LinePrinter.prototype.printerOnload = function printerOnload() {
    /* Initializes the line printer window and user interface */
    var newChild;
    var paperFrame;

    this.doc = this.window.document;
    this.doc.title = "retro-B5500 Line Printer " + this.mnemonic;

    paperFrame = this.$$("LPPaperFrame");
    this.paper = paperFrame.contentDocument.getElementById("Paper");
    this.endOfPaper = paperFrame.contentDocument.getElementById("EndOfPaper");
    this.paperMeter = this.$$("LPPaperMeter");

    newChild = paperFrame.contentDocument.createElement("div");
    newChild.id = this.paper.id;
    this.paper.parentNode.replaceChild(newChild, this.paper);
    this.paper = newChild;

    this.setAlgolGlyphs(this.useAlgolGlyphs);
    this.paperMeter.max = this.maxPaperLines;
    this.paperMeter.low = this.maxPaperLines*0.1;
    this.paperMeter.value = this.paperLeft = this.maxPaperLines;
    this.setPrinterReady(true);

    this.window.addEventListener("beforeunload",
            B5500LinePrinter.prototype.beforeUnload, false);
    this.$$("LPEndOfPaperBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.LPEndOfPaperBtn_onclick), false);
    this.$$("LPFormFeedBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.LPFormFeedBtn_onclick), false);
    this.$$("LPSpaceBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.LPSpaceBtn_onclick), false);
    this.$$("LPAlgolGlyphsBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.LPAlgolGlyphsBtn_onclick), false);
    this.$$("LPStopBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.LPStopBtn_onclick), false);
    this.$$("LPStartBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500LinePrinter.prototype.LPStartBtn_onclick), false);
};

/**************************************/
B5500LinePrinter.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */
    var text;

    this.errorMask = 0;
    if (length > 0) {
        text = String.fromCharCode.apply(null, buffer.subarray(0, length)).replace(this.rtrimRex, '');
        if (this.useAlgolGlyphs) {
            text = B5500Util.xlateASCIIToAlgol(text);
        }
    }

    if (control || length) {
        this.printLine(text, control);
    }

    this.timer = setCallback(this.mnemonic, this,
        60000/this.linesPerMinute + this.initiateStamp - performance.now(),
        this.signal);
    finish(this.errorMask, 0);
    this.endOfPaper.scrollIntoView();
};

/**************************************/
B5500LinePrinter.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit */

    finish(0x04, 0);
};

/**************************************/
B5500LinePrinter.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearCallback(this.timer);
    }
    this.window.removeEventListener("beforeunload", B5500LinePrinter.prototype.beforeUnload, false);
    this.window.close();
};