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

    this.scheduler = null;              // Reference to current setTimeout id
    this.accessor = {                   // Memory access control block
        requestorID: ioUnitID,             // Memory requestor ID
        addr: 0,                           // Memory address
        word: 0,                           // 48-bit data word
        MAIL: 0,                           // Truthy if attempt to access @000-@777 in normal state
        MPED: 0,                           // Truthy if memory parity error
        MAED: 0                            // Truthy if memory address/inhibit error
    };
    
    this.schedule.that = this;          // Establish context for when called from setTimeout()
    
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
        "0", "1", "2", "3", "4", "5", "6", "7",         // 00-07, @00-07
        "8", "9", "#", "@", "?", ":", ">", "}",         // 08-1F, @10-17
        "+", "A", "B", "C", "D", "E", "F", "G",         // 10-17, @20-27
        "H", "I", ".", "[", "&", "(", "<", "~",         // 18-1F, @30-37
        "|", "J", "K", "L", "M", "N", "O", "P",         // 20-27, @40-47
        "Q", "R", "$", "*", "-", ")", ";", "{",         // 28-2F, @50-57
        " ", "/", "S", "T", "U", "V", "W", "X",         // 30-37, @60-67
        "Y", "Z", ",", "%", "!", "=", "]", "\""];       // 38-3F, @70-77
        
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

/**************************************/
B5500IOUnit.prototype.clear = function() {
    /* Initializes (and if necessary, creates) the processor state */

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

    this.cycleCount = 0;                // Current cycle count for this.run()
    this.cycleLimit = 0;                // Cycle limit for this.run()
    this.totalCycles = 0;               // Total cycles executed on this I/O Unit
    this.ioUnitTime = 0;                // Total I/O Unit running time, based on cycles executed
    this.ioUnitSlack = 0;               // Total I/O Unit throttling delay, milliseconds
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

    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    acc.word = this.A;
    this.cc.store(acc);

    this.cycleCount += B5500IOUnit.memCycles;               
    if (acc.MAED) {
        return 1;
    } else if (acc.MPED) {
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
        return 1;
    } else {
        return 0;                       // no error
    }
};

/**************************************/
B5500IOUnit.prototype.fetchBuffer = function(mode, words) {
    /* Fetches words from memory starting at this.Daddress and coverts the
    BIC characters to ANSI in this.buffer. "mode": 0=alpha, 1=binary; 
    "words": maximum number of words to transfer. In alpha mode, the transfer
    can be terminated by a group-mark code in memory. At exit, updates this.Daddress 
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
    var w;                              // local copy of this.W
    
    do {                                // loop through the words
        if (words <= 0) {
            done = true;
        } else {
            words--;
            if (overflow) {
                this.AOFF = 1;          // for display onlly
                this.D26F = 1;          // address overflow: set invalid address error
                done = true;
            } else if (this.fetch(addr)) { // fetch the next word from memory
                if (this.accessor.MAED) {
                    this.D26F = 1;      // set invalid address error
                }
                if (this.accessor.MPED) {
                    this.D29F = 1;      // set memory parity error
                }
            } else {                    // fill the buffer with this word's characters
                w = this.W;
                for (s=0; s<8; s++) {
                    c = (w - (w %= 0x40000000000))/0x40000000000;
                    if (mode || c != 0x1F) {        // if binary mode or not a group-mark
                        buf[count++] = B5500IOUnit.BICtoANSI[c];
                        w *= 64;                    // shift word left 6 bits
                    } else {
                        done = true;                // group-mark detected in alpha mode
                        break;
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
        this.DwordCount = words % 0x1FF;
    }
    return count;
};

/**************************************/
B5500IOUnit.prototype.storeBuffer = function(chars, offset, mode, words) {
    /* Converts characters in this.buffer from ANSI to BIC, assembles them into
    words, and stores the words into memory starting at this.Daddress.
    BIC characters to ANSI in this.buffer. "chars": the number of characters to 
    stort, starting at "offset" in the buffer; "mode": 0=alpha, 1=binary; 
    "words": maximum number of words to transfer. In alpha mode, the final character
    stored from the buffer is followed by a group-mark, assuming the word count is
    not exhausted. At exit, updates this.Daddress with the final transfer address+1. 
    If this.D23F, updates this.wordCount with any remaining count.
    Returns the number of characters stored into memory from the buffer */
    var addr = this.Daddress;           // local copy of memory address
    var buf = this.buffer;              // local pointer to buffer
    var c;                              // current character code
    var count = 0;                      // number of characters fetched
    var done = (words > 0);             // loop control
    var overflow = false;               // memory address overflowed max
    var power = 0x40000000000;          // factor for character shifting into a word
    var s = 8;                          // character shift counter
    var w = 0;                          // local copy of this.W
    
    while (!done) {                                // loop through the words
        if (count >= chars) {
            done = true;
        } else {
            c = B5500IOUnit.ANSItoBIC[buf[offset+(count++)]];
            w += c*power;
            power /= 64;
            if (--s <= 0) {
                this.W = w;
                if (overflow) {
                    this.D26F = 1;      // address overflow: set invalid address error
                    done = true;
                } else if (this.store(addr)) { // store the word in memory
                    if (this.accessor.MAED) {
                        this.D26F = 1;  // set invalid address error
                    }
                }
                if (addr < 0x7FFF) {
                    addr++;
                } else {
                    overflow = true;
                }
                s = 8;
                w = 0;
                power = 0x40000000000;
                if (--words <= 0) {
                    done = true;
                }
            }
        }
    } // while !done
    
    if (!mode) {                        // alpha transfer terminates with a group-mark
        w += 0x1F*power;                // set group mark in register
        s--;
        count++;
    }
    if (s < 8 && words > 0) {           // partial word left to be stored
        this.W = w;
        if (overflow) {
            this.D26F = 1;              // address overflow: set invalid address error
            done = true;
        } else if (this.store(addr)) {  // store the word in memory
            if (this.accessor.MAED) {
                this.D26F = 1;          // set invalid address error
            }
        }
        words--;
        if (addr < 0x7FFF) {
            addr++;
        }
    }
    
    this.Daddress = addr;
    if (this.D23F) {
        this.DwordCount = words % 0x1FF;
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
        this.Daddressf;
    
    switch(ioUnitID) {
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
    
    this.Dunit = 0;                     // zero so CC won't think unit is busy
};

/**************************************/
B5500IOUnit.prototype.initiate = function() {
    /* Initiates an I/O operation on this I/O Unit */
    var addr;                           // memory address
    var x;
    
    this.clearD();
    this.AOFF = 0;
    this.EXNF = 0;
    this.D31F = 1;                      // preset IOD fetch error condition (cleared if successful)
    if (this.fetch(0x08)) {             // fetch the IOD address from @10
        this.finish();
    } else {
        this.EXNF = 1;
        this.Daddress = addr = this.W % 0x7FFF;
        if (this.fetch(addr)) {         // fetch the IOD from that address
            this.finish();
        } else {
            this.D31F = 0;              // reset the IOD-fetch error condition
            this.D = x = this.W;        // explode the D-register into its fields
            this.Dunit = this.cc.fieldIsolate(x, 3, 5);
            this.DwordCount = this.cc.fieldIsolate(x, 8, 10);
            x = x % 0x40000000;         // isolate low-order 30 bits
            this.D18F = (x >>> 29) & 1; // memory inhibit
            this.D21F = (x >>> 26) & 1; // mode
            this.D22F = (x >>> 25) & 1; // direction (for tapes)
            this.D23F = (x >>> 24) & 1; // use word counter
            this.D24F = (x >>> 23) & 1; // write/read
            this.LP = (x >>> 15) & 0x3F;// save control bits for drum and printer
            this.Daddress = x % 0x7FFF;
            if (this.cc.testUnitBusy(this.ioUnitID, this.Dunit)) {
                this.D32F = 1;          // set unit busy error
                this.finish();
            } else if (!this.cc.testUnitReady(this.D24F, this.Dunit)) {
                this.D30F = 1;          // set unit not-ready error
                this.finish();
            } else {
                switch(this.Dunit) {
                // disk designates
                case 6: 
                case 12:
                    this.D30F = 1; this.finish(); // >>> temp until implemented <<<
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
                    this.D30F = 1; this.finish(); // >>> temp until implemented <<<
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
        }
    }
};

/**************************************/
B5500IOUnit.prototype.run = function() {
};

/**************************************/
B5500IOUnit.prototype.schedule = function schedule() {
    /* Schedules the I/O Unit run time and attempts to throttle performance
    to approximate that of a real B5500. Well, at least we hope this will run
    fast enough that the performance will need to be throttled. It establishes
    a timeslice in terms of a number of I/O Unit "cycles" of 1 microsecond
    each and calls run() to execute at most that number of cycles. run()
    counts up cycles until it reaches this limit or some terminating event
    (such as a halt), then exits back here. If the I/O Unit remains active,
    this routine will reschedule itself for an appropriate later time, thereby
    throttling the performance and allowing other modules a chance at the
    Javascript execution thread. */
    var delayTime;
    var that = schedule.that;

    that.scheduler = null;
    that.cycleLimit = B5500IOUnit.timeSlice;
    that.cycleCount = 0;

    that.run();

    that.totalCycles += that.cycleCount
    that.ioUnitTime += that.cycleCount;
    if (that.busy) {
        delayTime = that.ioUnitTime/1000 - new Date().getTime();
        that.ioUnitSlack += delayTime;
        that.scheduler = setTimeout(that.schedule, (delayTime < 0 ? 1 : delayTime));
    }
};
