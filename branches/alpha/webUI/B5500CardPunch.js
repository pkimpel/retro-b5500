/***********************************************************************
* retro-b5500/emulator B5500CardPunch.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Card Punch Peripheral Unit module.
*
* Defines a card punch peripheral unit type.
*
************************************************************************
* 2013-06-16  P.Kimpel
*   Original version, from B5500CardReader.js & B5500DummyPrinter.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500CardPunch(mnemonic, unitIndex, designate, statusChange, signal) {
    /* Constructor for the CardPunch object */
    var that = this;

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
    this.stacker1 = null;
    this.endOfStacker1 = null;
    this.stacker2 = null;
    this.endOfStacker2 = null;
    this.window = window.open("../webUI/B5500CardPunch.html", mnemonic,
            "scrollbars=no,resizable,width=560,height=204,left=0,top=220");
    this.window.addEventListener("load", function windowLoad() {
        that.punchOnload();
    }, false);
}

B5500CardPunch.prototype.cardsPerMinute = 300;  // Punch speed
B5500CardPunch.prototype.maxScrollLines = 850;  // Maximum punch stacker scrollback (stacker capacity)

/**************************************/
B5500CardPunch.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500CardPunch.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the punch unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion

    this.runoutArmed = false;           // EOF button: armed state
    this.stopCount = 0;                 // stopCount for clearing the input buffer
    this.stacker1Count = 0;             // cards in stacker #1
    this.stacker2Count = 0;             // cards in stacker #2
};

/**************************************/
B5500CardPunch.prototype.setPunchReady = function setPunchReady(ready) {
    /* Controls the ready-state of the card punch */

    if (ready && !this.ready) {
        this.statusChange(1);
        B5500Util.addClass(this.$$("CPStartBtn"), "greenLit")
        B5500Util.removeClass(this.$$("CPNotReadyLight"), "redLit");
        this.ready = true;
        if (this.runoutArmed) {
            if (this.stacker1Count || this.stacker2Count) {
                if (this.window.confirm("Empty both " + this.mnemonic + " stackers?")) {
                    this.stacker1Count = this.stacker2Count = 0;
                    this.$$("CPStacker1Bar").value = 0;
                    this.$$("CPStacker2Bar").value = 0;
                    while (this.stacker1.firstChild) {
                        this.stacker1.removeChild(this.stacker1.firstChild);
                    }
                    while (this.stacker2.firstChild) {
                        this.stacker2.removeChild(this.stacker2.firstChild);
                    }
                }
            }
            this.armRunout(false);
        }
    } else if (!ready && this.ready) {
        this.statusChange(0);
        B5500Util.removeClass(this.$$("CPStartBtn"), "greenLit")
        B5500Util.addClass(this.$$("CPNotReadyLight"), "redLit");
        this.ready = false;
    }
};

/**************************************/
B5500CardPunch.prototype.armRunout = function armRunout(armed) {
    /* Controls the arming/disarming of the EOF signal when starting with
    an empty input stacker */

    if (armed && !this.ready) {
        B5500Util.addClass(this.$$("CPRunoutBtn"), "redLit");
        this.runoutArmed = true;
    } else {
        B5500Util.removeClass(this.$$("CPRunoutBtn"), "redLit");
        this.runoutArmed = false;
    }
};

/**************************************/
B5500CardPunch.prototype.CPStartBtn_onclick = function CPStartBtn_onclick(ev) {
    /* Handle the click event for the START button */
    var that = this;

    if (!this.ready) {
        this.stopCount = 0;
        if (this.bufIndex < this.bufLength) {
        }
        this.setPunchReady(true);
    }
};

/**************************************/
B5500CardPunch.prototype.CPStopBtn_onclick = function CPStopBtn_onclick(ev) {
    /* Handle the click event for the STOP button */

    if (this.ready) {
        this.setPunchReady(false);
    } else if (this.runoutArmed) {
        this.armRunout(false);
    }
};

/**************************************/
B5500CardPunch.prototype.CPRunoutBtn_onclick = function CPRunoutBtn_onclick(ev) {
    /* Handle the click event for the EOF button */

    this.armRunout(!this.runoutArmed);
};

/**************************************/
B5500CardPunch.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500CardPunch.prototype.punchOnload = function punchOnload() {
    /* Initializes the punch window and user interface */
    var de;
    var that = this;

    this.doc = this.window.document;
    de = this.doc.documentElement;
    this.doc.title = "retro-B5500 " + this.mnemonic;

    this.stacker1Frame = this.$$("CPStacker1Frame");
    this.stacker1 = this.stacker1Frame.contentDocument.getElementById("Paper");
    this.endOfStacker1 = this.stacker1Frame.contentDocument.getElementById("EndOfPaper");

    this.stacker2Frame = this.$$("CPStacker2Frame");
    this.stacker2 = this.stacker2Frame.contentDocument.getElementById("Paper");
    this.endOfStacker2 = this.stacker2Frame.contentDocument.getElementById("EndOfPaper");

    this.armRunout(false);
    this.setPunchReady(true);

    this.window.addEventListener("beforeunload",
            B5500CardPunch.prototype.beforeUnload, false);
    this.$$("CPStartBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500CardPunch.prototype.CPStartBtn_onclick), false);
    this.$$("CPStopBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500CardPunch.prototype.CPStopBtn_onclick), false);
    this.$$("CPRunoutBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500CardPunch.prototype.CPRunoutBtn_onclick), false);
    this.$$("CPStacker1Bar").max = this.maxScrollLines;
    this.$$("CPStacker2Bar").max = this.maxScrollLines;

    this.window.resizeBy(de.scrollWidth - this.window.innerWidth + 4, // kludge for right-padding/margin
                         de.scrollHeight - this.window.innerHeight);
};

/**************************************/
B5500CardPunch.prototype.appendLine = function appendLine(stacker, text) {
    /* Removes excess lines already printed, then appends a new <pre> element
    to the <iframe>, creating an empty text node inside the new element */
    var count = stacker.childNodes.length;
    var line = this.doc.createTextNode(text || "");

    //while (count-- > this.maxScrollLines) {
    //    stacker.removeChild(stacker.firstChild);
    //}
    stacker.appendChild(line);
};

/**************************************/
B5500CardPunch.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */
    var text;

    this.errorMask = 0;
    this.busy = true;
    text = String.fromCharCode.apply(null, buffer.subarray(0, length));
    //console.log("WRITE:  L=" + length + ", M=" + mode + ", C=" + control + " : " + text);
    if (control) {
        this.appendLine(this.stacker2, text + "\n");
        this.endOfStacker2.scrollIntoView();
        this.$$("CPStacker2Bar").value = (++this.stacker2Count);
        if (this.stacker2Count >= this.maxScrollLines) {
            this.setPunchReady(false);
        }
    } else {
        this.appendLine(this.stacker1, text + "\n");
        this.endOfStacker1.scrollIntoView();
        this.$$("CPStacker1Bar").value = (++this.stacker1Count);
        if (this.stacker1Count >= this.maxScrollLines) {
            this.setPunchReady(false);
        }
    }

    this.timer = setCallback(this.mnemonic, this,
        60000/this.cardsPerMinute + this.initiateStamp - performance.now(),
        function writeDelay() {
            this.busy = false;
            finish(this.errorMask, length);
    });
};

/**************************************/
B5500CardPunch.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardPunch.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearCallback(this.timer);
    }
    this.window.removeEventListener("beforeunload", B5500CardPunch.prototype.beforeUnload, false);
    this.window.close();
};
