/***********************************************************************
* retro-b5500/emulator B5500DatacomUnit.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Datacom Peripheral Unit module.
*
* Defines a Datacom peripheral unit type that implements:
*   - The B249 Data Transmission Control Unit (DTCU), with
*   - A single B487 Data Transmission Terminal Unit (DTTU), having
*   - A single type 980 (teletype) adapter with a 112-character buffer.
*
* The user interface emulates a simple teletype device, similar to the SPO.
*
* Note that the results from the DCA are unusual, in that the terminal unit
* (TU) and buffer numbers are returned in [8:10] of the error mask.
*
************************************************************************
* 2013-10-19  P.Kimpel
*   Original version, cloned from B5500SPOUnit.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500DatacomUnit(mnemonic, unitIndex, designate, statusChange, signal, options) {
    /* Constructor for the DatacomUnit object */

    this.maxScrollLines = 5000;         // Maximum amount of printer scrollback
    this.charPeriod = 100;              // Printer speed, milliseconds per character
    this.bufferSize = 112;              // 4 28-character B487 buffer segments

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. Datacom inquiry request)

    this.buffer = new ArrayBuffer(448); // adapter buffer storage
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)
    this.inTimer = 0;                   // input setCallback() token
    this.outTimer = 0;                  // output setCallback() token

    this.clear();

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy any previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.paper = null;
    this.endOfPaper = null;
    this.window = window.open("../webUI/B5500DatacomUnit.html", mnemonic,
            "location=no,scrollbars,resizable,width=520,height=540");
    this.window.addEventListener("load", B5500CentralControl.bindMethod(this,
            B5500DatacomUnit.prototype.datacomOnload), false);
}

// this.bufState enumerations
B5500DatacomUnit.prototype.bufNotReady = 0;
B5500DatacomUnit.prototype.bufIdle = 1;
B5500DatacomUnit.prototype.bufInputBusy = 2;
B5500DatacomUnit.prototype.bufReadReady = 3;
B5500DatacomUnit.prototype.bufOutputBusy = 4;
B5500DatacomUnit.prototype.bufWriteReady = 5;

B5500DatacomUnit.prototype.keyFilter = [    // Filter keyCode values to valid BCL ones
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // 00-0F
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // 10-1F
        0x20,0x7D,0x22,0x23,0x24,0x25,0x26,0x7B,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,  // 20-2F
        0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x00,0x3D,0x00,0x3F,  // 30-3F
        0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 40-4F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x7C,0x5D,0x21,0x7E,  // 50-5F
        0x00,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 60-6F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x00,0x00,0x00,0x7E,0x00]; // 70-7F

/**************************************/
B5500DatacomUnit.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500DatacomUnit.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the datacom unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.abnormal = false;              // buffer in abnormal state
    this.bufIndex = 0;                  // current offset into buffer
    this.bufCheckPoint = 0;             // last bufIndex when input overflowed a line
    this.bufLength = 0;                 // current buffer length
    this.connected = false;             // buffer/adapter is currently connected
    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion
    this.fullBuffer = false;            // buffer is full (unterminated)
    this.interrupt = false;             // buffer in interrupt state
    this.nextCharTime = 0;              // next output character time
    this.printCol = 0;                  // current printer column

    this.bufState = this.bufNotReady;   // Current state of datacom buffer
};

/**************************************/
B5500DatacomUnit.prototype.showBufferIndex = function showBufferIndex() {
    /* Formats the buffer index and length, and the column counter, for display */

    this.$$("BufferOffset").textContent = this.bufIndex.toString();
    this.$$("BufferLength").textContent = this.bufLength.toString();
    this.$$("PrintColumn").textContent = (this.printCol+1).toString();
};

/**************************************/
B5500DatacomUnit.prototype.setState = function setState(newState) {
    /* Sets a new state in this.bufState and updates the annunciators appropriately */

    this.showBufferIndex();

    if (this.abnormal) {
        B5500Util.addClass(this.$$("Abnormal"), "textLit")
    } else {
        B5500Util.removeClass(this.$$("Abnormal"), "textLit");
    }

    if (this.interrupt) {
        B5500Util.addClass(this.$$("Interrupt"), "textLit")
    } else {
        B5500Util.removeClass(this.$$("Interrupt"), "textLit");
    }

    if (this.fullBuffer) {
        B5500Util.addClass(this.$$("FullBuffer"), "textLit")
    } else {
        B5500Util.removeClass(this.$$("FullBuffer"), "textLit");
    }

    if (this.bufState != newState) {
        switch (this.bufState) {
        case this.bufNotReady:
            B5500Util.removeClass(this.$$("NotReadyState"), "textLit");
            break;
        case this.bufIdle:
            B5500Util.removeClass(this.$$("IdleState"), "textLit");
            break;
        case this.bufInputBusy:
            B5500Util.removeClass(this.$$("InputBusyState"), "textLit");
            break;
        case this.bufReadReady:
            B5500Util.removeClass(this.$$("ReadReadyState"), "textLit");
            break;
        case this.bufOutputBusy:
            B5500Util.removeClass(this.$$("OutputBusyState"), "textLit");
            break;
        case this.bufWriteReady:
            B5500Util.removeClass(this.$$("WriteReadyState"), "textLit");
            break;
        }

        switch (newState) {
        case this.bufNotReady:
            B5500Util.addClass(this.$$("NotReadyState"), "textLit");
            break;
        case this.bufIdle:
            B5500Util.addClass(this.$$("IdleState"), "textLit");
            break;
        case this.bufInputBusy:
            B5500Util.addClass(this.$$("InputBusyState"), "textLit");
            break;
        case this.bufReadReady:
            B5500Util.addClass(this.$$("ReadReadyState"), "textLit");
            break;
        case this.bufOutputBusy:
            B5500Util.addClass(this.$$("OutputBusyState"), "textLit");
            break;
        case this.bufWriteReady:
            B5500Util.addClass(this.$$("WriteReadyState"), "textLit");
            break;
        }

        this.bufState = newState;
    }
};

/**************************************/
B5500DatacomUnit.prototype.termDisconnect = function termDisconnect() {
    /* Sets the status of the datacom unit to disconnected */

    if (this.connected) {
        this.bufLength = 0;
        this.bufIndex = 0;
        B5500Util.removeClass(this.$$("TermConnectBtn"), "greenLit");
        this.interrupt = true;
        this.abnormal = true;
        this.setState(this.bufIdle);
        this.signal();
        this.connected = false;
    }
};

/**************************************/
B5500DatacomUnit.prototype.termConnect = function termConnect() {
    /* Sets the status of the datacom unit to connected */

    if (!this.connected) {
        B5500Util.addClass(this.$$("TermConnectBtn"), "greenLit");
        this.interrupt = true;
        this.abnormal = true;
        this.setState(this.bufWriteReady);
        this.signal();
        this.connected = true;
    }
};

/**************************************/
B5500DatacomUnit.prototype.appendEmptyLine = function appendEmptyLine(text) {
    /* Removes excess lines already printed, then appends a new <pre> element
    to the <iframe>, creating an empty text node inside the new element */
    var count = this.paper.childNodes.length;
    var line = text || "";

    while (--count > this.maxScrollLines) {
        this.paper.removeChild(this.paper.firstChild);
    }
    this.paper.lastChild.nodeValue += "\n";     // newline
    this.paper.appendChild(this.doc.createTextNode(line));
};

/**************************************/
B5500DatacomUnit.prototype.backspaceChar = function backspaceChar() {
    /* Handles backspace for datacom buffer input */
    var line = this.paper.lastChild;

    if (this.bufLength > 0) {
        this.bufIndex--;
        this.showBufferIndex();
    }
};

/**************************************/
B5500DatacomUnit.prototype.printChar = function printChar(c) {
    /* Echoes the character code "c" to the terminal display */
    var col = this.printCol;
    var line = this.paper.lastChild.nodeValue;
    var len = line.length;

    if (col < 72) {
        while (len < col) {
            line += " ";
            ++len;
        }
        if (len > col) {
            line = line.substring(0, col) + String.fromCharCode(c) + line.substring(col+1);
        } else {
            line += String.fromCharCode(c);
        }
        ++this.printCol;
    } else {
         line = line.substring(0, 71) + String.fromCharCode(c);
    }
    this.paper.lastChild.nodeValue = line;
};

/**************************************/
B5500DatacomUnit.prototype.outputChar = function outputChar() {
    /* Outputs one character from the buffer to the terminal display. If more characters remain
    to be printed, schedules itself 100 ms later to print the next one, otherwise
    calls finished(). If the column counter exceeds 72, the last character over-types.
    Note that Group Mark (left-arrow) detection is done by IOUnit in preparing the buffer */
    var c;
    var delay;
    var nextTime;
    var stamp;

    if (this.bufIndex >= this.bufLength) {
        this.interrupt = true;
        this.setState(this.fullBuffer ? this.bufWriteReady : this.bufIdle);
        this.signal();
    } else {
        stamp = performance.now();
        nextTime = (this.nextCharTime < stamp ? stamp : this.nextCharTime) + this.charPeriod;
        delay = nextTime - stamp;
        this.nextCharTime = nextTime;

        c = this.buffer[this.bufIndex++];
        switch (c) {
        case 0x21:      // ! not-equal, output LF
            this.endOfPaper.scrollIntoView();
            this.appendEmptyLine();
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
            break;
        case 0x3C:      // < less-than, output RO (DEL)
        case 0x3E:      // > greater-than, output X-ON (DC1)
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
            break;              // do nothing, just delay
        case 0x7B:      // { less-or-equal, output CR
            this.printCol = 0;
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
            break;
        case 0x7D:      // } greater-or-equal, disconnect
            this.termDisconnect();
            break;
        case 0x7E:      // ~ left-arrow, end-of-message (should never happen)
            this.bufIndex = this.bufLength;
            this.outTimer = setCallback(this.mnemonic, this, 0, this.outputChar);
        default:
            this.printChar(c);
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
            break;
        }
        this.showBufferIndex();
    }
};

/**************************************/
B5500DatacomUnit.prototype.terminateInput = function terminateInput() {
    /* Handles the End of Message event */

    this.interrupt = true;
    this.setState(this.bufReadReady);
    this.signal();
};

/**************************************/
B5500DatacomUnit.prototype.keyAction = function keyAction(ev, c) {
    /* Implements the semantics of keyboard events from keyPress or keyDown.
    Depending on the state of the buffer, either buffers the character for
    transmission to the I/O Unit, echos it to the printer, or ignores it
    altogether */
    var b;                              // translated character
    var delay;                          // inter-character delay, ms
    var nextTime;                       // next character output time, ms
    var stamp;                          // current timestamp, ms

    //this.$$("CharCode").textContent = c.toString() + ":0x" + c.toString(16);

    if (this.connected) {
        stamp = performance.now();
        if (this.bufState == this.bufIdle) {
            this.bufIndex = this.bufLength = 0;
            this.nextCharTime = stamp;
        }

        nextTime = this.nextCharTime + this.charPeriod;
        delay = nextTime - stamp;

        if (this.bufState == this.bufReadReady && this.fullBuffer) {
            this.interrupt = true;
            this.setState(this.bufInputBusy);
            setCallback(this.mnemonic, this, delay, this.signal);       // buffer overflow
            ev.stopPropagation();
            ev.preventDefault();
        } else if (this.bufState == this.bufInputBusy || this.bufState == this.bufIdle) {
            switch (c) {
            case 0x7E:                  // ~ left-arrow (Group Mark), end of message
            case 0x5F:                  // _ underscore (TTY left-arrow), end of message
                this.inTimer = setCallback(this.mnemonic, this, delay, this.printChar, c);
                this.nextCharTime = this.charPeriod + nextTime;
                setCallback(this.mnemonic, this, this.charPeriod+delay, this.terminateInput);
                ev.stopPropagation();
                ev.preventDefault();
                break;
            case 0x3C:                  // <, backspace
                if (this.bufIndex > 0) {
                    --this.bufIndex;
                }
                this.inTimer = setCallback(this.mnemonic, this, delay, this.printChar, c);
                this.nextCharTime = nextTime;
                ev.stopPropagation();
                ev.preventDefault();
                break;
            case 0x21:                  // !, EOT, send disconnect request
                this.buffer[this.bufIndex++] = 0x7D;    // } greater-or-equal code
                this.interrupt = true;
                this.abnormal = true;
                this.setState(this.bufReadReady);
                setCallback(this.mnemonic, this, delay, this.signal);
                this.inTimer = setCallback(this.mnemonic, this, delay, this.printChar, c);
                this.nextCharTime = nextTime;
                ev.stopPropagation();
                ev.preventDefault();
                break;
            case 0x02:                  // Ctrl-B, STX, break on input
                this.bufIndex = this.bufLength = 0;
                this.setState(this.bufIdle);
                ev.stopPropagation();
                ev.preventDefault();
                break;
            case 0x05:                  // Ctrl-E, ENQ, who-are-you (WRU)
                if (this.bufState == this.bufIdle || this.bufState == this.bufInputBusy) {
                    this.interrupt = true;
                    this.abnormal = true;
                    this.setState(this.bufWriteReady);
                    setCallback(this.mnemonic, this, delay, this.signal);
                }
                ev.stopPropagation();
                ev.preventDefault();
                break;
            case 0x0C:                  // Ctrl-L, FF, clear input buffer
                if (this.bufState == this.bufInputBusy) {
                    this.bufIndex = this.bufLength = 0;
                    this.setState(this.bufIdle);
                }
                ev.stopPropagation();
                ev.preventDefault();
                break;
            case 0x3F:                  // ? question-mark, set abnormal for control message
                this.abnormal = true;
                this.setState(this.bufState);       // just to turn on the annunciator
                // no break
            default:
                b = this.keyFilter[c];
                if (b) {                // if it's a character we will accept
                    this.buffer[this.bufIndex++] = b;
                    if (c >= 0x61 && c <= 0x7A) {
                        c -= 32;        // up-case echoed letters
                    }
                    this.inTimer = setCallback(this.mnemonic, this, delay, this.printChar, c);
                    this.nextCharTime = nextTime;
                    if (this.bufIndex < this.bufferSize) {
                        this.setState(this.bufInputBusy);
                    } else {
                        this.interrupt = true;
                        this.fullBuffer = true;
                        this.setState(this.bufReadReady);
                        setCallback(this.mnemonic, this, this.charPeriod+delay, this.signal);  // full buffer, no GM detected
                    }
                    ev.stopPropagation();
                    ev.preventDefault();
                }
                break;
            } // switch c
        } else if (this.bufState == this.bufOutputBusy) {
            if (c == 0x02) {            // Ctrl-B, STX, break on output
                this.interrupt = true;
                this.abnormal = true;
                this.setState(this.bufReadReady);
                setCallback(this.mnemonic, this, delay, this.signal);
                ev.stopPropagation();
                ev.preventDefault();
            }
        }
    }
};

/**************************************/
B5500DatacomUnit.prototype.keyPress = function keyPress(ev) {
    /* Handles the onkeypress event by simply passing the event and character
    on to this.keyAction */
    var c = ev.charCode;

    if (ev.ctrlKey) {
        c = 0;                          // not something we want
    }

    this.keyAction(ev, c);
};

/**************************************/
B5500DatacomUnit.prototype.keyDown = function keyDown(ev) {
    /* Handles the onkeydown event. Translates non-character keystrokes
    to their character equivalents, then passes the substitute character
    on to this.keyAction */

    switch(ev.keyCode) {
    case 0x08:                          // BS: force Backspace key
        this.keyAction(ev, 0x3C);
        break;
    case 0x0D:                          // Enter: force ~ (GM) for end-of-message
        this.keyAction(ev, 0x7E);
        break;
    case 0x42:
        if (ev.ctrlKey) {
            this.keyAction(ev, 0x02);   // Ctrl-B: force STX, break
        }
        break;
    case 0x44:
        if (ev.ctrlKey) {
            this.keyAction(ev, 0x21);   // Ctrl-D: force EOT, disconnect request
        }
        break;
    case 0x45:
        if (ev.ctrlKey) {
            this.keyAction(ev, 0x05);   // Ctrl-E:force ENQ, WRU
        }
        break;
    case 0x4C:
        if (ev.ctrlKey) {
            this.keyAction(ev, 0x0C);   // Ctrl-L: force FF, clear input buffer
        }
        break;
    case 0x51:
        if (ev.ctrlKey) {
            this.keyAction(ev, 0x7E);   // Ctrl-Q: DC1, X-ON to ~ (GM) for end-of-message
        }
        break;
    }
};

/**************************************/
B5500DatacomUnit.prototype.termConnectBtnClick = function termConnectBtnClick(ev) {

    if (this.connected) {
        this.termDisconnect();
    } else {
        this.termConnect();
    }
    ev.target.blur();                   // move focus off the Connect btn
    this.paper.focus();
};

/**************************************/
B5500DatacomUnit.prototype.copyPaper = function copyPaper(ev) {
    /* Copies the text contents of the "paper" area of the SPO, opens a new
    temporary window, and pastes that text into the window so it can be copied
    or saved by the user */
    var text = ev.target.textContent;
    var title = "B5500 " + this.mnemonic + " Text Snapshot";
    var win = window.open("./B5500FramePaper.html", this.mnemonic + "-Snapshot",
            "location=no,scrollbars,resizable,width=500,height=500");

    win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    win.addEventListener("load", function() {
        var doc;

        doc = win.document;
        doc.title = title;
        doc.getElementById("Paper").textContent = text;
    });

    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B5500DatacomUnit.prototype.resizeWindow = function resizeWindow(ev) {
    /* Handles the window onresize event by scrolling the "paper" so that it
    remains at the end */

    this.endOfPaper.scrollIntoView();
};

/**************************************/
B5500DatacomUnit.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500DatacomUnit.prototype.datacomOnload = function datacomOnload() {
    /* Initializes the datacom unit and terminal window user interface */
    var x;

    this.doc = this.window.document;
    this.doc.title = "retro-B5500 Datacom Unit " + this.mnemonic + ": TU/BUF=01/00";
    this.paper = this.$$("Paper");
    this.endOfPaper = this.$$("EndOfPaper");

    this.window.addEventListener("beforeunload",
            B5500DatacomUnit.prototype.beforeUnload, false);
    this.window.addEventListener("resize",
            B5500CentralControl.bindMethod(this, B5500DatacomUnit.prototype.resizeWindow), false);
    this.window.addEventListener("keydown",
            B5500CentralControl.bindMethod(this, B5500DatacomUnit.prototype.keyDown), false);
    this.window.addEventListener("keypress",
            B5500CentralControl.bindMethod(this, B5500DatacomUnit.prototype.keyPress), false);
    this.$$("TermOut").addEventListener("keypress",
            B5500CentralControl.bindMethod(this, B5500DatacomUnit.prototype.keyPress), false);
    this.paper.addEventListener("dblclick",
            B5500CentralControl.bindMethod(this, B5500DatacomUnit.prototype.copyPaper), false);
    this.$$("TermConnectBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500DatacomUnit.prototype.termConnectBtnClick), false);

    this.statusChange(1);               // make DCA ready
    this.window.moveTo((screen.availWidth-this.window.outerWidth)/2,
                       (screen.availHeight-this.window.outerHeight)/2);
    this.window.focus();
    this.nextCharTime = performance.now();
};

/**************************************/
B5500DatacomUnit.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit. "control" is the TU/BUF# */
    var actualLength = 0;
    var bufNr;
    var tuNr;
    var transparent;
    var x;

    this.errorMask = 0x100 + (mode & 0x01)*0x800; // set the read [24:1] and mode [21:1] bits in the mask
    bufNr = control % 0x10;
    transparent = (control % 0x20) >>> 4;
    tuNr = (control % 0x200) >>> 5;

    switch (true) {
    case tuNr != 1:
    case bufNr != 0:
        this.errorMask |= 0x34;         // not this TU/BUF -- set buffer not ready
        break;
    case !this.connected:
        this.errorMask |= 0x34;         // not connected -- set buffer not ready
        break;
    case this.bufState == this.bufReadReady:
        // Copy the adapter buffer to the IOUnit buffer
        actualLength = (transparent ? this.bufferSize : this.bufIndex);
        for (x=0; x<actualLength; ++x) {
            buffer[x] = this.buffer[x];
        }

        // Set the state bits in the result and reset the adapter to idle
        if (this.abnormal) {
            this.errorMask |= 0x200;    // set abnormal bit
        }
        if (this.fullBuffer || transparent) {
            this.errorMask |= 0x80;     // set no-GM/buffer-exhausted bit
        }
        this.bufIndex = this.bufLength = 0;
        this.interrupt = false;
        this.abnormal = false;
        this.fullBuffer = false;
        this.setState(this.bufIdle);
        break;
    case this.bufState == this.bufWriteReady:
        this.errorMask |= 0x20;         // attempt to read a write-ready buffer
        break;
    case this.bufState == this.bufInputBusy:
    case this.bufState == this.bufOutputBusy:
        this.errorMask |= 0x30;         // buffer busy
        break;
    default:
        this.errorMask |= 0x34;         // buffer idle or not ready
        break;
    } // switch (true)

    this.errorMask += bufNr*0x40000000 + tuNr*0x800000000;

    //console.log(this.mnemonic + " Read:  " + control.toString(8) + ":" + this.errorMask.toString(8) + " (" +
    //    actualLength + ") " + (actualLength ? String.fromCharCode.apply(null, buffer.subarray(0, actualLength)) : 0));

    finish(this.errorMask, actualLength);
};

/**************************************/
B5500DatacomUnit.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DatacomUnit.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit. "control" is the TU/BUF# */
    var actualLength = 0;
    var bufNr;
    var tuNr;
    var transparent;
    var x;

    this.errorMask = (mode & 0x01)*0x800; // set the mode [21:1] bit in the mask
    bufNr = control % 0x10;
    transparent = (control % 0x20) >>> 4;
    tuNr = (control % 0x200) >>> 5;

    switch (true) {
    case tuNr != 1:
    case bufNr != 0:
        this.errorMask |= 0x34;         // not this TU/BUF -- buffer not ready
        break;
    case !this.connected:
        this.errorMask |= 0x34;         // not connected -- buffer not ready
        break;
    case this.bufState == this.bufIdle:
    case this.bufState == this.bufWriteReady:
        // Copy the IOUnit buffer to the adapter buffer
        if (transparent) {
            actualLength = this.bufferSize;
            this.fullBuffer = false;    // or should it be true for transparent?
        } else if (length < this.bufferSize) {
            actualLength = length;
            this.fullBuffer = false;
        } else {
            actualLength = this.bufferSize;
            this.fullBuffer = true;
        }
        for (x=0; x<actualLength; ++x) {
            this.buffer[x] = buffer[x];
        }

        // Set the state bits in the result and start printing
        if (this.abnormal) {
            this.errorMask |= 0x200;    // set abnormal bit
        }
        if (this.fullBuffer || transparent) {
            this.errorMask |= 0x80;     // set no-GM/buffer-exhausted bit
        }
        this.bufIndex = 0;
        this.bufLength = actualLength;
        this.interrupt = false;
        this.abnormal = false;
        this.setState(this.bufOutputBusy);
        this.nextCharTime = this.initiateStamp;
        this.outputChar();              // start the printing process
        break;
    case this.bufState == this.bufReadReady:
        this.errorMask |= 0x20;         // attempt to write a read-ready buffer
        break;
    case this.bufState == this.bufInputBusy:
    case this.bufState == this.bufOutputBusy:
        this.errorMask |= 0x30;         // buffer busy
        break;
    default:
        this.errorMask |= 0x34;         // buffer not ready
        break;
    } // switch (true)

    this.errorMask += bufNr*0x40000000 + tuNr*0x800000000;

    //console.log(this.mnemonic + " Write: " + control.toString(8) + ":" + this.errorMask.toString(8) + " (" +
    //    actualLength + ") " + (actualLength ? String.fromCharCode.apply(null, buffer.subarray(0, actualLength)) : ""));

    finish(this.errorMask, actualLength);
};

/**************************************/
B5500DatacomUnit.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DatacomUnit.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DatacomUnit.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DatacomUnit.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DatacomUnit.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit. "control" is the TU/BUF# */
    var bufNr;
    var tuNr;

    this.errorMask = 0;                 // default result is idle
    bufNr = control % 0x10;
    tuNr = (control % 0x200) >>> 5;

    if (tuNr > 1) {
        this.errorMask |= 0x34;         // not a valid TU/BUF -- report not ready
    } else if (tuNr == 1 && bufNr > 0) {
        this.errorMask |= 0x34          // not a valid BUF for TU#1 -- report not ready
    } else if (tuNr == 0) {
        if (this.interrupt) {
            tuNr = 1;
            bufNr = 0;
        }
    }

    if (tuNr == 1 && bufNr == 0) {
        switch (this.bufState) {
        case this.bufReadReady:
            this.errorMask |= 0x100;
            break;
        case this.bufWriteReady:
            this.errorMask |= 0x20;
            break;
        case this.bufInputBusy:
        case this.bufOUtputBusy:
            this.errorMask |= 0x10;
            break;
        case this.bufIdle:
            // default value, no action
            break;
        default:
            this.errorMask |= 0x14;     // report not ready
            break;
        } // switch (this.bufState)

        if (this.abnormal) {
            this.errorMask |= 0x200;    // set abnormal bit
        }
        this.interrupt = false;
        this.setState(this.bufState);
    }

    this.errorMask += bufNr*0x40000000 + tuNr*0x800000000;

    //console.log(this.mnemonic + " W-Int: " + control.toString(8) + ":" + this.errorMask.toString(8));

    finish(this.errorMask, 0);
};

/**************************************/
B5500DatacomUnit.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.inTimer) {
        clearCallback(this.inTimer);
    }
    if (this.outTimer) {
        clearCallback(this.outTimer);
    }
    this.window.removeEventListener("beforeunload", B5500DatacomUnit.prototype.beforeUnload, false);
    this.window.close();
};
