/***********************************************************************
* retro-b5500/emulator B5500CentralControl.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the B5500 Central Control module.
************************************************************************
* 2012-06-03  P.Kimpel
*   Original version, from thin air.
***********************************************************************/

/**************************************/
function B5500CentralControl() {
    /* Constructor for the Central Control module object */

    /* Global system modules */

    this.PA = null;                 // Processor A (PA)
    this.PB = null;                 // Processor B (PB)
    this.IO1 = null;                // I/O unit 1
    this.IO2 = null;                // I/O unit 2
    this.IO3 = null;                // I/O unit 3
    this.IO4 = null;                // I/O unit 4

    this.P1 = null;                 // Reference for Processor 1 (control) [PA or PB]
    this.P1 = null;                 // Reference for Processor 2 (slave)   [PA or PB]

    this.AddressSpace = [];         // Array of memory module address spaces (8 x 32KB each)
    this.Memory = [];               // Array of memory module words as Float64s (8 x 4KW each)

    // This memory instantiation should be done in configuration, but here's the idea...
    this.AddressSpace[0] = new ArrayBuffer(32768);
    this.Memory[0] = new Float64Array(this.AddressSpace[0]);

    /* Central Control registers and flip flops */

    this.IAR = 0;                   // Interrupt address register
    this.TM = 0;                    // Real-time clock (6 bits, 60 ticks per second)

    this.CCI03F = 0;                // Time interval interrupt
    this.CCI04F = 0;                // I/O busy interrupt
    this.CCI05F = 0;                // Keyboard request interrupt
    this.CCI06F = 0;                // Printer 1 finished interrupt
    this.CCI07F = 0;                // Printer 2 finished interrupt
    this.CCI08F = 0;                // I/O unit 1 finished interrupt (RD in @14)
    this.CCI09F = 0;                // I/O unit 2 finished interrupt (RD in @15)
    this.CCI10F = 0;                // I/O unit 3 finished interrupt (RD in @16)
    this.CCI11F = 0;                // I/O unit 4 finished interrupt (RD in @17)
    this.CCI12F = 0;                // P2 busy interrupt
    this.CCI13F = 0;                // Remote inquiry request interrupt
    this.CCI14F = 0;                // Special interrupt #1 (not used)
    this.CCI15F = 0;                // Disk file #1 read check finished
    this.CCI16F = 0;                // Disk file #2 read check finished

    this.MCYF = 0;                  // Memory cycle FFs (one bit per M0..M7)
    this.PAXF = 0;                  // PA memory exchange select (M0..M7)
    this.PBXF = 0;                  // PB memory exchange select (M0..M7)
    this.I1XF = 0;                  // I/O unit 1 exchange select (M0..M7)
    this.I2XF = 0;                  // I/O unit 2 exchange select (M0..M7)
    this.I3XF = 0;                  // I/O unit 3 exchange select (M0..M7)
    this.I4XF = 0;                  // I/O unit 4 exchange select (M0..M7)

    this.AD1F = 0;                  // I/O unit 1 busy
    this.AD2F = 0;                  // I/O unit 2 busy
    this.AD3F = 0;                  // I/O unit 3 busy
    this.AD4F = 0;                  // I/O unit 4 busy

    this.LOFF = 0;                  // Load button pressed on console
    this.CTMF = 0;                  // Commence timing FF
    this.P2BF = 0;                  // Processor 2 busy FF
    this.HP2F = 0;                  // Halt processor 2 FF
    this.PB1L = 0;                  // 0=> PA is P1, 1=> PB is P1


    this.rtcTick = 1000/60;         // Real-time clock period, milliseconds
    this.nextTimeStamp = 0;         // Next actual Date.getTime() expected
}

/**************************************/
B5500CentralControl.prototype.fetch(r) {
    /* Called by requestor module "r" to fetch a word from memory. */
    var acer = r.accessor;
    var addr = acer.addr;
    var modNr = addr >>> 12;
    var modAddr = addr & 0x0FFF;
    var modMask = 1 << modNr;

    this.MCYF |= modMask;               // !! need to figure out when to turn this off for display purposes
                                        //    (odd/even addresses? fetch vs. store?)
    switch (r) {
    case PA:
        this.PAXF = modMask;
        break;
    case PB:
        this.PBXF = modMask;
        break;
    case IO1:
        this.I1XF = modMask;
        break;
    case IO2:
        this.I2XF = modMask;
        break;
    case IO3:
        this.I3XF = modMask;
        break;
    case IO4;
        this.I4XF = modMask;
        break;
    }

    // For now, we assume memory parity can never happen
    if (acer.MAIL || !this.Memory[modNr]) {
        // acer.MPED = 0;
        acer.MAED = 1;
        acer.word = 0;
    } else (
        // acer.MPED = 0;
        acer.MPED = 0;
        acer.word = this.Memory[memMod][modAddr];
    }
}

/**************************************/
B5500CentralControl.prototype.store(r, addr, word) {
    /* Called by requestor module "r" to store a word into memory. */
    var acer = r.accessor
    var addr = acer.addr;
    var modNr = addr >>> 12;
    var modAddr = addr & 0x0FFF;
    var modMask = 1 << modNr;

    this.MCYF |= modMask;               // !! need to figure out when to turn this off for display purposes
                                        //    (odd/even addresses? fetch vs. store?)
    switch (r) {
    case this.PA:
        this.PAXF = modMask;
        break;
    case this.PB:
        this.PBXF = modMask;
        break;
    case this.IO1:
        this.I1XF = modMask;
        break;
    case this.IO2:
        this.I2XF = modMask;
        break;
    case this.IO3:
        this.I3XF = modMask;
        break;
    case this.IO4:
        this.I4XF = modMask;
        break;
    }

    // For now, we assume memory parity can never happen
    if (acer.MAIL || !this.Memory[modNr]) {
        // acer.MPED = 0;
        acer.MAED = 1;
    } else (
        // acer.MPED = 0;
        acer.MAED = 0;
        this.Memory[memMod][modAddr] = acer.word;
    }
}

/**************************************/
B5500CentralControl.prototype.signalInterrupt() {
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
}

/**************************************/
B5500CentralControl.prototype.clearInterrupt();
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
}

/**************************************/
B5500CentralControl.prototype.clear() {
    /* Initializes the system and starts the real-time clock */

    this.nextTimeStamp = new Date().getTime() + this.rtcTick;
    setTimeout(this.tock, this.rtcTick);
}

/**************************************/
B5500CentralControl.prototype.tock() {
    /* Handles the 1/60th second real-time clock increment */
    var thisTime = new Date().getTime();

    if (this.TM < 63) {
        this.TM++;
    } else {
        this.TM = 0;
        this.CCI03F = 1;                // set timer interrupt
        this.signalInterrupt();
    }
    this.nextTimeStamp += this.rtcTick;
    if (this.nextTimeStamp < thisTime) {
        setTimeout(this.tock, 1);       // try to catch up
    } else {
        setTimeout(this.tock, this.nextTimeStamp-thisTime);
    }
}

/**************************************/
B5500CentralControl.prototype.halt() {
    /* Halts the system */

    // TO BE PROVIDED
}

/**************************************/
B5500CentralControl.prototype.load() {
    /* Initiates a Load operation to start the system */

    // TO BE PROVIDED
}