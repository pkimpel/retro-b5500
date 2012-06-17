/***********************************************************************
* retro-b5500/emulator B5500DistributionAndDisplay.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the B5500 Distribution & Display module.
************************************************************************
* 2012-06-16  P.Kimpel
*   Original version, from thin air.
***********************************************************************/

/***********************************************************************
*  Panel Lamp                                                          *
************************************************************************
function B5500DDLamp(x, y) {
    /* Constructor for the lamp objects used within D&D. x & y are the
    coordinates of the lamp within its containing element */

    this.state = 0;                     // current lamp state, 0=off

    this.element =                      // visible DOM element
        document.createElement("div");
    this.element.className = "ddLamp";
    this.element.style.left = String(x) + "px";
    this.element.style.top = String(y) + "px";
}

/**************************************/

B5500DDLamp.prototype.onColor = "#FF9900";
B5500DDLamp.prototype.offColor = "#999999";

/**************************************/
B5500DDLamp.prototype.set = function(v) {
    /* Changes the visible state of the lamp according to the low-order
    bit of "v". */
    newState = v & 1;

    if (this.state ^ newState) {         // the state has changed
        this.element.backgroundColor = (v & 1 ? this.onColor : this.offColor);
        this.state = newState;
    }
}


/***********************************************************************
*  Panel Register                                                      *
***********************************************************************/
B5500DDRegister(bits, x, y, rows, deltax, deltay) {
    /* Constructor for the register objects used within D&D.
    */
    var cols = Math.floor((bits+rows-1)/rows);
    var height = rows*this.vSpacing;
    var width = cols*this.hSpacing;

    this.bits = bits;                   // number of bits in the register
    this.left = x;                      // horizontal offset relative to container
    this.top = y;                       // vertical offset relative to container
    this.element =                      // visible DOM element
        document.createElement("div");
    this.element.className = "ddRegister";
    this.element.style.left = String(x) + "px";
    this.element.style.top = String(y) + "px";
}

/**************************************/

B5500DDRegister.prototype.hSpacing = 18; // horizontal lamp spacing, pixels
B5500DDRegister.prototype.vSpacing = 18; // vertical lamp spacing, pixels



/***********************************************************************
*  Distribution And Display Module                                     *
************************************************************************/
function B5500DistributionAndDisplay() {
    /* Constructor for the Distribution And Display module object */

    /* Global system modules */

    this.nextTimeStamp = 0;             // Next actual Date.getTime() expected
    this.timer = null;                  // Reference to the RTC setTimeout id.

    this.clear();                       // Create and initialize the Central Control state

    this.tock.that = this;              // Establish contexts for when called from setTimeout().
}

/**************************************/
    /* Global constants */

B5500DistributionAndDisplay.prototype.refreshPeriod = 50; // milliseconds

/**************************************/
B5500DistributionAndDisplay.prototype.clear = function() {
    /* Initializes the system and starts the real-time clock */

    if (this.timer) {
        clearTimeout(this.timer);
    }

    this.nextTimeStamp = new Date().getTime() + this.rtcTick;
    this.timer = setTimeout(this.tock, this.rtcTick);

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
}
