/***********************************************************************
* retro-b5500/emulator B5500IOUnit.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Input/Output Unit module.
*
* Instance variables in all caps generally refer to register or flip-flop (FF)
* entities in the processor hardware. See the Burroughs B5500 Reference Manual
* (1021326, May 1967) and B5283 Input/Output Training Manual (1036993, January 1969)
* for details:
* http://bitsavers.org/pdf/burroughs/B5000_5500_5700/1021326_B5500_RefMan_May67.pdf
* http://bitsavers.org/pdf/burroughs/B5000_5500_5700/1036993_B5283_TrainingMan_Jan69.pdf
*
* B5500 word format: 48 bits plus (hidden) parity.
*   Bit 0 is high-order, bit 47 is low-order, big-endian character ordering.
*   I/O and Result Descriptors have the following general format:
*       [0:1]   Flag bit (1=descriptor)
*       [1:1]   (0=descriptor)
*       [2:1]   Presence bit (1=present and available in memory, 0=absent or unavailable)
*       [3:5]   Unit designate
*       [8:10]  Word count (optional, see [23:1])
*       [18:1]  Memory inhibit bit (1=no data transfer)
*       [19:2]  (not used by I/O Unit)
*       [21:1]  Mode bit (0=alpha, 1=binary)
*       [22:1]  Direction bit (0=forward, 1=reverse for mag tape, 120/132 col for printers)
*       [23:1]  Word count bit (0=ignore, 1=use word count in [8:10])
*       [24:1]  I/O bit (0=write, 1=read)
*       [25:1]  (not used by I/O Unit)
*       [26:7]  Control and error-reporting bits (depend on unit)
*       [33:15] Memory address
*
************************************************************************
* 2012-12-08  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500IOUnit(ioUnitID, cc) {
    /* Constructor for the I/O Unit object */

    this.ioUnitID = ioUnitID;           // I/O Unit ID ("1", "2", "3", or "4")
    this.cc = cc;                       // Reference back to Central Control module

    this.forkHandle = null;             // Reference to current setTimeout id
    this.accessor = {                   // Memory access control block
        requestorID: ioUnitID,             // Memory requestor ID
        addr: 0,                           // Memory address
        word: 0,                           // 48-bit data word
        MAIL: 0,                           // Truthy if attempt to access @000-@777 in normal state
        MPED: 0,                           // Truthy if memory parity error
        MAED: 0                            // Truthy if memory address/inhibit error
    };
    
    // Establish a buffer for the peripheral modules to use during their I/O.
    // The size is sufficient for 63 disk sectors, rounded up to the next 8KB.
    this.bufferArea = new ArrayBuffer(16384);  
    this.buffer = new Uint8Array(this.bufferArea);

    this.clear();                       // Create and initialize the processor state
}

/**************************************/

B5500IOUnit.timeSlice = 5000;           // Standard run() timeslice, about 5ms (we hope) 
B5500IOUnit.memCycles = 6;              // assume 6 us memory cycle time (the other option was 4 usec)

B5500IOUnit.BICtoANSI = [               // Index by 6-bit BIC to get 8-bit ANSI code
        0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,        // 00-07, @00-07
        0x38,0x39,0x23,0x40,0x3F,0x3A,0x3E,0x7D,        // 08-1F, @10-17
        0x2B,0x41,0x42,0x43,0x44,0x45,0x46,0x47,        // 10-17, @20-27
        0x48,0x49,0x2E,0x5B,0x26,0x28,0x3C,0x7E,        // 18-1F, @30-37
        0x7C,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,0x50,        // 20-27, @40-47
        0x51,0x52,0x24,0x2A,0x2D,0x29,0x3B,0x7B,        // 28-2F, @50-57
        0x20,0x2F,0x53,0x54,0x55,0x56,0x57,0x58,        // 30-37, @60-67
        0x59,0x5A,0x2C,0x25,0x21,0x3D,0x5D,0x22];       // 38-3F, @70-77

B5500IOUnit.BICtoBCLANSI = [            // Index by 6-bit BIC to get 8-bit BCL-as-ANSI code
        0x23,0x31,0x32,0x33,0x34,0x35,0x36,0x37,        // 00-07, @00-07
        0x38,0x39,0x40,0x3F,0x30,0x3A,0x3E,0x7D,        // 08-1F, @10-17
        0x2C,0x2F,0x53,0x54,0x55,0x56,0x57,0x58,        // 10-17, @20-27
        0x59,0x5A,0x25,0x21,0x20,0x3D,0x5D,0x22,        // 18-1F, @30-37
        0x24,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,0x50,        // 20-27, @40-47
        0x51,0x52,0x2A,0x2D,0x7C,0x29,0x3B,0x7B,        // 28-2F, @50-57
        0x2B,0x41,0x42,0x43,0x44,0x45,0x46,0x47,        // 30-37, @60-67
        0x48,0x49,0x5B,0x26,0x2E,0x28,0x3C,0x7E];       // 38-3F, @70-77
        
B5500IOUnit.ANSItoBIC = [               // Index by 8-bit ANSI to get 6-bit BIC (upcased, invalid=>"?")
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 00-0F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 10-1F
        0x30,0x3C,0x3F,0x0A,0x2A,0x3B,0x1C,0x0C,0x1D,0x2D,0x2B,0x10,0x3A,0x2C,0x1A,0x31,  // 20-2F
        0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0D,0x2E,0x1E,0x3D,0x0E,0x0C,  // 30-3F
        0x0B,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x21,0x22,0x23,0x24,0x25,0x26,  // 40-4F
        0x27,0x28,0x29,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x1B,0x0C,0x3E,0x0C,0x0C,  // 50-5F
        0x0C,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x21,0x22,0x23,0x24,0x25,0x26,  // 60-6F
        0x27,0x28,0x29,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x2F,0x20,0x0F,0x1F,0x0C,  // 70-7F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 80-8F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 90-9F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // A0-AF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // B0-BF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // C0-CF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // D0-DF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // E0-EF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C]; // F0-FF
        
B5500IOUnit.BCLANSItoBIC = [            // Index by 8-bit BCL-as-ANSI to get 6-bit BIC (upcased, invalid=>"?")
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 00-0F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 10-1F
        0x1C,0x1B,0x1F,0x00,0x20,0x1A,0x3B,0x0C,0x3D,0x2D,0x2A,0x30,0x10,0x2B,0x3C,0x11,  // 20-2F
        0x0C,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0D,0x2E,0x3E,0x1D,0x0E,0x0B,  // 30-3F
        0x0A,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x21,0x22,0x23,0x24,0x25,0x26,  // 40-4F
        0x27,0x28,0x29,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x3A,0x0C,0x1E,0x0C,0x0C,  // 50-5F
        0x0C,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x21,0x22,0x23,0x24,0x25,0x26,  // 60-6F
        0x27,0x28,0x29,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x2F,0x2C,0x0F,0x3F,0x0C,  // 70-7F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 80-8F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // 90-9F
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // A0-AF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // B0-BF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // C0-CF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // D0-DF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,  // E0-EF
        0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C]; // F0-FF

/**************************************/
B5500IOUnit.prototype.clear = function() {
    /* Initializes (and if necessary, creates) the I/O Unit state */

    this.W = 0;                         // Memory buffer register
    this.D = 0;                         // I/O descriptor (control) register
    this.clearD();                      // clear the D-register exploded fields
    
    this.CC = 0;                        // Character counter (3 bits)
    this.IB = 0;                        // Input buffer register (6 bits+parity)    
    this.IR = 0;                        // Tape read register (6 bits+parity)
    this.OB = 0;                        // Output buffer register (6 bits+parity)
    this.WB = 0;                        // Tape write register (6 bits+parity)
    this.LP = 0;                        // Longitudinal parity register (6 bits+parity)
    this.SC = 0;                        // Sequence counter (4 bits) 
    this.PC = 0;                        // Pulse counter register (6 bits, 1MHz rate)
    
    this.AOFF = 0;                      // Address overflow FF
    this.EXNF = 0;                      // W-contents FF (0=has address, 1=has descriptor)
    this.HOLF = 0;                      // Hold-over FF (for alpha vs. binary card read)
    this.LCHF = 0;                      // Last-character FF (triggers RD construction)
    this.LPWF = 0;                      // (unknown)
    this.MANF = 0;                      // Memory access needed FF
    this.MAOF = 0;                      // Memory access obtained FF
    this.OBCF = 0;                      // (unknown)
    this.STRF = 0;                      // Strobe FF
    
    this.BKWF = 0;                      // Tape control FF                                                
    this.FWDF = 0;                      // Tape control FF                                                
    this.IM1F = 0;                      // Tape control FF                                                
    this.IMFF = 0;                      // Tape control FF                                                
    this.PUCF = 0;                      // Tape control FF                                                
    this.RCNF = 0;                      // Tape control FF                                                
    this.SHOF = 0;                      // Tape control FF                                                
    this.SKFF = 0;                      // Tape control FF                                                
    this.VRCF = 0;                      // Tape control FF                                                
    
    this.IMCF = 0;                      // (unknown)
    this.RECF = 0;                      // (unknown)
    this.REMF = 1;                      // Remote FF (0=local, 1=remote and available)
    
    this.busy = 0;                      // I/O Unit is busy
    this.busyUnit = 0;                  // Peripheral unit index currently assigned to the I/O Unit

    this.cycleCount = 0;                // Current cycle count for this.run()
    this.cycleLimit = 0;                // Cycle limit for this.run()
    this.totalCycles = 0;               // Total cycles executed on this I/O Unit
    this.ioUnitTime = 0;                // Total I/O Unit running time, based on cycles executed
    this.ioUnitSlack = 0;               // Total I/O Unit throttling delay, milliseconds
    
    if (this.forkHandle) {
        clearTimeout(this.forkHandle);
    }
};

/**************************************/
B5500IOUnit.prototype.clearD = function() {
    /* Clears the D-register and the exploded field variables used internally */
    
    this.D = 0;
    this.Dunit = 0;                     // Unit designate field (5 bits)
    this.DwordCount = 0;                // Word count field (10 bits)
    this.D18F = 0;                      // Memory inhibit bit (0=transfer, 1=no transfer)
    this.D21F = 0;                      // Mode bit (0=alpha, 1=binary)
    this.D22F = 0;                      // Direction bit (0=forward), etc.
    this.D23F = 0;                      // Word counter bit (0=ignore, 1=use)
    this.D24F = 0;                      // I/O bit (0=write, 1=read)
    this.D26F = 0;                      // Memory address error bit
    this.D27F = 0;                      // Device error bit 1
    this.D28F = 0;                      // Device error bit 2
    this.D29F = 0;                      // Device error bit 3
    this.D30F = 0;                      // Unit not-ready bit
    this.D31F = 0;                      // Memory parity error on descriptor fetch bit
    this.D32F = 0;                      // Unit busy bit
    this.Daddress = 0;                  // Memory transfer address (15 bits)
};

/**************************************/
B5500IOUnit.prototype.fetch = function(addr) {
    /* Fetch a word from memory at address "addr" and leave it in the W register.
    Returns 1 if a memory access error occurred, 0 if no error */
    var acc = this.accessor;            // get a local reference to the accessor object

    acc.addr = addr;
    this.cc.fetch(acc);
    this.W = acc.word;

    this.cycleCount += B5500IOUnit.memCycles;               
    if (acc.MAED) {
        this.D26F = 1;                  // set memory address error
        return 1;
    } else if (acc.MPED) {
        this.D29F = 1;                  // set memory parity error on data transfer
        return 1;
    } else {
        return 0;                       // no error
    }
};

/**************************************/
B5500IOUnit.prototype.store = function(addr) {
    /* Store a word in memory at address "addr" from the W register.
    Returns 1 if a memory access error occurred, 0 if no error */
    var acc = this.accessor;            // get a local reference to the accessor object

    acc.addr = addr;
    acc.word = this.W;
    this.cc.store(acc);

    this.cycleCount += B5500IOUnit.memCycles;               
    if (acc.MAED) {
        this.D26F = 1;                  // set memory address error
        return 1;
    } else {
        return 0;                       // no error
    }
};

/**************************************/
B5500IOUnit.prototype.fetchBuffer = function(mode, words) {
    /* Fetches words from memory starting at this.Daddress and coverts the
    BIC characters to ANSI or BCLANSI in this.buffer. "mode": 0=BCLANSI, 1=ANSI; 
    "words": maximum number of words to transfer. At exit, updates this.Daddress 
    with the final transfer address+1. If this.D23F, updates this.wordCount 
    with any remaining count.
    Returns the number of characters fetched into the buffer */
    var addr = this.Daddress;           // local copy of memory address
    var buf = this.buffer;              // local pointer to buffer
    var c;                              // current character code
    var count = 0;                      // number of characters fetched
    var done = false;                   // loop control
    var overflow = false;               // memory address overflowed max
    var s;                              // character shift counter
    var table = (mode ? B5500IOUnit.BICtoANSI : B5500IOUnit.BICtoBCLANSI);
    var w;                              // local copy of this.W
    
    do {                                // loop through the words
        if (words <= 0) {
            done = true;
        } else {
            words--;
            if (overflow) {
                this.AOFF = 1;          // for display only
                this.D26F = 1;          // address overflow: set invalid address error
                done = true;
            } else if (!this.fetch(addr)) { // fetch the next word from memory
                w = this.W;             // fill the buffer with this word's characters        
                for (s=0; s<8; s++) {
                    c = (w - (w %= 0x40000000000))/0x40000000000;
                    buf[count++] = table[c];
                    w *= 64;            // shift word left 6 bits
                } // for s
            }
            if (addr < 0x7FFF) {
                addr++;
            } else {
                overflow = true;
            }
        }
    } while (!done);
    
    this.Daddress = addr;
    if (this.D23F) {
        this.DwordCount = words & 0x1FF;
    }
    return count;
};

/**************************************/
B5500IOUnit.prototype.fetchBufferWithGM = function(mode, words) {
    /* Fetches words from memory starting at this.Daddress and coverts the
    BIC characters to ANSI or BCLANSI in this.buffer. "mode": 0=BCLANSI, 1=ANSI; 
    "words": maximum number of words to transfer. The transfer can be terminated 
    by a group-mark code in memory. At exit, updates this.Daddress with the 
    final transfer address+1. If this.D23F, updates this.wordCount 
    with any remaining count.
    Returns the number of characters fetched into the buffer */
    var addr = this.Daddress;           // local copy of memory address
    var buf = this.buffer;              // local pointer to buffer
    var c;                              // current character code
    var count = 0;                      // number of characters fetched
    var done = false;                   // loop control
    var overflow = false;               // memory address overflowed max
    var s;                              // character shift counter
    var table = (mode ? B5500IOUnit.BICtoANSI : B5500IOUnit.BICtoBCLANSI);
    var w;                              // local copy of this.W
    
    do {                                // loop through the words
        if (words <= 0) {
            done = true;
        } else {
            words--;
            if (overflow) {
                this.AOFF = 1;          // for display only
                this.D26F = 1;          // address overflow: set invalid address error
                done = true;
            } else if (!this.fetch(addr)) { // fetch the next word from memory
                w = this.W;             // fill the buffer with this word's characters        
                for (s=0; s<8; s++) {
                    c = (w - (w %= 0x40000000000))/0x40000000000;
                    if (c == 0x1F) {    
                        done = true;    // group-mark detected 
                        break;
                    } else {
                        buf[count++] = table[c];
                        w *= 64;        // shift word left 6 bits
                    }
                } // for s
            }
            if (addr < 0x7FFF) {
                addr++;
            } else {
                overflow = true;
            }
        }
    } while (!done);
    
    this.Daddress = addr;
    if (this.D23F) {
        this.DwordCount = words & 0x1FF;
    }
    return count;
};

/**************************************/
B5500IOUnit.prototype.storeBuffer = function(chars, offset, mode, words) {
    /* Converts characters in this.buffer from ANSI or BCLANSI to BIC, assembles
    them into words, and stores the words into memory starting at this.Daddress.
    "chars": the number of characters to store, starting at "offset" in the buffer; 
    "mode": 0=BCLANSI, 1=ANSI; "words": maximum number of words to transfer. 
    At exit, updates this.Daddress with the final transfer address+1. 
    If this.D23F, updates this.wordCount with any remaining count.
    Returns the number of characters stored into memory from the buffer */
    var addr = this.Daddress;           // local copy of memory address
    var buf = this.buffer;              // local pointer to buffer
    var c;                              // current character code
    var count = 0;                      // number of characters fetched
    var done = (words == 0);            // loop control
    var overflow = false;               // memory address overflowed max
    var power = 0x40000000000;          // factor for character shifting into a word
    var s = 0;                          // character shift counter
    var table = (mode ? B5500IOUnit.ANSItoBIC : B5500IOUnit.BCLANSItoBIC);
    var w = 0;                          // local copy of this.W
    
    while (!done) {                     // loop through the words
        if (count >= chars) {
            done = true;
        } else {
            c = table[buf[offset+(count++)]];
            w += c*power;
            power /= 64;
            if (++s > 7) {
                this.W = w;
                if (overflow) {
                    this.AOFF = 1;      // for display only
                    this.D26F = 1;      // address overflow: set invalid address error
                    done = true;
                } else {
                    this.store(addr);   // store the word in memory
                }
                if (addr < 0x7FFF) {
                    addr++;
                } else {
                    overflow = true;
                }
                w = s = 0;
                power = 0x40000000000;
                if (--words <= 0) {
                    done = true;
                }
            }
        }
    } // while !done

    if (s > 0 && words > 0) {           // partial word left to be stored
        this.W = w;
        if (overflow) {
            this.AOFF = 1;              // for display only
            this.D26F = 1;              // address overflow: set invalid address error
            done = true;
        } else {
            this.store(addr);           // store the word in memory
        }
        words--;
        if (addr < 0x7FFF) {
            addr++;
        }
    }
    
    this.Daddress = addr;
    if (this.D23F) {
        this.DwordCount = words & 0x1FF;
    }
    return count;
};

/**************************************/
B5500IOUnit.prototype.storeBufferWithGM = function(chars, offset, mode, words) {
    /* Converts characters in this.buffer from ANSI to BIC, assembles them into
    words, and stores the words into memory starting at this.Daddress.
    "chars": the number of characters to store, starting at "offset" in the buffer; 
    "mode": 0=BCLANSI, 1=ANSI; "words": maximum number of words to transfer. 
    The final character stored from the buffer is followed in memory by a group-mark, 
    assuming the word count is not exhausted. At exit, updates this.Daddress with the 
    final transfer address+1. 
    If this.D23F, updates this.wordCount with any remaining count.
    Returns the number of characters stored into memory from the buffer, plus one
    for the group-mark */
    var addr = this.Daddress;           // local copy of memory address
    var buf = this.buffer;              // local pointer to buffer
    var c;                              // current character code
    var count = 0;                      // number of characters fetched
    var done = (words == 0);            // loop control
    var overflow = false;               // memory address overflowed max
    var power = 0x40000000000;          // factor for character shifting into a word
    var s = 0;                          // character shift counter
    var table = (mode ? B5500IOUnit.ANSItoBIC : B5500IOUnit.BCLANSItoBIC);
    var w = 0;                          // local copy of this.W
    
    while (!done) {                     // loop through the words
        if (count >= chars) {
            done = true;
        } else {
            c = table[buf[offset+(count++)]];
            w += c*power;
            power /= 64;
            if (++s > 7) {
                this.W = w;
                if (overflow) {
                    this.AOFF = 1;      // for display only
                    this.D26F = 1;      // address overflow: set invalid address error
                    done = true;
                } else {
                    this.store(addr);   // store the word in memory
                }
                if (addr < 0x7FFF) {
                    addr++;
                } else {
                    overflow = true;
                }
                w = s = 0;
                power = 0x40000000000;
                if (--words <= 0) {
                    done = true;
                }
            }
        }
    } // while !done
    
    w += 0x1F*power;                // set group mark in register
    s++;
    count++;

    if (s > 0 && words > 0) {           // partial word left to be stored
        this.W = w;
        if (overflow) {
            this.AOFF = 1;              // for display only
            this.D26F = 1;              // address overflow: set invalid address error
            done = true;
        } else {
            this.store(addr);           // store the word in memory
        }
        words--;
        if (addr < 0x7FFF) {
            addr++;
        }
    }
    
    this.Daddress = addr;
    if (this.D23F) {
        this.DwordCount = words & 0x1FF;
    }
    return count;
};

/**************************************/
B5500IOUnit.prototype.finish = function () {
    /* Called to finish an I/O operation on this I/O Unit. Constructs and stores
    the result descriptor, sets the appropriate I/O Finished interrupt in CC */
    
    this.W = this.D = 
        this.Dunit *   0x10000000000 +
        this.DwordCount * 0x40000000 +
        this.D18F *       0x20000000 +
        this.D21F *        0x4000000 +
        this.D22F *        0x2000000 +
        this.D23F *        0x1000000 +
        this.D24F *         0x800000 +
        this.D26F *         0x200000 +
        this.D27F *         0x100000 +
        this.D28F *          0x80000 +
        this.D29F *          0x40000 +
        this.D30F *          0x20000 +
        this.D31F *          0x10000 +
        this.D32F *           0x8000 +
        this.Daddress;
    
    switch(this.ioUnitID) {
    case "1":
        this.store(0x0C);
        this.cc.CCI08F = 1;             // set I/O Finished #1
        break;
    case "2":
        this.store(0x0D);
        this.cc.CCI08F = 1;             // set I/O Finished #2
        break;
    case "3":
        this.store(0x0E);
        this.cc.CCI08F = 1;             // set I/O Finished #3
        break;
    case "4":
        this.store(0x0F);
        this.cc.CCI08F = 1;             // set I/O Finished #4
        break;
    }
    
    this.busy = 0;                      // zero so CC won't think I/O unit is busy
    this.busyUnit = 0;                  
    this.cc.signalInterrupt();
};

/**************************************/
B5500IOUnit.prototype.makeFinish = function(f) {
    /* Utility function to create a closure for I/O finish handlers */
    var that = this;
    
    return function(mask, length) {return f.call(that, mask, length)};
};

/**************************************/
B5500IOUnit.prototype.finishGeneric = function(errorMask, length) {
    /* Handles a generic I/O finish when no word-count update or input data
    transfer is needed. Can also be used to apply common error mask posting
    at the end of specialized finish handlers. Note that this turns off the
    busyUnit mask bit in CC */
    
    if (errorMask & 0x01) {this.D32F = 1}
    if (errorMask & 0x02) {this.D31F = 1}
    if (errorMask & 0x04) {this.D30F = 1}
    if (errorMask & 0x08) {this.D29F = 1}
    if (errorMask & 0x10) {this.D28F = 1}
    if (errorMask & 0x20) {this.D27F = 1}
    if (errorMask & 0x40) {this.D26F = 1}
    this.cc.setUnitBusy(this.busyUnit, 0);
    this.finish();
};

/**************************************/
B5500IOUnit.prototype.finishSPORead = function(errorMask, length) {
    /* Handles I/O finish for a SPO keyboard input operation */
    
    this.storeBufferWithGM(length, 0, 1, 0x7FFF);
    this.finishGeneric(errorMask, length);
};

/**************************************/
B5500IOUnit.prototype.finishDiskRead = function(errorMask, length) {
    /* Handles I/O finish for a DFCU data read operation */
    var segWords = Math.floor((length+7)/8);
    var memWords = (this.D23F ? this.DwordCount : segWords);
    
    if (segWords < memWords) {
        memWords = segWords;
    }
    this.storeBuffer(length, 0, this.D21F, memWords);
    this.finishGeneric(errorMask, length);
};

/**************************************/
B5500IOUnit.prototype.initiateDiskIO = function(u) {
    /* Initiates an I/O to the Disk File Control Unit. The disk address is fetched from
    the first word of the memory area and converted to binary for the DFCU module. Read
    check and interrogate operations are determined from their respective IOD bits. If
    it's a read data operation, we request the specified number of segments from the disk
    and will sort out word count issues in finishDiskRead(). If it's a write data operation,
    we truncate or pad the data from memory as appropriate and request a write of the 
    specified number of segments */
    var c;                              // address char
    var memWords;                       // number of memory words to transfer
    var p = 1;                          // address digit power
    var w;                              // current memory word value
    var x;                              // temp variable
    
    var segAddr = 0;                    // disk segment address
    var segs = this.LP;                 // I/O size in segments
    var segWords = segs*30;             // I/O size in words
    var segChars = segWords*8;          // I/O size in characters

    if (this.fetch(this.Daddress)) {    // fetch the segment address from first buffer word
        this.finish();
    } else {
        this.Daddress++;                // bump memory address past the seg address word
        w = this.W;                     // convert address word to binary
        for (x=0; x<7; x++) {
            c = w % 0x40;               // get low-order six bits of word
            segAddr += (c % 0x10)*p;    // isolate the numeric portion and accumulate
            w = (w-c)/0x40;             // shift word right six bits
            p *= 10;                    // bump power for next digit
        }

        if (this.D18F) {                // mem inhibit => read check operation
            u.readCheck(this.makeFinish(this.finishGeneric), segChars, segAddr);
        } else if (this.D23F && this.DwordCount == 0) {
            if (this.D24F) {            // read interrogate operation
                u.readInterrogate(this.makeFinish(this.finishGeneric), segAddr);
            } else {                    // write interrogate operation
                u.writeInterrogate(this.makeFinish(this.finishGeneric), segAddr);
            }
        } else if (this.D24F) {         // it's a read data operation
            u.read(this.makeFinish(this.finishDiskRead), this.buffer, segChars, this.D21F, segAddr);
        } else {                        // it's a write data operation
            memWords = (this.D23F ? this.DwordCount : segWords);
            if (segWords <= memWords) { // transfer size is limited by number of segs
                this.fetchBuffer(this.D21F, segWords);
            } else {                    // transfer size is limited by word count
                x = this.fetchBuffer(this.D21F, memWords);
                c = (this.D21F ? 0x00 : 0x2B);  // pad "0" if binary, " " if alpha (as BCL)
                while (x < segChars) {  // pad remainder of buffer up to seg count
                    this.buffer[x++] = c;
                }
            }
            u.write(this.makeFinish(this.finishGeneric), this.buffer, segChars, this.D21F, segAddr);
        }
    }
};

/**************************************/
B5500IOUnit.prototype.forkIO = function forkIO() {
    /* Asychrounously nitiates an I/O operation on this I/O Unit for a peripheral device */
    var addr;                           // memory address
    var chars;                          // I/O memory transfer length
    var index;                          // unit index
    var u;                              // peripheral unit object
    var x;                              // temp number variable

    this.forkHandle = null;             // clear the setTimeout() handle
    
    x = this.D;                         // explode the D-register into its fields
    this.Dunit = this.cc.fieldIsolate(x, 3, 5);
    this.DwordCount = this.cc.fieldIsolate(x, 8, 10);
    x = x % 0x40000000;                 // isolate low-order 30 bits
    this.D18F = (x >>> 29) & 1;         // memory inhibit
    this.D21F = (x >>> 26) & 1;         // mode
    this.D22F = (x >>> 25) & 1;         // direction (for tapes)
    this.D23F = (x >>> 24) & 1;         // use word counter
    this.D24F = (x >>> 23) & 1;         // write/read
    this.LP = (x >>> 15) & 0x3F;        // save control bits for disk, drum, and printer
    this.Daddress = x % 0x8000;

    this.busyUnit = index = B5500CentralControl.unitIndex[this.D24F & 1][this.Dunit & 0x1F];
    if (this.cc.testUnitBusy(index)) {
        this.D32F = 1;                  // set unit busy error
        this.finish();
    } else if (!this.cc.testUnitReady(index)) {
        this.D30F = 1;                  // set unit not-ready error
        this.finish();
    } else {
        this.cc.setUnitBusy(index, 1);
        u = this.cc.unit[index];
        switch(this.Dunit) {
        // disk designates
        case 6: 
        case 12:
            this.initiateDiskIO(u);
            break;

        // printer designates
        case 22: 
        case 26:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // datacom designate
        case 16:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // card #1 reader/punch
        case 10:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // card #2 reader
        case 14:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // SPO designate
        case 30:
            if (this.D24F) {
                u.read(this.makeFinish(this.finishSPORead), this.buffer, 0x7FFF, 0, 0);
            } else {
                chars = this.fetchBufferWithGM(1, 0x7FFF);
                u.write(this.makeFinish(this.finishGeneric), this.buffer, chars, 0, 0);
            }
            break;

        // magnetic tape designates
        case  1: case  3: case  5: case  7: case  9: case 11: case 13: case 15: 
        case 17: case 19: case 21: case 23: case 25: case 27: case 29: case 31:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // drum designates
        case 4: 
        case 8:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // paper tape designates
        case 18: 
        case 20:
            this.D30F = 1; this.finish(); // >>> temp until implemented <<<
            break;

        // illegal designates
        default:
            this.D30F = 1;      // report invalid unit as not ready
            this.finish();
            break;
        } // switch this.Dunit
    }
};

/**************************************/
B5500IOUnit.prototype.initiate = function() {
    /* Initiates an I/O operation on this I/O Unit. When P1 executes an IIO instruction,
    it calls the CentralControl.initiateIO() function, which selects an idle I/O Unit and
    calls this function for that unit. Thus, at entry we are still running on top of the
    processor. This routine merely fetches the IOD from memory and then schedules forkIO()
    to run asynchronously. Then we exit back through CC and into P1, thus allowing the 
    actual I/O operation to run asynchronously from the processor. Of course, in a browser
    environment, all of the Javascript action occurs on one thread, so this allows us to 
    multiplex what are supposed to be asynchronous operations on that thread */
    var that = this;                    // Establish object context for the callback
    
    this.clearD();
    this.AOFF = 0;
    this.EXNF = 0;
    this.D31F = 1;                      // preset IOD fetch error condition (cleared if successful)
    if (this.fetch(0x08)) {             // fetch the IOD address from @10
        this.finish();
    } else {
        this.EXNF = 1;
        this.Daddress = this.W % 0x8000;
        if (this.fetch(this.Daddress)) {// fetch the IOD from that address
            this.finish();
        } else {
            this.D31F = 0;              // reset the IOD-fetch error condition
            this.D = this.W;        
            this.forkHandle = setTimeout(function() {that.forkIO()}, 0);
        }
    }
};
