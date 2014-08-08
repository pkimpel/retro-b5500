/***********************************************************************
* retro-b5500/emulator B5500SystemConfiguration.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License,
*       see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 System Configuration module.
*
* This is presently a static Javascript object describing the hardware
* modules and peripherals attached to the system.
************************************************************************
* 2012-06-30  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

var B5500SystemConfiguration = {

    PA:         true,                   // Processor A available
    PB:         false,                  // Processor B available

    PB1L:       false,                  // PA is P1 (false) | PB is P1 (true)

    IO1:        true,                   // I/O Unit 1 available
    IO2:        true,                   // I/O Unit 2 available
    IO3:        true,                   // I/O Unit 3 available
    IO4:        false,                  // I/O Unit 4 available

    memMod: [
                true,                   // Memory module 0 available (4KW)
                true,                   // Memory module 1 available (4KW)
                true,                   // Memory module 2 available (4KW)
                true,                   // Memory module 3 available (4KW)
                true,                   // Memory module 4 available (4KW)
                true,                   // Memory module 5 available (4KW)
                true,                   // Memory module 6 available (4KW)
                true],                  // Memory module 7 available (4KW)

    units: {
        SPO:    true,                   // SPO keyboard/printer
        DKA:    true,                   // Disk File Control A
        DKB:    true,                   // Disk File Control B
        CRA:    true,                   // Card Reader A
        CRB:    false,                  // Card Reader B
        CPA:    true,                   // Card Punch A
        LPA:    true,                   // Line Printer A
        LPB:    false,                  // Line Printer B
        PRA:    false,                  // Paper Tape Reader A
        PRB:    false,                  // Paper Tape Reader B
        PPA:    false,                  // Paper Tape Punch A
        PPB:    false,                  // Paper Tape Punch A
        DCA:    true,                   // Data Communications Control A
        DRA:    false,                  // Drum/Auxmem A
        DRB:    false,                  // Drum/Auxmem B
        MTA:    true,                   // Magnetic Tape Unit A
        MTB:    true,                   // Magnetic Tape Unit B
        MTC:    true,                   // Magnetic Tape Unit C
        MTD:    true,                   // Magnetic Tape Unit D
        MTE:    false,                  // Magnetic Tape Unit E
        MTF:    false,                  // Magnetic Tape Unit F
        MTH:    false,                  // Magnetic Tape Unit H
        MTJ:    false,                  // Magnetic Tape Unit J
        MTK:    false,                  // Magnetic Tape Unit K
        MTL:    false,                  // Magnetic Tape Unit L
        MTM:    false,                  // Magnetic Tape Unit M
        MTN:    false,                  // Magnetic Tape Unit N
        MTP:    false,                  // Magnetic Tape Unit P
        MTR:    false,                  // Magnetic Tape Unit R
        MTS:    false,                  // Magnetic Tape Unit S
        MTT:    false}                  // Magnetic Tape Unit X
};
