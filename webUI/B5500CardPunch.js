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
function B5500CardPunch(mnemonic, unitIndex, designate, statusChange, signal, options) {
    /* Constructor for the CardPunch object */

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (not used here)

    this.timer = 0;                     // setCallback() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)
    this.useAlgolGlyphs = options.algolGlyphs; // format Unicode for special Algol chars

    this.clear();

    this.doc = null;
    this.window = null;
    this.stacker1 = null;
    this.endOfStacker1 = null;
    this.stacker2 = null;
    this.endOfStacker2 = null;
    B5500Util.openPopup(window, "../webUI/B5500CardPunch.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=560,height=204,left=0,top=220",
            this, B5500CardPunch.prototype.punchOnload);
}

B5500CardPunch.prototype.cardsPerMinute = 300;  // Punch speed
B5500CardPunch.prototype.msPerCard = 60000/B5500CardPunch.prototype.cardsPerMinute;
B5500CardPunch.prototype.maxScrollLines = 850;  // Maximum punch stacker scrollback (stacker capacity)
B5500CardPunch.prototype.rtrimRex = /\s+$/g;    // regular expression for right-trimming card text

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
    this.stacker1Count = 0;             // cards in stacker #1
    this.stacker2Count = 0;             // cards in stacker #2
};

/**************************************/
B5500CardPunch.prototype.emptyStacker = function emptyStacker(stacker) {
    /* Empties the stacker of all text lines */

    while (stacker.firstChild) {
        stacker.removeChild(stacker.firstChild);
    }
};

/**************************************/
B5500CardPunch.prototype.copyStacker = function copyStacker(ev) {
    /* Copies the text contents of a "stacker" area of the device, opens a new
    temporary window, and pastes that text into the window so it can be copied
    or saved by the user */
    var stacker = ev.target;
    var text = stacker.textContent;
    var title = "B5500 " + this.mnemonic + " Stacker Snapshot";

    B5500Util.openPopup(window, "./B5500FramePaper.html", "",
            "scrollbars,resizable,width=500,height=500",
            this, function(ev) {
        var doc = ev.target;
        var win = doc.defaultView;

        doc.title = title;
        win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
        doc.getElementById("Paper").textContent = text;
    });

    this.emptyStacker(stacker);
    ev.preventDefault();
    ev.stopPropagation();
};

/**************************************/
B5500CardPunch.prototype.setPunchReady = function setPunchReady(ready) {
    /* Controls the ready-state of the card punch */

    if (ready && !this.ready) {
        this.statusChange(1);
        this.$$("CPStartBtn").classList.add("greenLit")
        this.$$("CPNotReadyLight").classList.remove("whiteLit");
        this.ready = true;
        if (this.runoutArmed) {
            if (this.stacker1Count || this.stacker2Count) {
                if (this.window.confirm("Empty both " + this.mnemonic + " stackers?")) {
                    this.stacker1Count = this.stacker2Count = 0;
                    this.$$("CPStacker1Bar").value = 0;
                    this.$$("CPStacker1Full").classList.remove("annunciatorLit");
                    this.emptyStacker(this.stacker1);
                    this.$$("CPStacker2Bar").value = 0;
                    this.$$("CPStacker2Full").classList.remove("annunciatorLit");
                    this.emptyStacker(this.stacker2);
                }
            }
            this.armRunout(false);
        }
    } else if (!ready && this.ready) {
        this.statusChange(0);
        this.$$("CPStartBtn").classList.remove("greenLit")
        this.$$("CPNotReadyLight").classList.add("whiteLit");
        this.ready = false;
    }
};

/**************************************/
B5500CardPunch.prototype.setAlgolGlyphs = function setAlgolGlyphs(makeItPretty) {
    /* Controls the display of Unicode glyphs for the special Algol characters */

    if (makeItPretty) {
        if (!this.useAlgolGlyphs) {
            B5500Util.xlateDOMTreeText(this.stacker1, B5500Util.xlateASCIIToAlgol);
            B5500Util.xlateDOMTreeText(this.stacker2, B5500Util.xlateASCIIToAlgol);
        }
    } else {
        if (this.useAlgolGlyphs) {
            B5500Util.xlateDOMTreeText(this.stacker1, B5500Util.xlateAlgolToASCII);
            B5500Util.xlateDOMTreeText(this.stacker2, B5500Util.xlateAlgolToASCII);
        }
    }
    this.$$("CPAlgolGlyphsCheck").checked = makeItPretty;
    this.useAlgolGlyphs = makeItPretty;
};

/**************************************/
B5500CardPunch.prototype.appendLine = function appendLine(stacker, text) {
    /* Appends a new <pre> element to the <iframe>, creating an empty text
    node inside the new element */

    stacker.appendChild(this.doc.createTextNode(text || "\xA0"));
};

/**************************************/
B5500CardPunch.prototype.armRunout = function armRunout(armed) {
    /* Controls the arming/disarming of the EOF signal when starting with
    an empty input stacker */

    if (armed && !this.ready) {
        this.$$("CPRunoutBtn").classList.add("redLit");
        this.runoutArmed = true;
    } else {
        this.$$("CPRunoutBtn").classList.remove("redLit");
        this.runoutArmed = false;
    }
};

/**************************************/
B5500CardPunch.prototype.CPStartBtn_onclick = function CPStartBtn_onclick(ev) {
    /* Handle the click event for the START button */

    if (!this.ready) {
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
B5500CardPunch.prototype.CPAlgolGlyphsCheck_onclick = function CPAlgolGlyphsCheck_onclick(ev) {
    /* Handle the click event for the Algol Glyphs checkbox */

    this.setAlgolGlyphs(ev.target.checked);
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
B5500CardPunch.prototype.punchOnload = function punchOnload(ev) {
    /* Initializes the punch window and user interface */
    var de;

    this.doc = ev.target;
    this.window = this.doc.defaultView;
    de = this.doc.documentElement;
    this.doc.title = "retro-B5500 Card Punch " + this.mnemonic;

    this.stacker1Frame = this.$$("CPStacker1Frame");
    this.stacker1 = this.stacker1Frame.contentDocument.getElementById("Paper");
    this.endOfStacker1 = this.stacker1Frame.contentDocument.getElementById("EndOfPaper");

    this.stacker2Frame = this.$$("CPStacker2Frame");
    this.stacker2 = this.stacker2Frame.contentDocument.getElementById("Paper");
    this.endOfStacker2 = this.stacker2Frame.contentDocument.getElementById("EndOfPaper");

    this.setAlgolGlyphs(this.useAlgolGlyphs);
    this.armRunout(false);
    this.setPunchReady(true);

    this.window.addEventListener("beforeunload",
            B5500CardPunch.prototype.beforeUnload, false);
    this.stacker1.addEventListener("dblclick",
            B5500CardPunch.prototype.copyStacker.bind(this));
    this.stacker2.addEventListener("dblclick",
            B5500CardPunch.prototype.copyStacker.bind(this));
    this.$$("CPStartBtn").addEventListener("click",
            B5500CardPunch.prototype.CPStartBtn_onclick.bind(this), false);
    this.$$("CPStopBtn").addEventListener("click",
            B5500CardPunch.prototype.CPStopBtn_onclick.bind(this), false);
    this.$$("CPRunoutBtn").addEventListener("click",
            B5500CardPunch.prototype.CPRunoutBtn_onclick.bind(this), false);
    this.$$("CPAlgolGlyphsCheck").addEventListener("click",
            B5500CardPunch.prototype.CPAlgolGlyphsCheck_onclick.bind(this), false);
    this.$$("CPStacker1Bar").max = this.maxScrollLines;
    this.$$("CPStacker2Bar").max = this.maxScrollLines;

    this.window.resizeBy(de.scrollWidth - this.window.innerWidth + 4, // kludge for right-padding/margin
                         de.scrollHeight - this.window.innerHeight);
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
    text = String.fromCharCode.apply(null, buffer.subarray(0, length)).replace(this.rtrimRex, '');
    if (this.useAlgolGlyphs) {
        text = B5500Util.xlateASCIIToAlgol(text);
    }
    //console.log("WRITE:  L=" + length + ", M=" + mode + ", C=" + control + " : " + text);
    if (control) {
        this.appendLine(this.stacker2, text + "\n");
        this.endOfStacker2.scrollIntoView();
        this.$$("CPStacker2Bar").value = (++this.stacker2Count);
        if (this.stacker2Count >= this.maxScrollLines) {
            this.$$("CPStacker2Full").classList.add("annunciatorLit");
            this.setPunchReady(false);
        }
    } else {
        this.appendLine(this.stacker1, text + "\n");
        this.endOfStacker1.scrollIntoView();
        this.$$("CPStacker1Bar").value = (++this.stacker1Count);
        if (this.stacker1Count >= this.maxScrollLines) {
            this.$$("CPStacker1Full").classList.add("annunciatorLit");
            this.setPunchReady(false);
        }
    }

    this.timer = setCallback(this.mnemonic, this,
        this.msPerCard + this.initiateStamp - performance.now(),
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