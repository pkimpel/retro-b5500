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
* This implementation supports READONLY operation for .bcd files ONLY.
*
************************************************************************
* 2013-10-26  P.Kimpel
*   Original version, from B5500CardReader.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500MagTapeDrive(mnemonic, unitIndex, designate, statusChange, signal) {
    /* Constructor for the MagTapeDrive object */
    var that = this;
    var x = (mnemonic == "MTA" ? 30 : 60);

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (not used here)

    this.timer = null;                  // setCallback() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)

    this.clear();

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.window = window.open("../webUI/B5500MagTapeDrive.html", mnemonic,
        "scrollbars=no,resizable,width=560,height=120,left="+x+",top="+x);
    this.window.addEventListener("load", function windowLoad() {
        that.tapeDriveOnLoad();
    }, false);

    this.progressBar = null;
    this.reelIcon = null;
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
B5500MagTapeDrive.prototype.maxTapeLength = 2400*12;
                                        // max tape length on reel [inches]
B5500MagTapeDrive.prototype.maxBlankFrames = 9*12*B5500MagTapeDrive.prototype.density;
                                        // max blank tape length, 9 feet [frames]
B5500MagTapeDrive.prototype.bcdTapeMark = 0x8F;
                                        // .bcd image EOF code
B5500MagTapeDrive.prototype.reelCircumference = 10*3.14159;
                                        // max circumference of tape [inches]

B5500MagTapeDrive.prototype.cardFilter = [ // Filter ASCII character values to valid BIC ones
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 00-0F
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 10-1F
        0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x3F,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,  // 20-2F
        0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,  // 30-3F
        0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 40-4F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x3F,0x5D,0x3F,0x3F,  // 50-5F
        0x3F,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 60-6F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x7B,0x7C,0x7D,0x7E,0x3F]; // 70-7F

B5500MagTapeDrive.prototype.bcdXlateInOdd = [     // Translate odd parity BIC to ASCII
        0xFF,0x31,0x32,0xFF,0x34,0xFF,0xFF,0x37,0x38,0xFF,0xFF,0x40,0xFF,0x3A,0x3E,0xFF,
        0x2B,0xFF,0xFF,0x43,0xFF,0x45,0x46,0xFF,0xFF,0x49,0x2E,0xFF,0x26,0xFF,0xFF,0x7E,
        0x7C,0xFF,0xFF,0x4C,0xFF,0x4E,0x4F,0xFF,0xFF,0x52,0x24,0xFF,0x2D,0xFF,0xFF,0x7B,
        0xFF,0x2F,0x53,0xFF,0x55,0xFF,0xFF,0x58,0x59,0xFF,0xFF,0x25,0xFF,0x3D,0x5D,0xFF,
        0x30,0xFF,0xFF,0x33,0xFF,0x35,0x36,0xFF,0xFF,0x39,0x23,0xFF,0x3F,0xFF,0xFF,0x7D,
        0xFF,0x41,0x42,0xFF,0x44,0xFF,0xFF,0x47,0x48,0xFF,0xFF,0x5B,0xFF,0x28,0x3C,0xFF,
        0xFF,0x4A,0x4B,0xFF,0x4D,0xFF,0xFF,0x50,0x51,0xFF,0xFF,0x2A,0xFF,0x29,0x3B,0xFF,
        0x20,0xFF,0xFF,0x54,0xFF,0x56,0x57,0xFF,0xFF,0x5A,0x2C,0xFF,0x21,0xFF,0xFF,0x22]

B5500MagTapeDrive.prototype.bcdXlateInEven = [    // Translate even parity BCL to ASCII
        0x30,0xFF,0xFF,0x33,0xFF,0x35,0x36,0xFF,0xFF,0x39,0x23,0xFF,0x3F,0xFF,0xFF,0x7D,  // 00-0F
        0xFF,0x41,0x42,0xFF,0x44,0xFF,0xFF,0x47,0x48,0xFF,0xFF,0x5B,0xFF,0x28,0x3C,0xFF,  // 10-1F
        0xFF,0x4A,0x4B,0xFF,0x4D,0xFF,0xFF,0x50,0x51,0xFF,0xFF,0x2A,0xFF,0x29,0x3B,0xFF,  // 20-2F
        0x20,0xFF,0xFF,0x54,0xFF,0x56,0x57,0xFF,0xFF,0x5A,0x2C,0xFF,0x21,0xFF,0xFF,0x22,  // 30-3F
        0xFF,0x31,0x32,0xFF,0x34,0xFF,0xFF,0x37,0x38,0xFF,0xFF,0x40,0xFF,0x3A,0x3E,0xFF,  // 40-4F
        0x2B,0xFF,0xFF,0x43,0xFF,0x45,0x46,0xFF,0xFF,0x49,0x2E,0xFF,0x26,0xFF,0xFF,0x7E,  // 50-5F
        0x7C,0xFF,0xFF,0x4C,0xFF,0x4E,0x4F,0xFF,0xFF,0x52,0x24,0xFF,0x2D,0xFF,0xFF,0x7B,  // 60-6F
        0xFF,0x2F,0x53,0xFF,0x55,0xFF,0xFF,0x58,0x59,0xFF,0xFF,0x25,0xFF,0x3D,0x5D,0xFF]; // 70-7F

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

    this.image = null;                  // Tape drive "reel of tape"
    this.imgLength = 0;                 // Current input buffer length (characters)
    this.imgIndex = 0;                  // 0-relative offset to next tape block to be read

    this.tapeState = this.tapeUnloaded; // tape drive state
    this.angle = 0;                     // current rotation angle of reel image [degrees]
    this.tapeInches = 0;                // number of inches up-tape
    this.writeRing = false;             // true if write ring is present and tape is writable
    this.atBOT = false;                 // true if tape at BOT
    this.atEOT = false;                 // true if tape at EOT

    this.buffer = null;                 // IOUnit buffer
    this.bufLength = 0;                 // IOUnit buffer length
    this.bufIndex = 0;                  // IOUnit buffer current offset
};

/**************************************/
B5500MagTapeDrive.prototype.hasClass = function hasClass(e, name) {
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
B5500MagTapeDrive.prototype.addClass = function addClass(e, name) {
    /* Adds a class "name" to the element "e"s class list */

    if (!this.hasClass(e, name)) {
        e.className += (" " + name);
    }
};

/**************************************/
B5500MagTapeDrive.prototype.removeClass = function removeClass(e, name) {
    /* Removes the class "name" from the element "e"s class list */

    e.className = e.className.replace(new RegExp("\\b" + name + "\\b\\s*", "g"), "");
};

/**************************************/
B5500MagTapeDrive.prototype.spinReel = function spinReel(inches) {
    /* Rotates the reel image icon an appropriate amount based on the number of
    inches of tape movement */
    var circumference = this.reelCircumference*(1 - this.tapeInches/this.maxTapeLength/2);
    var angle = inches/circumference*360;

    if (angle >= 33) {
        angle = 33;
    } else if (angle < -33) {
        angle = -33;
    }

    this.angle = (this.angle + angle)%360;
    this.reelIcon.style.transform = "rotate(" + this.angle.toFixed(0) + "deg)";
};

/**************************************/
B5500MagTapeDrive.prototype.setAtBOT = function setAtBOT(atBOT) {
    /* Controls the ready-state of the tape drive */

    if (atBOT ^ this.atBOT) {
        this.atBOT = atBOT;
        if (atBOT) {
            this.imgIndex = 0;
            this.tapeInches = 0;
            this.addClass(this.$$("MTAtBOTLight"), "whiteLit");
            this.reelIcon.style.transform = "rotate(0deg)";
        } else {
            this.removeClass(this.$$("MTAtBOTLight"), "whiteLit");
        }
    }
};

/**************************************/
B5500MagTapeDrive.prototype.setAtEOT = function setAtEOT(atEOT) {
    /* Controls the ready-state of the tape drive */

    if (atEOT ^ this.atEOT) {
        this.atEOT = atEOT;
        if (atEOT) {
            this.imgIndex = this.imgLength;
            this.addClass(this.$$("MTAtEOTLight"), "whiteLit");
        } else {
            this.removeClass(this.$$("MTAtEOTLight"), "whiteLit");
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
        this.$$("MTFileSelector").disabled = false;
        this.$$("MTFileSelector").value = null;
        this.removeClass(this.$$("MTRemoteBtn"), "yellowLit");
        this.addClass(this.$$("MTLocalBtn"), "yellowLit");
        this.removeClass(this.$$("MTWriteRingBtn"), "redLit");
        this.addClass(this.$$("MTUnloadedLight"), "whiteLit");
        this.progressBar.value = 0;
        this.setAtBOT(false);
        this.setAtEOT(false);
        this.reelIcon.style.visibility = "hidden";
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
        this.$$("MTFileSelector").disabled = true;
        this.ready = ready;
        if (ready) {
            this.tapeState = this.tapeRemote;
            this.statusChange(1);
            this.removeClass(this.$$("MTLocalBtn"), "yellowLit");
            this.addClass(this.$$("MTRemoteBtn"), "yellowLit");
        } else {
            this.tapeState = this.tapeLocal;
            this.statusChange(0);
            this.removeClass(this.$$("MTRemoteBtn"), "yellowLit");
            this.addClass(this.$$("MTLocalBtn"), "yellowLit");
        }
    }
};

/**************************************/
B5500MagTapeDrive.prototype.setWriteRing = function setWriteRing(writeRing) {
    /* Controls the write-ring (write-enabled state of the tape drive. In Local state,
    writable status can be set or reset; in Remote state, it can only be reset */

    switch (this.tapeState) {
    case this.tapeLocal:
        this.writeRing = writeRing;
        if (writeRing) {
            this.addClass(this.$$("MTWriteRingBtn"), "redLit");
        } else {
            this.removeClass(this.$$("MTWriteRingBtn"), "redLit");
        }
        break;
    case this.tapeRemote:
        if (this.writeRing && !writeRing) {
            this.writeRing = false;
            this.removeClass(this.$$("MTWriteRingBtn"), "redLit");
        }
        break;
    }
};

/**************************************/
B5500MagTapeDrive.prototype.tapeRewind = function tapeRewind(makeReady) {
    /* Rewinds the tape. Makes the drive not-ready and delays for an appropriate amount
    of time depending on how far up-tape we are. If makeReady is true, then readies
    the unit again when the rewind is complete [valid only when called from
    this.rewind()] */
    var inches;
    var inchFactor = this.imgIndex/this.tapeInches;
    var lastStamp = new Date().getTime();

    function rewindDelay() {
        var stamp = new Date().getTime();
        var interval = stamp - lastStamp;

        if (interval <= 0) {
            interval = 1;
        }
        if (this.tapeInches > 0) {
            inches = interval/1000*this.rewindSpeed;
            this.tapeInches -= inches;
            this.spinReel(-inches);
            this.progressBar.value = this.imgLength - this.tapeInches*inchFactor;
            lastStamp = stamp;
            this.timer = setCallback(rewindDelay, this, 30);
        } else {
            this.busy = false;
            this.setAtBOT(true);
            this.progressBar.value = this.imgLength;
            this.removeClass(this.$$("MTRewindingLight"), "whiteLit");
            if (makeReady) {
                this.ready = true;
                this.statusChange(1);
            }
        }
    }

    if (this.tapeState != this.tapeUnloaded) {
        this.busy = true;
        this.ready = false;
        this.statusChange(0);
        this.setAtEOT(false);
        this.addClass(this.$$("MTRewindingLight"), "whiteLit");
        this.timer = setCallback(rewindDelay, this,
                this.startStopTime*1000 + this.initiateStamp - lastStamp);
    }
};

/**************************************/
B5500MagTapeDrive.prototype.MTUnloadBtn_onclick = function MTUnloadBtn_onclick(ev) {
    /* Handle the click event for the UNLOAD button */

    this.setTapeUnloaded();
};

/**************************************/
B5500MagTapeDrive.prototype.MTLoadBtn_onclick = function MTLoadBtn_onclick(ev) {
    /* Handle the click event for the LOAD button */
    var ck = new MouseEvent("click", {cancelable:true, bubbles:false, detail:{}});

    this.$$("MTFileSelector").value = null;     // reset the control so the same file can be reloaded
    this.$$("MTFileSelector").dispatchEvent(ck);// click the file selector's Browse... button
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
B5500MagTapeDrive.prototype.fileSelector_onChange = function fileSelector_onChange(ev) {
    /* Handle the <input type=file> onchange event when a file is selected. Loads the
    file and puts the drive in Local state */
    var tape;
    var f = ev.target.files[0];
    var that = this;

    function fileLoader_onLoad(ev) {
        /* Handle the onload event for the ArrayBuffer FileReader */

        that.image = new Uint8Array(ev.target.result);
        that.imgIndex = 0;
        that.imgLength = that.image.length;
        that.progressBar.value = that.imgLength;
        that.progressBar.max = that.imgLength;
        that.removeClass(that.$$("MTUnloadedLight"), "whiteLit");
        that.tapeState = that.tapeLocal;// setTapeRemote() requires it not to be unloaded
        that.setAtBOT(true);
        that.setAtEOT(false);
        that.setTapeRemote(false);
        that.setWriteRing(false);       // read-only for now...
        that.reelIcon.style.visibility = "visible";
    }

    tape = new FileReader();
    tape.onload = fileLoader_onLoad;
    tape.readAsArrayBuffer(f);
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
        mask |= 0x40000;                // tape at EOT
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

    if (imgIndex < imgLength) {
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
    if (imgIndex >= imgLength) {
        this.setAtEOT(true);
    }
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
        this.errorMask |= 0x100010;     // set blank-tape and parity bits
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
        if (imgIndex <= 0) {
            this.setAtBOT(true);
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

    if (imgIndex < imgLength) {
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
    if (imgIndex >= imgLength) {
        this.setAtEOT(true);
    }
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
        this.errorMask |= 0x100010;     // set blank-tape and parity bits
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
        if (imgIndex <= 0) {
            this.setAtBOT(true);
        }
    }
    this.imgIndex = imgIndex;
    this.bufIndex = bufIndex;
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
B5500MagTapeDrive.prototype.tapeDriveOnLoad = function tapeDriveOnLoad() {
    /* Initializes the reader window and user interface */
    var that = this;

    this.doc = this.window.document;
    this.doc.title = "retro-B5500 " + this.mnemonic;

    this.progressBar = this.$$("MTProgressBar");
    this.reelIcon = this.$$("MTReel");

    this.window.addEventListener("beforeunload", this.beforeUnload, false);

    this.tapeState = this.tapeLocal;    // setTapeUnloaded() requires it not to be unloaded
    this.setTapeUnloaded();

    this.$$("MTUnloadBtn").addEventListener("click", function startClick(ev) {
        that.MTUnloadBtn_onclick(ev);
    }, false);

    this.$$("MTLoadBtn").addEventListener("click", function stopClick(ev) {
        that.MTLoadBtn_onclick(ev);
    }, false);

    this.$$("MTRemoteBtn").addEventListener("click", function startClick(ev) {
        that.MTRemoteBtn_onclick(ev);
    }, false);

    this.$$("MTLocalBtn").addEventListener("click", function stopClick(ev) {
        that.MTLocalBtn_onclick(ev);
    }, false);

    this.$$("MTWriteRingBtn").addEventListener("click", function eofClick(ev) {
        that.MTWriteRingBtn_onclick(ev);
    }, false);

    this.$$("MTRewindBtn").addEventListener("click", function eofClick(ev) {
        that.MTRewindBtn_onclick(ev);
    }, false);

    this.progressBar.addEventListener("click", function progressClick(ev) {
        that.MTProgressBar_onclick(ev);
    }, false);

    this.$$("MTFileSelector").addEventListener("change", function fileSelectorChange(ev) {
        that.fileSelector_onChange(ev);
    }, false);
};

/**************************************/
B5500MagTapeDrive.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit. If the drive is busy or not ready,
    returns those conditions.  Otherwise, attempts to read the next block from the tape.
        mode 0=Alpha (even parity), 1=Binary (odd parity) read
        control 0=forward, 1=backward read
    At present, this supports only .bcd tape images */
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
        } else {
            count = this.bcdReadForward(mode);
            residue = count % 8;
            imgCount = this.imgIndex - imgCount;
            inches = imgCount/this.density + this.gapLength;
        }

        this.tapeInches += inches;
        this.buildErrorMask(residue);
        this.timer = setCallback(function readDelay() {
            this.busy = false;
            finish(this.errorMask, count);
        }, this, (imgCount/this.charsPerSec + this.startStopTime)*1000 +
                  this.initiateStamp - new Date().getTime());

        this.spinReel(inches);
        if (this.imgIndex < this.imgLength) {
            this.progressBar.value = this.imgLength-this.imgIndex;
        } else {
            this.progressBar.value = 0;
        }
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
    At present, this supports only .bcd tape images */
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
        } else {
            this.bcdSpaceForward(true);
            imgCount = this.imgIndex - imgCount;
            inches = imgCount/this.density + this.gapLength;
        }

        this.tapeInches += inches;
        this.buildErrorMask(0);
        this.timer = setCallback(function readDelay() {
            this.busy = false;
            finish(this.errorMask, 0);
        }, this, (imgCount/this.charsPerSec + this.startStopTime)*1000 +
                  this.initiateStamp - new Date().getTime());

        this.spinReel(inches);
        if (this.imgIndex < this.imgLength) {
            this.progressBar.value = this.imgLength-this.imgIndex;
        } else {
            this.progressBar.value = 0;
        }
    }
    //console.log(this.mnemonic + " space:           c=" + control + ", length=" + length +
    //    ", count=" + imgCount + ", inches=" + this.tapeInches +
    //    ", index=" + this.imgIndex + ", mask=" + this.errorMask.toString(8));
};

/**************************************/
B5500MagTapeDrive.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500MagTapeDrive.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);                    // report unit not ready
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
        this.buildErrorMask(0, true);
        if (!this.writeRing) {
            this.errorMask |= 0x50;     // RD bits 26 & 28 => no write ring
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
    this.window.removeEventListener("beforeunload", this.beforeUnload, false);
    this.window.close();
};
