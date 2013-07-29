/***********************************************************************
* retro-b5500/emulator B5500DummyPrinter.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 (DUMMY) Line Printer Peripheral Unit module.
*
* Defines a Line Printer peripheral unit type. Journals all output to
* console.log() as well as the pritner window.
*
************************************************************************
* 2013-06-11  P.Kimpel
*   Original version, from B5500SPOUnit.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500DummyPrinter(mnemonic, unitIndex, designate, statusChange, signal) {
    /* Constructor for the DummyPrinter object */
    var that = this;

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. Printer Finished)

    this.timer = null;                  // setTimeout() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)

    this.clear();

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.paper = null;
    this.endOfPaper = null;
    this.window = window.open("/B5500/webUI/B5500DummyPrinter.html", mnemonic,
            "scrollbars,resizable,width=600,height=500");
    this.window.addEventListener("load", function windowOnLoad() {
        that.printerOnload();
    }, false);
}
B5500DummyPrinter.prototype.linesPerMinute = 1040; // B329 line printer
B5500DummyPrinter.maxScrollLines = 150000;         // Maximum printer scrollback (about a box of paper)


/**************************************/
B5500DummyPrinter.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500DummyPrinter.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the printer unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status
    this.activeIOUnit = 0;              // I/O unit currently using this device

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion
};

/**************************************/
B5500DummyPrinter.prototype.ripPaper = function ripPaper(ev) {
    /* Handles an event to clear the "paper" from the printer */

    if (this.window.confirm("Do you want to clear the \"paper\" from the printer?")) {
        while (this.paper.firstChild) {
            this.paper.removeChild(this.paper.firstChild);
        }
    }
};

/**************************************/
B5500DummyPrinter.prototype.appendLine = function appendLine(text) {
    /* Removes excess lines already printed, then appends a new <pre> element
    to the <iframe>, creating an empty text node inside the new element */
    var count = this.paper.childNodes.length;
    var line = this.doc.createTextNode(text || "");

    while (count-- > this.maxScrollLines) {
        this.paper.removeChild(this.paper.firstChild);
    }
    this.paper.appendChild(line);
};

/**************************************/
B5500DummyPrinter.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500DummyPrinter.prototype.printerOnload = function printerOnload() {
    /* Initializes the line printer window and user interface */
    var that = this;

    this.doc = this.window.document;
    this.doc.title = "retro-B5500 " + this.mnemonic;
    this.paper = this.doc.createElement("pre");
    this.doc.body.appendChild(this.paper);
    this.endOfPaper = this.doc.createElement("div");
    this.doc.body.appendChild(this.endOfPaper);

    this.window.moveTo(40, 40);
    this.window.resizeTo(1000, screen.availHeight*0.80);

    this.window.addEventListener("click", function windowOnClick(ev) {
        if (ev.detail == 2) { // check for left-button double-click
            that.ripPaper(ev);
        }
    }, false);

    this.window.addEventListener("beforeunload", this.beforeUnload, false);

    this.statusChange(1);
};

/**************************************/
B5500DummyPrinter.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit */

    console.log("READ:   L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    console.log("SPACE:  L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */
    var text;
    var that = this;

    this.errorMask = 0;
    text = String.fromCharCode.apply(null, buffer.subarray(0, length));
    //console.log("WRITE:  L=" + length + ", M=" + mode + ", C=" + control + " : " + text);
    if (length || control) {
        this.appendLine(text + "\n");
        if (control > 1) {
            this.appendLine("\n");
        } else if (control < 0) {
            this.paper.appendChild(this.doc.createElement("hr"));
        }
    }

    this.timer = setTimeout(this.signal,
        60000/this.linesPerMinute + this.initiateStamp - new Date().getTime());
    finish(this.errorMask, 0);
    this.endOfPaper.scrollIntoView();
};

/**************************************/
B5500DummyPrinter.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    console.log("ERASE:  L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    console.log("REWIND: L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    console.log("READCK: L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    console.log("READIG: L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit */

    console.log("WRITEG: L=" + length + ", M=" + mode + ", C=" + control + " : " +
        String.fromCharCode.apply(null, buffer.subarray(0, length)));
    finish(0x04, 0);
};

/**************************************/
B5500DummyPrinter.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearTimeout(this.timer);
    }
    this.window.removeEventListener("beforeunload", this.beforeUnload, false);
    this.window.close();
};