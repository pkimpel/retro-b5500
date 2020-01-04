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
function B5500SPOUnit(mnemonic, unitIndex, designate, statusChange, signal, options) {
    /* Constructor for the SPOUnit object */
    var h = Math.max(screen.availHeight*0.33, 420);
    var w = 688;

    this.maxScrollLines = 5000;         // Maximum amount of printer scrollback
    this.charPeriod = 100;              // Printer speed, milliseconds per character
    this.printGreeting = false;         // Print initial greeting message

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. SPO input request)

    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)
    this.inTimer = 0;                   // input setCallback() token
    this.outTimer = 0;                  // output setCallback() token
    this.useAlgolGlyphs = options.algolGlyphs; // format Unicode for special Algol chars

    this.clear();

    this.doc = null;
    this.window = null;
    this.paper = null;
    this.inputBox = null;
    this.endOfPaper = null;
    B5500Util.openPopup(window, "../webUI/B5500SPOUnit.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=" + w + ",height=" + h +
                ",left=" + (screen.availWidth - w) + ",top=" + (screen.availHeight - h),
            this, B5500SPOUnit.prototype.spoOnload);
}

// this.spoState enumerations
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
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x3F,0x5D,0x3F,0x7E,  // 50-5F
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

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion
    this.buffer = null;
    this.bufLength = 0;
    this.bufIndex = 0;                  // current index into I/O buffer
    this.printCol = 0;                  // current print column (0-relative)
    this.nextCharTime = 0;

    this.spoState = this.spoLocal;      // Current state of SPO interface
    this.spoInputRequested = false;     // INPUT REQUEST button pressed
    this.spoLocalRequested = false;     // LOCAL button pressed while active
};

/**************************************/
B5500SPOUnit.prototype.setLocal = function setLocal() {
    /* Sets the status of the SPO to Local and enables the input element */

    this.spoLocalRequested = false;
    this.spoInputRequested = false;
    this.spoState = this.spoLocal;
    this.endOfPaper.scrollIntoView();
    this.$$("SPOLocalBtn").classList.add("yellowLit");
    this.inputBox.classList.add("visible");
    this.inputBox.focus();
    this.$$("SPORemoteBtn").classList.remove("yellowLit");
    this.$$("SPOInputRequestBtn").classList.remove("yellowLit");
    this.statusChange(0);

    // Set up to echo characters from the keyboard
    this.buffer = null;
    this.bufLength = 0;
    this.bufIndex = 0;
    this.nextCharTime = performance.now();
    this.finish = null;
};

/**************************************/
B5500SPOUnit.prototype.requestLocal = function requestLocal(ev) {
    /* Handler for the Local button click. If the SPO is idle and in remote
    status, sets it to local; otherwise flags it to go local once the current
    I/O completes */

    if (this.spoState == this.spoRemote) {
        this.setLocal();
    } else {
        this.spoLocalRequested = true;
    }
};

/**************************************/
B5500SPOUnit.prototype.setRemote = function setRemote() {
    /* Sets the status of the SPO to Remote and disabled the input element */
    var text;

    if (this.spoState == this.spoLocal) {
        this.spoState = this.spoRemote;
        this.spoLocalRequested = false;
        this.spoInputRequested = false;
        this.$$("SPORemoteBtn").classList.add("yellowLit");
        this.$$("SPOLocalBtn").classList.remove("yellowLit");
        this.inputBox.classList.remove("visible");
        this.window.focus();
        text = this.inputBox.value;
        if (text.length > 0) {
            this.appendEmptyLine(text.substring(0, 72));
            this.inputBox.value = "";
        }
        this.endOfPaper.scrollIntoView();
        this.nextCharTime = performance.now();
        this.statusChange(1);
    }
};

/**************************************/
B5500SPOUnit.prototype.setAlgolGlyphs = function setAlgolGlyphs(makeItPretty) {
    /* Controls the display of Unicode glyphs for the special Algol characters */

    if (makeItPretty) {
        if (!this.useAlgolGlyphs) {
            B5500Util.xlateDOMTreeText(this.paper, B5500Util.xlateASCIIToAlgol);
        }
    } else {
        if (this.useAlgolGlyphs) {
            B5500Util.xlateDOMTreeText(this.paper, B5500Util.xlateAlgolToASCII);
        }
    }
    this.useAlgolGlyphs = makeItPretty;
    if (makeItPretty) {
        this.$$("SPOAlgolGlyphsBtn").classList.add("yellowLit");
    } else {
        this.$$("SPOAlgolGlyphsBtn").classList.remove("yellowLit");
    }
};

/**************************************/
B5500SPOUnit.prototype.appendEmptyLine = function appendEmptyLine(text) {
    /* Removes excess lines already printed, then appends a new text node
    to the <pre> element within the paper element */
    var count = this.paper.childNodes.length;
    var line = text || "";

    while (--count > this.maxScrollLines) {
        this.paper.removeChild(this.paper.firstChild);
    }
    this.paper.lastChild.nodeValue += "\n";     // newline
    this.paper.appendChild(this.doc.createTextNode(line));
    this.printCol = line.length;
};

/**************************************/
B5500SPOUnit.prototype.printChar = function printChar(c) {
    /* Echoes the character code "c" to the SPO printer */
    var line = this.paper.lastChild.nodeValue;
    var len = line.length;
    var s;

    if (!this.useAlgolGlyphs) {
        s = String.fromCharCode(c);
    } else {
        switch (c) {
        case 0x21: s = "\u2260"; break;  // ! = not-equal
        case 0x7B: s = "\u2264"; break;  // { = less-than-or-equal
        case 0x7C: s = "\u00D7"; break;  // | = multiply (x)
        case 0x7D: s = "\u2265"; break;  // } = greater-than-or-equal
        case 0x7E: s = "\u2190"; break;  // ~ = left-arrow
        default:   s = String.fromCharCode(c); break;
        }
    }

    if (len < 1) {
        line = s;
        ++this.printCol;
    } else if (len < 72) {
        line += s;
        ++this.printCol;
    } else {
         line = s;
         this.appendEmptyLine();
    }
    this.paper.lastChild.nodeValue = line;
};

/**************************************/
B5500SPOUnit.prototype.outputChar = function outputChar() {
    /* Outputs one character from the buffer to the SPO. If more characters remain
    to be printed, schedules itself 100 ms later to print the next one, otherwise
    calls finished(). If the column counter exceeds 72, a CR/LF pair is output.
    A CR/LF pair is also output at the end of the message */
    var nextTime = this.nextCharTime + this.charPeriod;
    var delay = nextTime - performance.now();

    this.nextCharTime = nextTime;
    if (this.printCol < 72) {           // print the character
        if (this.bufIndex < this.bufLength) {
            this.printChar(this.buffer[this.bufIndex++]);
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
        } else {                        // set up for the final CR/LF
            this.printCol = 72;
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
        }
    } else if (this.printCol == 72) {   // delay to fake the output of a carriage-return
        ++this.printCol;
        this.outTimer = setCallback(this.mnemonic, this, delay+this.charPeriod, this.outputChar);
    } else {                            // actually output the CR/LF
        this.printCol = 0;
        this.endOfPaper.scrollIntoView();
        if (this.bufIndex < this.bufLength) {
            this.outTimer = setCallback(this.mnemonic, this, delay, this.outputChar);
        } else {                        // message text is exhausted
            this.finish(this.errorMask, this.bufLength);  // report finish with any errors
            if (this.spoLocalRequested) {
                this.setLocal();
            } else {
                this.spoState = this.spoRemote;
            }
        }
    }
};

/**************************************/
B5500SPOUnit.prototype.requestInput = function requestInput() {
    /* Handles the request for keyboard input, from either the Input Request
    button or the ESC key */

    switch (this.spoState) {
    case this.spoRemote:
    case this.spoOutput:
        if (!this.spoInputRequested) {
            this.spoInputRequested = true;
            this.$$("SPOInputRequestBtn").classList.add("yellowLit");
            this.signal(0);             // Cause the Input Request interrupt
        }
        break;
    case this.spoInput:
        // the second click moved focus out of the SPO input control
        this.inputBox.focus();
        break;
    }
};

/**************************************/
B5500SPOUnit.prototype.terminateInput = function terminateInput() {
    /* Handles the End of Message event. Turns off the Ready lamp, transfers
    the message text from the input element to the "paper", then calls
    outputChar(), which will find bufIndex==bufLength, output a new-line,
    set the state to Remote, and call finish() for us. Slick, eh? */
    var text = this.inputBox.value;
    var len = text.length;
    var x;

    if (this.spoState == this.spoInput) {
        this.$$("SPOReadyBtn").classList.remove("yellowLit");
        this.inputBox.classList.remove("visible");
        this.appendEmptyLine(text.substring(0, 72));
        for (x=0; x<len; ++x) {
            this.buffer[this.bufIndex++] = text.charCodeAt(x);
        }
        this.endOfPaper.scrollIntoView();
        this.inputBox.value = "";
        this.bufLength = this.bufIndex;
        this.nextCharTime = performance.now();
        this.outputChar();
        this.window.focus();
    }
};

/**************************************/
B5500SPOUnit.prototype.cancelInput = function cancelInput() {
    /* Handles the Error message event. This is identical to terminateInput(),
    but it also sets a parity error so the input message will be rejected */

    if (this.spoState == this.spoInput) {
        this.errorMask |= 0x10;         // set parity/error-button bit
        this.terminateInput();
    }
};

/**************************************/
B5500SPOUnit.prototype.SPOAlgolGlyphsBtn_onclick = function SPOAlgolGlyphsBtn_onclick(ev) {
    /* Handle the click event for the Algol Glyphs button */

    this.setAlgolGlyphs(!this.useAlgolGlyphs);
};

/**************************************/
B5500SPOUnit.prototype.keyPress = function keyPress(ev) {
    /* Handles keyboard character events. Depending on the state of the unit,
    either buffers the character for transmission to the I/O Unit, simply echos
    it to the printer, or ignores it altogether */
    var c = ev.charCode;
    var len = ev.target.value.length;
    var x;

    switch (this.spoState) {
    case this.spoInput:
        if (c == 0x7E || c == 0x5F) {   // "~" or "_" (B5500 group-mark)
            ev.preventDefault();
            ev.stopPropagation();
            c = this.keyFilter[c];
            this.terminateInput();
        } else if (c >= 0x20 && c < 0x7E) {
            ev.preventDefault();
            ev.stopPropagation();
            c = this.keyFilter[c];
            if (len < 72) {
                ev.target.value += String.fromCharCode(c);
            } else {
                this.appendEmptyLine(ev.target.value);
                this.endOfPaper.scrollIntoView();
                for (x=0; x<len; ++x) {
                    this.buffer[this.bufIndex++] = ev.target.value.charCodeAt(x);
                }
                ev.target.value = String.fromCharCode(c);
            }
        }
        break;

    case this.spoLocal:
        if (c >= 0x20 && c <= 0x7E) {
            ev.preventDefault();
            ev.stopPropagation();
            c = this.keyFilter[c];
            if (len < 72) {
                ev.target.value += String.fromCharCode(c);
            } else {
                this.appendEmptyLine(ev.target.value);
                this.endOfPaper.scrollIntoView();
                ev.target.value = String.fromCharCode(c);
            }
        }
        break;
    }
};

/**************************************/
B5500SPOUnit.prototype.keyDown = function keyDown(ev) {
    /* Handles key-down events in the window to capture ESC and Enter
    keystrokes */
    var c = ev.keyCode;

    switch (c) {
    case 0x1B:                  // ESC
        switch (this.spoState) {
        case this.spoRemote:
        case this.spoOutput:
            this.requestInput();
            break;
        case this.spoInput:
            this.cancelInput();
            break;
        }
        ev.preventDefault();
        ev.stopPropagation();
        break;
    case 0x0D:                  // Enter
        switch (this.spoState) {
        case this.spoInput:
            this.terminateInput();
            break;
        case this.spoLocal:
            this.endOfPaper.scrollIntoView();
            this.appendEmptyLine(this.inputBox.value.substring(0, 72));
            this.inputBox.value = "";
            break;
        }
        ev.preventDefault();
        ev.stopPropagation();
        break;
    }
};

/**************************************/
B5500SPOUnit.prototype.copyPaper = function copyPaper(ev) {
    /* Copies the text contents of the "paper" area of the SPO, opens a new
    temporary window, and pastes that text into the window so it can be copied
    or saved by the user */
    var text = ev.target.textContent;
    var title = "B5500 " + this.mnemonic + " Text Snapshot";

    B5500Util.openPopup(this.window, "./B5500FramePaper.html", "",
            "scrollbars,resizable,width=500,height=500",
            this, function(ev) {
        var doc = ev.target;
        var win = doc.defaultView;

        doc.title = title;
        win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
        doc.getElementById("Paper").textContent = text;
    });

    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B5500SPOUnit.prototype.resizeWindow = function resizeWindow(ev) {
    /* Handles the window onresize event by scrolling the "paper" so it remains at the end */

    this.endOfPaper.scrollIntoView();
};

/**************************************/
B5500SPOUnit.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
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
    this.nextCharTime = performance.now();
    this.finish = finish;
    this.appendEmptyLine();
    this.outputChar();                  // start the printing process
    this.endOfPaper.scrollIntoView();
};

/**************************************/
B5500SPOUnit.prototype.spoInitialize = function spoInitialize() {
    /* Initializes the SPO after power-on */

    this.setRemote();
    this.appendEmptyLine("\xA0");
    this.endOfPaper.scrollIntoView();
    this.signal(-1);                    // re-focus the Console window
};

/**************************************/
B5500SPOUnit.prototype.spoOnload = function spoOnload(ev) {
    /* Initializes the SPO window and user interface */
    var x;

    this.doc = ev.target;
    this.window = this.doc.defaultView;
    this.doc.title = "retro-B5500 " + this.mnemonic;
    this.paper = this.$$("Paper");
    this.inputBox = this.$$("InputBox");
    this.endOfPaper = this.$$("EndOfPaper");

    this.setAlgolGlyphs(this.useAlgolGlyphs);

    this.window.addEventListener("beforeunload",
            B5500SPOUnit.prototype.beforeUnload, false);
    this.window.addEventListener("resize",
            B5500SPOUnit.prototype.resizeWindow.bind(this), false);
    this.window.addEventListener("keydown",
            B5500SPOUnit.prototype.keyDown.bind(this), false);
    this.$$("SPOUT").addEventListener("keydown",
            B5500SPOUnit.prototype.keyDown.bind(this), false);
    this.inputBox.addEventListener("keydown",
            B5500SPOUnit.prototype.keyDown.bind(this), false);
    this.inputBox.addEventListener("keypress",
            B5500SPOUnit.prototype.keyPress.bind(this), false);
    this.paper.addEventListener("dblclick",
            B5500SPOUnit.prototype.copyPaper.bind(this), false);
    this.$$("SPORemoteBtn").addEventListener("click",
            B5500SPOUnit.prototype.setRemote.bind(this), false);
    this.$$("SPOLocalBtn").addEventListener("click",
            B5500SPOUnit.prototype.requestLocal.bind(this), false);
    this.$$("SPOInputRequestBtn").addEventListener("click",
            B5500SPOUnit.prototype.requestInput.bind(this), false);
    this.$$("SPOErrorBtn").addEventListener("click",
            B5500SPOUnit.prototype.cancelInput.bind(this), false);
    this.$$("SPOEndOfMessageBtn").addEventListener("click",
            B5500SPOUnit.prototype.terminateInput.bind(this), false);
    this.$$("SPOAlgolGlyphsBtn").addEventListener("click",
            B5500SPOUnit.prototype.SPOAlgolGlyphsBtn_onclick.bind(this), false);

    this.window.focus();
    this.window.moveTo(screen.availWidth-this.window.outerWidth,
                       screen.availHeight-this.window.outerHeight);
    if (this.printGreeting) {
        this.printText("retro-B5500 Emulator Version " + B5500CentralControl.version,
            B5500SPOUnit.prototype.spoInitialize);
    } else {
        this.spoInitialize();
    }
};

/**************************************/
B5500SPOUnit.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit */

    this.errorMask = 0;
    switch (this.spoState) {
    case this.spoRemote:
        this.spoState = this.spoInput;
        this.spoInputRequested = false;
        this.$$("SPOReadyBtn").classList.add("yellowLit");
        this.$$("SPOInputRequestBtn").classList.remove("yellowLit");
        this.endOfPaper.scrollIntoView();
        this.inputBox.classList.add("visible");
        this.inputBox.focus();
        this.buffer = buffer;
        this.bufLength = length;
        this.bufIndex = 0;
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
        this.nextCharTime = this.initiateStamp;
        this.finish = finish;
        //this.window.focus();          // interferes with datacom terminal window
        this.endOfPaper.scrollIntoView();
        this.appendEmptyLine();
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

/**************************************/
B5500SPOUnit.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.inTimer) {
        clearCallback(this.inTimer);
    }
    if (this.outTimer) {
        clearCallback(this.outTimer);
    }
    this.window.removeEventListener("beforeunload", B5500SPOUnit.prototype.beforeUnload, false);
    this.window.close();
};
