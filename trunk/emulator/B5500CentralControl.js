/***********************************************************************
* retro-b5500/emulator B5500CentralControl.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License,
*       see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Central Control module.
************************************************************************
* 2012-06-03  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500CentralControl() {
    /* Constructor for the Central Control module object */

    /* Global system modules */
    this.DD = null;                     // Distribution & Display unit
    this.PA = null;                     // Processor A (PA)
    this.PB = null;                     // Processor B (PB)
    this.IO1 = null;                    // I/O unit 1
    this.IO2 = null;                    // I/O unit 2
    this.IO3 = null;                    // I/O unit 3
    this.IO4 = null;                    // I/O unit 4

    this.P1 = null;                     // Reference for Processor 1 (control) [PA or PB]
    this.P1 = null;                     // Reference for Processor 2 (slave)   [PA or PB]

    this.AddressSpace = new Array(8);   // Array of memory module address spaces (8 x 32KB each)
    this.MemMod = new Array(8);         // Array of memory module words as Float64s (8 x 4KW each)

    // Instance variables and flags
    this.poweredUp = 0;                 // System power indicator

    this.PB1L = 0;                      // 0=> PA is P1, 1=> PB is P1
    this.cardLoadSelect = 0;            // 0=> load from disk/drum; 1=> load from cards

    this.nextTimeStamp = 0;             // Next actual Date.getTime() for timer tick
    this.timer = null;                  // Reference to the RTC setTimeout id.
    this.loadTimer = null;              // Reference to the load setTimeout id.

    this.tock.that = this;              // Establish contexts for when called from setTimeout().
    this.loadComplete.that = this;

    this.clear();                       // Create and initialize the Central Control state
}

/**************************************/
    /* Global constants */

B5500CentralControl.rtcTick = 1000/60; // Real-time clock period, milliseconds

B5500CentralControl.pow2 = [ // powers of 2 from 0 to 52
                       1,               2,                4,                8,
                      16,              32,               64,              128,
                     256,             512,             1024,             2048,
                    4096,            8192,            16384,            32768,
                   65536,          131072,           262144,           524288,
                 1048576,         2097152,          4194304,          8388608,
                16777216,        33554432,         67108864,        134217728,
               268435456,       536870912,       1073741824,       2147483648,
              4294967296,      8589934592,      17179869184,      34359738368,
             68719476736,    137438953472,     274877906944,     549755813888,
           1099511627776,   2199023255552,    4398046511104,    8796093022208,
          17592186044416,  35184372088832,   70368744177664,  140737488355328,
         281474976710656, 562949953421312, 1125899906842624, 2251799813685248,
        4503599627370496];

B5500CentralControl.mask2 = [ // (2**n)-1 for n from 0 to 52
                       0,               1,                3,                7,
                      15,              31,               63,              127,
                     255,             511,             1023,             2047,
                    4095,            8191,            16383,            32767,
                   65535,          131071,           262143,           524287,
                 1048575,         2097151,          4194303,          8388607,
                16777215,        33554431,         67108863,        134217727,
               268435455,       536870911,       1073741823,       2147483647,
              4294967295,      8589934591,      17179869183,      34359738367,
             68719476735,    137438953471,     274877906943,     549755813887,
           1099511627775,   2199023255551,    4398046511103,    8796093022207,
          17592186044415,  35184372088831,   70368744177663,  140737488355327,
         281474976710655, 562949953421311, 1125899906842623, 2251799813685247,
        4503599627370495];

/**************************************/
B5500CentralControl.prototype.clear = function() {
    /* Initializes (and if necessary, creates) the system and starts the
    real-time clock */

    if (this.timer) {
        clearTimeout(this.timer);
    }

    this.nextTimeStamp = new Date().getTime() + B5500CentralControl.rtcTick;
    this.timer = setTimeout(this.tock, B5500CentralControl.rtcTick);

    this.IAR = 0;                       // Interrupt address register
    this.TM = 0;                        // Real-time clock (6 bits, 60 ticks per second)

    this.CCI03F = 0;                    // Time interval interrupt
    this.CCI04F = 0;                    // I/O busy interrupt
    this.CCI05F = 0;                    // Keyboard request interrupt
    this.CCI06F = 0;                    // Printer 1 finished interrupt
    this.CCI07F = 0;                    // Printer 2 finished interrupt
    this.CCI08F = 0;                    // I/O unit 1 finished interrupt (RD in @14)
    this.CCI09F = 0;                    // I/O unit 2 finished interrupt (RD in @15)
    this.CCI10F = 0;                    // I/O unit 3 finished interrupt (RD in @16)
    this.CCI11F = 0;                    // I/O unit 4 finished interrupt (RD in @17)
    this.CCI12F = 0;                    // P2 busy interrupt
    this.CCI13F = 0;                    // Remote inquiry request interrupt
    this.CCI14F = 0;                    // Special interrupt #1 (not used)
    this.CCI15F = 0;                    // Disk file #1 read check finished
    this.CCI16F = 0;                    // Disk file #2 read check finished

    this.MCYF = 0;                      // Memory cycle FFs (one bit per M0..M7)
    this.PAXF = 0;                      // PA memory exchange select (M0..M7)
    this.PBXF = 0;                      // PB memory exchange select (M0..M7)
    this.I1XF = 0;                      // I/O unit 1 exchange select (M0..M7)
    this.I2XF = 0;                      // I/O unit 2 exchange select (M0..M7)
    this.I3XF = 0;                      // I/O unit 3 exchange select (M0..M7)
    this.I4XF = 0;                      // I/O unit 4 exchange select (M0..M7)

    this.AD1F = 0;                      // I/O unit 1 busy
    this.AD2F = 0;                      // I/O unit 2 busy
    this.AD3F = 0;                      // I/O unit 3 busy
    this.AD4F = 0;                      // I/O unit 4 busy

    this.LOFF = 0;                      // Load button pressed on console
    this.CTMF = 0;                      // Commence timing FF
    this.P2BF = 0;                      // Processor 2 busy FF
    this.HP2F = 1;                      // Halt processor 2 FF

    if (this.PA) {
        this.PA.clear();
    }
    if (this.PB) {
        this.PB.clear();
    }
    this.P1 = (this.PB1L ? this.PB : this.PA);
    this.P2 = (this.PB1L ? this.PA : this.PB);
    if (!this.P2) {
        this.P2BF = 1;                  // mark non-existent P2 as busy
    }
};

/**************************************/
B5500CentralControl.prototype.bit = function(word, bit) {
    /* Extracts and returns the specified bit from the word */
    var e = 47-bit;
    var p;

    if (e > 0) {
        p = B5500CentralControl.pow2[e];
        return ((word - word%p)/p) % 2;
    } else {
        return word % 2;
    }
};

/**************************************/
B5500CentralControl.prototype.bitSet = function(word, bit) {
    /* Sets the specified bit in word and returns the updated word */

    return this.fieldInsert(word, bit, 1, 1);
};

/**************************************/
B5500CentralControl.prototype.bitReset = function(word, bit) {
    /* Resets the specified bit in word and returns the updated word */

    return this.fieldInsert(word, bit, 1, 0);
};

/**************************************/
B5500CentralControl.prototype.fieldIsolate = function(word, start, width) {
    /* Extracts a bit field [start:width] from word and returns the field */
    var ue = 48-start;                  // upper power exponent
    var le = ue-width;                  // lower power exponent
    var p;

    if (le > 0) {
        p = B5500CentralControl.pow2[le];
        return ((word - word%p)/p) % B5500CentralControl.pow2[width];
    } else {
        return word % B5500CentralControl.pow2[width];
    }
};

/**************************************/
B5500CentralControl.prototype.fieldInsert = function(word, start, width, value) {
    /* Inserts a bit field into word.[start:width] and returns the updated word */
    var ue = 48-start;                  // upper power exponent
    var le = ue-width;                  // lower power exponent
    var bpower = 1;                     // bottom portion power of 2
    var bottom = 0;                     // unaffected bottom portion of word
    var top = 0;                        // unaffected top portion of word

    if (start > 0) {
        top = word - (word % B5500CentralControl.pow2[ue]);
    }
    if (le > 0) {
        bpower = B5500CentralControl.pow2[le];
        bottom = word % bpower;
    }
    return (value % B5500CentralControl.pow2[width])*bpower + top + bottom;
};

/**************************************/
B5500CentralControl.prototype.fetch = function(acc) {
    /* Called by requestor module passing accessor object "acc" to fetch a
    word from memory. */
    var addr = acc.addr;
    var modNr = addr >>> 12;
    var modAddr = addr & 0x0FFF;
    var modMask = 1 << modNr;

    this.MCYF |= modMask;               // !! need to figure out when to turn this off for display purposes
                                        //    (odd/even addresses? fetch vs. store? XOR the mask?)
    switch (acc.requestorID) {
    case "A":
        this.PAXF = modMask;
        break;
    case "B":
        this.PBXF = modMask;
        break;
    case "1":
        this.I1XF = modMask;
        break;
    case "2":
        this.I2XF = modMask;
        break;
    case "3":
        this.I3XF = modMask;
        break;
    case "4":
        this.I4XF = modMask;
        break;
    }

    // For now, we assume memory parity can never happen
    if (acc.MAIL || !this.MemMod[modNr]) {
        acc.MPED = 0;   // no memory parity error
        acc.MAED = 1;   // memory address error
        // no .word value is returned in this case
    } else {
        acc.MPED = 0;   // no parity error
        acc.MAED = 0;   // no address error
        acc.word = this.MemMod[modNr][modAddr];
    }
};

/**************************************/
B5500CentralControl.prototype.store = function(r, addr, word) {
    /* Called by requestor module passing accessor object "acc" to store a
    word into memory. */
    var addr = acc.addr;
    var modNr = addr >>> 12;
    var modAddr = addr & 0x0FFF;
    var modMask = 1 << modNr;

    this.MCYF |= modMask;               // !! need to figure out when to turn this off for display purposes
                                        //    (odd/even addresses? fetch vs. store? XOR the mask?)
    switch (acc.requestorID) {
    case "A":
        this.PAXF = modMask;
        break;
    case "B":
        this.PBXF = modMask;
        break;
    case "1":
        this.I1XF = modMask;
        break;
    case "2":
        this.I2XF = modMask;
        break;
    case "3":
        this.I3XF = modMask;
        break;
    case "4":
        this.I4XF = modMask;
        break;
    }

    // For now, we assume memory parity can never happen
    if (acc.MAIL || !this.MemMod[modNr]) {
        acc.MPED = 0;   // no memory parity error
        acc.MAED = 1;   // memory address error
        // no word is stored in this case
    } else {
        acc.MPED = 0;   // no parity error
        acc.MAED = 0;   // no address error
        this.MemMod[modNr][modAddr] = acc.word;
    }
};

/**************************************/
B5500CentralControl.prototype.signalInterrupt = function() {
    /* Called by all modules to signal that an interrupt has occurred and
    to invoke the interrupt prioritization mechanism. This will result in
    an updated vector address in the IAR. Can also be called to reprioritize
    any remaining interrupts after an interrupt is handled. If no interrupt
    condition exists, this.IAR is set to zero. */
    var p1 = this.P1;
    var p2 = this.P2;

    this.IAR = p1.I & 0x01      ? 0x30  // @60: P1 memory parity error
             : p1.I & 0x02      ? 0x31  // @61: P1 invalid address error
             : this.CCI03F      ? 0x12  // @22: Time interval
             : this.CCI04F      ? 0x13  // @23: I/O busy
             : this.CCI05F      ? 0x14  // @24: Keyboard request
             : this.CCI08F      ? 0x17  // @27: I/O 1 finished
             : this.CCI09F      ? 0x18  // @30: I/O 2 finished
             : this.CCI10F      ? 0x19  // @31: I/O 3 finished
             : this.CCI11F      ? 0x1A  // @32: I/O 4 finished
             : this.CCI06F      ? 0x15  // @25: Printer 1 finished
             : this.CCI07F      ? 0x16  // @26: Printer 2 finished
             : this.CCI12F      ? 0x1B  // @33: P2 busy
             : this.CCI13F      ? 0x1C  // @34: Inquiry request
             : this.CCI14F      ? 0x1D  // @35: Special interrupt 1
             : this.CCI15F      ? 0x1E  // @36: Disk file 1 read check finished
             : this.CCI16F      ? 0x1F  // @37: Disk file 2 read check finished
             : p1.I & 0x04      ? 0x32  // @62: P1 stack overflow
             : p1.I & 0xF0      ? (p1.I >>> 4) + 0x30   // @64-75: P1 syllable-dependent
             : p2.I & 0x01      ? 0x20  // @40: P2 memory parity error
             : p2.I & 0x02      ? 0x21  // @41: P2 invalid address error
             : p2.I & 0x04      ? 0x22  // @42: P2 stack overflow
             : p2.I & 0xF0      ? (p2.I >>> 4) + 0x20   // @44-55: P2 syllable-dependent
             : 0;                       // no interrupt set
};

/**************************************/
B5500CentralControl.prototype.clearInterrupt = function() {
    /* Resets an interrupt based on the current setting of this.IAR, then
    reprioritizes any remaining interrupts, leaving the new vector address
    in this.IAR. */
    var p1 = this.P1;
    var p2 = this.P2;

    switch (this.IAR) {
    case 0x12:                          // @22: Time interval
        this.CCI03F = 0;
        break;
    case 0x13:                          // @23: I/O busy
        this.CCI04F = 0;
        break;
    case 0x14:                          // @24: Keyboard request
        this.CCI05F = 0;
        break;
    case 0x15:                          // @25: Printer 1 finished
        this.CCI06F = 0;
        break;
    case 0x16:                          // @26: Printer 2 finished
        this.CCI07F = 0;
        break;
    case 0x17:                          // @27: I/O 1 finished
        this.CCI08F = 0;
        break;
    case 0x18:                          // @30: I/O 2 finished
        this.CCI09F = 0;
        break;
    case 0x19:                          // @31: I/O 3 finished
        this.CCI10F = 0;
        break;
    case 0x1A:                          // @32: I/O 4 finished
        this.CCI11F = 0;
        break;
    case 0x1B:                          // @33: P2 busy
        this.CCI12F = 0;
        break;
    case 0x1C:                          // @34: Inquiry request
        this.CCI13F = 0;
        break;
    case 0x1D:                          // @35: Special interrupt 1
        this.CCI14F = 0;
        break;
    case 0x1E:                          // @36: Disk file 1 read check finished
        this.CCI15F = 0;
        break;
    case 0x1F:                          // @37: Disk file 2 read check finished
        this.CCI16F = 0;
        break;

    case 0x20:                          // @40: P2 memory parity error
        p2.I &= 0xFE;
        break;
    case 0x21:                          // @41: P2 invalid address error
        p2.I &= 0xFD;
        break;
    case 0x22:                          // @42: P2 stack overflow
        p2.I &= 0xFB;
        break;
    case 0x24:                          // @44-55: P2 syllable-dependent
    case 0x25:
    case 0x26:
    case 0x27:
    case 0x28:
    case 0x29:
    case 0x2A:
    case 0x2B:
    case 0x2C:
    case 0x2D:
        p2.I &= 0x0F;
        break;

    case 0x30:                          // @60: P1 memory parity error
        p1.I &= 0xFE;
        break;
    case 0x31:                          // @61: P1 invalid address error
        p1.I &= 0xFD;
        break;
    case 0x32:                          // @62: P1 stack overflow
        p1.I &= 0x0B;
        break;
    case 0x34:                          // @64-75: P1 syllable-dependent
    case 0x35:
    case 0x36:
    case 0x37:
    case 0x38:
    case 0x39:
    case 0x3A:
    case 0x3B:
    case 0x3C:
    case 0x3D:
        p1.I &= 0x0F;
        break;

    default:                            // no interrupt vector was set
        break;
    }
    this.signalInterrupt();
};

/**************************************/
B5500CentralControl.prototype.tock = function tock() {
    /* Handles the 1/60th second real-time clock tick */
    var interval;                       // milliseconds to next tick
    var that = tock.that;               // capture the current closure context
    var thisTime = new Date().getTime();

    if (that.TM < 63) {
        that.TM++;
    } else {
        that.TM = 0;
        that.CCI03F = 1;                // set timer interrupt
        // inhibit for now // that.signalInterrupt();
    }
    interval = (that.nextTimeStamp += B5500CentralControl.rtcTick) - thisTime;
    that.timer = setTimeout(function() {that.tock()}, (interval < 0 ? 1 : interval));
};

/**************************************/
B5500CentralControl.prototype.initiateP2 = function() {
    /* Called by P1 to initiate P2. Assumes that an INCW has been stored at
    memory location @10. If P2 is busy or not present, sets the P2 busy
    interrupt. Otherwise, loads the INCW into P2's A register and initiates
    the processor. */
    var p2 = this.P2;

    if (!this.P2 || this.P2BF) {
        this.CCI12F = 1;                // set P2 busy interrupt
        this.signalInterrupt();
    } else {
        p2.M = 8;                       // Now have P2 pick up the INCW
        p2.access(0x04);                // A = [M]
        p2.AROF = 1;
        p2.T = 0x849;                   // inject 4111=IP1 into P2's T register
        p2.TROF = 1;
        p2.NCSF = 0;                    // make sure P2 is in control state
        this.P2BF = 1;
        this.HP2F = 0;

        // Now start scheduling P2 on the Javascript thread
        p2.procTime = new Date().getTime()*1000;
        p2.scheduler = setTimeout(p2.schedule, 0);
    }
};

/**************************************/
B5500CentralControl.prototype.initiateIO = function() {
    /* Selects an I/O unit and initiates an I/O */

    if (this.IO1) {
        this.AD1F = 1;
        this.IO1.initiate();
    } else if (this.IO2) {
        this.AD2F = 1;
        this.IO2.initiate();
    } else if (this.IO3) {
        this.AD3F = 1;
        this.IO3.initiate();
    } else if (this.IO4) {
        this.AD4F = 1;
        this.IO4.initiate();
    } else {
        this.CCI04F = 1;                // set I/O busy interrupt
        this.signalInterrupt();
    }
};

/**************************************/
B5500CentralControl.prototype.halt = function() {
    /* Halts the processors. Any in-process I/Os are allowed to complete */

    if (this.PA && this.PA.busy) {
        this.PA.busy = 0;
        this.PA.cycleLimit = 0;
        if (this.PA.scheduler) {
            clearTimeout(this.PA.scheduler);
            this.PA.scheduler = null;
        }
    }

    if (this.PB && this.PB.busy) {
        this.PB.busy = 0;
        this.PB.cycleLimit = 0;
        if (this.PB.scheduler) {
            clearTimeout(this.PB.scheduler);
            this.PB.scheduler = null;
        }
    }

    if (this.loadTimer) {
        clearTimeout(this.loadTimer);
        this.loadTimer = null;
    }
};

/**************************************/
B5500CentralControl.prototype.load = function() {
    /* Initiates a Load operation to start the system */

    if ((this.PA && this.PA.busy) || (this.PB && this.PB.busy)) {
        this.clear();
        if (this.P1) {
            this.LOFF = 1;
            if (this.IO1) {             // !! not sure about I/O selection here
                this.IO1.initiateLoad(this.cardLoadSelect);
                this.loadComplete();
            }
        }
    }
};

/**************************************/
B5500CentralControl.prototype.loadComplete = function loadComplete() {
    /* Monitors an initial load I/O operation for complete status.
    When complete, initiates P1 */
    var that = loadComplete.that;       // capture the current closure context

    if (!that.CCI08F) {
        that.loadTimer = setTimeout(that.loadComplete, 100);
    } else {
        that.loadTimer = null
        that.LOFF = 0;
        that.P1.C = 0x10;               // execute from address @20
        that.P1.access(0x30);           // P = [C]
        that.P1.T = that.fieldIsolate(that.P, 0, 12);
        that.P1.TROF = 1;
        that.P1.L = 1;                  // advance L to the next syllable

        // Now start scheduling P1 on the Javascript thread
        that.P1.procTime = new Date().getTime()*1000;
        that.P1.scheduler = setTimeout(that.P1.schedule, 0);
    }
};

/**************************************/
B5500CentralControl.prototype.configureSystem = function() {
    /* Establishes the hardware module configuration from the
    B5500SystemConfiguration module */
    var cfg = B5500SystemConfiguration;
    var x;

    // !! inhibit for now // this.DD = new B5500DistributionAndDisplay();

    if (cfg.PA) {this.PA = new B5500Processor("A")};
    if (cfg.PB) {this.PB = new B5500Processor("B")};

    this.PB1L = (cfg.PB1L ? 1 : 0);

    /*** enable once I/O exists ***
    if (cfg.IO1) {this.IO1 = new B5500IOUnit("1")};
    if (cfg.IO2) {this.IO2 = new B5500IOUnit("2")};
    if (cfg.IO3) {this.IO3 = new B5500IOUnit("3")};
    if (cfg.IO4) {this.IO4 = new B5500IOUnit("4")};
    ***/

    for (x=0; x<8; x++) {
        if (cfg.MemMod[x]) {
            this.AddressSpace[x] = new ArrayBuffer(32768);  // 4K B5500 words @ 8 bytes each
            this.MemMod[x] = new Float64Array(this.AddressSpace[x]);
        }
    }

    // Peripheral unit configuration should take place here once we have it.
};

/**************************************/
B5500CentralControl.prototype.powerOn = function() {
    /* Powers up the system and establishes the hardware module configuration.
    Redundant power-ons are ignored. */

    if (!this.poweredUp) {
        this.configureSystem();
        this.poweredUp = 1;
    }
};

/**************************************/
B5500CentralControl.prototype.powerOff = function() {
    /* Powers down the system and deallocates the hardware modules.
    Redundant power-offs are ignored. */
    var x;

    if (this.poweredUp) {
        this.halt();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        // Deallocate the system modules
        this.P1 = this.P2 = null;
        this.PA = null;
        this.PB = null;
        this.IO1 = null;
        this.IO2 = null;
        this.IO3 = null;
        this.IO4 = null;
        for (x=0; x<8; x++) {
            this.MemMod[x] = null;
            this.AddressSpace[x] = null;
        }

        this.poweredUp = 0;
    }
};
