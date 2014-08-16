/***********************************************************************
* retro-b5500/emulator B5500CardReader.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Card Reader Peripheral Unit module.
*
* Defines a card reader peripheral unit type.
*
************************************************************************
* 2013-06-05  P.Kimpel
*   Original version, from B5500SPOUnit.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500CardReader(mnemonic, unitIndex, designate, statusChange, signal) {
    /* Constructor for the CardReader object */
    var that = this;
    var x = (mnemonic == "CRA" ? 0 : 1)*110;

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (not used here)

    this.timer = 0;                     // setCallback() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)

    this.clear();

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.window = window.open("../webUI/B5500CardReader.html", mnemonic,
        "scrollbars=no,resizable,width=560,height=160,left=0,top="+x);
    this.window.addEventListener("load", function windowLoad() {
        that.readerOnload();
    }, false);

    this.hopperBar = null;
    this.outHopperFrame = null;
    this.outHopper = null;
}

B5500CardReader.prototype.eolRex = /([^\n\r\f]*)((:?\r[\n\f]?)|\n|\f)?/g;

B5500CardReader.prototype.cardsPerMinute = 1400;        // B129 card reader

B5500CardReader.prototype.cardFilter = [ // Filter ASCII character values to valid BIC ones
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 00-0F
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 10-1F
        0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x3F,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,  // 20-2F
        0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,  // 30-3F
        0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 40-4F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x3F,0x5D,0x3F,0x3F,  // 50-5F
        0x3F,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 60-6F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x7B,0x7C,0x7D,0x7E,0x3F]; // 70-7F

/**************************************/
B5500CardReader.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the reader unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion

    this.buffer = "";                   // Card reader "input hopper"
    this.bufLength = 0;                 // Current input buffer length (characters)
    this.bufIndex = 0;                  // 0-relative offset to next "card" to be read
    this.eofArmed = false;              // EOF button: armed state
};

/**************************************/
B5500CardReader.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500CardReader.prototype.setReaderReady = function setReaderReady(ready) {
    /* Controls the ready-state of the card reader */

    this.$$("CRFileSelector").disabled = ready;
    this.ready = ready;
    if (ready) {
        this.statusChange(1);
        B5500Util.addClass(this.$$("CRStartBtn"), "greenLit")
        B5500Util.removeClass(this.$$("CRNotReadyLight"), "redLit");
    } else {
        this.statusChange(0);
        B5500Util.removeClass(this.$$("CRStartBtn"), "greenLit")
        B5500Util.addClass(this.$$("CRNotReadyLight"), "redLit");
    }
};

/**************************************/
B5500CardReader.prototype.armEOF = function armEOF(armed) {
    /* Controls the arming/disarming of the EOF signal when starting with
    an empty input hopper */

    this.eofArmed = armed;
    if (armed) {
        B5500Util.addClass(this.$$("CREOFBtn"), "redLit");
    } else {
        B5500Util.removeClass(this.$$("CREOFBtn"), "redLit");
    }
};

/**************************************/
B5500CardReader.prototype.CRStartBtn_onclick = function CRStartBtn_onclick(ev) {
    /* Handle the click event for the START button */
    var that = this;

    if (!this.ready) {
        if (this.bufIndex < this.bufLength) {
            this.setReaderReady(true);
        }
    }
};

/**************************************/
B5500CardReader.prototype.CRStopBtn_onclick = function CRStopBtn_onclick(ev) {
    /* Handle the click event for the STOP button */

    this.$$("CRFileSelector").value = null;     // reset the control so the same file can be reloaded
    if (this.ready) {
        this.setReaderReady(false);
    } else if (this.eofArmed) {
        this.armEOF(false);
    }
};

/**************************************/
B5500CardReader.prototype.CREOFBtn_onclick = function CREOFBtn_onclick(ev) {
    /* Handle the click event for the EOF button */

    this.armEOF(!this.eofArmed);
};

/**************************************/
B5500CardReader.prototype.CRHopperBar_onclick = function CRHopperBar_onclick(ev) {
    /* Handle the click event for the "input hopper" meter bar */

    if (this.bufIndex < this.bufLength && !this.ready) {
        if (this.window.confirm((this.bufLength-this.bufIndex).toString() + " of " + this.bufLength.toString() +
                     " characters remaining to read.\nDo you want to clear the reader input hopper?")) {
            this.buffer = "";
            this.bufLength = 0;
            this.bufIndex = 0;
            this.hopperBar.value = 0;
            this.$$("CRFileSelector").value = null;     // reset the control
            while (this.outHopper.childNodes.length > 0) {
                this.outHopper.removeChild(this.outHopper.firstChild);
            }
        }
    }
};

/**************************************/
B5500CardReader.prototype.fileSelector_onChange = function fileSelector_onChange(ev) {
    /* Handle the <input type=file> onchange event when files are selected. For each
    file, load it and add it to the "input hopper" of the reader */
    var deck;
    var f = ev.target.files;
    var that = this;
    var x;

    function fileLoader_onLoad(ev) {
        /* Handle the onload event for a Text FileReader */

        if (that.bufIndex >= that.bufLength) {
            that.buffer = ev.target.result;
        } else {
            switch (that.buffer.charAt(that.buffer.length-1)) {
            case "\r":
            case "\n":
            case "\f":
                break;                  // do nothing -- the last card has a delimiter
            default:
                that.buffer += "\n";    // so the next deck starts on a new line
                break;
            }
            that.buffer = that.buffer.substring(that.bufIndex) + ev.target.result;
        }

        that.bufIndex = 0;
        that.bufLength = that.buffer.length;
        that.$$("CRHopperBar").value = that.bufLength;
        that.$$("CRHopperBar").max = that.bufLength;
    }

    for (x=f.length-1; x>=0; x--) {
        deck = new FileReader();
        deck.onload = fileLoader_onLoad;
        deck.readAsText(f[x]);
    }
};

/**************************************/
B5500CardReader.prototype.readCardAlpha = function readCardAlpha(buffer, length) {
    /* Reads one card image from the buffer in alpha mode; pads or trims the
    image as necessary to the I/O buffer length. Invalid BCL characters are
    translated to ASCII "?" and the invalid character bit is set in the errorMask.
    Returns the raw card image as a string */
    var c;                              // current character
    var card;                           // card image
    var cardLength;                     // length of card image
    var match;                          // result of eolRex.exec()
    var x;                              // for loop index

    this.eolRex.lastIndex = this.bufIndex;
    match = this.eolRex.exec(this.buffer);
    if (!match) {
        card = "";
        cardLength = 0;
    } else {
        this.bufIndex += match[0].length;
        card = match[1];
        cardLength = card.length;
        if (length < cardLength) {
            cardLength = length;
        }
        for (x=0; x<cardLength; x++) {
            c = card.charCodeAt(x);
            if (c == 0x3F && x > 0) {   // an actual "?"
                buffer[x] = 0x3F;
            } else if (c > 0x7F) {      // Unicode R Us -- NOT!
                this.errorMask |= 0x08;
            } else if ((buffer[x] = this.cardFilter[c]) == 0x3F) {      // intentional assignment
                this.errorMask |= 0x08;
            }
        }
    }

    while (cardLength < length) {
        buffer[cardLength++] = 0x20;    // pad with spaces
    }

    return card;
};

/**************************************/
B5500CardReader.prototype.readCardBinary = function readCardBinary(buffer, length) {
    /* Reads one card image from the buffer in binary mode; pads or trims the
    image as necessary to the I/O buffer length. Invalid BCL characters are
    translated to ASCII "?", but are not reported in the errorMask.
    Returns the raw card image as a string  */
    var card;                           // card image
    var cardLength;                     // length of card image
    var match;                          // result of eolRex.exec()
    var x;                              // for loop index

    this.eolRex.lastIndex = this.bufIndex;
    match = this.eolRex.exec(this.buffer);
    if (!match) {
        card = "";
        cardLength = 0;
    } else {
        this.bufIndex += match[0].length;
        card = match[1];
        cardLength = card.length;
        if (length < cardLength) {
            cardLength = length;
        }
        for (x=0; x<cardLength; x++) {
            buffer[x] = this.cardFilter[card.charCodeAt(x) & 0x7F];
        }
    }

    while (cardLength < length) {
        buffer[cardLength++] = 0x30;    // pad with ASCII zeroes
    }

    return card;
};

/**************************************/
B5500CardReader.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500CardReader.prototype.readerOnload = function readerOnload() {
    /* Initializes the reader window and user interface */
    var de;

    this.doc = this.window.document;
    de = this.doc.documentElement;
    this.doc.title = "retro-B5500 " + this.mnemonic;

    this.hopperBar = this.$$("CRHopperBar");
    this.outHopperFrame = this.$$("CROutHopperFrame");
    this.outHopper = this.outHopperFrame.contentDocument.getElementById("Paper");

    this.armEOF(false);
    this.setReaderReady(false);

    this.window.addEventListener("beforeunload",
        B5500CardReader.prototype.beforeUnload, false);
    this.$$("CRFileSelector").addEventListener("change",
        B5500CentralControl.bindMethod(this, B5500CardReader.prototype.fileSelector_onChange), false);
    this.$$("CRStartBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500CardReader.prototype.CRStartBtn_onclick), false);
    this.$$("CRStopBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500CardReader.prototype.CRStopBtn_onclick), false);
    this.$$("CREOFBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500CardReader.prototype.CREOFBtn_onclick), false);
    this.hopperBar.addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500CardReader.prototype.CRHopperBar_onclick), false);

    this.window.resizeBy(de.scrollWidth - this.window.innerWidth + 4, // kludge for right-padding/margin
                         de.scrollHeight - this.window.innerHeight);
};

/**************************************/
B5500CardReader.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit. If the reader is not ready and the input
    buffer is empty and EOF is armed, returns EOF; otherwise if not ready,
    returns Not Ready */
    var card;

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        if (this.eofArmed && this.bufIndex >= this.bufLength) {
            this.armEOF(false);
            finish(0x24, 0);            // report unit EOF + not ready
        } else {
            finish(0x04, 0);            // report unit not ready
        }
    } else {
        this.busy = true;
        if (mode == 0) {
            card = this.readCardAlpha(buffer, length);
        } else {
            card = this.readCardBinary(buffer, length);
        }

        this.timer = setCallback(this.mnemonic, this,
            60000/this.cardsPerMinute + this.initiateStamp - performance.now(),
            function readDelay() {
                this.busy = false;
                finish(this.errorMask, length);
        });

        if (this.bufIndex < this.bufLength) {
            this.hopperBar.value = this.bufLength-this.bufIndex;
        } else {
            this.hopperBar.value = 0;
            this.buffer = "";           // discard the input buffer
            this.bufLength = 0;
            this.bufIndex = 0;
            this.setReaderReady(false);
            this.$$("CRFileSelector").value = null; // reset the control so the same file can be reloaded
        }

        while (this.outHopper.childNodes.length > 1) {
            this.outHopper.removeChild(this.outHopper.firstChild);
        }
        this.outHopper.appendChild(this.doc.createTextNode("\n"));
        this.outHopper.appendChild(this.doc.createTextNode(card));
    }
};

/**************************************/
B5500CardReader.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearCallback(this.timer);
    }
    this.window.removeEventListener("beforeunload", this.beforeUnload, false);
    this.window.close();
};
