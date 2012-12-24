/***********************************************************************
* retro-b5500/emulator B5500DummyUnit.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Dummy/Non-existent Peripheral Unit module.
*
* Defines a dummy peripheral unit type that should be instantiated for all
* non-existent or unimplemented peripheral units in the system. This class
* defines the full peripheral interface, but immediately reports a non-ready
* result for all I/O operations that are attempted.
*
************************************************************************
* 2012-12-21  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500DummyUnit(mnemonic, index, designate, statusChange, signal) {
    /* Constructor for the DummyUnit object */

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.index = index;                 // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. SPO input request)
    this.finish = null;                 // external function to call for I/O completion
    
    this.clear();
}

/**************************************/
B5500DummyUnit.prototype.clear = function() {
    /* Initializes (and if necessary, creates) the processor state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status
    this.activeIOUnit = 0;              // I/O unit currently using this device
};

/**************************************/
B5500DummyUnit.prototype.read = function(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit */
    
    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.space = function(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.write = function(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.erase = function(finish, length) {
    /* Initiates an erase operation on the unit */
    
    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.rewind = function(finish) {
    /* Initiates a rewind operation on the unit */
    
    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.readCheck = function(finish, length) {
    /* Initiates a read check operation on the unit */
    
    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.readInterrogate = function(finish) {
    /* Initiates a read interrogate operation on the unit */
    
    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500DummyUnit.prototype.writeInterrogate = function (finish) {
    /* Initiates a write interrogate operation on the unit */
    
    finish(0x04, 0);                    // report unit not ready
};
