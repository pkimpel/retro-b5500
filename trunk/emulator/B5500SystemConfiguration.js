/***********************************************************************
* retro-b5500/emulator B5500SystemConfiguration.js
************************************************************************
* Copyright (c) 2012, 2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License,
*       see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 System Configuration definition module.
*
* This class defines the system configuration properties for the B5500
* emulator. This is not used directly by the emulator, but serves as a
* central definition of the configuration properties and as a template
* from which actual configuration instances can be cloned.
************************************************************************
* 2012-06-30  P.Kimpel
*   Original version, from thin air.
* 2014-08-27  P.Kimpel
*   Revise and implement as a constructor with prototype to support the
*   new dynamic configuration mechanism.
***********************************************************************/
"use strict";

/**************************************/
function B5500SystemConfiguration() {
    /* Constructor for the global SystemConfiguration definition object */
    // ...nothing to construct at present... everything's in the prototype.
}

/**************************************/
B5500SystemConfiguration.prototype.configLevel = 1;     // configuration object version
B5500SystemConfiguration.prototype.sysDefaultConfigName = "Default";
B5500SystemConfiguration.prototype.sysDefaultStorageName = "B5500DiskUnit";

// Template for Datacom terminal unit (B487) definition object
B5500SystemConfiguration.prototype.sysDefaultTerminalUnit = {
    enabled: true,                      // available in system
    adapters: 1,                        // number of terminal interface adapters
    buffers:  2,                        // number of 28-character buffers/adapter
    pingPong: false                     // use ping-pong buffer management
};

// Template for the global system configuration definition object
B5500SystemConfiguration.prototype.systemConfig = {
    configLevel:    B5500SystemConfiguration.prototype.configLevel,
    configName:     B5500SystemConfiguration.prototype.sysDefaultConfigName,

    PA: {enabled: true},                // Processor A available
    PB: {enabled: false},               // Processor B available

    PB1L: false,                        // PA is P1 (false) | PB is P1 (true)

    IO1: {enabled: true},               // I/O Unit 1 available
    IO2: {enabled: true},               // I/O Unit 2 available
    IO3: {enabled: true},               // I/O Unit 3 available
    IO4: {enabled: false},              // I/O Unit 4 available

    memMod: [   {enabled: true},        // Memory module 0 available (4KW)
                {enabled: true},        // Memory module 1 available (4KW)
                {enabled: true},        // Memory module 2 available (4KW)
                {enabled: true},        // Memory module 3 available (4KW)
                {enabled: true},        // Memory module 4 available (4KW)
                {enabled: true},        // Memory module 5 available (4KW)
                {enabled: true},        // Memory module 6 available (4KW)
                {enabled: true}],       // Memory module 7 available (4KW)

    units: {
        SPO:    {enabled: true,         // SPO keyboard/printer
                 algolGlyphs: false},

        DKA:    {enabled: true,         // Disk File Control A
                 DFX: true, FPM: false,
                 storageName:    B5500SystemConfiguration.prototype.sysDefaultStorageName},
        DKB:    {enabled: false,        // Disk File Control B
                 DFX: true, FPM: false,
                 storageName:    B5500SystemConfiguration.prototype.sysDefaultStorageName},

        CRA:    {enabled: true},        // Card Reader A
        CRB:    {enabled: false},       // Card Reader B
        CPA:    {enabled: true,         // Card Punch A
                 algolGlyphs: true},

        LPA:    {enabled: true,         // Line Printer A
                 algolGlyphs: true},
        LPB:    {enabled: false,        // Line Printer B
                 algolGlyphs: true},

        PRA:    {enabled: false},       // Paper Tape Reader A
        PRB:    {enabled: false},       // Paper Tape Reader B
        PPA:    {enabled: false},       // Paper Tape Punch A
        PPB:    {enabled: false},       // Paper Tape Punch A

        DCA:    {enabled: true,         // Data Communications Control A
                 terminalUnits: {
                    TU1: B5500SystemConfiguration.prototype.sysDefaultTerminalUnit
                }},

        DRA:    {enabled: false},       // Drum/Auxmem A
        DRB:    {enabled: false},       // Drum/Auxmem B

        MTA:    {enabled: true},        // Magnetic Tape Unit A
        MTB:    {enabled: false},       // Magnetic Tape Unit B
        MTC:    {enabled: false},       // Magnetic Tape Unit C
        MTD:    {enabled: false},       // Magnetic Tape Unit D
        MTE:    {enabled: false},       // Magnetic Tape Unit E
        MTF:    {enabled: false},       // Magnetic Tape Unit F
        MTH:    {enabled: false},       // Magnetic Tape Unit H
        MTJ:    {enabled: false},       // Magnetic Tape Unit J
        MTK:    {enabled: false},       // Magnetic Tape Unit K
        MTL:    {enabled: false},       // Magnetic Tape Unit L
        MTM:    {enabled: false},       // Magnetic Tape Unit M
        MTN:    {enabled: false},       // Magnetic Tape Unit N
        MTP:    {enabled: false},       // Magnetic Tape Unit P
        MTR:    {enabled: false},       // Magnetic Tape Unit R
        MTS:    {enabled: false},       // Magnetic Tape Unit S
        MTT:    {enabled: false}        // Magnetic Tape Unit T
    }
};
