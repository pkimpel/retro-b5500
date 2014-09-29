/***********************************************************************
* retro-b5500/emulator B5500MagTapeDrive.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Magnetic Tape Drive Peripheral Unit module.
*
* Defines a magnetic tape drive peripheral unit type, emulating the
* Burroughs B425 tape transport at 800 bits/inch.
*
* Internally, tape images are maintained in ".bcd" format. Each character
* frame on the tape is represented by one 8-bit byte in memory. The low-
* order six bits of each frame are the character bits (in BCL if even
* parity or BIC if odd parity). The seventh bit is even or odd parity,
* and the high-order bit in the byte is one if this frame starts a block.
* EOF is represented as a one-frame block with a code of 0x8F in both
* odd- and even-parity recording.
*
************************************************************************
* 2013-10-26  P.Kimpel
*   Original version, from B5500CardReader.js.
* 2013-01-01  P.Kimpel
*   Add write capabilty, read capability for ASCII tape images, and
*   selectable tape lengths.
***********************************************************************/
"use strict";

/**************************************/
function B5500MagTapeDrive(mnemonic, unitIndex, designate, statusChange, signal, options) {
    /* Constructor for the MagTapeDrive object */

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (not used here)

    this.timer = 0;                     // setCallback() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)

    this.clear();

    this.loadWindow = null;             // handle for the tape loader window
    this.reelBar = null;                // handle for tape-full meter
    this.reelIcon = null;               // handle for the reel spinner

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy any previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.window = window.open("../webUI/B5500MagTapeDrive.html", mnemonic,
            "location=no,scrollbars=no,resizable,width=560,height=120,left=280,top=0");
    this.window.addEventListener("load",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.tapeDriveOnload), false);
}

// this.tapeState enumerations
B5500MagTapeDrive.prototype.tapeUnloaded = 0;
B5500MagTapeDrive.prototype.tapeLocal = 1;
B5500MagTapeDrive.prototype.tapeRemote = 2;

B5500MagTapeDrive.prototype.density = 800;
                                        // 800 bits/inch
B5500MagTapeDrive.prototype.charsPerSec = 72000;
                                        // B425, 90 inches/sec @ 800 bits/inch
B5500MagTapeDrive.prototype.gapLength = 0.75;
                                        // inter-block blank tape gap [inches]
B5500MagTapeDrive.prototype.startStopTime = 0.0045 + 0.0042;
                                        // tape start+stop time [sec]
B5500MagTapeDrive.prototype.rewindSpeed = 320;
                                        // rewind speed [inches/sec]
B5500MagTapeDrive.prototype.tapeSpeed = B5500MagTapeDrive.prototype.charsPerSec/B5500MagTapeDrive.prototype.density;
                                        // tape motion speed [inches/sec]
B5500MagTapeDrive.prototype.maxTapeLength = 2410*12;
                                        // max tape length on reel [inches]
B5500MagTapeDrive.prototype.postEOTLength = 20*12;
                                        // length of tape after EOT reflector [inches]
B5500MagTapeDrive.prototype.maxBlankFrames = 9*12*B5500MagTapeDrive.prototype.density;
                                        // max blank tape length, 9 feet [frames]
B5500MagTapeDrive.prototype.bcdTapeMark = 0x8F;
                                        // .bcd image EOF code
B5500MagTapeDrive.prototype.reelCircumference = 10*Math.PI;
                                        // max circumference of tape [inches]
B5500MagTapeDrive.prototype.spinUpdateInterval = 15;
                                        // milliseconds between reel icon angle updates
B5500MagTapeDrive.prototype.maxSpinAngle = 25;
                                        // max angle to rotate reel image [degrees]

B5500MagTapeDrive.prototype.bcdXlateInOdd = [   // Translate odd parity BIC to ASCII
        0xFF,0x31,0x32,0xFF,0x34,0xFF,0xFF,0x37,0x38,0xFF,0xFF,0x40,0xFF,0x3A,0x3E,0xFF,  // 00-0F
        0x2B,0xFF,0xFF,0x43,0xFF,0x45,0x46,0xFF,0xFF,0x49,0x2E,0xFF,0x26,0xFF,0xFF,0x7E,  // 10-1F
        0x7C,0xFF,0xFF,0x4C,0xFF,0x4E,0x4F,0xFF,0xFF,0x52,0x24,0xFF,0x2D,0xFF,0xFF,0x7B,  // 20-2F
        0xFF,0x2F,0x53,0xFF,0x55,0xFF,0xFF,0x58,0x59,0xFF,0xFF,0x25,0xFF,0x3D,0x5D,0xFF,  // 30-3F
        0x30,0xFF,0xFF,0x33,0xFF,0x35,0x36,0xFF,0xFF,0x39,0x23,0xFF,0x3F,0xFF,0xFF,0x7D,  // 40-4F
        0xFF,0x41,0x42,0xFF,0x44,0xFF,0xFF,0x47,0x48,0xFF,0xFF,0x5B,0xFF,0x28,0x3C,0xFF,  // 50-5F
        0xFF,0x4A,0x4B,0xFF,0x4D,0xFF,0xFF,0x50,0x51,0xFF,0xFF,0x2A,0xFF,0x29,0x3B,0xFF,  // 60-6F
        0x20,0xFF,0xFF,0x54,0xFF,0x56,0x57,0xFF,0xFF,0x5A,0x2C,0xFF,0x21,0xFF,0xFF,0x22]; // 70-7F

B5500MagTapeDrive.prototype.bcdXlateOutOdd = [  // Translate ASCII to odd Parity BIC
        0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,  // 00-0F
        0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,0x4C,  // 10-1F
        0x70,0x7C,0x7F,0x4A,0x2A,0x3B,0x1C,0x4C,0x5D,0x6D,0x6B,0x10,0x7A,0x2C,0x1A,0x31,  // 20-2F
        0x40,0x01,0x02,0x43,0x04,0x45,0x46,0x07,0x08,0x49,0x0D,0x6E,0x5E,0x3D,0x0E,0x4C,  // 30-3F
        0x0B,0x51,0x52,0x13,0x54,0x15,0x16,0x57,0x58,0x19,0x61,0x62,0x23,0x64,0x25,0x26,  // 40-4F
        0x67,0x68,0x29,0x32,0x73,0x34,0x75,0x76,0x37,0x38,0x79,0x5B,0x4C,0x3E,0x4C,0x4C,  // 50-5F
        0x4C,0x51,0x52,0x13,0x54,0x15,0x16,0x57,0x58,0x19,0x61,0x62,0x23,0x64,0x25,0x26,  // 60-6F
        0x67,0x68,0x29,0x32,0x73,0x34,0x75,0x76,0x37,0x38,0x79,0x2F,0x20,0x4F,0x1F,0x4C]; // 70-7F

B5500MagTapeDrive.prototype.bcdXlateInEven = [  // Translate even parity BCL to ASCII
        0x3F,0xFF,0xFF,0x33,0xFF,0x35,0x36,0xFF,0xFF,0x39,0x30,0xFF,0x40,0xFF,0xFF,0x7D,  // 00-0F
        0xFF,0x2F,0x53,0xFF,0x55,0xFF,0xFF,0x58,0x59,0xFF,0xFF,0x2C,0xFF,0x3D,0x5D,0xFF,  // 10-1F
        0xFF,0x4A,0x4B,0xFF,0x4D,0xFF,0xFF,0x50,0x51,0xFF,0xFF,0x24,0xFF,0x29,0x3B,0xFF,  // 20-2F
        0x26,0xFF,0xFF,0x43,0xFF,0x45,0x46,0xFF,0xFF,0x49,0x2B,0xFF,0x5B,0xFF,0xFF,0x7E,  // 30-3F
        0xFF,0x31,0x32,0xFF,0x34,0xFF,0xFF,0x37,0x38,0xFF,0xFF,0x23,0xFF,0x3A,0x3E,0xFF,  // 40-4F
        0x20,0xFF,0xFF,0x54,0xFF,0x56,0x57,0xFF,0xFF,0x5A,0x21,0xFF,0x25,0xFF,0xFF,0x22,  // 50-5F
        0x2D,0xFF,0xFF,0x4C,0xFF,0x4E,0x4F,0xFF,0xFF,0x52,0x7C,0xFF,0x2A,0xFF,0xFF,0x7B,  // 60-6F
        0xFF,0x41,0x42,0xFF,0x44,0xFF,0xFF,0x47,0x48,0xFF,0xFF,0x2E,0xFF,0x28,0x3C,0xFF]; // 70-7F

B5500MagTapeDrive.prototype.bcdXlateOutEven = [ // Translate ASCII to even parity BCL
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // 00-0F
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // 10-1F
        0x50,0x5A,0x5F,0x4B,0x2B,0x5C,0x30,0x00,0x7D,0x2D,0x6C,0x3A,0x1B,0x60,0x7B,0x11,  // 20-2F
        0x0A,0x41,0x42,0x03,0x44,0x05,0x06,0x47,0x48,0x09,0x4D,0x2E,0x7E,0x1D,0x4E,0x00,  // 30-3F
        0x0C,0x71,0x72,0x33,0x74,0x35,0x36,0x77,0x78,0x39,0x21,0x22,0x63,0x24,0x65,0x66,  // 40-4F
        0x27,0x28,0x69,0x12,0x53,0x14,0x55,0x56,0x17,0x18,0x59,0x3C,0x00,0x1E,0x00,0x00,  // 50-5F
        0x00,0x71,0x72,0x33,0x74,0x35,0x36,0x77,0x78,0x39,0x21,0x22,0x63,0x24,0x65,0x66,  // 60-6F
        0x27,0x28,0x69,0x12,0x53,0x14,0x55,0x56,0x17,0x18,0x59,0x6F,0x6A,0x0F,0x3F,0x00]; // 70-7F


/**************************************/
B5500MagTapeDrive.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500MagTapeDrive.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the reader unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion

    this.image = null;                  // tape drive "reel of tape"
    this.imgEOTInches = 0;              // tape image length to EOT marker [inches]
    this.imgIndex = 0;                  // 0-relative offset to next tape block to be read
    this.imgLength = 0;                 // current input buffer length (characters)
    this.imgMaxInches = 0;              // tape image max length [inches]
    this.imgTopIndex = 0;               // highest-used offset within image data
    this.imgWritten = false;            // tape image has been modified (implies writable)

    this.tapeState = this.tapeUnloaded; // tape drive state
    this.reelAngle = 0;                 // current rotation angle of reel image [degrees]
    this.tapeInches = 0;                // number of inches currently up-tape
    this.writeRing = false;             // true if write ring is present and tape is writable
    this.atBOT = true;                  // true if tape at BOT
    this.atEOT = false;                 // true if tape at EOT

    this.buffer = null;                 // IOUnit buffer
    this.bufLength = 0;                 // IOUnit buffer length
    this.bufIndex = 0;                  // IOUnit buffer current offset
};

/**************************************/
B5500MagTapeDrive.prototype.spinReel = function spinReel(inches) {
    /* Rotates the reel image icon an appropriate amount based on the "inches"
    of tape to be moved. The rotation is limited to this.maxSpinAngle degrees
    in either direction so that movement remains apparent to the viewer */
    var circumference = this.reelCircumference*(1 - this.tapeInches/this.maxTapeLength/2);
    var degrees = inches/circumference*360;

    if (degrees > this.maxSpinAngle) {
        degrees = this.maxSpinAngle;
    } else if (degrees < -this.maxSpinAngle) {
        degrees = -this.maxSpinAngle;
    }

    this.reelAngle = (this.reelAngle + degrees)%360;
    this.reelIcon.style["-webkit-transform"] = "rotate(" + this.reelAngle.toFixed(0) + "deg)";  // temp for Chrome
    this.reelIcon.style.transform = "rotate(" + this.reelAngle.toFixed(0) + "deg)";

    if (this.tapeInches < this.imgMaxInches) {
        this.reelBar.value = this.imgMaxInches - this.tapeInches;
    } else {
        this.reelBar.value = 0;
    }
};

/**************************************/
B5500MagTapeDrive.prototype.moveTape = function moveTape(inches, delay, callBack) {
    /* Delays the I/O during tape motion, during which it animates the reel image
    icon. At the completion of the "delay" time in milliseconds, "callBack" is
    called with no parameters. */
    var delayLeft = delay;              // milliseconds left to delay
    var direction = (inches < 0 ? -1 : 1);
    var inchesLeft = inches;            // inches left to move tape
    var lastStamp = performance.now();  // last timestamp for spinDelay

    function spinFinish() {
        this.timer = 0;
        if (inchesLeft != 0) {
            this.spinReel(inchesLeft);
        }
        callBack.call(this);
    }

    function spinDelay() {
        var motion;
        var stamp = performance.now();
        var interval = stamp - lastStamp;

        if (interval <= 0) {
            interval = this.spinUpdateInterval/2;
            if (interval > delayLeft) {
                interval = delayLeft;
            }
        }

        if ((delayLeft -= interval) > this.spinUpdateInterval) {
            lastStamp = stamp;
            this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, spinDelay);
        } else {
            this.timer = setCallback(this.mnemonic, this, delayLeft, spinFinish);
        }
        motion = this.tapeSpeed*interval/1000*direction;
        inchesLeft -= motion;
        if (inchesLeft*direction < 0) { // inchesLeft crossed zero
            inchesLeft = direction = 0;
        }
        this.spinReel(motion);
    }

    spinDelay.call(this);
};

/**************************************/
B5500MagTapeDrive.prototype.setAtBOT = function setAtBOT(atBOT) {
    /* Controls the ready-state of the tape drive */

    if (atBOT ^ this.atBOT) {
        this.atBOT = atBOT;
        if (atBOT) {
            this.imgIndex = 0;
            this.tapeInches = 0;
            B5500Util.addClass(this.$$("MTAtBOTLight"), "annunciator");
            this.reelBar.value = this.imgMaxInches;
            this.reelIcon.style.transform = "rotate(0deg)";
            this.reelIcon.style["-webkit-transform"] = "rotate(0deg)";  // temp for Chrome
        } else {
            B5500Util.removeClass(this.$$("MTAtBOTLight"), "annunciatorLit");
        }
    }
};

/**************************************/
B5500MagTapeDrive.prototype.setAtEOT = function setAtEOT(atEOT) {
    /* Controls the ready-state of the tape drive */

    if (atEOT ^ this.atEOT) {
        this.atEOT = atEOT;
        if (atEOT) {
            B5500Util.addClass(this.$$("MTAtEOTLight"), "annunciatorLit");
            this.reelBar.value = 0;
        } else {
            B5500Util.removeClass(this.$$("MTAtEOTLight"), "annunciatorLit");
        }
    }
};

/**************************************/
B5500MagTapeDrive.prototype.setTapeUnloaded = function setTapeUnloaded() {
    /* Controls the loaded/unloaded-state of the tape drive */

    if (this.tapeState == this.tapeLocal && this.atBOT) {
        this.tapeState = this.tapeUnloaded;
        this.image = null;                  // release the tape image to GC
        this.imgIndex = this.imgLength = 0;
        this.writeRing = false;
        this.ready = false;
        this.statusChange(0);
        this.$$("MTUnloadBtn").disabled = true;
        this.$$("MTLoadBtn").disabled = false;
        this.$$("MTLocalBtn").disabled = true;
        this.$$("MTRemoteBtn").disabled = true;
        this.$$("MTRewindBtn").disabled = true;
        this.$$("MTWriteRingBtn").disabled = true;
        this.$$("MTFileName").value = "";
        B5500Util.removeClass(this.$$("MTRemoteBtn"), "yellowLit");
        B5500Util.addClass(this.$$("MTLocalBtn"), "yellowLit");
        B5500Util.removeClass(this.$$("MTWriteRingBtn"), "redLit");
        B5500Util.addClass(this.$$("MTUnloadedLight"), "annunciatorLit");
        this.setAtBOT(false);
        this.setAtEOT(false);
        this.reelBar.value = 0;
        this.reelIcon.style.visibility = "hidden";
        if (this.timer) {
            clearCallback(this.timer);
            this.timer = 0;
        }
    }
};

/**************************************/
B5500MagTapeDrive.prototype.setTapeRemote = function setTapeRemote(ready) {
    /* Controls the ready-state of the tape drive */

    if (this.tapeState != this.tapeUnloaded) {
        this.$$("MTLoadBtn").disabled = true;
        this.$$("MTUnloadBtn").disabled = ready;
        this.$$("MTLocalBtn").disabled = !ready;
        this.$$("MTRemoteBtn").disabled = ready;
        this.$$("MTWriteRingBtn").disabled = false;
        this.$$("MTRewindBtn").disabled = ready;
        this.ready = ready;
        if (ready) {
            this.tapeState = this.tapeRemote;
            this.statusChange(1);
            B5500Util.removeClass(this.$$("MTLocalBtn"), "yellowLit");
            B5500Util.addClass(this.$$("MTRemoteBtn"), "yellowLit");
        } else {
            this.tapeState = this.tapeLocal;
            this.statusChange(0);
            B5500Util.removeClass(this.$$("MTRemoteBtn"), "yellowLit");
            B5500Util.addClass(this.$$("MTLocalBtn"), "yellowLit");
        }
    }
};

/**************************************/
B5500MagTapeDrive.prototype.setWriteRing = function setWriteRing(writeRing) {
    /* Controls the write-ring (write-enabled state of the tape drive. In Local state,
    writable status can be set or reset; in Remote state, it can only be reset */

    switch (this.tapeState) {
    case this.tapeLocal:
    case this.tapeRemote:
        if (this.writeRing && !writeRing) {
            this.writeRing = false;
            B5500Util.removeClass(this.$$("MTWriteRingBtn"), "redLit");
        }
        break;
    }
};

/**************************************/
B5500MagTapeDrive.prototype.loadTape = function loadTape() {
    /* Loads a tape into memory based on selections in the MTLoad window */
    var $$$ = null;                     // getElementById shortcut for loader window
    var doc = null;                     // loader window.document
    var eotInches = 0;                  // tape inches until EOT marker
    var file = null;                    // FileReader instance
    var fileSelect = null;              // file picker element
    var formatSelect = null;            // tape format list element
    var maxInches = 0;                  // maximum tape inches in tape image
    var mt = this;                      // this B5500MagTapeDrive instance
    var tapeFormat = "";                // tape format code (bcd, aod, aev, etc.)
    var tapeInches = 0;                 // selected tape length in inches
    var tapeLengthSelect = null;        // tape length list element
    var win = this.window.open("B5500MagTapeLoadPanel.html", this.mnemonic + "Load",
            "location=no,scrollbars=no,resizable,width=508,height=112,left=" +
            (this.window.screenX+16) +",top=" + (this.window.screenY+16));
    var writeRing = false;              // true if write-enabled
    var writeRingCheck = null;          // tape write ring checkbox element

    function fileSelector_onChange(ev) {
        /* Handle the <input type=file> onchange event when a file is selected */
        var fileExt;
        var fileName;
        var x;

        file = ev.target.files[0];
        fileName = file.name;
        x = fileName.lastIndexOf(".");
        fileExt = (x > 0 ? fileName.substring(x) : "");
        writeRingCheck.checked = false;
        tapeLengthSelect.disabled = true;

        switch (fileExt) {
        case ".bcd":
            tapeFormat = "bcd";
            break;
        case ".tap":
            tapeFormat = "tap";
            break;
        default:
            tapeFormat = "aod";
            break;
        } // switch fileExt

        for (x=formatSelect.length-1; x>=0; x--) {
            if (formatSelect.options[x].value == tapeFormat) {
                formatSelect.selectedIndex = x;
                break;
            }
        } // for x
    }

    function finishLoad() {
        /* Finishes the tape loading process and closes the loader window */

        mt.imgIndex = 0;
        mt.imgLength = mt.image.length;
        mt.tapeInches = 0;
        mt.imgEOTInches = eotInches;
        mt.imgMaxInches = tapeInches;
        mt.reelBar.max = mt.imgMaxInches;
        mt.reelBar.value = mt.imgMaxInches;
        mt.setAtEOT(false);
        mt.setAtBOT(true);
        mt.tapeState = mt.tapeLocal;    // setTapeRemote() requires it not be unloaded
        mt.setTapeRemote(false);
        mt.reelIcon.style.visibility = "visible";
        B5500Util.removeClass(mt.$$("MTUnloadedLight"), "annunciatorLit");

        mt.imgWritten = false;
        mt.writeRing = writeRing;
        if (writeRing) {
            B5500Util.addClass(mt.$$("MTWriteRingBtn"), "redLit");
        } else {
            B5500Util.removeClass(mt.$$("MTWriteRingBtn"), "redLit");
        }

        win.close();
    }

    function bcdLoader_onload(ev) {
        /* Loads a ".bcd" tape image into the drive */
        var blockLength;
        var image = new Uint8Array(ev.target.result);
        var imageSize;
        var x;

        mt.imgTopIndex = image.length;
        if (writeRing) {
            eotInches = tapeInches;
            tapeInches += mt.postEOTLength;
            imageSize = tapeInches*mt.density;
            if (image.length > imageSize) {
                eotInches = image.length/mt.density;
                imageSize = image.length + mt.postEOTLength*mt.density;
                tapeInches = imageSize/mt.density;
            }
            mt.image = new Uint8Array(new ArrayBuffer(imageSize));
            for (x=image.length-1; x>=0; x--) {
                mt.image[x] = image[x];
            }
        } else {
            mt.image = image;
            imageSize = image.length;
            tapeInches = 0;
            x = 0;
            while (x < imageSize) {
                x++;
                blockLength = 1;
                while (x < imageSize && image[x] < 0x80) {
                    x++;
                    blockLength++;
                } // while for blockLength
                tapeInches += blockLength/mt.density + mt.gapLength;
            } // while for imageSize
            eotInches = tapeInches + mt.postEOTLength;
        }
        finishLoad();
    }

    function blankLoader() {
        /* Loads a blank tape image into the drive */

        writeRing = true;
        eotInches = tapeInches;
        tapeInches += mt.postEOTLength;
        mt.image = new Uint8Array(new ArrayBuffer(tapeInches*mt.density));
        mt.image[0] = 0x81;             // put a little noise on the tape to avoid blank-tape timeouts
        mt.image[1] = 0x03;
        mt.image[2] = 0x8F;
        mt.imgTopIndex = 3;
        finishLoad();
    }

    function tapLoader_onload(ev) {
        /* Loads a ".tap" tape image into the drive */

        /* To be Provided */
    }

    function textLoader_onload(ev) {
        /* Loads a text image as either odd or even parity bcd data */
        var block;                      // ANSI text of current block
        var blockLength;                // length of current ASCII block
        var eolRex = /([^\n\r\f]*)((:?\r[\n\f]?)|\n|\f)?/g;
        var image = ev.target.result;   // ANSI tape image
        var imageLength = image.length; // length of ANSI tape image
        var imageSize;                  // size of final tape image [bytes]
        var inches = 0;                 // tape inches occupied by image data
        var index = 0;                  // image index of next ANSI block
        var match;                      // result of eolRex.exec()
        var offset = 0;                 // index into mt.image
        var table = (tapeFormat == "aev" ? mt.bcdXlateOutEven : mt.bcdXlateOutOdd);
        var x;                          // for loop index

        if (!writeRing) {
            imageSize = imageLength;
        } else {
            eotInches = tapeInches;
            tapeInches += mt.postEOTLength;
            imageSize = tapeInches*mt.density;
            if (imageLength > imageSize) {
                eotInches = imageLength/mt.density;
                imageSize = imageLength + mt.postEOTLength*mt.density;
                tapeInches = imageSize/mt.density;
            }
        }

        mt.image = new Uint8Array(new ArrayBuffer(imageSize));
        do {
            eolRex.lastIndex = index;
            match = eolRex.exec(image);
            if (!match) {
                break;
            } else {
                index += match[0].length;
                block = match[1];
                blockLength = block.length;
                inches += blockLength/mt.density + mt.gapLength;
                if (block == "}") {
                    mt.image[offset++] = mt.bcdTapeMark;
                } else if (blockLength > 0) {
                    mt.image[offset++] = table[block.charCodeAt(0) & 0x7F] | 0x80;
                    for (x=1; x<blockLength; x++) {
                        mt.image[offset++] = table[block.charCodeAt(x) & 0x7F];
                    }
                }
            }
        } while (index < imageLength);

        mt.imgTopIndex = offset;
        if (!writeRing) {
            tapeInches = inches;
            eotInches = tapeInches + mt.postEOTLength;
        }
        finishLoad();
    }

    function tapeLoadOK(ev) {
        /* Handler for the OK button. Does the actual tape load */
        var tape;

        tapeFormat = formatSelect.value;
        if (!(file || tapeFormat == "blank")) {
            win.alert("File must be selected unless loading a blank tape");
        } else {
            tapeInches = (parseInt(tapeLengthSelect.value) || 2400)*12;
            writeRing = writeRingCheck.checked;
            mt.$$("MTFileName").value = (file ? file.name : "");

            switch (tapeFormat) {
            case "aod":
            case "aev":
                tape = new FileReader();
                tape.onload = textLoader_onload;
                tape.readAsText(file);
                break;
            case "bcd":
                tape = new FileReader();
                tape.onload = bcdLoader_onload;
                tape.readAsArrayBuffer(file);
                break;
            case "tap":
                tape = new FileReader();
                tape.onload = tapLoader_onload;
                tape.readAsArrayBuffer(file);
                break;
            default:
                mt.$$("MTFileName").value = (file ? file.name : "(blank tape)");
                blankLoader();
                break;
            } // switch
        }
    }

    function tapeLoadOnload (ev) {
        /* Driver for the tape loader window */
        var de;

        doc = win.document;
        de = doc.documentElement;
        win.focus();
        $$$ = function $$$(id) {
            return doc.getElementById(id);
        };

        fileSelect = $$$("MTLoadFileSelector");
        formatSelect = $$$("MTLoadFormatSelect");
        writeRingCheck = $$$("MTLoadWriteRingCheck");
        tapeLengthSelect = $$$("MTLoadTapeLengthSelect")

        doc.title = "B5500 " + mt.mnemonic + " Tape Loader";
        fileSelect.addEventListener("change", fileSelector_onChange, false);

        formatSelect.addEventListener("change", function loadFormatSelect(ev) {
            tapeFormat = ev.target.value;
            if (tapeFormat == "blank") {
                file = null;
                fileSelect.value = null;
                writeRingCheck.checked = true;
                tapeLengthSelect.disabled = false;
                tapeLengthSelect.selectedIndex = tapeLengthSelect.length-1;
            }
        }, false);

        writeRingCheck.addEventListener("click", function loadWriteRingCheck(ev) {
            tapeLengthSelect.disabled = !ev.target.checked;
        }, false);

        $$$("MTLoadOKBtn").addEventListener("click", tapeLoadOK, false);
        $$$("MTLoadCancelBtn").addEventListener("click", function loadCancelBtn(ev) {
            file = null;
            mt.$$("MTFileName").value = "";
            win.close();
        }, false);

        win.resizeBy(de.scrollWidth - win.innerWidth,
                     de.scrollHeight - win.innerHeight);
    }

    // Outer block of loadTape
    if (this.loadWindow && !this.loadWindow.closed) {
        this.loadWindow.close();
    }
    this.loadWindow = win;
    mt.$$("MTLoadBtn").disabled = true;
    win.addEventListener("load", tapeLoadOnload, false);
    win.addEventListener("unload", function tapeLoadUnload(ev) {
        this.loadWindow = null;
        if (win.closed) {
            mt.$$("MTLoadBtn").disabled = (mt.tapeState != mt.tapeUnloaded);
        }
    }, false);
};

/**************************************/
B5500MagTapeDrive.prototype.unloadTape = function unloadTape() {
    /* Reformats the tape image data as ASCII text and displays it in a new
    window so the user can save or copy/paste it elsewhere */
    var doc = null;                     // loader window.document
    var mt = this;                      // tape drive object
    var win = this.window.open("./B5500FramePaper.html", this.mnemonic + "-Unload",
            "location=no,scrollbars=yes,resizable,width=800,height=600");

    function unloadDriver() {
        /* Converts the tape image to ASCII once the window has displayed the
        waiting message */
        var buf = new Uint8Array(new ArrayBuffer(8192));
        var bufIndex;                   // offset into ASCII block data
        var bufLength = buf.length-2;   // max usable block size
        var c;                          // current image byte;
        var image = mt.image;           // tape image data
        var imgLength = mt.imgTopIndex; // tape image active length
        var table;                      // even/odd parity translate table
        var tape;                       // <pre> element to receive tape data
        var x = 0;                      // image data index

        doc = win.document;
        doc.title = "B5500 " + mt.mnemonic + " Unload Tape";
        tape = doc.getElementById("Paper");
        while (tape.firstChild) {               // delete any existing <pre> content
            tape.removeChild(tape.firstChild);
        }

        c = image[x];
        do {
            c &= 0x7F;                  // clear the start-of-block bit
            table = (mt.bcdXlateInEven[c] < 0xFF ? mt.bcdXlateInEven : mt.bcdXlateInOdd);
            bufIndex = 0;
            do {
                if (bufIndex >= bufLength) { // ASCII block size exceeded
                    tape.appendChild(doc.createTextNode(
                            String.fromCharCode.apply(null, buf.subarray(0, bufIndex))));
                    bufIndex = 0;
                }
                if (c > 0) {            // drop any unrecorded tape frames
                    buf[bufIndex++] = table[c];
                }
                if (++x < imgLength) {
                    c = image[x];
                } else {
                    break;
                }
            } while (c < 0x80);
            buf[bufIndex++] = 0x0A;
            tape.appendChild(doc.createTextNode(
                    String.fromCharCode.apply(null, buf.subarray(0, bufIndex))));
        } while (x < imgLength);

        mt.setTapeUnloaded();
    }

    function unloadSetup() {
        /* Loads a status message into the "paper" rendering area, then calls
        unloadDriver after a short wait to allow the message to appear */

        win.document.getElementById("Paper").appendChild(
                win.document.createTextNode("Rendering tape image... please wait..."));
        setTimeout(unloadDriver, 50);
    }

    // Outer block of unloadTape
    win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    win.focus();
    win.addEventListener("load", unloadSetup, false);
};

/**************************************/
B5500MagTapeDrive.prototype.tapeRewind = function tapeRewind(makeReady) {
    /* Rewinds the tape. Makes the drive not-ready and delays for an appropriate amount
    of time depending on how far up-tape we are. If makeReady is true [valid only when
    called from this.rewind()], then readies the unit again when the rewind is complete */
    var inches;
    var lastStamp = performance.now();

    function rewindFinish() {
        this.timer = 0;
        this.busy = false;
        B5500Util.removeClass(this.$$("MTRewindingLight"), "annunciatorLit");
        if (makeReady && this.tapeState == this.tapeRemote) {
            this.ready = true;
            this.statusChange(1);
        }
    }

    function rewindDelay() {
        var stamp = performance.now();
        var interval = stamp - lastStamp;

        if (interval <= 0) {
            interval = this.spinUpdateInterval/2;
        }
        if (this.tapeInches > 0) {
            inches = interval/1000*this.rewindSpeed;
            this.tapeInches -= inches;
            lastStamp = stamp;
            this.timer = setCallback(this.mnemonic, this, this.spinUpdateInterval, rewindDelay);
            this.spinReel(-inches);
        } else {
            this.setAtBOT(true);
            this.timer = setCallback(this.mnemonic, this, 2000, rewindFinish);
            this.spinReel(6);
        }
    }

    if (this.timer) {
        clearCallback(this.timer);
        this.timer = 0;
    }
    if (this.tapeState != this.tapeUnloaded && !this.atBOT) {
        this.busy = true;
        this.ready = false;
        this.statusChange(0);
        this.setAtEOT(false);
        B5500Util.addClass(this.$$("MTRewindingLight"), "annunciatorLit");
        this.timer = setCallback(this.mnemonic, this, 1000, rewindDelay);
    }
};

/**************************************/
B5500MagTapeDrive.prototype.MTUnloadBtn_onclick = function MTUnloadBtn_onclick(ev) {
    /* Handle the click event for the UNLOAD button */

    if (this.imgWritten && this.window.confirm(
            "Do you want to save the tape image data?\n(CANCEL discards the image)")) {
        this.unloadTape();              // it will do setTapeUnloaded() afterwards
    } else {
        this.setTapeUnloaded();
    }
};

/**************************************/
B5500MagTapeDrive.prototype.MTLoadBtn_onclick = function MTLoadBtn_onclick(ev) {
    /* Handle the click event for the LOAD button */

    this.loadTape();
};

/**************************************/
B5500MagTapeDrive.prototype.MTRemoteBtn_onclick = function MTRemoteBtn_onclick(ev) {
    /* Handle the click event for the REMOTE button */

    this.setTapeRemote(true);
};

/**************************************/
B5500MagTapeDrive.prototype.MTLocalBtn_onclick = function MTLocalBtn_onclick(ev) {
    /* Handle the click event for the LOCAL button */

    this.setTapeRemote(false);
};

/**************************************/
B5500MagTapeDrive.prototype.MTWriteRingBtn_onclick = function MTWriteRingBtn_onclick(ev) {
    /* Handle the click event for the WRITE RING button */

    this.setWriteRing(!this.writeRing);
};

/**************************************/
B5500MagTapeDrive.prototype.MTRewindBtn_onclick = function MTRewindBtn(ev) {
    /* Handle the click event for the REWIND button */

    this.tapeRewind(false);
};

/**************************************/
B5500MagTapeDrive.prototype.buildErrorMask = function buildErrorMask(chars) {
    /* Constructs the final error mask from this.errorMask, the number of residual
    characters in the last word, and the current drive state */
    var mask = this.errorMask & 0x01FC7FFF;     // clear out the char count bits

    mask |= (chars & 0x07) << 15;
    if (this.atBOT) {
        mask |= 0x80000;                // tape at BOT
    } else if (this.atEOT) {
        mask |= 0x40020;                // tape at EOT
    }
    this.errorMask = mask;
    return mask;
};

/**************************************/
B5500MagTapeDrive.prototype.bcdSpaceForward = function bcdSpaceForward(checkEOF) {
    /* Spaces over the next block (or the remainder of the current block) from the
    .bcd tape (this.image) in a forward direction. No data transfer to the IOUnit buffer
    takes place, and no parity detection is made. A block is terminated when the next
    frame has its high-order bit set, or the end of the tape image data is reached.
        checkEOF true=> check for an EOF frame (i.e., we're not spacing the rest of a block)
    Exits with the image index pointing to the first frame of the next block (or beyond
    the end of the image blob if at EOT) */
    var blankCount = 0;                 // blank tape frame counter
    var c;                              // current character (tape image frame)
    var image = this.image;             // tape image
    var imgLength = this.imgLength;     // tape image length
    var imgIndex = this.imgIndex;       // current tape image offset

    if (imgIndex >= imgLength) {
        this.errorMask |= 0x10;         // report parity error if beyond end of tape
    } else {
        if (this.atBOT) {
            this.setAtBOT(false);
        }
        c = image[imgIndex];
        if (checkEOF && c == this.bcdTapeMark && (imgIndex+1 >= imgLength || image[imgIndex+1] >= 0x80)) {
            this.errorMask |= 0x20;    // EOF
            imgIndex++;
        } else {
            do {
                if (c == 0x00) {
                    if (++blankCount > this.maxBlankFrames) {
                        this.errorMask |= 0x100000; // blank tape timeout
                        break;                  // kill the read loop
                    }
                } else {
                    blankCount = 0;
                }
                if (++imgIndex < imgLength) {
                    c = image[imgIndex];        // get next char frame
                } else {
                    break;                      // at end of tape, kill the read loop
                }
            } while (c < 0x80);
        }
    }
    this.imgIndex = imgIndex;
};

/**************************************/
B5500MagTapeDrive.prototype.bcdSpaceBackward = function bcdSpaceBackward(checkEOF) {
    /* Spaces over the next block (or the remainder of the current block) from the
    .bcd tape (this.image) in a backward direction. No data transfer to the IOUnit buffer
    takes place, and no parity detection is made. A block is terminated when the next
    frame has its high-order bit set, or the beginning of the tape image data is reached.
        checkEOF true=> check for an EOF frame (i.e., we're not spacing the rest of a block)
    Exits with the image index pointing to the first frame of THIS block (or at 0 if
    at BOT). This arrangement allows changes between forward/reverse motion to work */
    var blankCount = 0;                 // blank tape frame counter
    var c;                              // current character (tape image frame)
    var image = this.image;             // tape image
    var imgLength = this.imgLength;     // tape image length
    var imgIndex = this.imgIndex;       // current tape image offset

    if (imgIndex <= 0) {
        this.setAtBOT(true);
        this.errorMask |= 0x100000;     // set blank-tape bit
    } else {
        if (this.atEOT) {
            this.setAtEOT(false);
        }
        c = image[--imgIndex];
        if (checkEOF && c == this.bcdTapeMark) {
            this.errorMask |= 0x20;    // EOF
        } else {
            do {
                if (c == 0x00) {
                    if (++blankCount > this.maxBlankFrames) {
                        this.errorMask |= 0x100000; // blank tape timeout
                        break;                  // kill the read loop
                    }
                } else {
                    blankCount = 0;
                }
                if (--imgIndex >= 0) {
                    c = image[imgIndex];        // get next char frame
                } else {
                    break;                      // at start of tape, kill the read loop
                }
            } while (c < 0x80);
        }
    }
    this.imgIndex = imgIndex;
};

/**************************************/
B5500MagTapeDrive.prototype.bcdReadForward = function bcdReadForward(oddParity) {
    /* Reads the next block from the .bcd tape (this.image) in a forward direction,
    translating the character frames to ANSI character codes based on the translation
    table "xlate". The translated data is stored in this.buffer. A block is terminated
    when the next frame has its high-order bit set, or the end of the tape image data
    is reached. The resulting buffer is always at least one character in length, unless
    the block is a tapeMark or the end of the data has been reached.
        oddParity 0=Alpha (even parity), 1=Binary (odd parity) read
    Exits with the image index pointing to the first frame of the next block (or beyond
    the end of the image blob if at EOT). Returns the number of characters read into the
    IOUnit buffer */
    var blankCount = 0;                 // blank tape frame counter
    var buffer = this.buffer;           // IOUnit buffer
    var bufLength = this.bufLength      // IOUnit buffer length
    var bufIndex = 0;                   // current IOUnit buffer offset
    var c;                              // current character (tape image frame)
    var cx;                             // current character translated to ASCII
    var image = this.image;             // tape image
    var imgLength = this.imgLength;     // tape image length
    var imgIndex = this.imgIndex;       // current tape image offset
    var xlate = (oddParity ? this.bcdXlateInOdd : this.bcdXlateInEven);

    if (imgIndex >= imgLength) {
        this.errorMask |= 0x10;         // report parity error if beyond end of tape
    } else {
        if (this.atBOT) {
            this.setAtBOT(false);
        }
        c = image[imgIndex];
        if (c == this.bcdTapeMark && (imgIndex+1 >= imgLength || image[imgIndex+1] >= 0x80)) {
            this.errorMask |= 0x20;    // EOF
            imgIndex++;
        } else {
            c &= 0x7F;                 // zap the start-of-block bit
            do {
                if (c == 0x00) {
                    if (++blankCount > this.maxBlankFrames) {
                        this.errorMask |= 0x100000;     // blank tape timeout
                        break;                          // kill the read loop
                    } else if (++imgIndex < imgLength) {
                        c = image[imgIndex];            // get next char frame
                    } else {
                        break;                          // at end of tape, kill the read loop
                    }
                } else {
                    blankCount = 0;
                    cx = xlate[c];
                    if (cx < 0xFF) {
                        if (bufIndex < bufLength) {
                            buffer[bufIndex++] = cx;    // store the ANSI character
                            if (++imgIndex < imgLength) {
                                c = image[imgIndex];    // get next char frame
                            } else {
                                break;                  // at end of tape, kill the read loop
                            }
                        } else {
                            this.imgIndex = imgIndex;   // IOUnit buffer overflow
                            this.bcdSpaceForward(false);
                            imgIndex = this.imgIndex;
                            break;                      // kill the read loop
                        }
                    } else {
                        this.errorMask |= 0x10;         // parity error
                        this.imgIndex = imgIndex;
                        this.bcdSpaceForward(false);
                        imgIndex = this.imgIndex;
                        break;                          // kill the read loop
                    }
                }
            } while (c < 0x80);
        }
    }
    this.imgIndex = imgIndex;
    this.bufIndex = bufIndex;
    return bufIndex;
};

/**************************************/
B5500MagTapeDrive.prototype.bcdReadBackward = function bcdReadBackward(oddParity) {
    /* Reads the next block from the .bcd tape (this.image) in a backward direction,
    translating the character frames to ANSI character codes based on the translation
    table "xlate". The translated data is stored in this.buffer. A block is terminated
    when the next frame has its high-order bit set, or the beginning of the tape image
    data is reached. The resulting buffer is always at least one character in length,
    unless the block is a tapeMark or the end of the data has been reached.
        oddParity 0=Alpha (even parity), 1=Binary (odd parity) read
    Note that the characters are stored in this.buffer in ascending order as they are
    being read backwards; thus the buffer is in reverse order with respect to how the
    data will be stored in memory. The IOUnit will unravel this at finish.
    Exits with the image index pointing to the first frame of THIS block (or at 0 if
    at BOT). This arrangement allows changes between forward/reverse motion to work */
    var blankCount = 0;                 // blank tape frame counter
    var buffer = this.buffer;           // IOUnit buffer
    var bufLength = this.bufLength      // IOUnit buffer length
    var bufIndex = 0;                   // current IOUnit buffer offset
    var c;                              // current character (tape image frame)
    var cx;                             // current character translated to ASCII
    var image = this.image;             // tape image
    var imgLength = this.imgLength;     // tape image length
    var imgIndex = this.imgIndex;       // current tape image offset
    var xlate = (oddParity ? this.bcdXlateInOdd : this.bcdXlateInEven);

    if (imgIndex <= 0) {
        this.setAtBOT(true);
        this.errorMask |= 0x100000;     // set blank-tape bit
    } else {
        if (this.atEOT) {
            this.setAtEOT(false);
        }
        c = image[--imgIndex];
        if (c == this.bcdTapeMark) {
             this.errorMask |= 0x20;    // EOF
        } else {
            do {
                if (c == 0x00) {
                    if (++blankCount > this.maxBlankFrames) {
                        this.errorMask |= 0x100000;     // blank tape timeout
                        break;                          // kill the read loop
                    } else if (imgIndex > 0) {
                        c = image[--imgIndex];          // get next char frame
                    } else {
                        break;                          // at end of tape, kill the read loop
                    }
                } else {
                    blankCount = 0;
                    cx = xlate[c & 0x7F];
                    if (cx < 0xFF) {
                        if (bufIndex < bufLength) {
                            buffer[bufIndex++] = cx;    // store the ANSI character
                            if (c >= 0x80) {
                                break;                  // at start of block, kill the read loop
                            } else if (imgIndex > 0) {
                                c = image[--imgIndex];  // get next char frame
                            } else {
                                break;                  // at start of tape, kill the read loop
                            }
                        } else {
                            this.imgIndex = imgIndex;   // IOUnit buffer overflow
                            this.bcdSpaceBackward(false);
                            imgIndex = this.imgIndex;
                            break;                      // kill the read loop
                        }
                    } else {
                        this.errorMask |= 0x10;         // parity error
                        this.imgIndex = imgIndex;
                        this.bcdSpaceBackward(false);
                        imgIndex = this.imgIndex;
                        break;                          // kill the read loop
                    }
                }
            } while (true);
        }
    }
    this.imgIndex = imgIndex;
    this.bufIndex = bufIndex;
    return bufIndex;
};

/**************************************/
B5500MagTapeDrive.prototype.bcdWrite = function bcdWrite(oddParity) {
    /* Writes the next block to the .bcd tape (this.image) in memory, translating
    the character frames from ANSI character codes based on the translation
    table "xlate". The translated data is stored at the current offset in
    this.buffer. The start of a block is indicated by setting its high-order bit set.
        oddParity 0=Alpha (even parity), 1=Binary (odd parity) write
    Exits with the image index pointing beyond the last frame of the block (or beyond
    the end of the image blob if at the end). Returns the number of characters written
    to the IOUnit buffer */
    var buffer = this.buffer;           // IOUnit buffer
    var bufLength = this.bufLength      // IOUnit buffer length
    var bufIndex = 0;                   // current IOUnit buffer offset
    var image = this.image;             // tape image
    var imgLength = this.imgLength;     // tape image length
    var imgIndex = this.imgIndex;       // current tape image offset
    var xlate = (oddParity ? this.bcdXlateOutOdd : this.bcdXlateOutEven);

    if (imgIndex >= imgLength) {
        this.errorMask |= 0x04;         // report not ready if beyond end of tape
    } else {
        if (this.atBOT) {
            this.setAtBOT(false);
        }
        image[imgIndex++] = xlate[buffer[bufIndex++] & 0x7F] | 0x80;
        while (bufIndex < bufLength) {
            if (imgIndex >= imgLength) {
                this.errorMask |= 0x04; // report not ready beyond end of tape
                break;
            } else {
                image[imgIndex++] = xlate[buffer[bufIndex++] & 0x7F];
            }
        } // while
    }
    this.imgIndex = imgIndex;
    this.bufIndex = bufIndex;
    if (imgIndex > this.imgTopIndex) {
        this.imgTopIndex = imgIndex;
    }
    return bufIndex;
};

/**************************************/
B5500MagTapeDrive.prototype.beforeUnload = function beforeUnload(ev) {
    var msg = "Closing this window will make the device unusable.\n" +
              "Suggest you stay on the page and minimize this window instead";

    ev.preventDefault();
    ev.returnValue = msg;
    return msg;
};

/**************************************/
B5500MagTapeDrive.prototype.tapeDriveOnload = function tapeDriveOnload() {
    /* Initializes the reader window and user interface */
    var de;
    var y = ((this.mnemonic.charCodeAt(2) - "A".charCodeAt(0))*30);

    this.doc = this.window.document;
    de = this.doc.documentElement;
    this.doc.title = "retro-B5500 Tape Drive " + this.mnemonic;

    this.reelBar = this.$$("MTReelBar");
    this.reelIcon = this.$$("MTReel");

    this.tapeState = this.tapeLocal;    // setTapeUnloaded() requires it to be in local
    this.atBOT = true;                  // and also at BOT
    this.setTapeUnloaded();

    this.window.addEventListener("beforeunload",
            B5500MagTapeDrive.prototype.beforeUnload, false);
    this.$$("MTUnloadBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.MTUnloadBtn_onclick), false);
    this.$$("MTLoadBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.MTLoadBtn_onclick), false);
    this.$$("MTRemoteBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.MTRemoteBtn_onclick), false);
    this.$$("MTLocalBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.MTLocalBtn_onclick), false);
    this.$$("MTWriteRingBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.MTWriteRingBtn_onclick), false);
    this.$$("MTRewindBtn").addEventListener("click",
            B5500CentralControl.bindMethod(this, B5500MagTapeDrive.prototype.MTRewindBtn_onclick), false);

    this.window.resizeBy(de.scrollWidth - this.window.innerWidth + 4, // kludge for right-padding/margin
                         de.scrollHeight - this.window.innerHeight);
    this.window.moveTo(280, y);
};

/**************************************/
B5500MagTapeDrive.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit. If the drive is busy or not ready,
    returns those conditions.  Otherwise, attempts to read the next block from the tape.
        mode 0=Alpha (even parity), 1=Binary (odd parity) read
        control 0=forward, 1=backward read
    */
    var count;                          // number of characters read into IOUnit buffer
    var imgCount = this.imgIndex;       // number of characters passed on tape
    var inches = 0;                     // block length including gap [inches]
    var residue;                        // residual characters in last word read

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        finish(0x04, 0);                // report unit not ready
    } else {
        this.busy = true;
        this.buffer = buffer;
        this.bufLength = length;
        this.bufIndex = 0;

        if (control) {
            count = this.bcdReadBackward(mode);
            residue = 7 - count % 8;
            imgCount -= this.imgIndex;
            inches = -imgCount/this.density - this.gapLength;
            this.tapeInches += inches;
            if (this.atEOT && this.tapeInches < this.imgEOTInches) {
                this.setAtEOT(false);
            }
        } else {
            count = this.bcdReadForward(mode);
            residue = count % 8;
            imgCount = this.imgIndex - imgCount;
            inches = imgCount/this.density + this.gapLength;
            this.tapeInches += inches;
            if (!this.atEOT && this.tapeInches > this.imgEOTInches) {
                this.setAtEOT(true);
            }
        }

        this.buildErrorMask(residue);
        this.moveTape(inches,
            (imgCount/this.charsPerSec + this.startStopTime)*1000 + this.initiateStamp - performance.now(),
            function readDelay() {
                this.busy = false;
                finish(this.errorMask, count);
        });

        this.buffer = null;
    }
    //console.log(this.mnemonic + " read:             c=" + control + ", length=" + length + ", mode=" + mode +
    //    ", count=" + count + ", inches=" + this.tapeInches +
    //    ", index=" + this.imgIndex + ", mask=" + this.errorMask.toString(8));
    //console.log(String.fromCharCode.apply(null, buffer.subarray(0, 80)).substring(0, count));
};

/**************************************/
B5500MagTapeDrive.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit. If the drive is busy or not ready,
    returns those conditions.  Otherwise, attempts to space over the next block
    from the tape. Parity errors are ignored.
        control 0=forward, 1=backward space
    */
    var imgCount = this.imgIndex;       // number of characters passed on tape
    var inches = 0;                     // block length including gap [inches]

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        finish(0x04, 0);                // report unit not ready
    } else {
        this.busy = true;

        if (control) {
            this.bcdSpaceBackward(true);
            imgCount -= this.imgIndex;
            inches = -imgCount/this.density - this.gapLength;
            this.tapeInches += inches;
            if (this.atEOT && this.tapeInches < this.imgEOTInches) {
                this.setAtEOT(false);
            }
        } else {
            this.bcdSpaceForward(true);
            imgCount = this.imgIndex - imgCount;
            inches = imgCount/this.density + this.gapLength;
            this.tapeInches += inches;
            if (!this.atEOT && this.tapeInches > this.imgEOTInches) {
                this.setAtEOT(true);
            }
        }

        this.buildErrorMask(0);
        this.moveTape(inches,
            (imgCount/this.charsPerSec + this.startStopTime)*1000 + this.initiateStamp - performance.now(),
            function readDelay() {
                this.busy = false;
                finish(this.errorMask, 0);
        });
    }
    //console.log(this.mnemonic + " space:            c=" + control + ", length=" + length +
    //    ", count=" + imgCount + ", inches=" + this.tapeInches +
    //    ", index=" + this.imgIndex + ", mask=" + this.errorMask.toString(8));
};

/**************************************/
B5500MagTapeDrive.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit. If the drive is busy, not ready or has
    no write ring, returns those conditions.  Otherwise, attempts to write the next block
    to the tape. mode 0=Alpha (even parity), 1=Binary (odd parity) write */
    var count;                          // number of characters read into IOUnit buffer
    var imgCount = this.imgIndex;       // number of characters passed on tape
    var inches = 0;                     // block length including gap [inches]
    var residue;                        // residual characters in last word read

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        finish(0x04, 0);                // report unit not ready
    } else if (!this.writeRing) {
        finish(0x50, 0);                // RD bits 26 & 28 => no write ring, don't return Mod III bits
    } else {
        this.busy = true;
        this.buffer = buffer;
        this.bufLength = length;
        this.bufIndex = 0;

        count = this.bcdWrite(mode);
        residue = count % 8;
        imgCount = this.imgIndex - imgCount;
        inches = imgCount/this.density + this.gapLength;
        this.tapeInches += inches;
        if (!this.atEOT && this.tapeInches > this.imgEOTInches) {
            this.setAtEOT(true);
        }

        this.imgWritten = true;
        this.buildErrorMask(residue);
        this.moveTape(inches,
            (imgCount/this.charsPerSec + this.startStopTime)*1000 + this.initiateStamp - performance.now(),
            function writeDelay() {
                this.busy = false;
                finish(this.errorMask, count);
        });

        this.buffer = null;
    }
    //console.log(this.mnemonic + " write:            c=" + control + ", length=" + length + ", mode=" + mode +
    //    ", count=" + count + ", inches=" + this.tapeInches +
    //    ", index=" + this.imgIndex + ", mask=" + this.errorMask.toString(8));
    //console.log(String.fromCharCode.apply(null, buffer.subarray(0, 80)).substring(0, count));
};

/**************************************/
B5500MagTapeDrive.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit. If the drive is busy, not ready,
    or has no write ring, then returns those conditions.  Otherwise, does nothing
    to the tape image, as lengths of blank tape less than 9 feet in length are
    not "seen" by the I/O Unit. Delays an appropriate amount of time for the
    length of the erasure */
    var inches;                         // erase length [inches]

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        finish(0x04, 0);                // report unit not ready
    } else if (!this.writeRing) {
        finish(0x50, 0);                // RD bits 26 & 28 => no write ring, don't return Mod III bits
    } else {
        this.busy = true;

        inches = length/this.density;
        this.tapeInches += inches;
        if (!this.atEOT && this.tapeInches > this.imgEOTInches) {
            this.setAtEOT(true);
        }

        this.imgWritten = true;
        this.buildErrorMask(0);
        this.moveTape(inches,
            (length/this.charsPerSec + this.startStopTime)*1000 + this.initiateStamp - performance.now(),
            function eraseDelay() {
                this.busy = false;
                finish(this.errorMask, 0);
        });
     }
    //console.log(this.mnemonic + " erase:            c=" + control + ", length=" + length +
    //    ", inches=" + this.tapeInches +
    //    ", index=" + this.imgIndex + ", mask=" + this.errorMask.toString(8));
};

/**************************************/
B5500MagTapeDrive.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit. If the drive is busy or not ready,
    returns those conditions.  Otherwise, makes the drive not-ready, delays for an
    appropriate amount of time depending on how far up-tape we are, then readies the
    unit again */

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        finish(0x04, 0);                // report unit not ready
    } else {
        this.tapeRewind(true);
        this.buildErrorMask(0);
        finish(this.errorMask, 0);
    }
    //console.log(this.mnemonic + " rewind:           mask=" + this.errorMask.toString(8));
};

/**************************************/
B5500MagTapeDrive.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500MagTapeDrive.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500MagTapeDrive.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit. This is actually a write
    of zero length, typically used to determine ready and BOT/EOT status for the drive */

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        finish(0x04, 0);                // report unit not ready
    } else {
        if (this.writeRing) {
            this.buildErrorMask(0);
        } else {
            this.errorMask |= 0x50;     // RD bits 26 & 28 => no write ring, don't return Mod III bits
        }
        finish(this.errorMask, 0);
    }
    //console.log(this.mnemonic + " writeInterrogate: c=" + control + ", mask=" + this.errorMask.toString(8));
};

/**************************************/
B5500MagTapeDrive.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearCallback(this.timer);
    }
    this.window.removeEventListener("beforeunload", B5500MagTapeDrive.prototype.beforeUnload, false);
    this.window.close();
    if (this.loadWindow && !this.loadWindow.closed) {
        this.loadWindow.close();
    }
};
