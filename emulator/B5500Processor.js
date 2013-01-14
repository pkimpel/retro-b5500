/***********************************************************************
* retro-b5500/emulator B5500Processor.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Processor (CPU) module.
*
* Instance variables in all caps generally refer to register or flip-flop (FF)
* entities in the processor hardware. See the Burroughs B5500 Reference Manual
* (1021326, May 1967) and B5281 Processor Training Manual (B5281.55, August 1966)
* for details:
* http://bitsavers.org/pdf/burroughs/B5000_5500_5700/1021326_B5500_RefMan_May67.pdf
* http://bitsavers.org/pdf/burroughs/B5000_5500_5700/B5281.55_ProcessorTrainingManual_Aug66.pdf
*
* B5500 word format: 48 bits plus (hidden) parity.
*   Bit 0 is high-order, bit 47 is low-order, big-endian character ordering.
*       [0:1]   Flag bit (1=control word or descriptor)
*       [1:1]   Mantissa sign bit (1=negative)
*       [2:1]   Exponent sign bit (1=negative)
*       [3:6]   Exponent (power of 8, signed-magnitude)
*       [9:39]  Mantissa (signed-magnitude, scaling point after bit 47)
*
************************************************************************
* 2012-06-03  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500Processor(procID, cc) {
    /* Constructor for the Processor module object */

    this.processorID = procID;          // Processor ID ("A" or "B")
    this.cc = cc;                       // Reference back to Central Control module
    this.scheduler = null;              // Reference to current setTimeout id
    this.accessor = {                   // Memory access control block
        requestorID: procID,               // Memory requestor ID
        addr: 0,                           // Memory address
        word: 0,                           // 48-bit data word
        MAIL: 0,                           // Truthy if attempt to access @000-@777 in normal state
        MPED: 0,                           // Truthy if memory parity error
        MAED: 0                            // Truthy if memory address/inhibit error
    };
    this.schedule.that = this;          // Establish context for when called from setTimeout()

    this.clear();                       // Create and initialize the processor state
}

/**************************************/

B5500Processor.timeSlice = 5000;        // Standard run() timeslice, about 5ms (we hope) 
B5500Processor.memCycles = 6;           // assume 6 us memory cycle time (the other option was 4 usec)

B5500Processor.collation = [            // index by BIC to get collation value
    53, 54, 55, 56, 57, 58, 59, 60,             // @00: 0 1 2 3 4 5 6 7
    61, 62, 19, 20, 63, 21, 22, 23,             // @10: 8 9 # @ ? : > }
    24, 25, 26, 27, 28, 29, 30, 31,             // @20: + A B C D E F G
    32, 33,  1,  2,  6,  3,  4,  5,             // @30: H I . [ & ( < ~
    34, 35, 36, 37, 38, 39, 40, 41,             // @40: | J K L M N O P
    42, 43,  7,  8, 12,  9, 10, 11,             // @50: Q R $ * - ) ; {
     0, 13, 45, 46, 47, 48, 49, 50,             // @60: _ / S T U V W X  (_ = blank)
    51, 52, 14, 15, 44, 16, 17, 18];            // @70: Y Z , % ! = ] "

/**************************************/
B5500Processor.prototype.clear = function() {
    /* Initializes (and if necessary, creates) the processor state */

    this.A = 0;                         // Top-of-stack register A
    this.AROF = 0;                      // A Register Occupied FF
    this.B = 0;                         // Top-of-stack register B
    this.BROF = 0;                      // B Register Occupied FF
    this.C = 0;                         // Current program instruction word address
    this.CCCF = 0;                      // Clock-count control FF (maintenance only)
    this.CWMF = 0;                      // Character/word mode FF (1=CM)
    this.E = 0;                         // Memory access control register
    this.EIHF = 0;                      // E-register Inhibit Address FF
    this.F = 0;                         // Top MSCW/RCW stack address
    this.G = 0;                         // Character index register for A
    this.H = 0;                         // Bit index register for G (in A)
    this.HLTF = 0;                      // Processor halt FF
    this.I = 0;                         // Processor interrupt register
    this.K = 0;                         // Character index register for B
    this.L = 0;                         // Instruction syllable index in P
    this.M = 0;                         // Memory address register (SI.w in CM)
    this.MRAF = 0;                      // Memory read access FF
    this.MROF = 0;                      // Memory read obtained FF
    this.MSFF = 0;                      // Mark-stack FF (word mode: MSCW is pending RCW, physically also TFFF & Q12F)
    this.MWOF = 0;                      // Memory write obtained FF
    this.N = 0;                         // Octal shift counter for B
    this.NCSF = 0;                      // Normal/control state FF (1=normal)
    this.P = 0;                         // Current program instruction word register
    this.PROF = 0;                      // P contents valid
    this.Q = 0;                         // Misc. FFs (bits 1-9 only: Q07F=hardware-induced interrupt, Q09F=enable parallel adder for R-relative addressing)
    this.R = 0;                         // High-order 9 bits of PRT base address (TALLY in char mode)
    this.S = 0;                         // Top-of-stack memory address (DI.w in CM)
    this.SALF = 0;                      // Program/subroutine state FF (1=subroutine)
    this.T = 0;                         // Current program syllable register
    this.TM = 0;                        // Temporary maintenance storage register
    this.TROF = 0;                      // T contents valid
    this.V = 0;                         // Bit index register for K (in B)
    this.VARF = 0;                      // Variant-mode FF (enables full PRT indexing)
    this.X = 0;                         // Mantissa extension for B (loop control in CM)
    this.Y = 0;                         // Serial character register for A
    this.Z = 0;                         // Serial character register for B
    
    this.US14X = 0;                     // STOP OPERATOR switch

    this.cycleCount = 0;                // Current cycle count for this.run()
    this.cycleLimit = 0;                // Cycle limit for this.run()
    this.totalCycles = 0;               // Total cycles executed on this processor
    this.procTime = 0;                  // Total processor running time, based on cycles executed
    this.procSlack = 0;                 // Total processor throttling delay, milliseconds
    this.busy = 0;                      // Processor is running, not idle or halted
};

/**************************************/
B5500Processor.prototype.access = function(eValue) {
    /* Access memory based on the E register. If the processor is in normal
    state, it cannot access the first 512 words of memory => invalid address */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = eValue;                    // Just to show the world what's happening
    switch (eValue) {
    case 0x02:                          // A = [S]
        acc.addr = this.S;
        acc.MAIL = (this.S < 0x0200 && this.NCSF);
        this.cc.fetch(acc);
        this.A = acc.word;
        this.AROF = 1;
        break;
    case 0x03:                          // B = [S]
        acc.addr = this.S;
        acc.MAIL = (this.S < 0x0200 && this.NCSF);
        this.cc.fetch(acc);
        this.B = acc.word;
        this.BROF = 1;
        break;
    case 0x04:                          // A = [M]
        acc.addr = this.M;
        acc.MAIL = (this.M < 0x0200 && this.NCSF);
        this.cc.fetch(acc);
        this.A = acc.word;
        this.AROF = 1;
        break;
    case 0x05:                          // B = [M]
        acc.addr = this.M;
        acc.MAIL = (this.M < 0x0200 && this.NCSF);
        this.cc.fetch(acc);
        this.B = acc.word;
        this.BROF = 1;
        break;
    case 0x06:                          // M = [M].[18:15]
        acc.addr = this.M;
        acc.MAIL = (this.M < 0x0200 && this.NCSF);
        this.cc.fetch(acc);
        this.M = ((acc.word % 0x40000000) >>> 15) & 0x7FFF;
        break;
    case 0x0A:                          // [S] = A
        acc.addr = this.S;
        acc.MAIL = (this.S < 0x0200 && this.NCSF);
        acc.word = this.A;
        this.cc.store(acc);
        break;
    case 0x0B:                          // [S] = B
        acc.addr = this.S;
        acc.MAIL = (this.S < 0x0200 && this.NCSF);
        acc.word = this.B;
        this.cc.store(acc);
        break;
    case 0x0C:                          // [M] = A
        acc.addr = this.M;
        acc.MAIL = (this.M < 0x0200 && this.NCSF);
        acc.word = this.A;
        this.cc.store(acc);
        break;
    case 0x0D:                          // [M] = B
        acc.addr = this.M;
        acc.MAIL = (this.M < 0x0200 && this.NCSF);
        acc.word = this.B;
        this.cc.store(acc);
        break;
    case 0x30:                          // P = [C]
        acc.addr = this.C;
        acc.MAIL = (this.C < 0x0200 && this.NCSF);
        this.cc.fetch(acc);
        this.P = acc.word;
        this.PROF = 1;
        break;
    default:
        throw "Invalid E-register value: " + eValue.toString(2);
        break;
    }

    this.cycleCount += B5500Processor.memCycles;               
    if (acc.MAED) {
        this.I |= 0x02;                 // set I02F - memory address/inhibit error
        if (this.NCSF || this !== this.cc.P1) {
            this.cc.signalInterrupt();
        } else {
            this.busy = 0;              // P1 invalid address in control state stops the proc
            this.cycleLimit = 0;        // exit this.run()
        }
    } else if (acc.MPED) {
        this.I |= 0x01;                 // set I01F - memory parity error
        if (this.NCSF || this !== this.cc.P1) {
            this.cc.signalInterrupt();
        } else {
            this.busy = 0;              // P1 memory parity in control state stops the proc
            this.cycleLimit = 0;        // exit this.run()
        }
    }
};

/**************************************/
B5500Processor.prototype.accessCheck = function() {
    /* Common error checking routine for all memory acccesses */

    if (this.accessor.MAED) {
        this.I |= 0x02;                 // set I02F - memory address/inhibit error
        if (this.NCSF || this !== this.cc.P1) {
            this.cc.signalInterrupt();
        } else {
            this.busy = 0;              // P1 invalid address in control state stops the proc
            this.cycleLimit = 0;        // exit this.run()
        }
    } else if (this.accessor.MPED) {
        this.I |= 0x01;                 // set I01F - memory parity error
        if (this.NCSF || this !== this.cc.P1) {
            this.cc.signalInterrupt();
        } else {
            this.busy = 0;              // P1 memory parity in control state stops the proc
            this.cycleLimit = 0;        // exit this.run()
        }
    }
};

/**************************************/
B5500Processor.prototype.loadAviaS = function() {
    /* Load the A register from the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x02;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.A = acc.word;
    this.AROF = 1;
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
};        

/**************************************/
B5500Processor.prototype.loadBviaS = function() {
    /* Load the B register from the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x03;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.B = acc.word;
    this.BROF = 1;
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.loadAviaM = function() {
    /* Load the A register from the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x04;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.A = acc.word;
    this.AROF = 1;
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.loadBviaM = function() {
    /* Load the B register from the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x05;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.B = acc.word;
    this.BROF = 1;
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.loadMviaM = function() {
    /* Load the M register from bits [18:15] of the word addressed by M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x06;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.M = ((acc.word % 0x40000000) >>> 15) & 0x7FFF;
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.loadPviaC = function() {
    /* Load the P register from the address in C */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x30;                      // Just to show the world what's happening
    acc.addr = this.C;
    acc.MAIL = (this.C < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.P = acc.word;
    this.PROF = 1;
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.storeAviaS = function() {
    /* Store the A register at the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0A;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    acc.word = this.A;
    this.cc.store(acc);
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.storeBviaS = function() {
    /* Store the B register at the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0B;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    acc.word = this.B;
    this.cc.store(acc);
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.storeAviaM = function() {
    /* Store the A register at the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0C;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    acc.word = this.A;
    this.cc.store(acc);
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.storeBviaM = function() {
    /* Store the B register at the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0D;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    acc.word = this.B;
    this.cc.store(acc);
    this.cycleCount += B5500Processor.memCycles; 
    if (acc.MAED || acc.MPED) {
        this.accessCheck();
    }
}; 

/**************************************/
B5500Processor.prototype.adjustAEmpty = function() {
    /* Adjusts the A register so that it is empty, pushing the prior
    contents of A into B and B into memory, as necessary. */

    if (this.AROF) {
        if (this.BROF) {
            if ((this.S >>> 6) == this.R && this.NCSF) {
                this.I |= 0x04;         // set I03F: stack overflow
                this.cc.signalInterrupt();
            } else {
                this.S++;
                this.storeBviaS();      // [S] = B
            }
        }
        this.B = this.A;
        this.AROF = 0;
        this.BROF = 1;
    // else we're done -- A is already empty
    }
};

/**************************************/
B5500Processor.prototype.adjustAFull = function() {
    /* Adjusts the A register so that it is full, popping the contents of
    B or [S] into A, as necessary. */

    if (!this.AROF) {
        if (this.BROF) {
            this.A = this.B;
            this.AROF = 1;
            this.BROF = 0;
        } else {
            this.loadAviaS();           // A = [S]
            this.S--;
        }
    // else we're done -- A is already full
    }
};

/**************************************/
B5500Processor.prototype.adjustBEmpty = function() {
    /* Adjusts the B register so that it is empty, pushing the prior
    contents of B into memory, as necessary. */

    if (this.BROF) {
        if ((this.S >>> 6) == this.R && this.NCSF) {
            this.I |= 0x04;             // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            this.BROF = 0;
            this.S++;
            this.storeBviaS();          // [S] = B
        }
    // else we're done -- B is already empty
    }
};

/**************************************/
B5500Processor.prototype.adjustBFull = function() {
    /* Adjusts the B register so that it is full, popping the contents of
    [S] into B, as necessary. */

    if (!this.BROF) {
        this.loadBviaS();               // B = [S]
        this.S--;
    // else we're done -- B is already full
    }
};

/**************************************/
B5500Processor.prototype.adjustABEmpty = function() {
    /* Adjusts the A and B registers so that both are empty, pushing the 
    prior contents into memory, as necessary. */

    if (this.BROF) {
        this.BROF = 0;
        if ((this.S >>> 6) == this.R && this.NCSF) {
            this.I |= 0x04;         // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            this.S++;
            this.storeBviaS();      // [S] = B
        }
    }
    if (this.AROF) {
        this.AROF = 0;
        if ((this.S >>> 6) == this.R && this.NCSF) {
            this.I |= 0x04;         // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            this.S++;
            this.storeAviaS();      // [S] = A
        }
    }
};

/**************************************/
B5500Processor.prototype.adjustABFull = function() {
    /* Ensures both TOS registers are occupied, pushing up from memory as required */

    if (this.AROF) {
        if (this.BROF) {
            // A and B are already full, so we're done
        } else {
            // A is full and B is empty, so load B from [S]
            this.loadBviaS();           // B = [S]
            this.S--;
        }
    } else {
        if (this.BROF) {
            // A is empty and B is full, so copy B to A and load B from [S]
            this.A = this.B;
            this.AROF = 1;
        } else {
            // A and B are empty, so simply load them from [S]
            this.loadAviaS();           // A = [S]
            this.S--;
        }
        this.loadBviaS();               // B = [S]
        this.S--;
    }
};

/**************************************/
B5500Processor.prototype.exchangeTOS = function() {
    /* Exchanges the two top-of-stack values */
    var temp;

    if (this.AROF) {
        if (this.BROF) {
            // A and B are full, so simply exchange them
            temp = this.A;
            this.A = this.B;
            this.B = temp;
        } else {
            // A is full and B is empty, so push A to B and load A from [S]
            this.B = this.A;
            this.BROF = 1;
            this.loadAviaS();           // A = [S]
            this.S--;
        }
    } else {
        if (this.BROF) {
            // A is empty and B is full, so load A from [S]
            this.loadAviaS();           // A = [S]
            this.S--;
        } else {
            // A and B are empty, so simply load them in reverse order
            this.loadBviaS();           // B = [S]
            this.S--;
            this.loadAviaS();           // A = [S]
            this.S--;
        }
    }
};

/**************************************/
B5500Processor.prototype.jump = function(count, byWords) {
    /* Adjusts the C and L registers by "count" (which may be negative).
    If "byWords" is true, the adjustment is by words and L is set to 0.
    Initiates a fetch to reload the P register after C and L are adjusted.
    On entry, C and L are assumed to be pointing to the next instruction
    to be executed, not the current one */
    var addr;
    
    if (byWords) {
        this.C += count;
        this.L = 0;
    } else {
        addr = this.C*4 + this.L + count;
        this.C = addr >>> 2;
        this.L = addr & 0x03;
    }
    this.loadPviaC();                   // P = [C]
};

/**************************************/
B5500Processor.prototype.jumpOutOfLoop = function(count) {
    /* Terminates the current character-mode loop by restoring the prior LCW 
    (or RCW) from the stack to X. If "count" is not zero, adjusts C & L forward
    by that number of syllables and reloads P to branch to the jump-out location,
    otherwise continues in sequence. Uses A to restore X and invalidates A */
    var t1 = this.S;                    // save S (not the way the hardware did it)

    this.cycleCount += 2;
    this.S = this.cc.fieldIsolate(this.X, 18, 15);      // get prior LCW addr from X value
    this.loadAviaS();                   // A = [S], fetch prior LCW from stack
    if (count) {
        this.cycleCount += (count >>> 2) + (count & 0x03);
        this.jump(count, false);
    }
    this.X = this.A % 0x8000000000;     // store prior LCW (39 bits: less control bits) in X
    this.S = t1;                        // restore S
    this.AROF = 0;                      // invalidate A
};

/**************************************/
B5500Processor.prototype.streamAdjustSourceChar = function() {
    /* Adjusts the character-mode source pointer to the next character
    boundary, as necessary. If the adjustment crosses a word boundary,
    AROF is reset to force reloading later at the new source address */

    if (this.H > 0) {
        this.H = 0;
        if (this.G < 7) {
            this.G++;
        } else {
            this.G = 0;
            this.AROF = 0;
            this.M++;
        }
    }
};

/**************************************/
B5500Processor.prototype.streamAdjustDestChar = function() {
    /* Adjusts the character-mode destination pointer to the next character
    boundary, as necessary. If the adjustment crosses a word boundary and
    BROF is set, B is stored at S before S is incremented and BROF is reset
    to force reloading later at the new destination address */

    if (this.V > 0) {
        this.V = 0;
        if (this.K < 7) {
            this.K++;
        } else {
            this.K = 0;
            if (this.BROF) {
                this.storeBviaS();      // [S] = B
                this.BROF = 0;
            }
            this.S++;
        }
    }
};

/**************************************/
B5500Processor.prototype.compareSourceWithDest = function(count) {
    /* Compares source characters to destination characters according to the 
    processor collating sequence. 
    "count" is the number of source characters to process.
    The result of the comparison is left in two flip-flops:
        Q03F=1: an inequality was detected
        MSFF=1: the inequality was source > destination
    If the two strings are equal, Q03F and MSFF will both be zero. Once an 
    inequality is encountered, Q03F will be set to 1 and MSFF (also known as 
    TFFF) will be set based on the nature of inequality. After this point, the 
    processor merely advances its address pointers to exhaust the count and does 
    not fetch additional words from memory. Note that the processor uses Q04F to 
    inhibit storing the B register at the end of a word boundary. This store 
    may be required only for the first word in the destination string, if B may 
    have been left in an updated state by a prior syllable */
    var aBit;                           // A register bit nr
    var bBit;                           // B register bit nr

    this.MSFF = 0;
    this.streamAdjustSourceChar();
    this.streamAdjustDestChar();
    if (count) {
        if (this.BROF) {
            if (this.K == 0) {
                this.Q |= 0x08;         // set Q04F -- at start of word, no need to store B later
            }
        } else {
            this.loadBviaS();           // B = [S]
            this.Q |= 0x08;             // set Q04F -- just loaded B, no need to store it later
        }
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        
        // setting Q06F and saving the count in H & V is only significant if this
        // routine is executed as part of Field Add (FAD) or Field Subtract (FSU).
        this.Q |= 0x20;                 // set Q06F
        this.H = count >>> 3;
        this.V = count & 0x07;
        
        aBit = this.G*6;                // A-bit number
        bBit = this.K*6;                // B-bit number
        do {
            this.cycleCount++;          // approximate the timing
            if (this.Q & 0x04) {        // inequality already detected -- just count down
                if (count >= 8) {
                    count -= 8;
                    if (!(this.Q & 0x08)) {     // test Q04F to see if B may be dirty
                        this.storeBviaS();      // [S] = B
                        this.Q |= 0x08;         // set Q04F so we won't store B anymore
                    }
                    this.BROF = 0;
                    this.S++;
                    this.AROF = 0;
                    this.M++;
                } else {
                    count--;
                    if (this.K < 7) {
                        this.K++;
                    } else {
                        if (!(this.Q & 0x08)) { // test Q04F to see if B may be dirty
                            this.storeBviaS();  // [S] = B
                            this.Q |= 0x08;     // set Q04F so we won't store B anymore
                        }
                        this.K = 0;
                        this.BROF = 0;
                        this.S++;
                    }
                    if (this.G < 7) {
                        this.G++;
                    } else {
                        this.G = 0;
                        this.AROF = 0;
                        this.M++;
                    }
                }
            } else {                    // strings still equal -- check this character
                if ((this.Y = this.cc.fieldIsolate(this.A, aBit, 6)) != (this.Z = this.cc.fieldIsolate(this.B, bBit, 6))) {
                    this.Q |= 0x04;     // set Q03F to stop further comparison
                    this.MSFF = (B5500Processor.collate[this.Y] > B5500Processor.collate[this.Z] ? 1 : 0);
                } else {                // strings still equal -- advance to next character
                    count--;
                    if (bBit < 42) {
                        bBit += 6;
                        this.K++;
                    } else {
                        bBit = 0;
                        this.K = 0;
                        if (!(this.Q & 0x08)) { // test Q04F to see if B may be dirty
                            this.storeBviaS();  // [S] = B
                            this.Q |= 0x08;     // set Q04F so we won't store B anymore
                        }
                        this.S++;
                        this.loadBviaS();       // B = [S]
                    }
                    if (aBit < 42) {
                        aBit += 6;
                        this.G++;
                    } else {
                        aBit = 0;
                        this.G = 0;
                        this.M++;
                        this.loadAviaM();       // A = [M]
                    }
                }
            }
        } while (count);
    }
};

/**************************************/
B5500Processor.prototype.fieldArithmetic = function(count, adding) {
    /* Handles the Field Add (FAD) or Field Subtract (FSU) syllables.
    "count" indicates the length of the fields to be operated upon.
    "adding" will be false if this call is for FSU, otherwise it's for FAD */
    var aBit;                           // A register bit nr
    var bBit;                           // B register bit nr
    var carry = 0;                      // carry/borrow bit
    var compl = false;                  // complement addition (i.e., subtract the digits)
    var MSFF = (this.MSFF != 0);        // get TFFF as a Boolean
    var Q03F = (this.Q & 0x04 != 0);    // get Q03F as a Boolean
    var resultNegative;                 // sign of result is negative
    var sd;                             // digit sum
    var ycompl = false;                 // complement source digits
    var yd;                             // source digit
    var zcompl = false;                 // complement destination digits
    var zd;                             // destination digit
    
    this.compareSourceWithDest(count);
    this.cycleCount += 2;               // approximate the timing thus far
    if (this.Q & 0x20) {                // Q06F => count > 0, so there's characters to add
        this.Q &= ~(0x28);              // reset Q06F and Q04F
        
        // Back down the pointers to the last characters of their respective fields
        if (this.K > 0) {
            this.K--;
        } else {
            this.K = 7;
            this.BROF = 0;
            this.S--;
        }
        if (this.G > 0) {
            this.G--;
        } else {
            this.G = 7;
            this.AROF = 0;
            this.M--;
        }
        
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        
        this.Q |= 0x80;                 // set Q08F (for display only)
        aBit = this.G*6;                // A-bit number
        bBit = this.K*6;                // B-bit number
        yd = this.cc.fieldIsolate(this.A, aBit, 2);     // get the source sign
        zd = this.cc.fieldIsolate(this.B, bBit, 2);     // get the dest sign
        compl = (yd == zd ? !adding : adding );         // determine if complement needed
        resultNegative = !(                             // determine sign of result
                (zd == 0 && !compl) || 
                (zd == 0 && Q03F && !MSFF) ||
                (zd != 0 && compl && Q03F && MSFF ) ||
                (compl && !Q03F));
        if (compl) {
            this.Q |= 0x42;             // set Q07F and Q02F (for display only)
            carry = 1;                  // preset the carry/borrow bit (Q07F)        
            if (MSFF) {
                this.Q |= 0x08;         // set Q04F (for display only)
                zcompl = true;
            } else {
                ycompl = true;
            }
        }
        
        this.MSFF = 0;                  // reset TFFF so it can ultimately indicate overflow
        this.cycleCount += 4;
        do {
            count--;
            this.cycleCount += 2;
            yd = this.cc.fieldIsolate(this.A, aBit+2, 4);             // get the source sign
            zd = this.cc.fieldIsolate(this.B, bBit+2, 4);             // get the dest sign
            sd = (ycompl ? 9-yd : yd) + (zcompl ? 9-zd : zd) + carry; // develop binary digit sum
            if (sd <= 9) {
                carry = this.MSFF = 0;
            } else {
                carry = this.MSFF = 1;
                sd -= 10;
            }
            if (resultNegative) {
                sd += 0x20;             // set sign (BA) bits in char to binary 10
                resultNegative = false;
            }
            
            this.cc.fieldInsert(this.B, bBit, 6, sd);
            
            if (count == 0) {
                this.storeBviaS();      // [S] = B, store final dest word
            } else {
                if (bBit > 0) {
                    bBit -= 6;
                    this.K--;
                } else {
                    bBit = 42;
                    this.K = 7;
                    this.storeBviaS();  // [S] = B
                    this.S--;
                    this.loadBviaS();   // B = [S]
                }
                if (aBit > 0) {
                    aBit -= 6;
                    this.G--;
                } else {
                    aBit = 42;
                    this.G = 7;
                    this.M--;
                    this.loadAviaM();   // A = [M]
                }
            }
        } while (count);
        
        // Now restore the character pointers
        count = this.H*8 + this.V;
        while (count >= 8) {
            count -= 8;
            this.cycleCount++;
            this.S++;
            this.M++;
        } 
        this.cycleCount += count;
        while (count > 0) {
            count--;
            if (this.K < 7) {
                this.K++;
            } else {
                this.K = 0;
                this.S++;
            }
            if (this.G < 7) {
                this.G++;
            } else {
                this.G = 0;
                this.M++;
            }
        }
        this.AROF = this.BROF = 0;
        this.H = this.V = this.N = 0;
    }
};

/**************************************/
B5500Processor.prototype.streamBitsToDest = function(count, mask) {
    /* Streams a pattern of bits to the destination specified by S, K, and V,
    as supplied by the 48-bit "mask" argument. Partial words are filled from
    the low-order bits of the mask. Implements the guts of Character-Mode 
    Bit Set (XX64) and Bit Reset (XX65). Leaves the registers pointing at the 
    next bit in sequence */
    var bn;                             // field starting bit number
    var fl;                             // field length in bits
    
    if (count) {
        this.cycleCount += count;
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        do {
            bn = this.K*6 + this.V;     // starting bit nr.
            fl = 48-bn;                 // bits remaining in the word
            if (count < fl) {
                fl = count;
            }
            if (fl < 48) {
                this.B = this.cc.fieldInsert(this.B, bn, fl, mask);
            } else {
                this.B = mask;          // set the whole word
            }
            count -= fl;                // decrement by number of bits modified
            bn += fl;                   // increment the starting bit nr.
            if (bn < 48) {
                this.V = bn % 6;
                this.K = (bn - this.V)/6;
            } else {
                this.K = this.V = 0;
                this.storeBviaS();      // [S] = B, save the updated word
                this.S++;
                if (count > 0) {
                    this.loadBviaS();   // B = [S], fetch next word in sequence
                } else {
                    this.BROF = 0;
                }
            }
        } while (count);
    }
};

/**************************************/
B5500Processor.prototype.streamSourceToDest = function(count, transform) {
    /* General driver for character-mode character transfers from source to
    destination, such as TRS or TRZ. 
    "count" is the number of source characters to transfer.
    "transform" is a function(bBit, count) that determines how the characters 
    are transferred from the source (A) to destination (B). The Y register will 
    contain the current char during this call */
    var aBit;                           // A register bit nr
    var bBit;                           // B register bit nr

    this.streamAdjustSourceChar();
    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        this.cycleCount += count;       // approximate the timing
        aBit = this.G*6;                // A-bit number
        bBit = this.K*6;                // B-bit number
        do {
            this.Y = this.cc.fieldIsolate(this.A, aBit, 6);
            transform(bBit, count)
            count--;
            if (bBit < 42) {
                bBit += 6;
                this.K++;
            } else {
                bBit = 0;
                this.K = 0;
                this.storeBviaS();      // [S] = B
                this.S++;
                if (count < 8) {        // only need to load B if a partial word is left
                    this.loadBviaS();   // B = [S]
                }
            }
            if (aBit < 42) {
                aBit += 6;
                this.G++;
            } else {
                aBit = 0;
                this.G = 0;
                this.M++;
                this.loadAviaM();       // A = [M]
            }
        } while (count)
    }
};

/**************************************/
B5500Processor.prototype.streamToDest = function(count, transform) {
    /* General driver for character-mode character operations on the destination 
    from a non-A register source, such as TBN. 
    "count" is the number of characters to transfer. 
    "transform" is a function(bBit, count) that determines how the characters 
    are stored to the destination (B). Returning truthy terminates the process 
    without incrementing the destination address */
    var bBit;                           // B register bit nr

    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        this.cycleCount += count;       // approximate the timing
        bBit = this.K*6;                // B-bit number
        do {
            if (transform(bBit, count)) {
                count = 0;
            } else {
                count--;
                if (bBit < 42) {
                    bBit += 6;
                    this.K++;
                } else {
                    bBit = 0;
                    this.K = 0;
                    this.storeBviaS();  // [S] = B
                    this.S++;
                    if (count < 8) {    // only need to reload B if a partial word is left
                        this.loadBviaS();   // B = [S]
                    }
                }
            }
        } while (count)
    }
};

/**************************************/
B5500Processor.prototype.streamInputConvert = function(count) {
    /* Converts a signed-numeric character field at the source M & G address 
    from decimal to binary, storing the resulting word at the S address and then
    incrementing S. Normally, decimal to binary conversion shouldn't be this
    complex, so we must do it more or less the way the B5500 hardware did, by
    repeated remainder division (i.e., shifting right) and adjusting the
    low-order digit by -3 when a one was shifted into the high-order bit of the
    low-order digit from the higher digit locations. The problem with doing it a
    more direct and efficient way is with digits that are not in the range 0-9.
    Doing it the hardware way should yield the same (albeit questionable)
    result. See Section 2.6 in the B5281 Training Manual for details. This
    process took at least 27 clocks on the B5500, so we can afford to be slow
    here, too. Note that a maximum of 8 characters are converted */
    var a = 0;                          // local working copy of A
    var b = 0;                          // local working copy of B
    var power = 1;                      // A-register shif factor
    
    this.streamAdjustSourceChar();
    if (this.BROF) {
        this.storeBviaS();              // [S] = B
        this.BROF = 0;
    }
    if (this.K || this.V) {             // adjust dest to word boundary
        this.K = this.V = 0;
        this.S++;
    }
    if (count) {                        // count > 0
        this.cycleCount += count*2 + 27;
        count = ((count-1) & 0x07) + 1; // limit the count to 8
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        
        // First, assemble the digits into B
        do {                            
            b = b << 4 | ((this.Y = this.cc.fieldIsolate(this.A, this.G*6, 6)) & 0x0F);
            if (this.G < 7) {
                this.G++;
            } else {
                this.G = 0;
                this.M++;
                if (count > 1) {
                    this.loadAviaM();   // A = [M], only if more chars are needed
                } else {
                    this.AROF = 0;
                }
            }
        } while (--count);
        
        // Then do the artful shifting to form the binary value in A
        this.AROF = 0;
        this.B = b;                     // for display purposes only
        while (b) {
            if (b & 0x01) {
                a += power;
            }
            power *= 2;
            b >>>= 1;
            if (b & 0x08) {
                b -= 3;                 // since the low-order digit is >= 8, don't worry about borrow
            }
        }
        
        // Finally, fix up the binary sign and store the result
        if (a) {                        // zero results have sign bit reset
            if (this.Y & 0x30 == 0x20) {
                a += 0x400000000000;    // set the sign bit
            }
        }
        this.A = a;      
        this.storeAviaS();              // [S] = A
        this.S++;
    }
};

/**************************************/
B5500Processor.prototype.streamOutputConvert = function(count) {
    /* Converts the binary word addressed by M (after word-boundary adjustment) 
    to decimal BIC at the destination address of S & K. The maximum number of 
    digits to convert is 8. If the binary value can be represented in "count"
    digits (or the count is zero), the true-false FF, MSFF, is set; otherwise it
    is reset. The sign is stored in low-order character of the result */
    var a;                              // local working copy of A
    var b = 0;                          // local working copy of B
    var c;                              // converted decimal character
    var d = 0;                          // digit counter
    var power = 1;                      // power-of-64 factor for result digits
    
    this.MSFF = 1;                      // set TFFF unless there's overflow
    this.streamAdjustDestChar();
    if (this.BROF) {
        this.storeBviaS();              // [S] = B, but leave BROF set
    }
    if (this.G || this.H) {             // adjust source to word boundary
        this.G = this.H = 0;
        this.AROF = 0;
        this.M++;
    }
    if (count) {                        // count > 0
        this.cycleCount += count*2 + 27; 
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        count = ((count-1) & 0x07) + 1; // limit the count to 8
        a = this.A % 0x8000000000;      // get absolute mantissa value, ignore exponent
        if (a) {                        // mantissa is non-zero, so conversion is required
            if ((this.A % 0x800000000000) >= 0x400000000000) {
                b = 0x20;               // result is negative, so preset the sign in the low-order digit
            }
            do {                        // Convert the binary value in A to BIC digits in B 
                c = a % 10;
                a = (a-c)/10;
                if (c) {
                    b += c*power;
                }
                power *= 64;
            } while (a && ++d < count);
            if (a) {
                this.MSFF = 0;          // overflow occurred, so reset TFFF
            }
        }
        this.AROF = 0;                  // invalidate A
        this.M++;                       // and advance to the next source word
        
        // Finally, stream the digits from A (whose value is still in local b) to the destination 
        this.A = b;                     // for display purposes only
        this.loadBviaS();               // B = [S], restore original value of B
        d = 48 - count*6;               // starting bit in A
        do {
            this.B = this.cc.fieldTransfer(this.B, this.K*6, 6, b, d);
            d += 6;
            if (this.K < 7) {
                this.K++;
            } else {
                this.storeBviaS();      // [S] = B
                this.K = 0;
                this.S++;
                if (count > 1) {
                    this.loadBviaS();   // B = [S]
                } else {
                    this.BROF = 0;
                }
            }
        } while (--count);
    }    
};

/**************************************/
B5500Processor.prototype.storeForInterrupt = function(forTest) {
    /* Implements the 3011=SFI operator and the parts of 3411=SFT that are
    common to it. "forTest" implies use from SFT */
    var forced = this.Q & 0x40;         // Q07F: Hardware-induced SFI syllable
    var saveAROF = this.AROF;
    var saveBROF = this.BROF;
    var temp;

    if (forced || forTest) {
        this.NCSF = 0;                  // switch to control state
    }

    if (this.CWMF) {
        temp = this.S;                  // get the correct TOS address from X
        this.S = (this.X % 0x40000000) >>> 15;
        this.X = this.cc.fieldInsert(this.X, 18, 15, temp);
        if (this.AROF || forTest) {
            this.S++;
            this.storeAviaS();          // [S] = A
        }
        if (this.BROF || forTest) {
            this.S++;
            this.storeBviaS();          // [S] = B
        }
        this.B = this.X +               // store CM loop-control word
              saveAROF * 0x200000000000 +
              0xC00000000000;
        this.S++;
        this.storeBviaS();              // [S] = B
    } else {
        if (this.BROF || forTest) {
            this.S++;
            this.storeBviaS();          // [S] = B
        }
        if (this.AROF || forTest) {
            this.S++;
            this.storeAviaS();          // [S] = A
        }
    }
    this.B = this.M +                   // store interrupt control word (ICW)
          this.N * 0x8000 +
          this.VARF * 0x1000000 +
          this.SALF * 0x40000000 +
          this.MSFF * 0x80000000 +
          this.R * 0x200000000 +
          0xC00000000000;
    this.S++;
    this.storeBviaS();                  // [S] = B

    this.B = this.C +                   // store interrupt return control word (IRCW)
          this.F * 0x8000 +
          this.K * 0x40000000 +
          this.G * 0x200000000 +
          this.L * 0x1000000000 +
          this.V * 0x4000000000 +
          this.H * 0x20000000000 +
          saveBROF * 0x200000000000 +
          0xC00000000000;
    this.S++;
    this.storeBviaS();                  // [S] = B

    if (this.CWMF) {
        temp = this.F;                  // if CM, get correct R value from last MSCW
        this.F = this.S;
        this.S = temp;
        this.loadBviaS();               // B = [S]: get last RCW
        this.S = ((this.B % 0x40000000) >>> 15) & 0x7FFF;
        this.loadBviaS();               // B = [S]: get last MSCW
        this.R = this.cc.fieldIsolate(this.B, 6, 9);
        this.S = this.F;
    }

    this.B = this.S +                   // store the initiate control word (INCW)
          this.CWMF * 0x8000 +
          0xC00000000000;
    if (forTest) {
        this.B += (this.TM & 0x1F) * 0x10000 +
               this.Z * 0x400000 +
               this.Y * 0x10000000 +
               (this.Q & 0x1FF) * 0x400000000;
        this.TM = 0;
        this.MROF = 0;
        this.MWOF = 0;
    }

    this.M = (this.R*64) + 0x08;        // store initiate word at R+@10
    this.storeBviaM();                  // [M] = B

    this.M = 0;
    this.R = 0;
    this.MSFF = 0;
    this.SALF = 0;
    this.BROF = 0;
    this.AROF = 0;
    if (forced) {
        if (this === this.cc.P1) {
            this.T = 0x89;              // inject 0211=ITI into T register
        } else {
            this.T = 0;                 // idle the processor
            this.TROF = 0;
            this.PROF = 0;
            this.busy = 0;
            this.cycleLimit = 0;        // exit this.run()
            this.cc.HP2F = 1;           
            this.cc.P2BF = 0;           // tell P1 we've stopped
            if (this.scheduler) {
                clearTimeout(this.scheduler);
                this.scheduler = null;
            }
        }
        this.CWMF = 0;
    } else if (forTest) {
        this.CWMF = 0;
        if (this === this.cc.P1) {
            this.loadBviaM();           // B = [M]: load DD for test
            this.C = this.B % 0x7FFF;
            this.L = 0;
            this.loadPviaC();           // P = [C]: first word of test routine
            this.G = 0;
            this.H = 0;
            this.K = 0;
            this.V = 0;
        } else {
            this.T = 0;                 // idle the processor
            this.TROF = 0;
            this.PROF = 0;
            this.busy = 0;
            this.cycleLimit = 0;        // exit this.run()
            this.cc.HP2F = 1;
            this.cc.P2BF = 0;           // tell P1 we've stopped
            if (this.scheduler) {
                clearTimeout(this.scheduler);
                this.scheduler = null;
            }
        }
    }
};

/**************************************/
B5500Processor.prototype.start = function(runAddr) {
    /* Initiates the processor from a load condition at C=runAddr */

    this.C = runAddr;                   // starting execution address
    this.loadPviaC();                   // P = [C]
    this.T = this.fieldIsolate(this.P, 0, 12);
    this.TROF = 1;
    this.L = 1;                         // advance L to the next syllable

    // Now start scheduling the processor on the Javascript thread
    this.busy = 1;
    this.procTime = new Date().getTime()*1000;
    this.scheduler = setTimeout(this.schedule, 0);
};

/**************************************/
B5500Processor.prototype.initiate = function(forTest) {
    /* Initiates the processor from interrupt control words stored in the
    stack. Assumes the INCW is in A. "forTest" implies use from IFT */
    var saveAROF;
    var saveBROF;
    var temp;

    // restore the Initiate Control Word or Initiate Test Control Word
    this.S = this.A % 0x8000;
    this.CWMF = Math.floor(this.A / 0x8000) % 0x02;
    if (forTest) {
        this.TM = Math.floor(this.A / 0x10000) % 0x20;
        this.Z = Math.floor(this.A / 0x400000) % 0x40;
        this.Y = Math.floor(this.A / 0x10000000) % 0x40;
        this.Q = Math.floor(this.A / 0x400000000) % 0x200;
        this.TM |= Math.floor(this.A / 0x200000) % 0x02 * 32;           // CCCF
        this.TM |= Math.floor(this.A / 0x80000000000) % 0x02 * 64;      // MWOF
        this.TM |= Math.floor(this.A / 0x400000000000) % 0x02 * 128;    // MROF
        // Emulator doesn't support J register, so can't set that from TM
    }
    this.AROF = 0;
    this.BROF = 0;

    // restore the Interrupt Return Control Word
    this.loadBviaS();                   // B = [S]
    this.S--;
    this.C = this.B % 0x8000;
    this.F = Math.floor(this.B / 0x8000) % 0x8000;
    this.K = Math.floor(this.B / 0x40000000) % 0x08;
    this.G = Math.floor(this.B / 0x200000000) % 0x08;
    this.L = Math.floor(this.B / 0x1000000000) % 0x04;
    this.V = Math.floor(this.B / 0x4000000000) % 0x08;
    this.H = Math.floor(this.B / 0x20000000000) % 0x08;
    this.loadPviaC();                   // P = [C]
    if (this.CWMF || forTest) {
        saveBROF = Math.floor(this.B / 200000000000) % 0x02;
    }

    // restore the Interrupt Control Word
    this.loadBviaS();                   // B = [S]
    this.S--;
    this.VARF = Math.floor(this.B / 0x1000000) % 0x02;
    this.SALF = Math.floor(this.B / 0x40000000) % 0x02;
    this.MSFF = Math.floor(this.B / 0x80000000) % 0x02;
    this.R = (Math.floor(this.B / 0x200000000) % 0x200);

    if (this.CWMF || forTest) {
        this.M = this.B % 0x8000;
        this.N = Math.floor(this.B / 0x8000) % 0x10;

        // restore the CM Interrupt Loop Control Word
        this.loadBviaS();               // B = [S]
        this.S--;
        this.X = this.B % 0x8000000000;
        saveAROF = Math.floor(this.B / 0x400000000000) % 0x02;

        // restore the B register
        if (saveBROF || forTest) {
            this.loadBviaS();           // B = [S]
            this.S--;
        }

        // restore the A register
        if (saveAROF || forTest) {
            this.loadAviaS();           // A = [S]
            this.S--;
        }

        if (this.CWMF) {
            // exchange S with its field in X
            temp = this.S;
            this.S = (this.X % 0x40000000) >>> 15;
            this.X = this.X % 0x8000 +
                  temp * 0x8000 +
                  Math.floor(this.X / 0x40000000) * 0x40000000;
        }
    // else don't restore A or B for word mode -- will pop up as necessary
    }

    this.T = this.cc.fieldIsolate(this.P, this.L*12, 12);
    this.TROF = 1;
    if (forTest) {
        this.NCSF = (this.TM >>> 4) & 0x01;
        this.CCCF = (this.TM >>> 5) & 0x01;
        this.MWOF = (this.TM >>> 6) & 0x01;
        this.MROF = (this.TM >>> 7) & 0x01;
        this.S--;
        if (!this.CCCF) {
            this.TM |= 0x80;
        }
    } else {
        this.NCSF = 1;
        this.busy = 1;
    }
};

/**************************************/
B5500Processor.prototype.initiateAsP2 = function() {
    /* Called from Central Control to initiate the processor as P2. Fetches the
    INCW from @10 and calls initiate() */
    
    this.M = 0x08;                    // address of the INCW
    this.loadAviaM();                 // A = [M]
    this.AROF = 1;
    this.T = 0x849;                   // inject 4111=IP1 into P2's T register
    this.TROF = 1;
    this.NCSF = 0;                    // make sure P2 is in control state

    // Now start scheduling P2 on the Javascript thread
    this.procTime = new Date().getTime()*1000;
    this.scheduler = setTimeout(this.schedule, 0);
};

/**************************************/
B5500Processor.prototype.singlePrecisionCompare = function() {
    /* Algebraically compares the B register to the A register. Function returns 
    -1 if B<A, 0 if B=A, or +1 if B>A. Exits with AROF=0, BROF=1, and A and B as is */
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    
    this.cycleCount += 4;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa
    
    // Extract the exponents and signs. If the exponents are unequal, normalize 
    // each until the high-order octade is non-zero or the exponents are equal.
    if (ma == 0) {                      // if A mantissa is zero
        ea = sa = 0;                    // consider A to be completely zero
    } else {
        ea = (this.A - ma)/0x8000000000;
        sa = ((ea >>> 7) & 0x01);
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));
    }
    if (mb == 0) {                      // if B mantissa is zero 
        eb = sb = 0;                    // consider B to be completely zero
    } else {                           
        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));
    }
    if (ma) {                           // normalize the A mantissa
        while (ma < 0x1000000000 && ea != eb) {
            this.cycleCount++;
            ma *= 8;                    // shift left
            ea--;
        }
    }
    if (mb) {                           // normalize the B mantissa
        while (mb < 0x1000000000 && eb != ea) {
            this.cycleCount++;
            mb *= 8;                    // shift left
            eb--;
        }
    }
    
    // Compare signs, exponents, and normalized magnitudes, in that order.
    if (sb == sa) {                     // if signs are equal:
        if (eb == ea) {                 // if exponents are equal:
            if (mb == ma) {             // if magnitudes are equal:
                return 0;               // then the operands are equal
            } else if (mb > ma) {       // otherwise, if magnitude of B > A:
                return (sb ? -1 : 1);   //      B<A if B negative, B>A if B positive
            } else {                    // otherwise, if magnitude of B < A:
                return (sb ? 1 : -1);   //      B>A if B negative, B<A if B positive
            }
        } else if (eb > ea) {           // otherwise, if exponent of B > A:
            return (sb ? -1 : 1);       //      B<A if B negative, B>A if B positive
        } else {                        // otherwise, if exponent of B < A
            return (sb ? 1 : -1);       //      B>A if B negative, B<A if B positive
        }
    } else {                            // otherwise, if signs are different:
        return (sa < sb ? -1 : 1);      // B<A if B negative, B>A if B positive
    }
};

/**************************************/
B5500Processor.prototype.singlePrecisionAdd = function(adding) {
    /* Adds the contents of the A register to the B register, leaving the result 
    in B and invalidating A. If "adding" is not true, the sign of A is complemented
    to accomplish subtraction instead of addition */
    var d = 0;                          // the guard (rounding) digit
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A*8
    var mb;                             // absolute mantissa of B*8
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx = 0;                         // local copy of X
    
    this.cycleCount += 4;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa
    
    if (ma == 0) {                      // if A mantissa is zero
        if (mb == 0) {                  // and B mantissa is zero
            this.B = 0;                 // result is all zeroes
        } else {
            this.B %= 0x800000000000;   // otherwise, result is B with flag bit reset
        }
    } else if (mb == 0 && adding) {     // otherwise, if B is zero and we're adding, 
        this.B = this.A % 0x800000000000;       // result is A with flag bit reset
    } else {                            // rats, we actually have to do this
        ea = (this.A - ma)/0x8000000000;
        sa = ((ea >>> 7) & 0x01);
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // If the exponents are unequal, normalize the larger and scale the smaller
        // until they are in alignment, or one of the mantissas (mantissae?) becomes zero
        if (ea > eb) {
            // Normalize A for 39 bits (13 octades)
            while (ma < 0x1000000000 && ea != eb) {
                this.cycleCount++;
                ma *= 8;                // shift left
                ea--;
            }
            // Scale B until its exponent matches or mantissa goes to zero
            while (ea != eb) {
                this.cycleCount++;
                d = mb % 8;
                mb = (mb - d)/8;        // shift right into X
                xx = (xx - xx%8)/8 + d*0x1000000000;
                if (mb) {
                    eb++;
                } else {
                    eb = ea;            // if B=0, result will have exponent of A
                    // should we clear X at this point to prevent rounding of A?
                }
            }
        } else if (ea < eb) {
            // Normalize B for 39 bits (13 octades)
            while (mb < 0x1000000000 && eb != ea) {
                this.cycleCount++;
                mb *= 8;                // shift left
                eb--;
            }
            // Scale A until its exponent matches or mantissa goes to zero
            while (eb != ea) {
                this.cycleCount++;
                d =  ma % 8;
                ma = (ma -d)/8;         // shift right into X
                xx = (xx - xx%8)/8 + d*0x1000000000;
                if (ma) {
                    ea++;
                } else {
                    ea = eb;            // if A=0, kill the scaling loop
                    // should we clear X at this point to prevent rounding of B?
                }
            }
        }

        // At this point, the exponents are aligned (or one of the mantissas 
        // is zero), so do the actual 39-bit addition
        mb = (sb ? -mb : mb) + (sa ^ (adding ? 0 : 1) ? -ma : ma);

        if (mb == 0) {
            this.B = 0;
        } else {
            // Determine the resulting sign
            if (mb >= 0) {
                sb = 0;
            } else {
                sb = 1;
                mb = -mb;
            }

            // Normalize and round as necessary
            if (mb < 0x1000000000 && xx >= 0x800000000) {       // Normalization can be required for subtract
                this.cycleCount++;                              
                d = (xx - xx%0x1000000000)/0x1000000000;        // get the rounding digit from X
                xx = (xx%0x1000000000)*8;                       // shift B and X left together
                mb = mb*8 + d;
                eb--;
                d = (xx - xx%0x1000000000)/0x1000000000;        // get the next rounding digit from X
            } else if (mb >= 0x8000000000) {                    // Scaling can be required for add
                this.cycleCount++;
                d = mb % 8;                                     // get the rounding digit from B
                mb = (mb - d)/8;                                // shift right due to overflow
                eb++; 
            }
            
            // Note: the Training Manual does not say that rounding is suppressed
            // for add/subtract when the mantissa is all ones, but it does say so
            // for multiply/divide, so we assume it's also the case here.
            if (d & 0x04) {             // if the guard digit >= 4
                if (mb < 0x7FFFFFFFFF) {// and rounding would not cause overflow
                    this.cycleCount++;
                    mb++;               // round up the result
                }
            }

            // Check for exponent overflow
            if (eb > 63) {
                eb %= 64;
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xB0;    // set I05/6/8: exponent-overflow
                    this.cc.signalInterrupt();
                }
            } else if (eb < 0) {
                eb = (-eb) | 0x40;      // set the exponent sign bit
            }

            this.X = xx;                                // for display purposes only
            this.B = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
        } 
    }
};

/**************************************/
B5500Processor.prototype.singlePrecisionMultiply = function() {
    /* Multiplies the contents of the A register to the B register, leaving the 
    result in B and invalidating A. A double-precision mantissa is developed and
    then normalized and rounded */
    var d;                              // current multiplier digit (octal)
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var mx = 0;                         // local copy of X for product extension
    var n = 0;                          // local copy of N (octade counter)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx;                             // local copy of X for multiplier
    
    this.cycleCount += 4;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa
    
    if (ma == 0) {                      // if A mantissa is zero
        this.B = 0;                     // result is all zeroes
    } else if (mb == 0) {               // otherwise, if B is zero, 
        this.B = 0;                     // result is all zeroes
    } else {                            // otherwise, let the games begin
        ea = (this.A - ma)/0x8000000000;
        sa = ((ea >>> 7) & 0x01);
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // If the exponents are BOTH zero, perform an integer multiply.
        // Otherwise, normalize both operands
        if (ea == 0 && eb == 0) {
            this.Q |= 0x10;             // integer multiply operation: set Q05F
        } else {
            // Normalize A for 39 bits (13 octades)
            while (ma < 0x1000000000) {
                this.cycleCount++;
                ma *= 8;                // shift left
                ea--;
            }
            // Normalize B for 39 bits (13 octades)
            while (mb < 0x1000000000) {
                this.cycleCount++;
                mb *= 8;                // shift left
                eb--;
            }
        }

        // Determine resulting mantissa sign; initialize the product
        sb ^= sa;                       // positive if signs are same, negative if different
        xx = mb;                        // move multiplier to X
        mb = 0;                         // initialize high-order part of product
        
        // Now we step through the 13 octades of the multiplier, developing the product
        do {
            d = xx % 8;                 // extract the current multiplier digit
            xx = (xx - d)/8;            // shift the multiplier right one octade
            
            if (d == 0) {               // if multiplier digit is zero
                this.cycleCount++;      // hardware optimizes this case
            } else {
                this.cycleCount += 3;   // just estimate the average number of clocks
                mb += ma*d;             // develop the partial product
            }
            
            d = mb % 8;                 // get the low-order octade of partial product in B
            mb = (mb - d)/8;            // shift B right one octade 
            mx = mx/8 + d*0x1000000000; // shift B octade into high-order end of extension
        } while (++n < 13);
        
        // Normalize the result
        if (this.Q & 0x10 && mb == 0) { // if it's integer multiply (Q05F) with integer result
            mb = mx;                    // just use the low-order 39 bits
            eb = 0;                     // and don't normalize
        } else {
            eb += ea+13;                // compute resulting exponent from multiply
            while (mb < 0x1000000000) {
                this.cycleCount++;
                ma = mx % 0x1000000000; // reuse ma: get low-order 36 bits of mantissa extension
                d = (mx - ma)/0x1000000000;     // get high-order octade of extension
                mb = mb*8 + d;          // shift high-order extension octade into B
                mx = ma*8;              // shift extension left one octade
                eb--;
            }
        }
        
        // Round the result
        this.Q &= ~(0x10);              // reset Q05F
        this.A = 0;                     // required by specs due to the way rounding addition worked
        
        if (xx >= 0x4000000000) {       // if high-order bit of remaining extension is 1
            this.Q |= 0x01              // set Q01F (for display purposes only)
            if (mb < 0x7FFFFFFFFF) {    // if the rounding would not cause overflow
                this.cycleCount++;
                mb++;                   // round up the result
            }
        }
        
        if (mb == 0) {                  // don't see how this could be necessary here, but
            this.B = 0;                 // the TM says to do it anyway
        } else {
            // Check for exponent under/overflow
            if (eb > 63) {
                eb %= 64;
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xB0;    // set I05/6/8: exponent-overflow
                    this.cc.signalInterrupt();
                }
            } else if (eb < -63) {
                eb = ((-eb) % 64) | 0x40;       // mod the exponent and set its sign
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xA0;    // set I06/8: exponent-underflow
                    this.cc.signalInterrupt();
                }
            } else if (eb < 0) {
                eb = (-eb) | 0x40;      // set the exponent sign bit
            }

            this.B = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
        } 
    }
    this.X = mx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.singlePrecisionDivide = function() {
    /* Divides the contents of the A register into the B register, leaving the 
    result in B and invalidating A. A 14-octade mantissa is developed and
    then normalized and rounded */
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n = 0;                          // local copy of N (octade counter)
    var q = 0;                          // current quotient digit (octal)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx = 0;                         // local copy of X for quotient development
    
    this.cycleCount += 4;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa
    
    if (ma == 0) {                      // if A mantissa is zero
        this.A = this.B = 0;            // result is all zeroes
        if (this.NCSF) {
            this.I = (this.I & 0x0F) | 0xD0;    // set I05/7/8: divide by zero
            this.cc.signalInterrupt();
        }
    } else if (mb == 0) {               // otherwise, if B is zero, 
        this.A = this.B = 0;            // result is all zeroes
    } else {                            // otherwise, may the octades always be in your favor
        ea = (this.A - ma)/0x8000000000;
        sa = ((ea >>> 7) & 0x01);
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // Normalize A for 39 bits (13 octades)
        while (ma < 0x1000000000) {
            this.cycleCount++;
            ma *= 8;                // shift left
            ea--;
        }
        // Normalize B for 39 bits (13 octades)
        while (mb < 0x1000000000) {
            this.cycleCount++;
            mb *= 8;                // shift left
            eb--;
        }

        sb ^= sa;                       // positive if signs are same, negative if different
        
        // Now we step through the development of the quotient one octade at a time,
        // tallying the shifts in n until the high-order octade of xx is non-zero (i.e.,
        // normalized). The divisor is in ma and the dividend (which becomes the
        // remainder) is in mb. Since the operands are normalized, this will take
        // either 13 or 14 shifts. We do the xx shift at the top of the loop so that 
        // the 14th (rounding) digit will be available in q at the end. The initial 
        // shift has no effect, as it operates using zero values for xx and q.
        do {
            xx = xx*8 + q;              // shift quotient digit into the working quotient
            n++;                        // tally the shifts (one more than affects result)
            q = 0;                      // initialize the quotient digit
            while (mb >= ma) {
                q++;                    // bump the quotient digit
                mb -= ma;               // subtract divisor from remainder
            }
            mb *= 8;                    // shift the remainder left one octade
        } while (xx < 0x1000000000);
        
        this.cycleCount += n*3;         // just estimate the average number of divide clocks
        eb -= ea + n - 2;               // compute the exponent, accounting for the extra shift
        
        // Round the result (it's already normalized)
        this.A = 0;                     // required by specs due to the way rounding addition worked
        if (q >= 4) {                   // if high-order bit of last quotient digit is 1
            this.Q |= 0x01              // set Q01F (for display purposes only)
            if (xx < 0x7FFFFFFFFF) {    // if the rounding would not cause overflow
                xx++;                   // round up the result
            }
        }
        
        // Check for exponent under/overflow
        if (eb > 63) {
            eb %= 64;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0xB0;    // set I05/6/8: exponent-overflow
                this.cc.signalInterrupt();
            }
        } else if (eb < -63) {
            eb = ((-eb) % 64) | 0x40;   // mod the exponent and set its sign
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0xA0;    // set I06/8: exponent-underflow
                this.cc.signalInterrupt();
            }
        } else if (eb < 0) {
            eb = (-eb) | 0x40;          // set the exponent sign bit
        }

        this.B = (sb*128 + eb)*0x8000000000 + xx;   // Final Answer
    }
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.integerDivide = function() {
    /* Divides the contents of the A register into the B register, leaving the 
    integerized result in B and invalidating A. If the result cannot be expressed
    as an integer, the Integer-Overflow interrupt is set */
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n = 0;                          // local copy of N (octade counter)
    var q = 0;                          // current quotient digit (octal)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx = 0;                         // local copy of X for quotient development
    
    this.cycleCount += 4;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa
    
    if (ma == 0) {                      // if A mantissa is zero
        this.A = this.B = 0;            // result is all zeroes
        if (this.NCSF) {
            this.I = (this.I & 0x0F) | 0xD0;    // set I05/7/8: divide by zero
            this.cc.signalInterrupt();
        }
    } else if (mb == 0) {               // otherwise, if B is zero, 
        this.A = this.B = 0;            // result is all zeroes
    } else {                            // otherwise, continue
        ea = (this.A - ma)/0x8000000000;
        sa = ((ea >>> 7) & 0x01);
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // Normalize A for 39 bits (13 octades)
        while (ma < 0x1000000000) {
            this.cycleCount++;
            ma *= 8;                    // shift left
            ea--;
        }
        // Normalize B for 39 bits (13 octades)
        while (mb < 0x1000000000) {
            this.cycleCount++;
            mb *= 8;                    // shift left
            eb--;
        }
        
        if (ea > eb) {                  // if divisor has greater magnitude
            this.A = this.B = 0;        // quotient is < 1, so set result to zero
        } else {                        // otherwise, do the long division
            sb ^= sa;                   // positive if signs are same, negative if different

            // Now we step through the development of the quotient one octade at a time,
            // similar to that for DIV, but in addition to stopping when the high-order 
            // octade of xx is non-zero (i.e., normalized), we can stop if the exponents
            // becomes equal. Since there is no rounding, we do not need to develop an 
            // extra quotient digit.
            do {
                this.cycleCount += 3;   // just estimate the average number of clocks
                q = 0;                  // initialize the quotient digit
                while (mb >= ma) {
                    q++;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                mb *= 8;                // shift the remainder left one octade
                xx = xx*8 + q;          // shift quotient digit into the working quotient
                if (xx >= 0x1000000000) {
                    break;              // quotient has become normalized        
                } else if (ea < eb) {
                    eb--;               // decrement the B exponent
                } else {
                    break;
                }
            } while (true);

            if (ea == eb) {
                eb = 0;                 // integer result developed
            } else {
                if (this.NCSF) {        // integer overflow result        
                    this.I = (this.I & 0x0F) | 0xC0;    // set I07/8: integer-overflow
                    this.cc.signalInterrupt();
                }  
                eb = (eb-ea)%64;               
                if (eb < 0) {
                    eb = (-eb) | 0x40;  // set the exponent sign bit
                }
            }

            this.A = 0;                 // required by specs
            this.B = (sb*128 + eb)*0x8000000000 + xx;   // Final Answer
        }
    }
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.remainderDivide = function() {
    /* Divides the contents of the A register into the B register, leaving the 
    remainder result in B and invalidating A. The sign of the result is the sign 
    of the dividend (B register value). If the quotient cannot be expressed as an 
    integer, the Integer-Overflow interrupt is set */
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n = 0;                          // local copy of N (octade counter)
    var q = 0;                          // current quotient digit (octal)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx = 0;                         // local copy of X for quotient development
    
    this.cycleCount += 4;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa
    
    if (ma == 0) {                      // if A mantissa is zero
        this.A = this.B = 0;            // result is all zeroes
        if (this.NCSF) {
            this.I = (this.I & 0x0F) | 0xD0;    // set I05/7/8: divide by zero
            this.cc.signalInterrupt();
        }
    } else if (mb == 0) {               // otherwise, if B is zero, 
        this.A = this.B = 0;            // result is all zeroes
    } else {                            // otherwise, continue
        ea = (this.A - ma)/0x8000000000;
        sa = ((ea >>> 7) & 0x01);
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // Normalize A for 39 bits (13 octades)
        while (ma < 0x1000000000) {
            this.cycleCount++;
            ma *= 8;                    // shift left
            ea--;
        }
        // Normalize B for 39 bits (13 octades)
        while (mb < 0x1000000000) {
            this.cycleCount++;
            mb *= 8;                    // shift left
            eb--;
        }
        
        if (ea > eb) {                  // if divisor has greater magnitude
            this.A = 0;                 // quotient is < 1, so set A to zero and 
            this.B %= 0x8000000000000;  // result is original B (less the flag bit)
        } else {                        // otherwise, work remains (so to speak)
            // Now we step through the development of the quotient one octade at a time,
            // similar to that for DIV, but in addition to stopping when the high-order 
            // octade of xx is non-zero (i.e., normalized), we can stop if the exponents
            // becomes equal. Since there is no rounding, we do not need to develop an 
            // extra quotient digit. 
            do {
                this.cycleCount += 3;   // just estimate the average number of clocks
                q = 0;                  // initialize the quotient digit
                while (mb >= ma) {
                    q++;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                xx = xx*8 + q;          // shift quotient digit into the working quotient
                if (xx >= 0x1000000000) {
                    break;              // quotient has become normalized
                } else if (ea < eb) {
                    mb *= 8;            // shift the remainder left one octade
                    eb--;               // decrement the B exponent
                } else {
                    break;
                }
            } while (true);

            if (eb < -63) {             // check for exponent underflow
                eb %= 64;               // if so, exponent is mod 64
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xA0;    // set I06/8: exponent-underflow
                    this.cc.signalInterrupt();
                }
            } else if (ea == eb) {      // integer result developed
                if (mb == 0) {          // if B mantissa is zero, then
                    eb = sb = 0;        // assure result will be all zeroes
                } else {
                    eb %= 64;           // use remainder exponent mod 64
                }
            } else {
                if (this.NCSF) {        // integer overflow result        
                    this.I = (this.I & 0x0F) | 0xC0;    // set I07/8: integer-overflow
                    this.cc.signalInterrupt();
                }  
                mb = eb = sb = 0;       // result in B will be all zeroes
            }
            if (eb < 0) {
                eb = (-eb) | 0x40;  // set the exponent sign bit
            }

            this.A = 0;                 // required by specs
            this.B = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
        }
    }
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.doublePrecisionAdd = function(adding) {
    /* Adds the double-precision contents of the A and B registers to the double-
    precision contents of the top two words in the memory stack, leaving the result 
    in A and B. If "adding" is not true, the sign of A is complemented to accomplish 
    subtraction instead of addition */
    var carry = 0;                      // overflow carry flag
    var d = 0;                          // shifting digit between registers
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A*8
    var mb;                             // absolute mantissa of B*8
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xa;                             // extended mantissa for A
    var xb;                             // extended mantissa for B
    
    // Estimate some general overhead and account for stack manipulation we don't do
    this.cycleCount += B5500Processor.memCycles*4 + 8;
    
    this.adjustABFull();                // extract the top (A) operand fields:
    ma = this.A % 0x8000000000;         // extract the A mantissa
    xa = this.B % 0x8000000000;         // extract the A mantissa extension
    ea = (this.A - ma)/0x8000000000;
    sa = ((ea >>> 7) & 0x01);
    ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

    this.AROF = this.BROF = 0;          // empty the TOS registers
    this.adjustABFull();                // extract the second (B) operand fields:
    mb = this.A % 0x8000000000;         // extract the B mantissa
    xb = this.B % 0x8000000000;         // extract the B mantissa extension
    eb = (this.B - mb)/0x8000000000;
    sb = (eb >>> 7) & 0x01;
    eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

    
    if (ma == 0 && xa == 0) {           // if A is zero
        if (mb == 0 && xb == 0) {       // and B is zero
            this.A = this.B = 0;        // result is all zeroes
        } else {
            this.A %= 0x800000000000;   // otherwise, result is B with flag bit reset
        }
    } else if (mb == 0 && xb == 0 && adding) {  // otherwise, if B is zero and we're adding, 
        this.B = xa;                    // reconstruct A operand with flag bit reset
        this.A = ((sa*2 + (ea < 0 ? 1 : 0))*64 + (ea < 0 ? -ea : ea))*0x8000000000 + ma;       
    } else {                            // so much for the simple cases...
        // If the exponents are unequal, normalize the larger and scale the smaller
        // until they are in alignment, or one of the mantissas becomes zero
        if (ea > eb) {
            // Normalize A for 78 bits (26 octades)
            while (ma < 0x1000000000 && ea != eb) {
                this.cycleCount++;
                d = (xa - xa%0x1000000000)/0x1000000000;
                ma = ma*8 + d;          // shift left
                xa = (xa % 0x1000000000)*8;
                ea--;
            }
            // Scale B until its exponent matches or mantissa goes to zero
            while (ea != eb) {
                this.cycleCount++;
                d = mb % 8;
                mb = (mb - d)/8;        // shift right into extension
                xb = (xb - xb%8)/8 + d*0x1000000000;
                if (mb && xb) {
                    eb++;
                } else {
                    eb = ea;            // if B=0, result will have exponent of A
                }
            }
        } else if (ea < eb) {
            // Normalize B for 78 bits (26 octades)
            while (mb < 0x1000000000 && eb != ea) {
                this.cycleCount++;
                d = (xb - xb%0x1000000000)/0x1000000000;
                mb = mb*8 + d;          // shift left
                xb = (xb % 0x1000000000)*8;
                eb--;
            }
            // Scale A until its exponent matches or mantissa goes to zero
            while (eb != ea) {
                this.cycleCount++;
                d = ma % 8;
                ma = (ma - d)/8;        // shift right into extension
                xa = (xa - xa%8)/8 + d*0x1000000000;
                if (ma && xa) {
                    ea++;
                } else {
                    ea = eb;            // if A=0, kill the scaling loop
                }
            }
        }

        // At this point, the exponents are aligned (or one of the mantissas 
        // is zero), so do the actual 78-bit addition as two 40-bit, signed, twos-
        // complement halves. Note that computing the twos-complement of the 
        // extension requires a borrow from the high-order part, so the borrow
        // is taken from the 40-bit twos-complement base (i.e., using 0xFFFFFFFFFF
        // instead of 0x10000000000).
        if (sb) {                       // if B negative, compute B 2s complement
            this.cycleCount += 2;
            xb = 0x8000000000 - xb;
            mb = 0xFFFFFFFFFF - mb;
        }
        if (sa ^ (adding ? 0 : 1)) {    // if A negative XOR subtracting, compute A 2s complement
            this.cycleCount += 2;
            xa = 0x8000000000 - xa;
            ma = 0xFFFFFFFFFF - ma;
        }
        
        xb += xa;                       // add the extension parts
        if (xb >= 0x8000000000) {               // deal with carry out of extension part
            mb++;                               // into high-order part
            xb %= 0x8000000000;
        }
        
        mb += ma;                       // add the high-order parts
        
        // Check for overflow: if the result occupies more than 40 bits, we know
        // that overflow occurred; otherwise if both internal signs were positive
        // and we have a twos-complement negative result, overflow occurred; otherwise
        // if both internal signs were negative and we have a positive result,
        // overflow occurred. Set the carry flag and adjust the result as necessary.
        if (mb >= 0x10000000000) {                      // if result overflowed 40 bits
            carry = 1;                                  // set the carry flag
            mb -= 0x8000000000;                         // and adjust result for the overflow
        } else if (sb == (sa ^ (adding ? 0 : 1))) {     // if the signs of the internal addition are the same
            if (sb && mb < 0x8000000000) {              // if signs were negative and result is positive
                carry = 1;                              // overflow occurred: set carry flag
                mb += 0x8000000000;                     // and adjust result for the overflow
            } else if (!sb && mb >= 0x8000000000) {     // if signs were positive and result is negative
                carry = 1;                              // overflow occurred: set the carry flag
                mb -= 0x8000000000;                     // and adjust result for the overflow
            }
        }
        
        // Determine the resulting sign and decomplement as necessary        
        if (mb < 0x8000000000) {
            sb = 0;                     // it's positive
        } else {
            sb = 1;                     // it's negative
            this.cycleCount++;
            xb = 0x8000000000 - xb;
            mb = 0xFFFFFFFFFF - mb;
        }        

        // Scale or normalize as necessary
        if (carry) {                                    // overflow occurred, so scale it in
            this.cycleCount++;
            d = mb % 8;                                 // get the shift digit from high-order part
            mb = (mb - d)/8 + 0x1000000000;             // shift right and insert the overflow bit
            xb = (xb - xb%8)/8 + d*0x1000000000;        // shift the extension and insert the shift digit
            eb++; 
        } else {
            while (mb < 0x1000000000 && mb & xb) {      // Normalize
                this.cycleCount++;                              
                d = (xb - xb%0x1000000000)/0x1000000000;// get the rounding digit from X
                xb = (xb%0x1000000000)*8;               // shift B and X left together
                mb = mb*8 + d;
                eb--;
            }
        }

        if (mb == 0 && xb == 0) {
            this.A = this.B = 0;
        } else {
            // Check for exponent over/underflow
            if (eb > 63) {
                eb %= 64;
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xB0;    // set I05/6/8: exponent-overflow
                    this.cc.signalInterrupt();
                }
            } else if (eb < -63) {
                eb = ((-eb) % 64) | 0x40;               // mod the exponent and set its sign
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xA0;    // set I06/8: exponent-underflow
                    this.cc.signalInterrupt();
                }
            } else if (eb < 0) {
                eb = (-eb) | 0x40;                      // set the exponent sign bit
            }

            this.X = xb;                                // for display purposes only
            this.B = xb;
            this.A = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
        } 
    }
};

/**************************************/
B5500Processor.prototype.computeRelativeAddr = function(offset, cEnabled) {
    /* Computes an absolute memory address from the relative "offset" parameter
    and leaves it in the M register. See Table 6-1 in the B5500 Reference
    Manual. "cEnable" determines whether C-relative addressing is permitted.
    This offset must be in (0..1023) */

    if (this.SALF) {
        switch (offset >>> 7) {
        case 0:
        case 1:
        case 2:
        case 3:
            this.M = (this.R*64) + (offset & 0x1FF);
            break;
        case 4:
        case 5:
            if (this.MSFF) {
                this.M = (this.R*64) + 7;
                this.loadMviaM();       // M = [M].[18:15]
                this.M += (offset & 0xFF);
            } else {
                this.M = this.F + (offset & 0xFF);
            }
            break;
        case 6:
            if (cEnabled) {
                this.M = this.C + (offset & 0x7F);
            } else {
                this.M = (this.R*64) + (offset & 0x7F);
            }
            break;
        case 7:
            if (this.MSFF) {
                this.M = (this.R*64) + 7;
                this.loadMviaM();       // M = [M].[18:15]
                this.M -= (offset & 0x7F);
            } else {
                this.M = this.F - (offset & 0x7F);
            }
            break;
        } // switch
    } else {
        this.M = (this.R*64) + (offset & 0x3FF);
    }
};

/**************************************/
B5500Processor.prototype.indexDescriptor = function() {
    /* Indexes a descriptor and, if successful leaves the indexed value in
    the A register. Returns 1 if an interrupt is set and the syllable is
    to be exited */
    var aw = this.A;                    // local copy of A reg
    var bw;                             // local copy of B reg
    var interrupted = 0;                // fatal error, interrupt set
    var xe;                             // index exponent
    var xm;                             // index mantissa
    var xo;                             // last index octade shifted off
    var xs;                             // index mantissa sign
    var xt;                             // index exponent sign

    this.adjustBFull();
    bw = this.B;
    xm = (bw % 0x8000000000);
    xe = (bw - xm)/8;
    xs = (xe >>> 7) & 0x01;
    xt = (xe >>> 6) & 0x01;
    xe = (xt ? -(xe & 0x3F) : (xe & 0x3F));

    // Normalize the index, if necessary
    if (xe < 0) {                       // index exponent is negative
        do {
            this.cycleCount++;
            xo = xm % 8;
            xm = (xm - xo)/8;
        } while (++xe < 0);
        if (xo >= 4) {
            xm++;                       // round the index
        }
    } else if (xe > 0) {                // index exponent is positive
        do {
            this.cycleCount++;
            if (xm < 0x1000000000) {
                xm *= 8;
            } else {                // oops... integer overflow normalizing the index
                xe = 0;             // kill the loop
                interrupted = 1;
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xC0;        // set I07/8: int-overflow
                    this.cc.signalInterrupt();
                }
            }
        } while (--xe > 0);
    }

    // Now we have an integerized index value in xm
    if (!interrupted) {
        if (xs) {                       // oops... negative index
            interrupted = 1;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0x90;                // set I05/8: invalid-index
                this.cc.signalInterrupt();
            }
        } else if (xm >= this.cc.fieldIsolate(aw, 8, 10)) {
            interrupted = 1;            // oops... index out of bounds
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0x90;                // set I05/8: invalid-index
                this.cc.signalInterrupt();
            }
        } else {                        // we finally have a valid index
            this.A = this.cc.fieldInsert(aw, 33, 15, aw % 0x8000 + xm % 0x400);
            this.BROF = 0;
        }
    }

    return interrupted;
};

/**************************************/
B5500Processor.prototype.presenceTest = function(word) {
    /* Tests and returns the presence bit [2:1] of the "word" parameter. If
    0, the p-bit interrupt is set; otherwise no further action */

    if (word % 0x400000000000 >= 0x200000000000) {
        return 1;
    } else {
        if (this.NCSF) {
            this.I = (this.I & 0x0F) | 0x70;    // set I05/6/7: p-bit
            this.cc.signalInterrupt();
        }
        return 0;
    }
};

/**************************************/
B5500Processor.prototype.buildMSCW = function() {
    /* Return a Mark Stack Control Word from current processor state */

    return  this.F * 0x8000 +
            this.SALF * 0x40000000 +
            this.MSFF * 0x80000000 +
            this.R * 0x200000000 +
            0xC00000000000;
};

/**************************************/
B5500Processor.prototype.applyMSCW = function(word) {
    /* Set  processor state from fields of the Mark Stack Control
    Word in the "word" parameter */
    var f;

    f = word % 0x8000;                  // [33:15], not used
    word = (word-f)/0x8000;
    this.F = f = word % 0x8000;         // [18:15], F register
    word = (word-f)/0x8000;
    this.SALF = f = word % 2;           //  [17:1], SALF
    word = (word-f)/2;
    this.MSFF = word % 2;               //  [16:1], MSFF
    word = (word - word%4)/4;
    this.R = word % 0x200;              //   [6:9], R
};

/**************************************/
B5500Processor.prototype.buildRCW = function(descriptorCall) {
    /* Return a Return Control Word from the current processor state */

    return  this.C +
            this.F * 0x8000 +
            this.K * 0x40000000 +
            this.G * 0x200000000 +
            this.L * 0x1000000000 +
            this.V * 0x4000000000 +
            this.H * 0x20000000000 +
            (descriptorCall ? 0xE00000000000 : 0xC00000000000);
};

/**************************************/
B5500Processor.prototype.applyRCW = function(word, inline) {
    /* Set processor state from fields of the Return Control Word in
    the "word" parameter. If "inline" is truthy, C & L are NOT restored from
    the RCW. Returns the state of the OPDC/DESC bit [2:1] */
    var f;

    f = word % 0x8000;                  // [33:15], C
    if (!inline) {
        this.C = f;
        this.loadPviaC();               // P = [C], fetch new program word
    }
    word = (word-f)/0x8000;
    this.F = f = word % 0x8000;         // [18:15], F
    word = (word-f)/0x8000;
    this.K = f = word % 8;              //  [15:3], K
    word = (word-f)/8;
    this.G = f = word % 8;              //  [12:3], G
    word = (word-f)/8;
    f = word % 4;                       //  [10:2], L
    if (!inline) {
        this.L = f;
    }
    word = (word-f)/4;
    this.V = f = word % 8;              //   [7:3], V
    word = (word-f)/8;
    this.H = word % 8;                  //   [4:3], H
    word = (word - word % 0x10)/0x10;
    return word % 2;                    //   [2:1], DESC bit
};

/**************************************/
B5500Processor.prototype.enterCharModeInline = function() {
    /* Implements the 4441=CMN syllable */
    var bw;                             // local copy of B reg

    this.adjustAEmpty();                // flush TOS registers, but tank TOS value in A
    if (this.BROF) {
        this.A = this.B;                // tank the DI address in A
        this.adjustBEmpty();
    } else {
        this.loadAviaS();               // A = [S]: tank the DI address
    }
    this.B = this.buildRCW(0);
    this.adjustBEmpty();
    this.MSFF = 0;
    this.SALF = 1;
    this.F = this.S;
    this.R = 0;
    this.CWMF = 1;
    this.X = this.S * 0x8000;           // inserting S into X.[18:15], but X is zero at this point
    this.S = 0;
    this.B = bw = this.A;
    this.BROF = 1;
    this.AROF = 0;
    this.V = this.K = 0;

    // execute the portion of CM XX04=RDA operator starting at J=2
    if (bw < 0x800000000000) {                  // B contains an operand
        this.S = bw % 0x8000;
        this.K = (bw % 0x40000) >>> 15;
    } else {                                    // B contains a descriptor
        if (bw % 0x400000000000 < 0x200000000000) { // it's an absent descriptor
            if (this.NCSF) {
                // NOTE: docs do not mention if this is inhibited in control state, but we assume it is
                this.I = (this.I & 0x0F) | 0x70;    // set I05/6/7: P-bit
                this.cc.signalInterrupt();
            }
        } else {
            this.S = bw % 0x8000;
        }
    }
};

/**************************************/
B5500Processor.prototype.enterSubroutine = function(descriptorCall) {
    /* Enters a subroutine via the present program descriptor in A as part
    of an OPDC or DESC syllable. Also handles accidental entry */
    var aw = this.A;                    // local copy of word in A reg
    var bw;                             // local copy of word in B reg
    var arg = this.cc.bit(aw, 5);       // descriptor argument bit
    var mode = this.cc.bit(aw, 4);      // descriptor mode bit (1-char mode)

    if (arg && !this.MSFF) {
        ; // just leave the PD on TOS
    } else if (mode && !arg) {
        ; // ditto
    } else {
        // Now we are really going to enter the subroutine
        this.adjustBEmpty();
        if (!arg) {
            // Accidental entry -- mark the stack
            this.B = this.buildMSCW();
            this.adjustBEmpty();
        }

        // Push a RCW
        this.B = this.buildRCW(descriptorCall);
        this.adjustBEmpty();

        // Fetch the first word of subroutine code
        this.C = aw % 0x8000;
        this.L = 0;
        this.loadPviaC(); 

        // Fix up the rest of the registers
        if (arg) {
            this.F = this.S;
        } else {
            this.F = this.cc.fieldIsolate(aw, 18, 15);
        }
        this.AROF = 0;
        this.BROF = 0;
        this.SALF = 1;
        this.MSFF = 0;
        if (mode) {
            this.CWMF = 1;
            this.R = 0;
            this.X = this.cc.fieldInsert(this.X, 18, 15, this.S);
            this.S = 0;
        }
    }
};

/**************************************/
B5500Processor.prototype.exitSubroutine = function(inline) {
    /* Exits a subroutine by restoring the processor state from RCW and MSCW words
    in the stack. "inline" indicates the C & L registers are NOT restored from the
    RCW. The RCW is assumed to be in the B register, pointing to the MSCW.
    The A register is not affected by this routine. If SALF & MSFF bits in the MSCW
    are set, link back through the MSCWs until one is found that has either bit not
    set, and store that MSCW at [R]+7. This is the last prior MSCW that actually
    points to a RCW, thus skipping over any pending subroutine calls that are still
    building their parameters in the stack. Returns results as follows:
        0 = entered by OPDC
        1 = entered by DESC
        2 = flag bit interrupt set, terminate operator
    */
    var result;

    if (this.B < 0x800000000000) {      // flag bit not set
        result = 2;
        if (this.NCSF) {
            this.I = (this.I & 0x0F) | 0x80;    // set I08: flag-bit
            this.cc.signalInterrupt();
        }
    } else {                            // flag bit is set
        result = this.applyRCW(this.B, inline);
        this.X = this.B % 0x8000000000; // save F setting from MSCW to restore S at end

        this.S = this.F;
        this.loadBviaS();               // B = [S], fetch the MSCW
        this.applyMSCW(this.B);

        if (this.MSFF && this.SALF) {
            this.Q |= 0x20;             // set Q06F, not used except for display
            do {
                this.S = (this.B % 0x40000000) >>> 15;
                this.loadBviaS();       // B = [S], fetch prior MSCW
            } while (((this.B - this.B % 0x40000000)/0x40000000) % 4 == 3); // MSFF & SALF
            this.S = (this.R*64) + 7;
            this.storeBviaS();          // [S] = B, store last MSCW at [R]+7
        }
        this.S = ((this.X % 0x40000000) >>> 15) - 1;
        this.BROF = 0;
    }
    return result;
};

/**************************************/
B5500Processor.prototype.operandCall = function() {
    /* OPDC, the moral equivalent of "load accumulator" on lesser
    machines. Assumes the syllable has already loaded a word into A.
    See Figures 6-1, 6-3, and 6-4 in the B5500 Reference Manual */
    var aw;                             // local copy of A reg value
    var interrupted = 0;                // interrupt occurred

    aw = this.A;
    if (aw >= 0x800000000000) {
        // It's not a simple operand
        switch (this.cc.fieldIsolate(aw, 1, 3)) {
        case 2:
        case 3:
            // Present data descriptor
            if (this.cc.fieldIsolate(aw, 8, 10)) {
                interrupted = this.indexDescriptor();
            // else descriptor is already indexed (word count 0)
            }
            if (!interrupted) {
                this.M = this.A % 0x8000;
                this.loadAviaM();       // A = [M]
                if (this.A >= 0x800000000000 && this.NCSF) {
                    // Flag bit is set
                    this.I = (this.I & 0x0F) | 0x80;        // set I08: flag-bit interrupt
                    this.cc.signalInterrupt();
                }
            }
            break;

        case 7:
            // Present program descriptor
            this.enterSubroutine(0);
            break;

        case 0:
        case 1:
        case 5:
            // Absent data or program descriptor
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0x70;        // set I05/6/7: P-bit
                this.cc.signalInterrupt();
            // else if control state, we're done
            }
            break;

        default:
            // Miscellaneous control word -- leave as is
            break;
        }
    }

    // Reset variant-mode R-relative addressing, if enabled
    if (this.VARF && !interrupted) {
        this.SALF = 1;
        this.VARF = 0;
    }
};

/**************************************/
B5500Processor.prototype.descriptorCall = function() {
    /* DESC, the moral equivalent of "load address" on lesser machines. 
    Assumes the syllable has already loaded a word into A, and that the
    address of that word is in M.
    See Figures 6-2, 6-3, and 6-4 in the B5500 Reference Manual */
    var aw = this.A;                    // local copy of A reg value
    var interrupted = 0;                // interrupt occurred

    if (aw < 0x800000000000) {
        // It's a simple operand
        this.A = this.M + 0xA00000000000;
    } else {
        // It's not a simple operand
        switch (this.cc.fieldIsolate(aw, 1, 3)) {
        case 2:
        case 3:
            // Present data descriptor
            if (this.cc.fieldIsolate(aw, 8, 10)) {
                interrupted = this.indexDescriptor();
                this.A = this.cc.fieldInsert(this.A, 8, 10, 0);  // set word count to zero
            // else descriptor is already indexed (word count 0)
            }
            break;

        case 7:
            // Present program descriptor
            this.enterSubroutine(1);
            break;

        case 0:
        case 1:
        case 5:
            // Absent data or program descriptor
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0x70;        // set I05/6/7: p-bit
                this.cc.signalInterrupt();
            // else if control state, we're done
            }
            break;

        default:
            // Miscellaneous control word
            this.A = this.M + 0xA00000000000;
            break;
        }
    }

    // Reset variant-mode R-relative addressing, if enabled
    if (this.VARF && !interrupted) {
        this.SALF = 1;
        this.VARF = 0;
    }
};

/**************************************/
B5500Processor.prototype.run = function() {
    /* Instruction execution driver for the B5500 processor. This function is
    an artifact of the emulator design and does not represent any physical
    process or state of the processor. This routine assumes the registers are
    set up -- in particular there must be a syllable in T with TROF set, the
    current program word must be in P with PROF set, and the C & L registers
    must point to the next syllable to be executed.
    This routine will run while cycleCount < cycleLimit  */
    var noSECL = 0;                     // to support char mode dynamic count from CRF syllable
    var opcode;                         // copy of T register        
    var t1;                             // scratch variable for internal instruction use
    var t2;                             // ditto
    var t3;                             // ditto
    var t4;                             // ditto
    var variant;                        // high-order six bits of T register

    do {
        this.Q = 0;
        this.Y = 0;
        this.Z = 0;
        opcode = this.T;

        if (this.CWMF) {
            /***********************************************************
            *  Character Mode Syllables                                *
            ***********************************************************/
            variant = opcode >>> 6;
            do {                        // inner loop to support CRF dynamic repeat count
                noSECL = 0;             // force off by default (set by CRF)
                switch (opcode & 0x3F) {
                case 0x00:              // XX00: CMX, EXC: Exit character mode
                    this.adjustBEmpty();                // store destination string
                    this.S = this.F;
                    this.loadBviaS();                   // B = [S], fetch the RCW
                    this.exitSubroutine(variant & 0x01);// exit vs. exit inline
                    this.AROF = this.BROF = 0;
                    this.X = this.M = this.N = 0;
                    this.CWMF = 0;
                    break;

                case 0x02:              // XX02: BSD=Skip bit destination
                    this.cycleCount += variant;
                    t1 = this.K*6 + this.V + variant; 
                    while (t1 >= 48) {                  
                        if (this.BROF) {                // skipped off initial word, so
                            this.storeBviaS();          // [S] = B
                            this.BROF = 0;              // invalidate B
                        }
                        this.S++;                       
                        t1 -= 48;
                    }
                    this.K = (t1 - (this.V = t1 % 6))/6;
                    break;

                case 0x03:              // XX03: BSS=Skip bit source
                    this.cycleCount += variant;
                    t1 = this.G*6 + this.H + variant; 
                    while (t1 >= 48) {
                        this.M++;                       // skipped off initial word, so
                        this.AROF = 0;                  // invalidate A
                        t1 -= 48;
                    }
                    this.G = (t1 - (this.H = t1 % 6))/6;
                    break;

                case 0x04:              // XX04: RDA=Recall destination address
                    this.cycleCount += variant;
                    if (this.BROF) {
                        this.storeBviaS();              // [S] = B
                        this.BROF = 0;
                    }
                    this.S = this.F - variant;
                    this.loadBviaS();                   // B = [S]
                    this.S = this.B % 0x8000;
                    this.V = 0;
                    if (this.B >= 0x800000000000) {     // if it's a descriptor, 
                        this.K = 0;                     // force K to zero and
                        this.presenceTest(this.B);      // just take the side effect of any p-bit interrupt
                    } else {
                        this.K = this.cc.fieldIsolate(this.B, 18, 3);
                    }
                    break;

                case 0x05:              // XX05: TRW=Transfer words
                    if (this.BROF) {
                        this.storeBviaS();              // [S] = B
                        this.BROF = 0;
                    }
                    if (this.G || this.H) {
                        this.G = this.H = 0;
                        this.M++;
                        this.AROF = 0;
                    }
                    if (this.K || this.V) {
                        this.K = this.V = 0;
                        this.S++;
                    }
                    if (variant) {                      // count > 0
                        if (!this.AROF) {
                            this.loadAviaM();           // A = [M]
                        }
                        do {
                            this.storeAviaS();          // [S] = A
                            this.S++;
                            this.M++;
                            this.loadAviaM();           // A = [M]
                        } while (--variant);
                    }
                    break;

                case 0x06:              // XX06: SED=Set destination address
                    this.cycleCount += variant;
                    if (this.BROF) {
                        this.storeBviaS();              // [S] = B
                        this.BROF = 0;
                    }
                    this.S = this.F - variant;
                    this.K = this.V = 0;
                    break;

                case 0x07:              // XX07: TDA=Transfer destination address
                    this.cycleCount += 6;
                    this.streamAdjustDestChar();
                    if (this.BROF) {
                        this.storeBviaS();              // [S] = B, store B at dest addresss
                    }
                    t1 = this.M;                        // save M (not the way the hardware did it)
                    t2 = this.G;                        // save G (ditto)
                    this.M = this.S;                    // copy dest address to source address
                    this.G = this.K;
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M], load A from source address
                    }
                    for (variant=3; variant>0; variant--) {
                        this.B = (this.B % 0x100000000000000)*0x40 + (this.Y = this.cc.fieldIsolate(this.A, this.G*6, 6));
                        if (this.G < 7) {
                            this.G++;
                        } else {
                            this.G = 0;
                            this.M++;
                            this.loadAviaM();           // A = [M]
                        }
                    } 
                    this.S = this.B % 0x8000;
                    this.K = this.fieldIsolate(this.B, 18, 3);
                    this.M = t1;                        // restore M & G
                    this.G = t2;
                    this.AROF = this.BROF = 0;          // invalidate A & B
                    break;

                case 0x09:              // XX11: control state ops
                    switch (variant) {
                    case 0x14:          // 2411: ZPI=Conditional Halt
                        if (this.US14X) {               // STOP OPERATOR switch on
                            this.busy = 0;
                            this.cycleLimit = 0;        // exit this.run()
                        }
                        break;

                    case 0x18:          // 3011: SFI=Store for Interrupt
                        this.storeForInterrupt(0);
                        break;

                    case 0x1C:          // 3411: SFT=Store for Test
                        this.storeForInterrupt(1);
                        break;

                    default:            // Anything else is a no-op
                        break;
                    } // end switch for XX11 ops

                case 0x0A:              // XX12: TBN=Transfer blank for numeric
                    this.MSFF = 1;                      // initialize true-false FF
                    this.streamToDest(variant, function(bb, count) {
                        var c = this.Z = this.cc.fieldIsolate(this.B, bb, 6);
                        var result = 0;

                        if (c > 0 && c <= 9) {
                            this.MSFF = 0;              // numeric, non-zero: stop blanking
                            this.Q |= 0x04;             // set Q03F (display only)
                            result = 1;                 // terminate, pointing at this char
                        } else {
                            this.B = this.cc.fieldInsert(this.B, bb, 6, 0x30);   // replace with blank
                        }
                        return result;
                    });
                    break;

                case 0x0C:              // XX14: SDA=Store destination address
                    this.cycleCount += variant;
                    this.streamAdjustDestChar();
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    this.B = this.K*0x8000 * this.S;
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S -= variant;
                    this.storeBviaS();                  // [S] = B
                    this.S = t1;                        // restore S
                    this.B = this.A;                    // restore B from A
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x0D:              // XX15: SSA=Store source address
                    this.cycleCount += variant;
                    this.streamAdjustSourceChar();
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    this.B = this.G*0x8000 * this.M;
                    t1 = this.M;                        // save M (not the way the hardware did it)
                    this.M -= variant;
                    this.storeBviaM();                  // [M] = B
                    this.M = t1;                        // restore M
                    this.B = this.A;                    // restore B from A
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x0E:              // XX16: SFD=Skip forward destination
                    this.cycleCount += (variant >>> 3) + (variant & 0x07);
                    this.streamAdjustDestChar();
                    if (this.BROF && this.K + variant >= 8) {
                        this.storeBviaS();              // will skip off the current word,
                        this.BROF = 0;                  // so store and invalidate B
                    }
                    t1 = this.S*8 + this.K - variant;
                    this.S = t1 >>> 3;
                    this.K = t1 & 0x07;
                    break;

                case 0x0F:              // XX17: SRD=Skip reverse destination
                    this.cycleCount += (variant >>> 3) + (variant & 0x07);
                    this.streamAdjustDestChar();
                    if (this.BROF && this.K < variant) {
                        this.storeBviaS();              // will skip off the current word,
                        this.BROF = 0;                  // so store and invalidate B
                    }
                    t1 = this.S*8 + this.K - variant;
                    this.S = t1 >>> 3;
                    this.K = t1 & 0x07;
                    break;
                    break;

                case 0x12:              // XX22: SES=Set source address
                    this.cycleCount += variant;
                    this.M = this.F - variant;
                    this.G = this.H = 0;
                    this.AROF = 0;
                    break;

                case 0x14:              // XX24: TEQ=Test for equal
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = this.cc.fieldIsolate(this.A, this.G*6, 6);
                    this.MSFF = (t1 == variant ? 1 : 0);
                    break;

                case 0x15:              // XX25: TNE=Test for not equal
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = this.cc.fieldIsolate(this.A, this.G*6, 6);
                    this.MSFF = (t1 != variant ? 1 : 0);
                    break;

                case 0x16:              // XX26: TEG=Test for equal or greater
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 >= t2 ? 1 : 0);
                    break;

                case 0x17:              // XX27: TGR=Test for greater
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 > t2 ? 1 : 0);
                    break;

                case 0x18:              // XX30: SRS=Skip reverse source
                    this.cycleCount += (variant >>> 3) + (variant & 0x07);
                    this.streamAdjustSourceChar();
                    if (this.G < variant) {
                        this.AROF = 0;                  // will skip off the current word
                    }
                    t1 = this.M*8 + this.G - variant;
                    this.M = t1 >>> 3;
                    this.G = t1 & 0x07;
                    break;

                case 0x19:              // XX31: SFS=Skip forward source
                    this.cycleCount += (variant >>> 3) + (variant & 0x07);
                    this.streamAdjustSourceChar();
                    if (this.G + variant >= 8) {        // will skip off the current word
                        this.AROF = 0;
                    }
                    t1 = this.M*8 + this.G + variant;
                    this.G = t1 & 0x07;
                    this.M = t1 >>> 3;
                    break;

                case 0x1A:              // XX32: ---=Field subtract (aux)       !! ??
                    this.fieldArithmetic(variant, false);
                    break;

                case 0x1B:              // XX33: ---=Field add (aux)            !! ??
                    this.fieldArithmetic(variant, true);
                    break;

                case 0x1C:              // XX34: TEL=Test for equal or less
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 <= t2 ? 1 : 0);
                    break;

                case 0x1D:              // XX35: TLS=Test for less
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 < t2 ? 1 : 0);
                    break;

                case 0x1E:              // XX36: TAN=Test for alphanumeric
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    this.Y = t1 = this.cc.fieldIsolate(this.A, this.G*6, 6);
                    this.Z = variant;                   // for display only
                    if (B5500Processor.collate[t1] > B5500Processor.collate[variant]) {       // alphanumeric unless | or !
                        this.MSFF = (t1 == 0x20 ? 0 : (t1 == 0x3C ? 0 : 1));
                    } else {                            // alphanumeric if equal
                        this.Q |= 0x04;                 // set Q03F (display only)
                        this.MSFF = (t1 == variant ? 1 : 0);
                    }
                    break;

                case 0x1F:              // XX37: BIT=Test bit
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = (this.Y = this.cc.fieldIsolate(this.A, this.G*6, 6)) >>> 5-this.H;
                    this.MSFF = ((t1 & 0x01) == (variant & 0x01) ? 1 : 0);
                    break;

                case 0x20:              // XX40: INC=Increase TALLY
                    if (variant) {
                        this.R = (this.R + variant) & 0x3F;
                    // else it's a character-mode no-op
                    }
                    break;

                case 0x21:              // XX41: STC=Store TALLY
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B
                    this.AROF = 0;                      // invalidate A
                    this.B = this.F;                    // save RCW address in B (why??)
                    if (this.BROF) {
                        this.storeAviaS();              // [S] = A, save original B contents
                        this.BROF = 0;
                    }
                    this.A = this.B;                    // move saved F address to A (why??)
                    this.B = this.R;                    // copy the TALLY value to B
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;          
                    this.storeBviaS();                  // [S] = B, store the TALLY value
                    this.B = this.A;                    // restore F address from A (why??)
                    this.S = t1;                        // restore S
                    this.BROF = 0;                      // invalidate B
                    break;

                case 0x22:              // XX42: SEC=Set TALLY
                    this.R = variant;
                    break;

                case 0x23:              // XX43: CRF=Call repeat field
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B in A
                    this.AROF = this.BROF;
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;          // compute parameter address
                    this.loadBviaS();                   // B = [S]
                    variant = this.B % 0x40;            // dynamic repeat count is low-order 6 bits
                    this.S = t1;                        // restore S
                    this.B = this.A;                    // restore B from A
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    noSECL = 1;                         // >>> override normal instruction fetch <<<
                    opcode = this.cc.fieldIsolate(this.P, this.L*12, 12);
                    if (variant) {                      // if repeat count from parameter > 0
                        this.T = opcode & 0x3F + variant*0x40;  // apply it to the next syl
                    } else {                            // otherwise construct JFW (XX47) using
                        this.T = (opcode & 0xFC0) + 0x27;       // repeat count from next syl (whew!)
                    }
                    break;

                case 0x24:              // XX44: JNC=Jump out of loop conditional
                    if (!this.MSFF) {
                        this.jumpOutOfLoop(variant);
                    }
                    break;

                case 0x25:              // XX45: JFC=Jump forward conditional
                    if (!this.MSFF) {                   // conditional on TFFF
                        this.cycleCount += (variant >>> 2) + (variant & 0x03);
                        this.jump(variant, false);
                    }
                    break;

                case 0x26:              // XX46: JNS=Jump out of loop
                    this.jumpOutOfLoop(variant);
                    break;

                case 0x27:              // XX47: JFW=Jump forward unconditional
                    this.cycleCount += (variant >>> 2) + (variant & 0x03);
                    this.jump(variant, false);
                    break;

                case 0x28:              // XX50: RCA=Recall control address
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B in A 
                    this.AROF = this.BROF;
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;
                    this.loadBviaS();                   // B = [S]
                    this.S = t1;
                    this.C = this.B % 0x8000;
                    if (this.B >= 0x800000000000) {     // if it's a descriptor, 
                        this.L = 0;                     // force L to zero and
                        if (this.presenceTest(this.B)) {// if present, initiate a fetch to P
                            this.loadPviaC();           // P = [C]
                        }
                    } else {
                        t1 = this.cc.fieldIsolate(this.B, 10, 2);
                        if (t1 < 3) {                   // if not a descriptor, increment the address
                            this.L = t1+1;
                        } else {
                            this.L = 0;
                            this.C++;
                        }
                        this.loadPviaC();               // P = [C]
                    }
                    this.B = this.A;                    // restore B
                    this.BROF = this.AROF
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x29:              // XX51: ENS=End loop
                    this.cycleCount += 4;
                    this.A = this.B;                    // save B in A 
                    this.AROF = this.BROF;
                    t1 = this.X;
                    variant = this.cc.fieldIsolate(t1, 12, 6);  // get repeat count
                    if (variant) {                      // loop count exhausted?
                        this.C = this.cc.fieldIsolate(t1, 33, 15);      // no, restore C, L, and P to loop again
                        this.L = this.cc.fieldIsolate(t1, 10, 2);
                        this.loadPviaC();               // P = [C]
                        this.X = this.cc.fieldInsert(t1, 12, 6, variant-1);     // store decremented count in X
                    } else {
                        t2 = this.S;                    // save S (not the way the hardware did it)
                        this.S = this.cc.fieldIsolate(t1, 18, 15);      // get prior LCW addr from X value
                        this.loadBviaS();               // B = [S], fetch prior LCW from stack
                        this.S = t2;                    // restore S
                        this.X = this.cc.fieldIsolate(this.B, 9, 39);   // store prior LCW (less control bits) in X
                    }
                    this.B = this.A;                    // restore B
                    this.BROF = this.AROF
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2A:              // XX52: BNS=Begin loop
                    this.cycleCount += 4;
                    this.A = this.B;                    // save B in A (note that BROF is not altered)
                    t1 = this.cc.fieldInsert(           // construct new LCW: insert repeat count
                            this.cc.fieldInsert(        // insert L
                                this.cc.fieldInsert(this.X, 33, 15, this.C), // insert C
                                10, 2, this.L),
                            12, 6, (variant ? variant-1 : 0));  // decrement count for first iteration
                    this.B = this.cc.fieldInsert(this.X, 0, 2, 3);      // set control bits [0:2]=3
                    t2 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.cc.fieldIsolate(t1, 18, 15)+1;        // get F value from X value and ++
                    this.storeBviaS();                  // [S] = B, save prior LCW in stack
                    this.X = this.cc.fieldInsert(t1, 18, 15, this.S);   // update F value in X
                    this.S = t2;                        // restore S
                    this.B = this.A;                    // restore B (note that BROF is still relevant)
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2B:              // XX53: RSA=Recall source address
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    this.M = this.F - variant;
                    this.loadBviaM();                   // B = [M]
                    this.M = this.B % 0x8000;
                    this.H = 0;
                    if (this.B >= 0x800000000000) {     // if it's a descriptor, 
                        this.G = 0;                     // force G to zero and
                        this.presenceTest(this.B);      // just take the side effect of any p-bit interrupt
                    } else {
                        this.G = this.cc.fieldIsolate(this.B, 18, 3);
                    }
                    this.B = this.A;                    // restore B from A
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2C:              // XX54: SCA=Store control address
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    t2 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;          // compute store address
                    this.B = this.fieldInsert(          // construct control address: reset flag bit
                            this.cc.fieldInsert(        // insert F (as saved in t2)
                                this.cc.fieldInsert(    // insert L
                                    this.cc.fieldInsert(this.B, 33, 15, this.C), // insert C
                                    10, 2, this.L),
                                18, 15, t2),  
                            0, 1, 0);      
                    this.storeBviaS();                  // [S] = B
                    this.S = t2;                        // restore S
                    this.B = this.A;                    // restore B from A
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2D:              // XX55: JRC=Jump reverse conditional
                    if (!this.MSFF) {                   // conditional on TFFF
                        this.cycleCount += (variant >>> 2) + (variant & 0x03);
                        this.jump(-variant, false);
                    }
                    break;

                case 0x2E:              // XX56: TSA=Transfer source address
                    this.streamAdjustSourceChar();
                    if (this.BROF) {
                        this.storeBviaS();              // [S] = B, store B at dest addresss
                        this.BROF = 0;
                    }
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M], load A from source address
                    }
                    for (variant=3; variant>0; variant--) {
                        this.B = (this.B % 0x100000000000000)*0x40 + (this.Y = this.cc.fieldIsolate(this.A, this.G*6, 6));
                        if (this.G < 7) {
                            this.G++;
                        } else {
                            this.G = 0;
                            this.M++;
                            this.loadAviaM();           // A = [M]
                        }
                    } 
                    this.M = this.B % 0x8000;
                    this.G = this.fieldIsolate(this.B, 18, 3);
                    break;

                case 0x2F:              // XX57: JRV=Jump reverse unconditional
                    this.cycleCount += (variant >>> 2) + (variant & 0x03);
                    this.jump(-variant, false);
                    break;

                case 0x30:              // XX60: CEQ=Compare equal
                    this.compareSourceWithDest(variant);
                    this.MSFF = (this.Q & 0x04 ? 0 : 1);                // if !Q03F, S=D
                    break;

                case 0x31:              // XX61: CNE=Compare not equal
                    this.compareSourceWithDest(variant);
                    this.MSFF = (this.Q & 0x04 ? 1 : 0);                // if Q03F, S!=D
                    break;

                case 0x32:              // XX62: CEG=Compare greater or equal
                    this.compareSourceWithDest(variant);
                    this.MSFF = (this.Q & 0x04 ? this.MSFF : 1);        // if Q03F&MSFF, S>D; if !Q03F, S=D
                    break;

                case 0x33:              // XX63: CGR=Compare greater
                    this.compareSourceWithDest(variant);
                    this.MSFF = (this.Q & 0x04 ? this.MSFF : 0);        // if Q03F&MSFF, S>D
                    break;

                case 0x34:              // XX64: BIS=Set bit
                    this.streamBitsToDest(variant, 0xFFFFFFFFFFFF);
                    break;

                case 0x35:              // XX65: BIR=Reset bit
                    this.streamBitsToDest(variant, 0);
                    break;

                case 0x36:              // XX66: OCV=Output convert
                    this.streamOutputConvert(variant);
                    break;

                case 0x37:              // XX67: ICV=Input convert
                    this.streamInputConvert(variant);
                    break;

                case 0x38:              // XX70: CEL=Compare equal or less
                    this.compareSourceWithDest(variant);
                    this.MSFF = (this.Q & 0x04 ? 1-this.MSFF : 1);      // if Q03F&!MSFF, S<D; if !Q03F, S=D
                    break;

                case 0x39:              // XX71: CLS=Compare less
                    this.compareSourceWithDest(variant);
                    this.MSFF = (this.Q & 0x04 ? 1-this.MSFF : 0);      // if Q03F&!MSFF, S<D
                    break;

                case 0x3A:              // XX72: FSU=Field subtract
                    this.fieldArithmetic(variant, false);
                    break;

                case 0x3B:              // XX73: FAD=Field add
                    this.fieldArithmetic(variant, true);
                    break;

                case 0x3C:              // XX74: TRP=Transfer program characters
                    this.streamAdjustDestChar();
                    if (variant) {                      // count > 0
                        if (!this.BROF) {
                            this.loadBviaS();           // B = [S]
                        }
                        this.cycleCount += variant;     // approximate the timing
                        t1 = (this.L*2 + variant & 0x01)*6;     // P-reg bit number
                        t2 = this.K*6;                          // B-reg bit number
                        do {
                            this.Y = this.cc.fieldIsolate(this.P, t1, 6);
                            this.B = this.cc.fieldInsert(this.B, t2, 6, this.Y)
                            if (t2 < 42) {
                                t2 += 6;
                                this.K++;
                            } else {
                                t2 = 0;
                                this.K = 0;
                                this.storeBviaS();      // [S] = B
                                this.S++;
                                if (variant < 8) {      // just a partial word left
                                    this.loadBviaS();   // B = [S]
                                }
                            }
                            if (t1 < 42) {
                                t1 += 6;
                                if (!(variant & 0x01)) {
                                    this.L++;
                                }
                            } else {
                                t1 = 0;
                                this.L = 0;
                                this.C++;
                                this.loadPviaC();       // P = [C]
                            }
                        } while (--variant);
                    }
                    break;

                case 0x3D:              // XX75: TRN=Transfer source numerics
                    this.MSFF = 0;                      // initialize true-false FF
                    this.streamSourceToDest(variant, function(bb, count) {
                        var c = this.Y;

                        if (count == 1 && (c & 0x30) == 0x20) {
                            this.MSFF = 1;              // neg. sign
                        }
                        this.B = this.cc.fieldInsert(this.B, bb, 6, c & 0x0F);
                    });
                    break;

                case 0x3E:              // XX76: TRZ=Transfer source zones
                    this.streamSourceToDest(variant, function(bb, count) {
                        this.B = this.cc.fieldInsert(this.B, bb, 2, this.Y);
                    });
                    break;

                case 0x3F:              // XX77: TRS=Transfer source characters
                    this.streamSourceToDest(variant, function(bb, count) {
                        this.B = this.cc.fieldInsert(this.B, bb, 6, this.Y);
                    });
                    break;

                default:                // everything else is a no-op
                    break;
                } // end switch for character mode operators
            } while (noSECL);
            
        } else {
        
            /***********************************************************
            *  Word Mode Syllables                                     *
            ***********************************************************/
            this.M = 0;
            this.N = 0;
            this.X = 0;
            switch (opcode & 0x03) {
            case 0:                     // LITC: Literal Call
                this.adjustAEmpty();
                this.A = opcode >>> 2;
                this.AROF = 1;
                break;

            case 2:                     // OPDC: Operand Call
                this.adjustAEmpty();
                computeRelativeAddr(opcode >>> 2, 1);
                this.loadAviaM();                   // A = [M]
                this.operandCall();
                break;

            case 3:                     // DESC: Descriptor (name) Call
                this.adjustAEmpty();
                computeRelativeAddr(opcode >>> 2, 1);
                this.loadAviaM();                       // A = [M]
                this.descriptorCall();
                break;

            case 1:                     // all other word-mode operators
                variant = opcode >>> 6;
                switch (opcode & 0x3F) {
                case 0x01:              // XX01: single-precision numerics
                    switch (variant) {
                    case 0x01:          // 0101: ADD=single-precision add
                        this.singlePrecisionAdd(true);
                        break;

                    case 0x03:          // 0301: SUB=single-precision subtract
                        this.singlePrecisionAdd(false);
                        break;

                    case 0x04:          // 0401: MUL=single-precision multiply
                        this.singlePrecisionMultiply();
                        break;

                    case 0x08:          // 1001: DIV=single-precision floating divide
                        this.singlePrecisionDivide();
                        break;

                    case 0x18:          // 3001: IDV=integer divide
                        this.integerDivide();
                        break;

                    case 0x38:          // 7001: RDV=remainder divide
                        this.remainderDivide();
                        break;
                    }
                    break;

                case 0x05:              // XX05: double-precision numerics
                    switch (variant) {
                    case 0x01:          // 0105: DLA=double-precision add
                        this.doublePrecisionAdd(true);
                        break;

                    case 0x03:          // 0305: DLS=double-precision subtract
                        this.doublePrecisionAdd(false);
                        break;

                    case 0x04:          // 0405: DLM=double-precision multiply
                        this.adjustABFull();                    // FOR NOW, just do SP multiply
                        this.BROF = 0;                          // wipe out the first mantissa extension
                        this.adjustBFull();                     // get second mantissa
                        this.S--;                               // wipe out the second mantissa extension
                        this.singlePrecisionMultiply();
                        this.A = this.B;                        // move high-order result to A
                        this.AROF = 1;
                        this.B = 0;                             // set low-order result to 0 in B
                        break;

                    case 0x08:          // 1005: DLD=double-precision floating divide
                        this.adjustABFull();                    // FOR NOW, just do SP divide
                        this.BROF = 0;                          // wipe out the first mantissa extension
                        this.adjustBFull();                     // get second mantissa
                        this.S--;                               // wipe out the second mantissa extension
                        this.singlePrecisionDivide();
                        this.A = this.B;                        // move high-order result to A
                        this.AROF = 1;
                        this.B = 0;                             // set low-order result to 0 in B
                        break;
                    }
                    break;

                case 0x09:              // XX11: control state and communication ops
                    switch (variant) {
                    case 0x01:          // 0111: PRL=Program Release
                        break;

                    case 0x02:          // 0211: ITI=Interrogate Interrupt
                        if (this.cc.IAR && !this.NCSF) {        // control-state only
                            this.C = this.cc.IAR;
                            this.L = 0;
                            this.S = 0x40;                      // stack address @100
                            this.cc.clearInterrupt();
                            this.loadPviaC();                   // P = [C]
                        }
                        break;

                    case 0x04:          // 0411: RTR=Read Timer
                        if (!this.NCSF) {               // control-state only
                            this.adjustAEmpty();
                            this.A = this.cc.CCI03F*64 + this.cc.TM;
                            this.AROF = 1;
                        }
                        break;

                    case 0x08:          // 1011: COM=Communicate
                        if (this.NCSF) {                        // no-op in control state
                            this.M = (this.R*64) + 0x09;        // address = R+@11
                            if (this.AROF) {
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            } else {
                                this.adjustBFull();
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            }
                            this.I = (this.I & 0x0F) | 0x40;    // set I07
                            this.cc.signalInterrupt();
                        }
                        break;

                    case 0x11:          // 2111: IOR=I/O Release
                        break;

                    case 0x12:          // 2211: HP2=Halt Processor 2
                        if (!this.NCSF) {               // control-state only
                            this.cc.haltP2();
                        }
                        break;

                    case 0x14:          // 2411: ZPI=Conditional Halt
                        if (this.US14X) {               // STOP OPERATOR switch on
                            this.busy = 0;
                            this.cycleLimit = 0;        // exit this.run()
                        }
                        break;

                    case 0x18:          // 3011: SFI=Store for Interrupt
                        this.storeForInterrupt(0);
                        break;

                    case 0x1C:          // 3411: SFT=Store for Test
                        this.storeForInterrupt(1);
                        break;

                    case 0x21:          // 4111: IP1=Initiate Processor 1
                        if (!this.NCSF) {               // control-state only
                            this.initiate(0);
                        }
                        break;

                    case 0x22:          // 4211: IP2=Initiate Processor 2
                        if (!this.NCSF) {                       // control-state only
                            this.M = 0x08;                      // INCW is stored in @10
                            if (this.BROF && !this.AROF) {
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            } else {
                                this.adjustAFull();
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            }
                            this.cc.initiateP2();
                            this.cycleLimit = 0;                // give P2 a chance to run
                        }
                        break;

                    case 0x24:          // 4411: IIO=Initiate I/O
                        if (!this.NCSF) {
                            this.M = 0x08;                      // address of IOD is stored in @10
                            if (this.BROF && !this.AROF) {
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            } else {
                                this.adjustAFull();
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            }
                            this.cc.initiateIO();               // let CentralControl choose the I/O Unit
                            this.cycleLimit = 0;                // give the I/O a chance to start
                        }
                        break;

                    case 0x29:          // 5111: IFT=Initiate For Test
                        if (!this.NCSF) {                       // control-state only
                            this.initiate(1);
                        }
                        break;
                    } // end switch for XX11 ops
                    break;

                case 0x0D:              // XX15: logical (bitmask) ops
                    switch (variant) {
                    case 0x01:          // 0115: LNG=logical negate
                        this.adjustAFull();
                        t1 = this.A % 0x1000000;
                        t2 = (this.A - t1) / 0x1000000;
                        this.A = (t2 ^ 0x7FFFFF)*0x1000000 + (t1 ^ 0xFFFFFF);
                        break;

                    case 0x02:          // 0215: LOR=logical OR
                        this.adjustABFull();
                        t1 = this.A % 0x1000000;
                        t2 = (this.A - t1) / 0x1000000;
                        t3 = this.B % 0x1000000;
                        t4 = (this.B - t3) / 0x1000000;
                        this.A = (t4 | (t2 & 0x7FFFFF))*0x1000000 + (t1 | t3);
                        this.BROF = 0;
                        break;

                    case 0x04:          // 0415: LND=logical AND
                        this.adjustABFull();
                        t1 = this.A % 0x1000000;
                        t2 = (this.A - t1) / 0x1000000;
                        t3 = this.B % 0x1000000;
                        t4 = (this.B - t3) / 0x1000000;
                        this.A = ((t4 & 0x800000) | (t2 & t4 & 0x7FFFFF))*0x1000000 + (t1 & t3);
                        this.BROF = 0;
                        break;

                    case 0x08:          // 1015: LQV=logical EQV
                        this.cycleCount += 16;
                        this.adjustABFull();
                        t1 = this.A % 0x1000000;
                        t2 = (this.A - t1) / 0x1000000;
                        t3 = this.B % 0x1000000;
                        t4 = (this.B - t3) / 0x1000000;
                        this.B = ((t4 & 0x800000) | ((~(t2 ^ t4)) & 0x7FFFFF))*0x1000000 + ((~(t1 ^ t3)) & 0xFFFFFF);
                        this.AROF = 0;
                        break;

                    case 0x10:          // 2015: MOP=reset flag bit (make operand)
                        this.adjustAFull();
                        if (this.A >= 0x800000000000) {
                            this.A %= 0x800000000000;
                        }
                        break;

                    case 0x20:          // 4015: MDS=set flag bit (make descriptor)
                        this.adjustAFull();
                        if (this.A < 0x800000000000) {
                            this.A += 0x800000000000;
                        }
                        break;
                    }
                    break;

                case 0x11:              // XX21: load & store ops
                    switch (variant) {
                    case 0x01:          // 0121: CID=Conditional integer store descructive
                        break;

                    case 0x02:          // 0221: CIN=Conditional integer store nondestructive
                        break;

                    case 0x04:          // 0421: STD=Store destructive
                        break;

                    case 0x08:          // 1021: SND=Store nondestructive
                        break;

                    case 0x10:          // 2021: LOD=Load operand
                        break;

                    case 0x21:          // 4121: ISD=Integer store destructive
                        break;

                    case 0x22:          // 4221: ISN=Integer store nondestructive
                        break;
                    }
                    break;

                case 0x15:              // XX25: comparison & misc. stack ops
                    switch (variant) {
                    case 0x01:          // 0125: GEQ=compare B greater or equal to A
                        this.B = (this.singlePrecisionCompare() >= 0 ? 1 : 0);
                        break;

                    case 0x02:          // 0225: GTR=compare B greater to A
                        this.B = (this.singlePrecisionCompare() > 0 ? 1 : 0);
                        break;

                    case 0x04:          // 0425: NEQ=compare B not equal to A
                        this.B = (this.singlePrecisionCompare() != 0 ? 1 : 0);
                        break;

                    case 0x08:          // 1025: XCH=exchange TOS words
                        this.exchangeTOS();
                        break;

                    case 0x0C:          // 1425: FTC=F field to core field
                        break;

                    case 0x10:          // 2025: DUP=Duplicate TOS
                        if (this.AROF) {
                            this.adjustBEmpty();
                            this.B = this.A;
                            this.BROF = 1;
                        } else {
                            this.adjustBFull();
                            this.A = this.B;
                            this.AROF = 1;
                        }
                        break;

                    case 0x1C:          // 3425: FTF=F field to F field
                        break;

                    case 0x21:          // 4125: LEQ=compare B less or equal to A
                        this.B = (this.singlePrecisionCompare() <= 0 ? 1 : 0);
                        break;

                    case 0x22:          // 4225: LSS=compare B less to A
                        this.B = (this.singlePrecisionCompare() < 0 ? 1 : 0);
                        break;

                    case 0x24:          // 4425: EQL=compare B equal to A
                        this.B = (this.singlePrecisionCompare() == 0 ? 1 : 0);
                        break;

                    case 0x2C:          // 5425: CTC=core field to C field
                        break;

                    case 0x3C:          // 7425: CTF=core field to F field
                        break;
                    }
                    break;

                case 0x19:              // XX31: branch, sign-bit, interrogate ops
                    switch (variant) {
                    case 0x01:          // 0131: BBC=branch backward conditional
                        break;

                    case 0x02:          // 0231: BFC=branch forward conditional
                        break;

                    case 0x04:          // 0431: SSN=set sign bit (set negative)
                        this.adjustAFull();
                        t1 = this.A % 0x400000000000;
                        t2 = (this.A - t1)/0x400000000000;
                        this.A = ((t2 & 0x03) | 0x01)*0x400000000000 + t1;
                        break;

                    case 0x08:          // 1031: CHS=change sign bit
                        this.adjustAFull();
                        t1 = this.A % 0x400000000000;
                        t2 = (this.A - t1)/0x400000000000;
                        this.A = ((t2 & 0x03) ^ 0x01)*0x400000000000 + t1;
                        break;

                    case 0x10:          // 2031: TOP=test flag bit (test for operand)
                        this.adjustAEmpty();
                        this.adjustBFull();
                        this.A = (this.B % 0x800000000000 ? 0 : 1);
                        this.AROF = 1;
                        break;

                    case 0x11:          // 2131: LBC=branch backward word conditional
                        break;

                    case 0x12:          // 2231: LFC=branch forward word conditional
                        break;

                    case 0x14:          // 2431: TUS=interrogate peripheral status
                        this.adjustAEmpty();
                        this.A = this.cc.interrogateUnitStatus();
                        this.AROF = 1;
                        break;

                    case 0x21:          // 4131: BBW=branch backward unconditional
                        break;

                    case 0x22:          // 4231: BFW=branch forward unconditional
                        break;

                    case 0x24:          // 4431: SSP=reset sign bit (set positive)
                        this.adjustAFull();
                        t1 = this.A % 0x400000000000;
                        t2 = (this.A - t1)/0x400000000000;
                        this.A = (t2 & 0x02)*0x400000000000 + t1;
                        break;

                    case 0x31:          // 6131: LBU=branch backward word unconditional
                        break;

                    case 0x32:          // 6231: LFU=branch forward word unconditional
                        break;

                    case 0x34:          // 6431: TIO=interrogate I/O channel
                        this.adjustAEmpty();
                        this.A = this.cc.interrogateIOChannel();
                        this.AROF = 1;
                        break;

                    case 0x38:          // 7031: FBS=stack search for flag
                        // Handbook (bit numbers not reversed!):
                        //   M + 1, Load A @ M; // why is this incrementing here?
                        //   A48 & A46 <- 1
                        //   A47 <- 0, A[45=>16] <- 0;
                        //   A[15=>1] <- M
                        // RefMan:
                        //   stack pop? // described as "Pushup into A occurs if necessary..."
                        //   isolate lowest 15-bits of TOS // is this A?
                        //   loop
                        //     examine word at this base address
                        //     if flag bit(0) is true, place address in A, present bit(2) is set, exit loop
                        //     else increment address
                        //   end loop
                        this.AROF = 1;
                        break;
                    }
                    break;

                case 0x1D:              // XX35: exit & return ops
                    switch (variant) {
                    case 0x01:          // 0135: BRT=branch return
                        adjustAEmpty();
                        if (!this.BROF) {
                            this.Q |= 0x04;             // Q03F: not used, except for display purposes
                            adjustBFull();
                        }
                        if (this.presenceTest(this.B)) {
                            this.S = (this.B % 0x40000000) >>> 15;
                            this.C = this.B % 0x8000;
                            this.loadPviaC();           // P = [C]
                            this.L = 0;
                            this.loadBviaS();           // B = [S], fetch MSCW
                            this.S--;
                            this.applyMSCW(this.B);
                            this.BROF = 0;
                        }
                        break;

                    case 0x02:          // 0235: RTN=return normal
                        this.adjustAFull();
                        this.S = this.F;
                        this.loadBviaS();               // B = [S], fetch the RCW
                        switch (this.exitSubroutine(0)) {
                        case 0:
                            this.X = 0;
                            operandCall();
                        case 1:
                            this.Q |= 0x10;             // set Q05F, for display only
                            this.X = 0;
                            descriptorCall();
                        }
                        break;

                    case 0x04:          // 0435: XIT=exit procedure
                        this.AROF = 0;
                        this.S = this.F;
                        this.loadBviaS();               // B = [S], fetch the RCW
                        this.exitSubroutine(0);
                        break;

                    case 0x0A:          // 1235: RTS=return special
                        this.adjustAFull();
                        this.loadBviaS();               // B = [S], fetch the RCW
                        switch (this.exitSubroutine(0)) {
                        case 0:
                            this.X = 0;
                            operandCall();
                        case 1:
                            this.Q |= 0x10;             // set Q05F, for display only
                            this.X = 0;
                            descriptorCall();
                        case 2:                         // flag-bit interrupt occurred, do nothing
                            break;
                        }
                        break;
                    }
                    break;

                case 0x21:              // XX41: index, mark stack, etc.
                    switch (variant) {
                    case 0x01:          // 0141: INX=index
                        this.adjustABFull();
                        t1 = this.A % 0x8000;
                        this.M = (t1 + this.B % 0x8000) & 0x7FFF;
                        this.A += this.M - t1;
                        this.BROF = 0;
                        break;

                    case 0x02:          // 0241: COC=construct operand call
                        this.exchangeTOS();
                        this.A = this.cc.bitSet(this.A, 0);
                        this.operandCall();
                        break;

                    case 0x04:          // 0441: MKS=mark stack
                        this.adjustABEmpty();
                        this.B = this.buildMSCW();
                        this.adjustBEmpty();
                        this.F = this.S;
                        if (!this.MSFF) {
                            if (this.SALF) {            // store the MSCW at R+7
                                this.M = (this.R*64) + 7;
                                this.storeBviaM();      // [M] = B
                            }
                            this.MSFF = 1;
                        }
                        break;

                    case 0x0A:          // 1241: CDC=construct descriptor call
                        this.exchangeTOS();
                        this.A = this.cc.bitSet(this.A, 0);
                        this.descriptorCall();
                        break;

                    case 0x11:          // 2141: SSF=F & S register set/store
                        break;

                    case 0x15:          // 2541: LLL=link list lookup
                        break;

                    case 0x24:          // 4441: CMN=enter character mode inline
                        this.enterCharModeInline();
                        break;
                    }
                    break;

                case 0x25:              // XX45: ISO=Variable Field Isolate op
                    this.adjustAFull();
                    t2 = variant >>> 3;                         // number of whole chars
                    if (t2) {
                        t1 = this.G*6 + this.H;                 // starting source bit position
                        t2 = t2*6 - (variant & 7);              // number of bits
                        if (t1+t2 <= 48) {
                            this.A = this.cc.fieldIsolate(this.A, t1, t2);
                        } else {                                // handle wrap-around in the source value
                            this.A = this.cc.fieldInsert(
                                    this.cc.fieldIsolate(this.A, 96-t1-t2, t1+t2-48), 48-t2, 48-t1,
                                    this.cc.fieldIsolate(this.A, 0, 48-t1));
                        }
                        // approximate the shift cycle counts
                        this.cycleCount += (variant >>> 3) + (variant & 7) + this.G + this.H;
                        this.G = (this.G + variant >>> 3) & 7;
                        this.H = 0;
                    }
                    break;

                case 0x29:              // XX51: delete & conditional branch ops
                    if (variant == 0) { // 0051=DEL: delete TOS
                       if (this.AROF) {
                           this.AROF = 0;
                       } else if (this.BROF) {
                           this.BROF = 0;
                       } else {
                           this.S--;
                       }
                    } else {
                        switch (variant & 0x03) {
                        case 0x00:      // X051/X451: CFN=non-zero field branch forward nondestructive
                            break;

                        case 0x01:      // X151/X551: CBN=non-zero field branch backward nondestructive
                            break;

                        case 0x02:      // X251/X651: CFD=non-zero field branch forward destructive
                            break;

                        case 0x03:      // X351/X751: CBD=non-zero field branch backward destructive
                            break;
                        }
                    }
                    break;

                case 0x2D:              // XX55: NOP & DIA=Dial A ops
                    if (opcode & 0xFC0) {
                        this.G = variant >>> 3;
                        this.H = (variant) & 7;
                    // else             // 0055: NOP=no operation (the official one, at least)
                    }
                    break;

                case 0x31:              // XX61: XRT & DIB=Dial B ops
                    if (opcode & 0xFC0) {
                        this.K = variant >>> 3;
                        this.V = (variant) & 7;
                    } else {            // 0061=XRT: temporarily set full PRT addressing mode
                        this.VARF = this.SALF;
                        this.SALF = 0;
                    }
                    break;

                case 0x35:              // XX65: TRB=Transfer Bits
                    this.adjustABFull();
                    t1 = this.G*6 + this.H;     // A register starting bit nr
                    if (t1+variant > 48) {
                        variant = 48-t1;
                    }
                    t2 = this.K*6 + this.V;     // B register starting bit nr
                    if (t2+variant > 48) {
                        variant = 48-t2;
                    }
                    if (variant > 0) {
                        this.B = this.cc.fieldTransfer(this.B, t2, variant, this.A, t1);
                    }
                    this.AROF = 0;
                    this.cycleCount += variant + this.G + this.K;       // approximate the shift counts
                    break;

                case 0x39:              // XX71: FCL=Compare Field Low
                    this.adjustABFull();
                    t1 = this.G*6 + this.H;     // A register starting bit nr
                    if (t1+variant > 48) {
                        variant = 48-t1;
                    }
                    t2 = this.K*6 + this.V;     // B register starting bit nr
                    if (t2+variant > 48) {
                        variant = 48-t2;
                    }
                    if (variant > 0 && (this.cc.fieldIsolate(this.B, t2, variant) < this.cc.fieldIsolate(this.A, t1, variant))) {
                        this.A = 1;
                    } else {
                        this.A = 0;
                    }
                    this.cycleCount += variant + this.G + this.K;       // approximate the shift counts
                    break;

                case 0x3D:              // XX75: FCE=Compare Field Equal
                    this.adjustABFull();
                    t1 = this.G*6 + this.H;     // A register starting bit nr
                    if (t1+variant > 48) {
                        variant = 48-t1;
                    }
                    t2 = this.K*6 + this.V;     // B register starting bit nr
                    if (t2+variant > 48) {
                        variant = 48-t2;
                    }
                    if (variant > 0 && (this.cc.fieldIsolate(this.B, t2, variant) == this.cc.fieldIsolate(this.A, t1, variant))) {
                        this.A = 1;
                    } else {
                        this.A = 0;
                    }
                    this.cycleCount += variant + this.G + this.K;       // approximate the shift counts
                    break;

                default:
                    break;              // anything else is a no-op
                } // end switch for non-LITC/OPDC/DESC operators
                break;
            } // end switch for word-mode operators
        } // end main switch for opcode dispatch

        /***************************************************************
        *   SECL: Syllable Execution Complete Level                    *
        ***************************************************************/
        if ((this === this.cc.P1 ? this.cc.IAR : this.I) && this.NCSF) {
            // there's an interrupt and we're in normal state
            this.T = 0x0609;            // inject 3011=SFI into T
            this.Q &= 0xFFFEFF;         // reset Q09F: adder mode for R-relative addressing
            this.Q |= 0x40;             // set Q07F to indicate hardware-induced SFI
            this.storeForInterrupt(0);  // call directly to avoid resetting registers at top of loop
        } else {
            // otherwise, fetch the next instruction
            switch (this.L) {
            case 0:
                this.T = (((t1=this.P) - t1 % 0x1000000000) / 0x1000000000) % 0x1000;
                this.L = 1;
                break;
            case 1:
                this.T = (((t1=this.P) - t1 % 0x1000000) / 0x1000000) % 0x1000;
                this.L = 2;
                break;
            case 2:
                this.T = (((t1=this.P) - t1 % 0x1000) / 0x1000) % 0x1000;
                this.L = 3;
                break;
            case 3:
                this.T = this.P % 0x1000;
                this.L = 0;
                this.C++;
                this.loadPviaC();       // P = [C]
                break;
            }
        }
    } while ((this.cycleCount += 2) < this.cycleLimit);
};

/**************************************/
B5500Processor.prototype.schedule = function schedule() {
    /* Schedules the processor run time and attempts to throttle performance
    to approximate that of a real B5500. Well, at least we hope this will run
    fast enough that the performance will need to be throttled. It establishes
    a timeslice in terms of a number of processor "cycles" of 1 microsecond
    each and calls run() to execute at most that number of cycles. run()
    counts up cycles until it reaches this limit or some terminating event
    (such as a halt), then exits back here. If the processor remains active,
    this routine will reschedule itself for an appropriate later time, thereby
    throttling the performance and allowing other modules a chance at the
    Javascript execution thread. */
    var delayTime;
    var that = schedule.that;

    that.scheduler = null;
    that.cycleLimit = B5500Processor.timeSlice;
    that.cycleCount = 0;

    that.run();

    that.totalCycles += that.cycleCount
    that.procTime += that.cycleCount;
    if (that.busy) {
        delayTime = that.procTime/1000 - new Date().getTime();
        that.procSlack += delayTime;
        that.scheduler = setTimeout(that.schedule, (delayTime < 0 ? 1 : delayTime));
    }
};

/**************************************/
B5500Processor.prototype.step = function() {
    /* Single-steps the processor. Normally this will cause one instruction to
    be executed, but note that in case of an interrupt, one or two injected
    instructions (e.g., SFI followed by ITI) could also be executed. */

    this.cycleLimit = 1;
    this.cycleCount = 0;

    this.run();

    this.totalCycles += this.cycleCount
    this.procTime += this.cycleCount;
};
