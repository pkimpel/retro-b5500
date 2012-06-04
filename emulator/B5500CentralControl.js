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
B5500CentralControl.prototype.fetch(addr) {
    /* Called by all modules to fetch a word from memory. /*

    // TO BE PROVIDED
}

/**************************************/
B5500CentralControl.prototype.store(addr, word) {
    /* Called by all modules to fetch a word from memory. /*

    // TO BE PROVIDED
}

/**************************************/
B5500CentralControl.prototype.signalInterrupt() {
    /* Called by all modules to signal that an interrupt has occurred and
    to invoke the interrupt prioritization mechanism. This will result in
    an updated vector address in the IAR. /*

    // TO BE PROVIDED
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