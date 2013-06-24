/***********************************************************************
* retro-b5500/emulator B5500SPOUnit.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 SPO Peripheral Unit module.
*
* Defines a SPO peripheral unit type that implements the Supervisory
* Print Out device on the operator's console.
*
************************************************************************
* 2012-12-22  P.Kimpel
*   Original version, from B5500DummyUnit.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500SPOUnit(mnemonic, unitIndex, designate, statusChange, signal) {
    /* Constructor for the SPOUnit object */
    var that = this;

    this.maxScrollLines = 500;          // Maximum amount of printer scrollback
    this.charPeriod = 100;              // Printer speed, milliseconds per character

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. SPO input request)

    this.clear();

    this.backspaceChar.that = this;     // Store object context for these functions
    this.printChar.that = this;
    this.outputChar.that = this;

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.window.close();            // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.paper = null;
    this.endOfPaper = null;
    this.window = window.open("/B5500/webUI/B5500SPOUnit.html", mnemonic,
            "scrollbars,resizable,width=600,height=500");
    this.window.addEventListener("load", function() {
        that.spoOnload();
    }, false);
}

// this.spoState enumerations
B5500SPOUnit.prototype.spoNotReady = 0;
B5500SPOUnit.prototype.spoLocal = 1;
B5500SPOUnit.prototype.spoRemote = 2;
B5500SPOUnit.prototype.spoInput = 3;
B5500SPOUnit.prototype.spoOutput = 4;

B5500SPOUnit.prototype.keyFilter = [    // Filter keyCode values to valid BIC ones
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 00-0F
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 10-1F
        0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x3F,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,  // 20-2F
        0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,  // 30-3F
        0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 40-4F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x3F,0x5D,0x3F,0x3F,  // 50-5F
        0x3F,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 60-6F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x7B,0x7C,0x7D,0x7E,0x3F]; // 70-7F

/**************************************/
B5500SPOUnit.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500SPOUnit.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the SPO unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status
    this.activeIOUnit = 0;              // I/O unit currently using this device

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion
    this.buffer = null;
    this.bufLength = 0;
    this.bufIndex = 0;
    this.printCol = 0;
    this.nextCharTime = 0;

    this.spoState = this.spoNotReady;   // Current state of SPO interface
    this.spoLocalRequested = false;     // LOCAL button pressed while active
};

/**************************************/
B5500SPOUnit.prototype.hasClass = function hasClass(e, name) {
    /* returns true if element "e" has class "name" in its class list */
    var classes = e.className;

    if (!e) {
        return false;
    } else if (classes == name) {
        return true;
    } else {
        return (classes.search("\\b" + name + "\\b") >= 0);
    }
};

/**************************************/
B5500SPOUnit.prototype.addClass = function addClass(e, name) {
    /* Adds a class "name" to the element "e"s class list */

    if (!this.hasClass(e, name)) {
        e.className += (" " + name);
    }
};

/**************************************/
B5500SPOUnit.prototype.removeClass = function removeClass(e, name) {
    /* Removes the class "name" from the element "e"s class list */

    e.className = e.className.replace(new RegExp("\\b" + name + "\\b\\s*", "g"), "");
};

/**************************************/
B5500SPOUnit.prototype.setNotReady = function setNotReady() {
    /* Sets the status of the SPO to Not Ready */

    if (this.spoState == this.spoLocal) {
        this.spoState = this.spoNotReady;
        this.removeClass(this.$$("SPOReadyBtn"), "yellowLit");
        this.statusChange(0);
    }
};

/**************************************/
B5500SPOUnit.prototype.setReady = function setReady() {
    /* Sets the status of the SPO to Ready */

    if (this.spoState == this.spoNotReady) {
        this.addClass(this.$$("SPOReadyBtn"), "yellowLit");
        this.spoState = this.spoLocal;
    }
};

/**************************************/
B5500SPOUnit.prototype.setLocal = function setLocal() {
    /* Sets the status of the SPO to Local */

    if (this.spoState == this.spoRemote) {
        this.spoState = this.spoLocal;
        this.addClass(this.$$("SPOLocalBtn"), "yellowLit");
        this.removeClass(this.$$("SPORemoteBtn"), "yellowLit");
        this.statusChange(0);

        // Set up to echo characters from the keyboard
        this.buffer = null;
        this.bufLength = 0;
        this.bufIndex = 0;
        this.printCol = 0;
        this.nextCharTime = new Date().getTime();
        this.finish = null;
    }
};

/**************************************/
B5500SPOUnit.prototype.setRemote = function setRemote() {
    /* Sets the status of the SPO to Remote */

    if (this.spoState == this.spoLocal) {
        this.spoState = this.spoRemote;
        this.addClass(this.$$("SPORemoteBtn"), "yellowLit");
        this.removeClass(this.$$("SPOLocalBtn"), "yellowLit");
        this.statusChange(1);
    }
};

/**************************************/
B5500SPOUnit.prototype.appendEmptyLine = function appendEmptyLine() {
    /* Removes excess lines already printed, then appends a new <pre> element
    to the <iframe>, creating an empty text node inside the new element */
    var count = this.paper.childNodes.length;
    var line = this.doc.createTextNode("");

    this.printChar(0x0A);               // newline
    while (count-- > this.maxScrollLines) {
        this.paper.removeChild(this.paper.firstChild);
    }
    this.paper.appendChild(line);
};

/**************************************/
B5500SPOUnit.prototype.backspaceChar = function backspaceChar() {
    /* Handles backspace for SPO input */
    var that = backspaceChar.that;
    var line = that.paper.lastChild;

    if (that.bufLength > 0) {
        that.bufIndex--;
    }
    if (that.printCol > 0) {
        that.printCol--;
    }
    if (line.nodeValue.length > 0) {
        line.nodeValue = line.nodeValue.substring(0, line.nodeValue.length-1);
    }
};

/**************************************/
B5500SPOUnit.prototype.printChar = function printChar(c) {
    /* Echoes the character code "c" to the SPO printer */
    var that = printChar.that;
    var line = that.paper.lastChild;
    var len = line.nodeValue.length;

    if (len < 1) {
        line.nodeValue = String.fromCharCode(c);
        that.endOfPaper.scrollIntoView();
    } else if (len < 72) {
        line.nodeValue += String.fromCharCode(c);
    } else {
         line.nodeValue = line.nodeValue.substring(0, 71) + String.fromCharCode(c);
    }
};

/**************************************/
B5500SPOUnit.prototype.outputChar = function outputChar() {
    /* Outputs one character from the buffer to the SPO. If more characters remain
    to be printed, schedules itself 100 ms later to print the next one, otherwise
    calls finished(). If the column counter exceeds 72, a CR/LF pair is output.
    A CR/LF pair is also output at the end of the message. Note the use of the local
    function property "that" (initialized in the constructor), which supplies the
    necessary SPOUnit object context across setTimeout() calls */
    var that = outputChar.that;         // retrieve our object context
    var nextTime = that.nextCharTime + that.charPeriod;
    var delay = nextTime - new Date().getTime();

    that.nextCharTime = nextTime;
    if (that.printCol < 72) {           // print the character
        if (that.bufIndex < that.bufLength) {
            that.printChar(that.buffer[that.bufIndex]);
            that.bufIndex++;
            that.printCol++;
            setTimeout(that.outputChar, delay);
        } else {                        // set up for the final CR/LF
            that.printCol = 72;
            setTimeout(that.outputChar, delay);
        }
    } else if (that.printCol == 72) {   // delay to fake the output of a new-line
        that.printCol++;
        setTimeout(that.outputChar, delay+that.charPeriod);
    } else {                            // actually output the CR/LF
        that.appendEmptyLine();
        if (that.bufIndex < that.bufLength) {
            that.printCol = 0;          // more characters to print after the CR/LF
            setTimeout(that.outputChar, delay);
        } else {                        // message text is exhausted
            that.finish(that.errorMask, that.bufLength);  // report finish with any errors
            if (that.spoLocalRequested) {
                that.setLocal();
            } else {
                that.spoState = that.spoRemote;
            }
        }
    }
};

/**************************************/
B5500SPOUnit.prototype.terminateInput = function terminateInput() {
    /* Handles the End of Message event. Turns off then Input Request lamp, then
    calls outputChar(), which will find bufIndex==bufLength, output a new-line,
    set the state to Remote, and call finish() for us. Slick, eh? */

    if (this.spoState == this.spoInput) {
        this.removeClass(this.$$("SPOInputRequestBtn"), "yellowLit");
        this.bufLength = this.bufIndex;
        this.nextCharTime = new Date().getTime();
        this.outputChar();
    }
};

/**************************************/
B5500SPOUnit.prototype.cancelInput = function cancelInput() {
    /* Handles the Error message event. This is identical to terminateInput(),
    but it also sets a parity error so the input message will be rejected */

    if (this.spoState = this.spoInput) {
        this.removeClass(this.$$("SPOInputRequestBtn"), "yellowLit");
        this.errorMask |= 0x10;         // set parity/error-button bit
        this.bufLength = this.bufIndex;
        this.nextCharTime = new Date().getTime();
        this.outputChar();
    }
};

/**************************************/
B5500SPOUnit.prototype.keyPress = function keyPress(ev) {
    /* Handles keyboard character events. Depending on the state of the unit,
    either buffers the character for transmission to the I/O Unit, simply echos
    it to the printer, or ignores it altogether */
    var that = this;
    var c = ev.charCode;
    var index = this.bufLength;
    var nextTime;
    var result = true;
    var stamp = new Date().getTime();

    if (this.nextCharTime > stamp) {
        nextTime = this.nextCharTime + this.charPeriod;
    } else {
        nextTime = stamp + this.charPeriod;
    }
    this.nextCharTime = nextTime;
    if (this.spoState == this.spoInput) {
        if (c >= 32 && c < 126) {
            this.buffer[this.bufIndex++] = c = this.keyFilter[c];
            if (this.printCol < 72) {
                this.printCol++;
            }
            setTimeout(function() {that.printChar(c)}, nextTime-stamp);
        }
        if (c == 126) {                 // "~" (B5500 group-mark)
            c = this.keyFilter[c];
            if (this.printCol < 72) {
                this.printCol++;
            }
            setTimeout(function() {that.printChar(c)}, nextTime-stamp);
            this.nextCharTime = nextTime + this.charPeriod;
            this.terminateInput();
        }
    } else if (this.spoState == this.spoLocal) {
        if (c >= 32 && c <= 126) {
            c = this.keyFilter[c];
            setTimeout(function() {that.printChar(c)}, nextTime-stamp);
        }
    }
    if (!result) {
        ev.preventDefault();
    }
    return result;
};

/**************************************/
B5500SPOUnit.prototype.keyDown = function keyDown(ev) {
    /* Handles key-down events to capture ESC, BS, and Enter keystrokes */
    var that = this;
    var c = ev.keyCode;
    var nextTime;
    var result = true;
    var stamp = new Date().getTime();

    if (this.nextCharTime > stamp) {
        nextTime = this.nextCharTime + this.charPeriod;
    } else {
        nextTime = stamp + this.charPeriod;
    }
    this.nextCharTime = nextTime;

    if (this.spoState == this.spoRemote) {
        if (c == 27) {
            if (that.spoState == that.spoRemote) {
                that.signal();
            } else if (that.spoState == that.spoOutput) {
                that.signal();
            }
            result = false;
        }
    } else if (this.spoState == this.spoInput) {
        switch (c) {
        case 27:                    // ESC
            this.cancelInput();
            result = false;
            break;
        case 8:                     // Backspace
            setTimeout(this.backspaceChar, nextTime-stamp);
            result = false;
            break;
        case 13:                    // Enter
            this.terminateInput();
            result = false;
            break;
        }
    } else if (this.spoState == this.spoLocal) {
        switch (c) {
        case 8:                     // Backspace
            setTimeout(that.backspaceChar, nextTime-stamp);
            result = false;
            break;
        case 13:                    // Enter
            setTimeout(function() {that.appendEmptyLine()}, nextTime-stamp+this.charPeriod);
            result = false;
            break;
        }
    }
    if (!result) {
        ev.preventDefault();
    }
    return result;
};

/**************************************/
B5500SPOUnit.prototype.printText = function printText(msg, finish) {
    /* Utility function to convert a string to a Typed Array buffer and queue
    it for printing. This is intended only for printing an initialization message
    in Local state */
    var buf = new Uint8Array(msg.length);
    var length = msg.length;
    var x;

    for (x=0; x<length; x++) {
        buf[x] = msg.charCodeAt(x);
    }
    this.buffer = buf;
    this.bufLength = length;
    this.bufIndex = 0;
    this.printCol = 0;
    this.nextCharTime = new Date().getTime();
    this.finish = finish;
    this.outputChar();                  // start the printing process
};

/**************************************/
B5500SPOUnit.prototype.spoOnload = function spoOnload() {
    /* Initializes the SPO window and user interface */
    var that = this;
    var x;

    this.doc = this.window.document;
    this.doc.title = "retro-B5500 " + this.mnemonic;
    this.paper = this.doc.createElement("pre");
    this.paper.appendChild(this.doc.createTextNode(""));
    this.$$("SPOUT").contentDocument.body.appendChild(this.paper);
    this.endOfPaper = this.doc.createElement("div");
    //this.endOfPaper.appendChild(this.doc.createTextNode("\xA0"));
    this.$$("SPOUT").contentDocument.body.appendChild(this.endOfPaper);
    this.$$("SPOUT").contentDocument.head.innerHTML += "<style>" +
            "BODY {background-color: #FFE} " +
            "PRE {margin: 0; font-size: 10pt; font-family: Lucida Sans Typewriter, Courier New, Courier, monospace}" +
            "</style>";

    this.window.resizeTo(this.window.outerWidth+this.$$("SPODiv").scrollWidth-this.window.innerWidth+8,
                         this.window.outerHeight+this.$$("SPODiv").scrollHeight-this.window.innerHeight+8);
    this.window.moveTo(0, screen.availHeight-this.window.outerHeight);
    this.window.focus();

    this.$$("SPORemoteBtn").onclick = function() {
        that.setRemote();
    };

    this.$$("SPOPowerBtn").onclick = function() {
        that.window.alert("Don't DO THAT");
    };

    this.$$("SPOLocalBtn").onclick = function() {
        that.setLocal();
    };

    this.$$("SPOInputRequestBtn").onclick = function() {
        if (that.spoState == that.spoRemote) {
            that.signal();
        } else if (that.spoState == that.spoOutput) {
            that.signal();
        }
    };

    this.$$("SPOErrorBtn").onclick = function() {
        that.cancelInput();
    };

    this.$$("SPOEndOfMessageBtn").onclick = function() {
        that.terminateInput();
    };

    this.window.onkeypress = function(ev) {
        if (ev.keyCode == 191) {ev.preventDefault()};
        that.keyPress(ev);
    };

    this.window.onkeydown = function(ev) {
        if (ev.keyCode == 191) {ev.preventDefault()};
        that.keyDown(ev);
    };

    for (x=0; x<32; x++) {
        this.appendEmptyLine();
    }
    this.setReady();
    this.window.focus();
    this.printText("retro-B5500 Emulator Version " + B5500CentralControl.version, function() {
        that.setRemote();
        that.appendEmptyLine();
    });
};

/**************************************/
B5500SPOUnit.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit */

    this.errorMask = 0;
    switch (this.spoState) {
    case this.spoRemote:
        this.spoState = this.spoInput;
        this.addClass(this.$$("SPOInputRequestBtn"), "yellowLit");
        this.buffer = buffer;
        this.bufLength = length;
        this.bufIndex = 0;
        this.printCol = 0;
        this.nextCharTime = new Date().getTime();
        this.finish = finish;
        this.window.focus();
        break;
    case this.spoOutput:
    case this.spoInput:
        finish(0x01, 0);                // report unit busy (should never happen)
        break;
    default:
        finish(0x04, 0);                // report unit not ready
        break;
    }
};

/**************************************/
B5500SPOUnit.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500SPOUnit.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */

    this.errorMask = 0;
    switch (this.spoState) {
    case this.spoRemote:
        this.spoState = this.spoOutput;
        this.buffer = buffer;
        this.bufLength = length;
        this.bufIndex = 0;
        this.printCol = 0;
        this.nextCharTime = new Date().getTime();
        this.finish = finish;
        this.window.focus();
        this.outputChar();              // start the printing process
        break;
    case this.spoOutput:
    case this.spoInput:
        finish(0x01, 0);                // report unit busy (should never happen)
        break;
    default:
        finish(0x04, 0);                // report unit not ready
        break;
    }
};

/**************************************/
B5500SPOUnit.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500SPOUnit.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500SPOUnit.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500SPOUnit.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500SPOUnit.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};
