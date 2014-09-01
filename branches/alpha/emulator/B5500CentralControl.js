/***********************************************************************
* retro-b5500/emulator B5500CentralControl.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License,
*       see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Emulator Central Control module.
************************************************************************
* 2012-06-03  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500CentralControl(global) {
    /* Constructor for the Central Control module object */

    this.mnemonic = "CC";               // Unit mnemonic
    this.global = global;               // Javascript global object (e.g., "window" for browsers)
    this.sysConfig = null;              // System configuration object

    /* Global system modules */
    this.DD = null;                     // Distribution & Display unit
    this.PA = null;                     // Processor A (PA)
    this.PB = null;                     // Processor B (PB)
    this.IO1 = null;                    // I/O unit 1
    this.IO2 = null;                    // I/O unit 2
    this.IO3 = null;                    // I/O unit 3
    this.IO4 = null;                    // I/O unit 4

    this.P1 = null;                     // Reference for Processor 1 (control) [PA or PB]
    this.P2 = null;                     // Reference for Processor 2 (slave)   [PA or PB]

    this.addressSpace = [               // Array of memory module address spaces (8 x 32KB each)
        null, null, null, null, null, null, null, null];
    this.memMod = [                     // Array of memory module words as Float64s (8 x 4KW each)
        null, null, null, null, null, null, null, null];
    this.unit = [                       // Array of peripheral units, indexed by ready-mask bit number
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null];

    // Instance variables and flags
    this.poweredUp = 0;                 // System power indicator

    this.unitStatusMask = 0;            // Peripheral unit ready-status bitmask [must not be in clear()]

    this.PB1L = 0;                      // 0=> PA is P1, 1=> PB is P1
    this.inhCCI03F = 0;                 // 0=> allow timer interrupts; 1=> inhibit 'em
    this.cardLoadSelect = 0;            // 0=> load from disk/drum; 1=> load from cards

    this.nextTimeStamp = 0;             // Next actual Date.getTime() for timer tick
    this.timer = 0;                     // RTC setCallback id.

    this.clear();                       // Create and initialize the Central Control state
}

/**************************************/

/* Global constants */
B5500CentralControl.version = "0.21a6";

B5500CentralControl.memReadCycles = 2;          // assume 2 탎 memory read cycle time (the other option was 3 탎)
B5500CentralControl.memWriteCycles = 4;         // assume 4 탎 memory write cycle time (the other option was 6 탎)
B5500CentralControl.rtcTick = 1000/60;          // Real-time clock period, milliseconds

B5500CentralControl.pow2 = [ // powers of 2 from 0 to 52
                     0x1,              0x2,              0x4,              0x8,
                    0x10,             0x20,             0x40,             0x80,
                   0x100,            0x200,            0x400,            0x800,
                  0x1000,           0x2000,           0x4000,           0x8000,
                 0x10000,          0x20000,          0x40000,          0x80000,
                0x100000,         0x200000,         0x400000,         0x800000,
               0x1000000,        0x2000000,        0x4000000,        0x8000000,
              0x10000000,       0x20000000,       0x40000000,       0x80000000,
             0x100000000,      0x200000000,      0x400000000,      0x800000000,
            0x1000000000,     0x2000000000,     0x4000000000,     0x8000000000,
           0x10000000000,    0x20000000000,    0x40000000000,    0x80000000000,
          0x100000000000,   0x200000000000,   0x400000000000,   0x800000000000,
         0x1000000000000,  0x2000000000000,  0x4000000000000,  0x8000000000000,
        0x10000000000000];

B5500CentralControl.mask2 = [ // (2**n)-1 For n From 0 to 52
                     0x0,              0x1,              0x3,              0x7,
                    0x0F,             0x1F,             0x3F,             0x7F,
                   0x0FF,            0x1FF,            0x3FF,            0x7FF,
                  0x0FFF,           0x1FFF,           0x3FFF,           0x7FFF,
                 0x0FFFF,          0x1FFFF,          0x3FFFF,          0x7FFFF,
                0x0FFFFF,         0x1FFFFF,         0x3FFFFF,         0x7FFFFF,
               0x0FFFFFF,        0x1FFFFFF,        0x3FFFFFF,        0x7FFFFFF,
              0x0FFFFFFF,       0x1FFFFFFF,       0x3FFFFFFF,       0x7FFFFFFF,
             0x0FFFFFFFF,      0x1FFFFFFFF,      0x3FFFFFFFF,      0x7FFFFFFFF,
            0x0FFFFFFFFF,     0x1FFFFFFFFF,     0x3FFFFFFFFF,     0x7FFFFFFFFF,
           0x0FFFFFFFFFF,    0x1FFFFFFFFFF,    0x3FFFFFFFFFF,    0x7FFFFFFFFFF,
          0x0FFFFFFFFFFF,   0x1FFFFFFFFFFF,   0x3FFFFFFFFFFF  , 0x7FFFFFFFFFFF,
         0x0FFFFFFFFFFFF,  0x1FFFFFFFFFFFF,  0x3FFFFFFFFFFFF,  0x7FFFFFFFFFFFF,
        0x0FFFFFFFFFFFFF] ;

// The following two-dimensional array translates unit designates to a unique 1-relative
// peripheral unit index. This index is the same as the unit's ready-status bit number,
// which is why they are in the range 17..47. The [0] dimension determines the index
// when writing; the [1] dimension determines the index when reading. This approach
// is necessary since some unit designates map to two different devices depending
// on the read bit in IOD.[24:1], e.g. designate 14=CPA/CRA (status bits 23/24).

B5500CentralControl.unitIndex = [
     // 0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
    [null,  47,null,  46,  31,  45,  29,  44,  30,  43,  25,  42,  28,  41,null,  40,
       17,  39,  21,  38,  18,  37,  27,  36,null,  35,  26,  34,null,  33,  22,  32],
    [null,  47,null,  46,  31,  45,  29,  44,  30,  43,  24,  42,  28,  41,  23,  40,
       17,  39,  20,  38,  19,  37,null,  36,null,  35,null,  34,null,  33,  22,  32]];

// The following object maps the unit mnemonics from this.sysConfig.units
// to the attributes needed to configure the CC unit[] array.

B5500CentralControl.unitSpecs = {
    DCA: {unitIndex: 17, designate: 16, unitClass: "B5500DatacomUnit"},
    PPB: {unitIndex: 18, designate: 20, unitClass: null},
    PRB: {unitIndex: 19, designate: 20, unitClass: null},
    PRA: {unitIndex: 20, designate: 18, unitClass: null},
    PPA: {unitIndex: 21, designate: 18, unitClass: null},
    SPO: {unitIndex: 22, designate: 30, unitClass: "B5500SPOUnit"},
    CRB: {unitIndex: 23, designate: 14, unitClass: "B5500CardReader"},
    CRA: {unitIndex: 24, designate: 10, unitClass: "B5500CardReader"},
    CPA: {unitIndex: 25, designate: 10, unitClass: "B5500CardPunch"},
    LPB: {unitIndex: 26, designate: 26, unitClass: "B5500DummyPrinter"},
    LPA: {unitIndex: 27, designate: 22, unitClass: "B5500DummyPrinter"},
    DKB: {unitIndex: 28, designate: 12, unitClass: "B5500DiskUnit"},
    DKA: {unitIndex: 29, designate:  6, unitClass: "B5500DiskUnit"},
    DRB: {unitIndex: 30, designate:  8, unitClass: null},
    DRA: {unitIndex: 31, designate:  4, unitClass: null},
    MTT: {unitIndex: 32, designate: 31, unitClass: "B5500MagTapeDrive"},
    MTS: {unitIndex: 33, designate: 29, unitClass: "B5500MagTapeDrive"},
    MTR: {unitIndex: 34, designate: 27, unitClass: "B5500MagTapeDrive"},
    MTP: {unitIndex: 35, designate: 25, unitClass: "B5500MagTapeDrive"},
    MTN: {unitIndex: 36, designate: 23, unitClass: "B5500MagTapeDrive"},
    MTM: {unitIndex: 37, designate: 21, unitClass: "B5500MagTapeDrive"},
    MTL: {unitIndex: 38, designate: 19, unitClass: "B5500MagTapeDrive"},
    MTK: {unitIndex: 39, designate: 17, unitClass: "B5500MagTapeDrive"},
    MTJ: {unitIndex: 40, designate: 15, unitClass: "B5500MagTapeDrive"},
    MTH: {unitIndex: 41, designate: 13, unitClass: "B5500MagTapeDrive"},
    MTF: {unitIndex: 42, designate: 11, unitClass: "B5500MagTapeDrive"},
    MTE: {unitIndex: 43, designate:  9, unitClass: "B5500MagTapeDrive"},
    MTD: {unitIndex: 44, designate:  7, unitClass: "B5500MagTapeDrive"},
    MTC: {unitIndex: 45, designate:  5, unitClass: "B5500MagTapeDrive"},
    MTB: {unitIndex: 46, designate:  3, unitClass: "B5500MagTapeDrive"},
    MTA: {unitIndex: 47, designate:  1, unitClass: "B5500MagTapeDrive"}};


/**************************************/
B5500CentralControl.bindMethod = function bindMethod(context, f) {
    /* Returns a new function that binds the function "f" to the object "context".
    Note that this is a static constructor property function, NOT an instance
    method of the CC object */

    return function bindMethodAnon() {f.apply(context, arguments)};
};

/**************************************/
B5500CentralControl.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the system and starts the
    real-time clock */

    if (this.timer) {
        clearCallback(this.timer);
        this.timer = 0;
    }

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
    this.HP2F = 0;                      // Halt processor 2 FF

    this.ccLatch = 0x20;                // I/O Unit busy & P2 latched status (reset by console UI)
    this.interruptMask = 0;             // Interrupt status mask
    this.interruptLatch = 0;            // Interrupt latched status (reset by console UI)
    this.iouMask = 0;                   // I/O Unit busy status mask
    this.unitBusyLatch = 0;             // Peripheral unit latched status (reset by console UI)
    this.unitBusyMask = 0;              // Peripheral unit busy-status bitmask

    this.P1 = (this.PB1L ? this.PB : this.PA);
    this.P2 = (this.PB1L ? this.PA : this.PB);
    if (!this.P2) {
        this.P2BF = 1;                  // mark non-existent P2 as busy
        this.ccLatch |= 0x10;
    }
    if (this.PA) {
        this.PA.clear();
    }
    if (this.PB) {
        this.PB.clear();
    }
};

/**************************************/
B5500CentralControl.prototype.bitTest = function bitTest(word, bit) {
    /* Extracts and returns the specified bit from the word */
    var e = 47-bit;                     // word lower power exponent
    var p;                              // bottom portion of word power of 2

    if (e > 0) {
        return ((word - word % (p = B5500CentralControl.pow2[e]))/p) % 2;
    } else {
        return word % 2;
    }
};

/**************************************/
B5500CentralControl.prototype.bitSet = function bitSet(word, bit) {
    /* Sets the specified bit in word and returns the updated word */
    var ue = 48-bit;                    // word upper power exponent
    var le = ue-1;                      // word lower power exponent
    var bpower = 1;                     // bottom portion of word power of 2
    var bottom =                        // unaffected bottom portion of word
        (le == 0 ? 0 : (word % (bpower = B5500CentralControl.pow2[le])));
    var top =                           // unaffected top portion of word
        (bit == 0 ? 0 : (word - (word % B5500CentralControl.pow2[ue])));

    return bpower + top + bottom;
};

/**************************************/
B5500CentralControl.prototype.bitReset = function bitReset(word, bit) {
    /* Resets the specified bit in word and returns the updated word */
    var ue = 48-bit;                    // word upper power exponent
    var le = ue-1;                      // word lower power exponent
    var bottom =                        // unaffected bottom portion of word
        (le == 0 ? 0 : (word % B5500CentralControl.pow2[le]));
    var top =                           // unaffected top portion of word
        (bit == 0 ? 0 : (word - (word % B5500CentralControl.pow2[ue])));

    return top + bottom;
};

/**************************************/
B5500CentralControl.prototype.fieldIsolate = function fieldIsolate(word, start, width) {
    /* Extracts a bit field [start:width] from word and returns the field */
    var le = 48-start-width;            // lower power exponent
    var p;                              // bottom portion of word power of 2

    return (le == 0 ? word :
                      (word - word % (p = B5500CentralControl.pow2[le]))/p
            ) % B5500CentralControl.pow2[width];
};

/**************************************/
B5500CentralControl.prototype.fieldInsert = function fieldInsert(word, start, width, value) {
    /* Inserts a bit field from the low-order bits of value ([48-width:width])
    into word.[start:width] and returns the updated word */
    var ue = 48-start;                  // word upper power exponent
    var le = ue-width;                  // word lower power exponent
    var bpower = 1;                     // bottom portion of word power of 2
    var bottom =                        // unaffected bottom portion of word
        (le == 0 ? 0 : (word % (bpower = B5500CentralControl.pow2[le])));
    var top =                           // unaffected top portion of word
        (ue == 0 ? 0 : (word - (word % B5500CentralControl.pow2[ue])));

    return (value % B5500CentralControl.pow2[width])*bpower + top + bottom;
};

/**************************************/
B5500CentralControl.prototype.fieldTransfer = function fieldTransfer(word, wstart, width, value, vstart) {
    /* Inserts a bit field from value.[vstart:width] into word.[wstart:width] and
    returns the updated word */
    var ue = 48-wstart;                 // word upper power exponent
    var le = ue-width;                  // word lower power exponent
    var ve = 48-vstart-width;           // value lower power exponent
    var vpower;                         // bottom port of value power of 2
    var bpower = 1;                     // bottom portion of word power of 2
    var bottom =                        // unaffected bottom portion of word
        (le == 0 ? 0 : (word % (bpower = B5500CentralControl.pow2[le])));
    var top =                           // unaffected top portion of word
        (ue == 0 ? 0 : (word - (word % B5500CentralControl.pow2[ue])));

    return ((ve == 0 ? value :
                       (value - value % (vpower = B5500CentralControl.pow2[ve]))/vpower
                ) % B5500CentralControl.pow2[width]
            )*bpower + top + bottom;
};

/**************************************/
B5500CentralControl.prototype.fetch = function fetch(acc) {
    /* Called by a requestor module passing accessor object "acc" to fetch a
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
    if (acc.MAIL || !this.memMod[modNr]) {
        acc.MPED = 0;   // no memory parity error
        acc.MAED = 1;   // memory address error
        // no .word value is returned in this case
    } else {
        acc.MPED = 0;   // no parity error
        acc.MAED = 0;   // no address error
        acc.word = this.memMod[modNr][modAddr];
    }
};

/**************************************/
B5500CentralControl.prototype.store = function store(acc) {
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
    if (acc.MAIL || !this.memMod[modNr]) {
        acc.MPED = 0;   // no memory parity error
        acc.MAED = 1;   // memory address error
        // no word is stored in this case
    } else {
        acc.MPED = 0;   // no parity error
        acc.MAED = 0;   // no address error
        this.memMod[modNr][modAddr] = acc.word;
    }
};

/**************************************/
B5500CentralControl.prototype.signalInterrupt = function signalInterrupt() {
    /* Called by all modules to signal that an interrupt has occurred and
    to invoke the interrupt prioritization mechanism. This will result in
    an updated vector address in the IAR. Can also be called to reprioritize
    any remaining interrupts after an interrupt is handled. If no interrupt
    condition exists, this.IAR is set to zero. */
    var p1 = this.P1;
    var p2;

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
             : (p2 = this.P2) ?         // Yes, Virginia, this should actually be an assignment...
                  ( p2.I & 0x01 ? 0x20  // @40: P2 memory parity error
                  : p2.I & 0x02 ? 0x21  // @41: P2 invalid address error
                  : p2.I & 0x04 ? 0x22  // @42: P2 stack overflow
                  : p2.I & 0xF0 ? (p2.I >>> 4) + 0x20   // @44-55: P2 syllable-dependent
                  : 0
                  )
             : 0;                       // no interrupt set

     if (this.IAR) {
         this.interruptMask = this.bitSet(this.interruptMask, 65-this.IAR);
         this.interruptLatch = this.bitSet(this.interruptLatch, 65-this.IAR);
     }
};

/**************************************/
B5500CentralControl.prototype.clearInterrupt = function clearInterrupt() {
    /* Resets an interrupt based on the current setting of this.IAR, then
    reprioritizes any remaining interrupts, leaving the new vector address
    in this.IAR. */
    var p1 = this.P1;
    var p2 = this.P2;

    if (this.IAR) {
        this.interruptMask = this.bitReset(this.interruptMask, 65-this.IAR)
        switch (this.IAR) {
        case 0x12:                      // @22: Time interval
            this.CCI03F = 0;
            break;
        case 0x17:                      // @27: I/O 1 finished
            this.CCI08F = 0;
            this.AD1F = 0;                      // make unit non-busy
            this.iouMask &= 0xE;
            break;
        case 0x18:                      // @30: I/O 2 finished
            this.CCI09F = 0;
            this.AD2F = 0;                      // make unit non-busy
            this.iouMask &= 0xD;
            break;
        case 0x19:                      // @31: I/O 3 finished
            this.CCI10F = 0;
            this.AD3F = 0;                      // make unit non-busy
            this.iouMask &= 0xB;
            break;
        case 0x1A:                      // @32: I/O 4 finished
            this.CCI11F = 0;
            this.AD4F = 0;                      // make unit non-busy
            this.iouMask &= 0x7;
            break;
        case 0x15:                      // @25: Printer 1 finished
            this.CCI06F = 0;
            break;
        case 0x16:                      // @26: Printer 2 finished
            this.CCI07F = 0;
            break;

        case 0x34:                      // @64-75: P1 syllable-dependent
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

        case 0x1C:                      // @34: Inquiry request
            this.CCI13F = 0;
            break;
        case 0x14:                      // @24: Keyboard request
            this.CCI05F = 0;
            break;

        case 0x24:                      // @44-55: P2 syllable-dependent
        case 0x25:
        case 0x26:
        case 0x27:
        case 0x28:
        case 0x29:
        case 0x2A:
        case 0x2B:
        case 0x2C:
        case 0x2D:
            if (p2) {p2.I &= 0x0F}
            break;

        case 0x30:                      // @60: P1 memory parity error
            p1.I &= 0xFE;
            break;
        case 0x31:                      // @61: P1 invalid address error
            p1.I &= 0xFD;
            break;
        case 0x32:                      // @62: P1 stack overflow
            p1.I &= 0xFB;
            break;

        case 0x20:                      // @40: P2 memory parity error
            if (p2) {p2.I &= 0xFE}
            break;
        case 0x21:                      // @41: P2 invalid address error
            if (p2) {p2.I &= 0xFD}
            break;
        case 0x22:                      // @42: P2 stack overflow
            if (p2) {p2.I &= 0xFB}
            break;

        case 0x1E:                      // @36: Disk file 1 read check finished
            this.CCI15F = 0;
            break;
        case 0x1F:                      // @37: Disk file 2 read check finished
            this.CCI16F = 0;
            break;
        case 0x13:                      // @23: I/O busy
            this.CCI04F = 0;
            break;
        case 0x1B:                      // @33: P2 busy
            this.CCI12F = 0;
            break;
        case 0x1D:                      // @35: Special interrupt 1
            this.CCI14F = 0;
            break;
        default:                        // no interrupt vector was set
            break;
        }
    }
    this.signalInterrupt();
};

/**************************************/
B5500CentralControl.prototype.tock = function tock() {
    /* Handles the 1/60th second real-time clock tick */

    if (this.TM < 63) {
        ++this.TM;
    } else {
        this.TM = 0;
        if (!this.inhCCI03F) {
            this.CCI03F = 1;            // set timer interrupt
            this.signalInterrupt();
        }
    }
    this.nextTimeStamp += B5500CentralControl.rtcTick;
    this.timer = setCallback(this.mnemonic, this, this.nextTimeStamp - performance.now(), this.tock);
};

/**************************************/
B5500CentralControl.prototype.readTimer = function readTimer() {
    /* Returns the value of the 1/60th second timer */

    return this.CCI03F*64 + this.TM;
};

/**************************************/
B5500CentralControl.prototype.haltP2 = function haltP2() {
    /* Called by P1 to halt P2. We know that P2 is not currently running on this
    thread, so check to see if it's running at all and has a callback scheduled.
    If so, cancel the existing callback and schedule a new one for immediate
    execution. With HP2F set, P2 will store its registers and stop at next SECL */

    this.HP2F = 1;
    this.ccLatch |= 0x20;
    if (this.P2 && this.P2BF) {
        if (this.P2.scheduler) {
            clearCallback(this.P2.scheduler);
        }
        this.P2.scheduler = setCallback(this.P2.mnemonic, this.P2, 0, this.P2.schedule);
    }
};

/**************************************/
B5500CentralControl.prototype.initiateP2 = function initiateP2() {
    /* Called by P1 to initiate P2. Assumes that an INCW has been stored at
    memory location @10. If P2 is busy or not present, sets the P2 busy
    interrupt. Otherwise, loads the INCW into P2's A register and initiates
    the processor. */

    if (this.P2BF || !this.P2) {
        this.CCI12F = 1;                // set P2 busy interrupt
        this.signalInterrupt();
    } else {
        this.P2BF = 1;
        this.ccLatch |= 0x10;
        this.HP2F = 0;
        this.P2.initiateAsP2();
    }
};

/**************************************/
B5500CentralControl.prototype.initiateIO = function initiateIO() {
    /* Selects an I/O unit and initiates an I/O */

    if (this.IO1 && this.IO1.REMF && !this.AD1F) {
        this.AD1F = 1;
        this.iouMask |= 0x1;
        this.ccLatch |= 0x1;
        this.IO1.initiate();
    } else if (this.IO2 && this.IO2.REMF && !this.AD2F) {
        this.AD2F = 1;
        this.iouMask |= 0x2;
        this.ccLatch |= 0x2;
        this.IO2.initiate();
    } else if (this.IO3 && this.IO3.REMF && !this.AD3F) {
        this.AD3F = 1;
        this.iouMask |= 0x4;
        this.ccLatch |= 0x4;
        this.IO3.initiate();
    } else if (this.IO4 && this.IO4.REMF && !this.AD4F) {
        this.AD4F = 1;
        this.iouMask |= 0x8;
        this.ccLatch |= 0x8;
        this.IO4.initiate();
    } else {
        this.CCI04F = 1;                // set I/O busy interrupt
        this.signalInterrupt();
    }
};

/**************************************/
B5500CentralControl.prototype.interrogateIOChannel = function interrogateIOChannel() {
    /* Returns a value as for the processor TIO syllable indicating the first
    available and non-busy I/O Unit */

    if (this.IO1 && this.IO1.REMF && !this.AD1F) {
        return 1;
    } else if (this.IO2 && this.IO2.REMF && !this.AD2F) {
        return 2;
    } else if (this.IO3 && this.IO3.REMF && !this.AD3F) {
        return 3;
    } else if (this.IO4 && this.IO4.REMF && !this.AD4F) {
        return 4;
    } else {
        return 0;                       // All I/O Units busy
    }
};

/**************************************/
B5500CentralControl.prototype.interrogateUnitStatus = function interrogateUnitStatus() {
    /* Returns a bitmask as for the processor TUS syllable indicating the
    ready status of all peripheral units */

    return this.unitStatusMask;
};

/**************************************/
B5500CentralControl.prototype.testUnitReady = function testUnitReady(index) {
    /* Determines whether the unit index "index" is currently in ready status.
    Returns 1 if ready, 0 if not ready */

    return (index ? this.bitTest(this.unitStatusMask, index) : 0);
};

/**************************************/
B5500CentralControl.prototype.testUnitBusy = function testUnitBusy(index) {
    /* Determines whether the unit index "index" is currently in use by any other
    I/O Unit. Returns 1 if busy, 0 if not busy */

    return (index ? this.bitTest(this.unitBusyMask, index) : 0);
};

/**************************************/
B5500CentralControl.prototype.setUnitBusy = function setUnitBusy(index, busy) {
    /* Sets or resets the unit-busy mask bit for unit index "index" */

    if (index) {
        if (busy) {
            this.unitBusyMask = this.bitSet(this.unitBusyMask, index);
            this.unitBusyLatch = this.bitSet(this.unitBusyLatch, index);
        } else {
            this.unitBusyMask = this.bitReset(this.unitBusyMask, index);
        }
    }
};

/**************************************/
B5500CentralControl.prototype.fetchCCLatches = function fetchCCLatches(latches) {
    /* Returns the current latches in the "latches" array and and resets them.
    Used by the Console UI */

    latches[0] = this.ccLatch;
    this.ccLatch = this.iouMask | (this.P2BF << 4) | (this.HP2F << 5);
    latches[1] = this.interruptLatch;
    this.interruptLatch = this.interruptMask;
    latches[2] = this.unitBusyLatch;
    this.unitBusyLatch = this.unitBusyMask;
};

/**************************************/
B5500CentralControl.prototype.halt = function halt() {
    /* Halts the processors. Any in-process I/Os are allowed to complete */

    if (this.timer) {
        clearCallback(this.timer);
        this.timer = 0;
    }

    if (this.PA && this.PA.busy) {
        this.PA.stop();
    }

    if (this.PB && this.PB.busy) {
        this.PB.stop();
    }
};

/**************************************/
B5500CentralControl.prototype.loadComplete = function loadComplete(dontStart) {
    /* Monitors an initial load I/O operation for complete status.
    When complete, initiates P1 */
    var completed = false;              // true if some I/O Unit finished

    if (this.CCI08F) {                  // I/O Unit 1 finished
        completed = true;
        this.CCI08F = 0;
        this.AD1F = 0;
        this.iouMask &= 0xE;
    } else if (this.CCI09F) {           // I/O Unit 2 finished
        completed = true;
        this.CCI09F = 0;
        this.AD2F = 0;
        this.iouMask &= 0xD;
    } else if (this.CCI10F) {           // I/O Unit 3 finished
        completed = true;
        this.CCI10F = 0;
        this.AD3F = 0;
        this.iouMask &= 0xB;
    } else if (this.CCI11F) {           // I/O Unit 4 finished
        completed = true;
        this.CCI11F = 0;
        this.AD4F = 0;
        this.iouMask &= 0x7;
    }

    if (completed) {
        this.signalInterrupt();         // reset the pending I/O complete interrupt
        this.LOFF = 0;
        this.P1.preset(0x10);           // start execution at C=@20
        if (!dontStart) {
            this.P1.start();            // let'er rip
        }
    }
};

/**************************************/
B5500CentralControl.prototype.load = function load(dontStart) {
    /* Initiates a Load operation to start the system. If "dontStart" is truthy, then
    only the MCP bootstrap is loaded into memory -- P1 is not started */
    var result;
    var boundLoadComplete = (function boundLoadComplete(that, dontStart) {
        return function boundLoadCompleteAnon() {return that.loadComplete(dontStart)}
    }(this, dontStart));

    this.clear();                       // initialize P1/P2 configuration
    if (!this.P1 || this.P1.busy) {     // P1 is busy or not available
        result = 1;
    } else if (!this.testUnitReady(22)) {
        result = 2;                     // SPO not ready
    } else if (this.testUnitBusy(22)) {
        result = 3;                     // SPO is busy
    } else if (!(this.cardLoadSelect || this.testUnitReady(29))) {
        result = 4;                     // DKA not ready
    } else if (!this.cardLoadSelect && this.testUnitBusy(29)) {
        result = 5;                     // DKA is busy
    } else {                            // ready to rock 'n roll
        this.nextTimeStamp = performance.now();
        this.tock();
        this.LOFF = 1;                  // set the Load FF
        if (this.IO1 && this.IO1.REMF && !this.AD1F) {
            this.AD1F = 1;
            this.iouMask |= 0x1;
            this.ccLatch |= 0x1;
            this.IO1.initiateLoad(this.cardLoadSelect, boundLoadComplete);
        } else if (this.IO2 && this.IO2.REMF && !this.AD2F) {
            this.AD2F = 1;
            this.iouMask |= 0x2;
            this.ccLatch |= 0x2;
            this.IO2.initiateLoad(this.cardLoadSelect, boundLoadComplete);
        } else if (this.IO3 && this.IO3.REMF && !this.AD3F) {
            this.AD3F = 1;
            this.iouMask |= 0x4;
            this.ccLatch |= 0x4;
            this.IO3.initiateLoad(this.cardLoadSelect, boundLoadComplete);
        } else if (this.IO4 && this.IO4.REMF && !this.AD4F) {
            this.AD4F = 1;
            this.iouMask |= 0x8;
            this.ccLatch |= 0x8;
            this.IO4.initiateLoad(this.cardLoadSelect, boundLoadComplete);
        } else {
            this.CCI04F = 1;            // set I/O busy interrupt
        }
        result = 0;                     // all is copacetic
    }
    return result;
};

/**************************************/
B5500CentralControl.prototype.loadTest = function loadTest(buf, loadAddr) {
    /* Loads a test codestream into memory starting at B5500 word address
    "loadAddr" from the ArrayBuffer "buf". Returns the number of B5500
    words loaded into memory. Note that when loading an ESPOL "DISK" file,
    the first executable location is @20, so you will typically want to load
    to address 0 and call cc.runTest(0x10) [where 0x10 = @20]. This routine
    should not be used to load ESPOL "DECK" files */
    var addr = loadAddr;            // starting B5500 memory address
    var bytes = buf.byteLength;
    var data = new DataView(buf);   // use DataView() to avoid problems with littleendians.
    var power = 0x10000000000;
    var word = 0;
    var x = 0;

    function store(addr, word) {
        /* Stores a 48-bit word at the specified B5500 address.
           Invalid addresses and parity errors are ignored */
        var modNr = addr >>> 12;
        var modAddr = addr & 0x0FFF;

        if (modNr < 8 && this.memMod[modNr]) {
            this.memMod[modNr][modAddr] = word;
        }
    }

    if (!this.poweredUp) {
        throw "cc.loadTest: Cannot load with system powered off";
    } else {
        while (bytes > 6) {
            word = data.getUint8(x)* 0x10000000000 +
                   data.getUint8(x+1)* 0x100000000 +
                   data.getUint8(x+2)*   0x1000000 +
                   data.getUint8(x+3)*     0x10000 +
                   data.getUint8(x+4)*       0x100 +
                   data.getUint8(x+5);
            store.call(this, addr, word);
            x += 6;
            bytes -= 6;
            if (++addr > 0x7FFF) {
                break;
            }
        }
        // Store any partial word that may be left
        while (bytes > 0) {
            word += data.getUint8(x, false)*power;
            ++x;
            --bytes;
            power /= 0x100;
        }
        store.call(this, addr, word);
    }
    return addr-loadAddr+1;
};

/**************************************/
B5500CentralControl.prototype.runTest = function runTest(runAddr) {
    /* Executes a test program previously loaded by this.loadTest on processor
    P1. "runAddr" is the B5500 word address at which execution will begin
    (typically 0x10 [octal 20]) */

    this.clear();
    this.LOFF = 0;
    this.P1.preset(runAddr);
    this.P1.start();
};

B5500CentralControl.prototype.dumpSystemState = function dumpSystemState(caption, writer) {
    /* Generates a dump of the processor states and all of memory
       "caption is an identifying string that is output in the heading line.
       "writer" is a function that is called to output lines of text to the outside
       world. It takes two parameters:
           "phase" is a numeric code indicating the type of line being output:
                   0 = initialization and heading line
                   1 = processor 1 state
                   2 = processor 2 state
                  32 = core memory
                  -1 = end of dump (text parameter not valid)
           "text" is the line of text to be output.
    */
    var addr;
    var bic;
    var dupCount = 0;
    var lastLine = "";
    var line;
    var lineAddr;
    var mod;
    var x;

    var accessor = {                    // Memory access control block
        requestorID: "C",               // Memory requestor ID
        addr: 0,                        // Memory address
        word: 0,                        // 48-bit data word
        MAIL: 0,                        // Truthy if attempt to access @000-@777 in normal state
        MPED: 0,                        // Truthy if memory parity error
        MAED: 0                         // Truthy if memory address/inhibit error
    };

    var BICtoANSI = [
            "0", "1", "2", "3", "4", "5", "6", "7",
            "8", "9", "#", "@", "?", ":", ">", "}",
            "+", "A", "B", "C", "D", "E", "F", "G",
            "H", "I", ".", "[", "&", "(", "<", "~",
            "|", "J", "K", "L", "M", "N", "O", "P",
            "Q", "R", "$", "*", "-", ")", ";", "{",
            " ", "/", "S", "T", "U", "V", "W", "X",
            "Y", "Z", ",", "%", "!", "=", "]", "\""];

    function padLeft(text, minLength, c) {
        /* Pads "text" on the left to a total length of "minLength" with "c" */
        var s = text.toString();
        var len = s.length;
        var pad = c || " ";

        while (len++ < minLength) {
            s = pad + s;
        }
        return s;
    }

    function padOctal(value, octades) {
        /* Formats "value" as an octal number of "octades" length, left-padding with
        zeroes as necessary */
        var text = value.toString(8);

        if (value >= 0) {
            return padLeft(text, octades, "0");
        } else {
            return text;
        }
    }

    function convertWordtoANSI(value) {
        /* Converts the "value" as a B5500 word to an eight character string and returns it */
        var c;                              // current character
        var s = "";                         // working string value
        var w = value;                      // working word value
        var x;                              // character counter

        for (x=0; x<8; ++x) {
            c = w % 64;
            w = (w-c)/64;
            s = BICtoANSI[c] + s;
        }
        return s;
    }

    function dumpProcessorState(px, nr) {
        /* Dumps the register state for the specified processor */

        writer(nr, "Processor P" + nr + " = " + px.mnemonic + ":");
        writer(nr, "NCSF=" + px.NCSF + " CWMF=" + px.CWMF + " MSFF=" + px.MSFF + " SALF=" + px.SALF +
                  " VARF=" + px.VARF);
        writer(nr, "C=" + padOctal(px.C, 5) + " L=" + px.L + " P=" + padOctal(px.P, 16) + " PROF=" + px.TROF +
                  " T=" + padOctal(px.T, 4) + " TROF=" + px.TROF);
        writer(nr, "I=" + padLeft(px.I.toString(2), 8, "0") + " E=" + padLeft(px.E.toString(2), 6, "0") +
                  " Q=" + padLeft(px.Q.toString(2), 9, "0") + "  [bit masks]");
        writer(nr, "M=" + padOctal(px.M, 5) + " G=" + px.G + " H=" + px.H);
        writer(nr, "S=" + padOctal(px.S, 5) + " K=" + px.K + " V=" + px.V);
        writer(nr, "F=" + padOctal(px.F, 5) + " R=" + padOctal(px.R, 3));
        writer(nr, "X=   " + padOctal(px.X, 13) + " Y=" + padOctal(px.Y, 2) + " Z=" + padOctal(px.Z, 2) +
                  " N=" + px.N);
        writer(nr, "A=" + padOctal(px.A, 16) + " AROF=" + px.AROF);
        writer(nr, "B=" + padOctal(px.B, 16) + " BROF=" + px.BROF);
    }

    writer(0, "retro-B5500 State Dump by \"" + (caption || "(unknown)") + "\" : " + new Date().toString());

    // Dump the processor states
    dumpProcessorState(this.P1, 1);
    if (this.P2) {
        dumpProcessorState(this.P2, 2);
    }

    // Dump all of memory
    for (mod=0; mod<0x8000; mod+=0x1000) {
        for (addr=0; addr<0x1000; addr+=4) {
            lineAddr = mod+addr;
            line = " ";
            bic = "  ";
            for (x=0; x<4; ++x) {
                accessor.addr = lineAddr+x;
                this.fetch(accessor);
                if (accessor.MPED) {
                    line += " << PARITY >>    ";
                    bic += "????????";
                } else if (accessor.MAED) {
                    line += " << INV ADDR >>  ";
                    bic += "????????";
                } else {
                    line += " " + padOctal(accessor.word, 16);
                    bic += convertWordtoANSI(accessor.word);
                }
            } // for x

            if (line == lastLine && lineAddr < 0x7FFC) {
                ++dupCount;
            } else {
                if (dupCount > 0) {
                    writer(32, ".....  ................ for " + dupCount*4 + " words");
                    dupCount = 0;
                }
                writer(32, padOctal(lineAddr, 5) + line + bic);
                lastLine = line;
            }
        } // for addr
    } // for mod

    writer(-1, null);
};

/**************************************/
B5500CentralControl.prototype.configureSystem = function configureSystem(cfg) {
    /* Establishes the hardware module configuration from the system configuration
    object "cfg" */
    var mnem;
    var signal = null;
    var specs;
    var u;
    var unitClass;
    var x;

    function makeChange(cc, maskBit) {
        return function statusChange(ready) {
            cc.unitStatusMask = (ready ? cc.bitSet(cc.unitStatusMask, maskBit)
                                       : cc.bitReset(cc.unitStatusMask, maskBit));
        };
    }

    function makeSignal(cc, mnemonic) {
        switch (mnemonic) {
        case "SPO":
            return function signalSPO() {
                cc.CCI05F = 1;
                cc.signalInterrupt();
            };
            break;
        case "LPA":
            return function signalLPA() {
                cc.CCI06F = 1;
                cc.signalInterrupt();
            };
            break;
        case "LPB":
            return function signalLPB() {
                cc.CCI07F = 1;
                cc.signalInterrupt();
            };
            break;
        case "DCA":
            return function signalDCA() {
                cc.CCI13F = 1;
                cc.signalInterrupt();
            };
            break;
        case "DKA":
            return function signalDKA() {
                cc.setUnitBusy(29, 0);          // Is this needed here ??
                cc.CCI15F = 1;
                cc.signalInterrupt();
            };
            break;
        case "DKB":
            return function signalDKB() {
                cc.setUnitBusy(28, 0);          // Is this needed here ??
                cc.CCI16F = 1;
                cc.signalInterrupt();
            };
            break;
        default:
            return function signalDefault() {};
            break;
        }
    }

    // Configure the processors
    if (cfg.PA.enabled) {this.PA = new B5500Processor("A", this)}
    if (cfg.PB.enabled) {this.PB = new B5500Processor("B", this)}

    // Determine P1/P2
    this.PB1L = (cfg.PB1L ? 1 : 0);

    // Configure the I/O Units
    if (cfg.IO1.enabled) {this.IO1 = new B5500IOUnit("1", this)}
    if (cfg.IO2.enabled) {this.IO2 = new B5500IOUnit("2", this)}
    if (cfg.IO3.enabled) {this.IO3 = new B5500IOUnit("3", this)}
    if (cfg.IO4.enabled) {this.IO4 = new B5500IOUnit("4", this)}

    // Configure memory
    for (x=0; x<8; ++x) {
        if (cfg.memMod[x].enabled) {
            this.addressSpace[x] = new ArrayBuffer(4096*8);     // 4K B5500 words @ 8 bytes each
            this.memMod[x] = new Float64Array(this.addressSpace[x]);
        }
    }

    // Configure the peripheral units
    for (mnem in cfg.units) {
        if (cfg.units[mnem].enabled) {
            specs = B5500CentralControl.unitSpecs[mnem];
            if (specs) {
                unitClass = this.global[specs.unitClass || "B5500DummyUnit"];
                if (unitClass) {
                    u = new unitClass(mnem, specs.unitIndex, specs.designate,
                            makeChange(this, specs.unitIndex), makeSignal(this, mnem),
                            cfg.units[mnem]);
                    this.unit[specs.unitIndex] = u;
                }
            }
        }
    }

    this.clear();
};

/**************************************/
B5500CentralControl.prototype.powerOn = function powerOn(config) {
    /* Powers up the system and establishes the hardware module configuration.
    "config" is the system configuration object. Redundant power-ons are ignored. */

    if (!this.poweredUp) {
        this.sysConfig = config;
        this.configureSystem(config);
        this.poweredUp = 1;
    }
};

/**************************************/
B5500CentralControl.prototype.powerOff = function powerOff() {
    /* Powers down the system and deallocates the hardware modules.
    Redundant power-offs are ignored. */

    function systemShutDown() {
        var x;

        if (this.timer) {
            clearCallback(this.timer);
            this.timer = 0;
        }

        // Shut down the peripheral devices
        for (x=0; x<this.unit.length; ++x) {
            if (this.unit[x]) {
                this.unit[x].shutDown();
            }
        }

        // Deallocate the system modules
        this.P1 = this.P2 = null;
        this.PA = null;
        this.PB = null;
        this.IO1 = null;
        this.IO2 = null;
        this.IO3 = null;
        this.IO4 = null;
        for (x=0; x<8; ++x) {
            this.memMod[x] = null;
            this.addressSpace[x] = null;
        }

        this.clear();
        this.poweredUp = 0;
    }

    if (this.poweredUp) {
        this.halt();
        // Wait a little while for I/Os, etc., to finish
        setCallback(this.mnemonic, this, 500, systemShutDown);
    }
};
