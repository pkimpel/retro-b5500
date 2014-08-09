/***********************************************************************
* retro-b5500/emulator B5500Processor.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Emulator Processor (CPU) module.
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
    this.mnemonic = "P" + procID;       // Unit mnemonic
    this.cc = cc;                       // Reference back to CentralControl module
    this.scheduler = 0;                 // Current setCallback token
    this.accessor = {                   // Memory access control block
        requestorID: procID,               // Memory requestor ID
        addr: 0,                           // Memory address
        word: 0,                           // 48-bit data word
        MAIL: 0,                           // Truthy if attempt to access @000-@777 in Normal State
        MPED: 0,                           // Truthy if memory parity error
        MAED: 0                            // Truthy if memory address/inhibit error
    };

    this.clear();                       // Create and initialize the processor state

    this.delayDeltaAvg = 0;             // Average difference between requested and actual setCallback() delays, ms
    this.delayLastStamp = 0;            // Timestamp of last setCallback() delay, ms
    this.delayRequested = 0;            // Last requested setCallback() delay, ms
}

/**************************************/

B5500Processor.cyclesPerMilli = 1000;   // clock cycles per millisecond (1000 => 1.0 MHz)
B5500Processor.timeSlice = 1000;        // this.run() time-slice, clocks
B5500Processor.delayAlpha = 0.999;      // decay factor for exponential weighted average delay
B5500Processor.slackAlpha = 0.9999;     // decay factor for exponential weighted average slack

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
B5500Processor.prototype.clear = function clear() {
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
    this.NCSF = 0;                      // Normal/Control State FF (1=normal)
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

    this.isP1 = (this === this.cc.P1);  // True if this is the control processor
    this.busy = 0;                      // Processor is running, not idle or halted
    this.controlCycles = 0;             // Current control-state cycle count (for UI display)
    this.cycleCount = 0;                // Cycle count for current syllable
    this.cycleLimit = 0;                // Cycle limit for this.run()
    this.normalCycles = 0;              // Current normal-state cycle count (for UI display)
    this.runCycles = 0;                 // Current cycle cound for this.run()
    this.totalCycles = 0;               // Total cycles executed on this processor
    this.procStart = 0;                 // Javascript time that the processor started running, ms
    this.procTime = 0.001;              // Total processor running time, ms
    this.procSlack = 0;                 // Total processor throttling delay, ms
    this.procSlackAvg = 0;              // Average slack time per time slice, ms
    this.procRunAvg = 0;                // Average run time per time slice, ms
};

/**************************************/
B5500Processor.prototype.accessError = function accessError() {
    /* Common error handling routine for all memory acccesses */

    if (this.accessor.MAED) {
        this.I |= 0x02;                 // set I02F: memory address/inhibit error
        this.cc.signalInterrupt();
    } else if (this.accessor.MPED) {
        this.I |= 0x01;                 // set I01F: memory parity error
        this.cc.signalInterrupt();
        if (this.isP1 && !this.NCSF) {
            this.stop();                // P1 memory parity in Control State stops the proc
        }
    }
};

/**************************************/
B5500Processor.prototype.loadAviaS = function loadAviaS() {
    /* Load the A register from the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x02;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.cycleCount += B5500CentralControl.memReadCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    } else {
        this.A = acc.word;
        this.AROF = 1;
    }
};

/**************************************/
B5500Processor.prototype.loadBviaS = function loadBviaS() {
    /* Load the B register from the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x03;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.cycleCount += B5500CentralControl.memReadCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    } else {
        this.B = acc.word;
        this.BROF = 1;
    }
};

/**************************************/
B5500Processor.prototype.loadAviaM = function loadAviaM() {
    /* Load the A register from the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x04;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.cycleCount += B5500CentralControl.memReadCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    } else {
        this.A = acc.word;
        this.AROF = 1;
    }
};

/**************************************/
B5500Processor.prototype.loadBviaM = function loadBviaM() {
    /* Load the B register from the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x05;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.cycleCount += B5500CentralControl.memReadCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    } else {
        this.B = acc.word;
        this.BROF = 1;
    }
};

/**************************************/
B5500Processor.prototype.loadMviaM = function loadMviaM() {
    /* Load the M register from bits [18:15] of the word addressed by M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x06;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.cycleCount += B5500CentralControl.memReadCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    } else {
        this.M = (acc.word % 0x40000000) >>> 15;
    }
};

/**************************************/
B5500Processor.prototype.loadPviaC = function loadPviaC() {
    /* Load the P register from the address in C */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x30;                      // Just to show the world what's happening
    acc.addr = this.C;
    acc.MAIL = (this.C < 0x0200 && this.NCSF);
    this.cc.fetch(acc);
    this.PROF = 1;                      // PROF gets set even for invalid address
    this.cycleCount += B5500CentralControl.memReadCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    } else {
        this.P = acc.word;
    }
};

/**************************************/
B5500Processor.prototype.storeAviaS = function storeAviaS() {
    /* Store the A register at the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0A;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    acc.word = this.A;
    this.cc.store(acc);
    this.cycleCount += B5500CentralControl.memWriteCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    }
};

/**************************************/
B5500Processor.prototype.storeBviaS = function storeBviaS() {
    /* Store the B register at the address in S */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0B;                      // Just to show the world what's happening
    acc.addr = this.S;
    acc.MAIL = (this.S < 0x0200 && this.NCSF);
    acc.word = this.B;
    this.cc.store(acc);
    this.cycleCount += B5500CentralControl.memWriteCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    }
};

/**************************************/
B5500Processor.prototype.storeAviaM = function storeAviaM() {
    /* Store the A register at the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0C;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    acc.word = this.A;
    this.cc.store(acc);
    this.cycleCount += B5500CentralControl.memWriteCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    }
};

/**************************************/
B5500Processor.prototype.storeBviaM = function storeBviaM() {
    /* Store the B register at the address in M */
    var acc = this.accessor;            // get a local reference to the accessor object

    this.E = 0x0D;                      // Just to show the world what's happening
    acc.addr = this.M;
    acc.MAIL = (this.M < 0x0200 && this.NCSF);
    acc.word = this.B;
    this.cc.store(acc);
    this.cycleCount += B5500CentralControl.memWriteCycles;
    if (acc.MAED || acc.MPED) {
        this.accessError();
    }
};

/**************************************/
B5500Processor.prototype.adjustAEmpty = function adjustAEmpty() {
    /* Adjusts the A register so that it is empty, pushing the prior
    contents of A into B and B into memory, as necessary. */

    if (this.AROF) {
        if (this.BROF) {
            if ((this.S >>> 6) == this.R && this.NCSF) {
                this.I |= 0x04;         // set I03F: stack overflow
                this.cc.signalInterrupt();
            } else {
                ++this.S;
                this.storeBviaS();      // [S] = B
            }
        } else {
            this.BROF = 1;
        }
        this.B = this.A;
        this.AROF = 0;
    // else we're done -- A is already empty
    }
};

/**************************************/
B5500Processor.prototype.adjustAFull = function adjustAFull() {
    /* Adjusts the A register so that it is full, popping the contents of
    B or [S] into A, as necessary. */

    if (!this.AROF) {
        if (this.BROF) {
            this.A = this.B;
            this.AROF = 1;
            this.BROF = 0;
        } else {
            this.loadAviaS();           // A = [S]
            --this.S;
        }
    // else we're done -- A is already full
    }
};

/**************************************/
B5500Processor.prototype.adjustBEmpty = function adjustBEmpty() {
    /* Adjusts the B register so that it is empty, pushing the prior
    contents of B into memory, as necessary. */

    if (this.BROF) {
        if ((this.S >>> 6) == this.R && this.NCSF) {
            this.I |= 0x04;             // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            ++this.S;
            this.storeBviaS();          // [S] = B
            this.BROF = 0;
        }
    // else we're done -- B is already empty
    }
};

/**************************************/
B5500Processor.prototype.adjustBFull = function adjustBFull() {
    /* Adjusts the B register so that it is full, popping the contents of
    [S] into B, as necessary. */

    if (!this.BROF) {
        this.loadBviaS();               // B = [S]
        --this.S;
    // else we're done -- B is already full
    }
};

/**************************************/
B5500Processor.prototype.adjustABEmpty = function adjustABEmpty() {
    /* Adjusts the A and B registers so that both are empty, pushing the
    prior contents into memory, as necessary. */

    if (this.BROF) {
        if ((this.S >>> 6) == this.R && this.NCSF) {
            this.I |= 0x04;         // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            ++this.S;
            this.storeBviaS();      // [S] = B
            this.BROF = 0;
        }
    }
    if (this.AROF) {
        if ((this.S >>> 6) == this.R && this.NCSF) {
            this.I |= 0x04;         // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            ++this.S;
            this.storeAviaS();      // [S] = A
            this.AROF = 0;
        }
    }
};

/**************************************/
B5500Processor.prototype.adjustABFull = function adjustABFull() {
    /* Ensures both TOS registers are occupied, pushing up from memory as required */

    if (this.AROF) {
        if (this.BROF) {
            // A and B are already full, so we're done
        } else {
            // A is full and B is empty, so load B from [S]
            this.loadBviaS();           // B = [S]
            --this.S;
        }
    } else {
        if (this.BROF) {
            // A is empty and B is full, so copy B to A and load B from [S]
            this.A = this.B;
            this.AROF = 1;
        } else {
            // A and B are empty, so simply load them from [S]
            this.loadAviaS();           // A = [S]
            --this.S;
        }
        this.loadBviaS();               // B = [S]
        --this.S;
    }
};

/**************************************/
B5500Processor.prototype.exchangeTOS = function exchangeTOS() {
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
            --this.S;
        }
    } else {
        if (this.BROF) {
            // A is empty and B is full, so load A from [S]
            this.loadAviaS();           // A = [S]
            --this.S;
        } else {
            // A and B are empty, so simply load them in reverse order
            this.loadBviaS();           // B = [S]
            --this.S;
            this.loadAviaS();           // A = [S]
            --this.S;
        }
    }
};

/**************************************/
B5500Processor.prototype.jumpSyllables = function jumpSyllables(count) {
    /* Adjusts the C and L registers by "count" syllables (which may be negative).
    Forces a fetch to reload the P register after C and L are adjusted.
    On entry, C and L are assumed to be pointing to the next instruction
    to be executed, not the current one */
    var addr;

    addr = this.C*4 + this.L + count;
    this.C = addr >>> 2;
    this.L = addr & 0x03;
    this.PROF = 0;                      // require fetch at SECL
};

/**************************************/
B5500Processor.prototype.jumpWords = function jumpWords(count) {
    /* Adjusts the C register by "count" words (which may be negative). L is set
    to zero. Forces a fetch to reload the P register after C and L are adjusted.
    On entry, C is assumed to be pointing to the CURRENT instruction word, i.e.,
    Inhibit Fetch and Inhibit Count for Fetch have both been asserted. Any adjustment
    to C to account for the emulator's automatic C/L increment at SECL is the
    responsibility of the caller */

    this.C += count;
    this.L = 0;
    this.PROF = 0;                      // require fetch at SECL
};

/**************************************/
B5500Processor.prototype.jumpOutOfLoop = function jumpOutOfLoop(count) {
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
        this.jumpSyllables(count);
    }
    this.X = this.A % 0x8000000000;     // store prior LCW (39 bits: less control bits) in X
    this.S = t1;                        // restore S
    this.AROF = 0;                      // invalidate A
};

/**************************************/
B5500Processor.prototype.streamAdjustSourceChar = function streamAdjustSourceChar() {
    /* Adjusts the character-mode source pointer to the next character
    boundary, as necessary. If the adjustment crosses a word boundary,
    AROF is reset to force reloading later at the new source address */

    if (this.H > 0) {
        this.H = 0;
        if (this.G < 7) {
            ++this.G;
        } else {
            this.G = 0;
            this.AROF = 0;
            ++this.M;
        }
    }
};

/**************************************/
B5500Processor.prototype.streamAdjustDestChar = function streamAdjustDestChar() {
    /* Adjusts the character-mode destination pointer to the next character
    boundary, as necessary. If the adjustment crosses a word boundary and
    BROF is set, B is stored at S before S is incremented and BROF is reset
    to force reloading later at the new destination address */

    if (this.V > 0) {
        this.V = 0;
        if (this.K < 7) {
            ++this.K;
        } else {
            this.K = 0;
            if (this.BROF) {
                this.storeBviaS();      // [S] = B
                this.BROF = 0;
            }
            ++this.S;
        }
    }
};

/**************************************/
B5500Processor.prototype.compareSourceWithDest = function compareSourceWithDest(count, numeric) {
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
    var aw;                             // current A register word
    var bBit;                           // B register bit nr
    var bw;                             // current B register word
    var Q03F = (this.Q & 0x04) >>> 2;   // local copy of Q03F: inequality detected
    var Q04F = (this.Q & 0x08) >>> 3;   // local copy of Q04F: B not dirty
    var yc = 0;                         // local Y register
    var zc = 0;                         // local Z register

    this.MSFF = 0;
    this.streamAdjustSourceChar();
    this.streamAdjustDestChar();
    if (count) {
        if (this.BROF) {
            if (this.K == 0) {
                Q04F = 1;               // set Q04F -- at start of word, no need to store B later
            }
        } else {
            this.loadBviaS();           // B = [S]
            Q04F = 1;                   // set Q04F -- just loaded B, no need to store it later
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
        aw = this.A;
        bBit = this.K*6;                // B-bit number
        bw = this.B;
        do {
            ++this.cycleCount;          // approximate the timing
            if (Q03F) {                 // inequality already detected -- just count down
                if (count >= 8) {
                    count -= 8;
                    if (!Q04F) {        // test Q04F to see if B may be dirty
                        this.storeBviaS();      // [S] = B
                        Q04F = 1;               // set Q04F so we won't store B anymore
                    }
                    this.BROF = 0;
                    ++this.S;
                    this.AROF = 0;
                    ++this.M;
                } else {
                    --count;
                    if (this.K < 7) {
                        ++this.K;
                    } else {
                        if (!Q04F) {            // test Q04F to see if B may be dirty
                            this.storeBviaS();  // [S] = B
                            Q04F = 1;           // set Q04F so we won't store B anymore
                        }
                        this.K = 0;
                        this.BROF = 0;
                        ++this.S;
                    }
                    if (this.G < 7) {
                        ++this.G;
                    } else {
                        this.G = 0;
                        this.AROF = 0;
                        ++this.M;
                    }
                }
            } else {                    // strings still equal -- check this character
                if (numeric) {
                    yc = this.cc.fieldIsolate(aw, aBit+2, 4);
                    zc = this.cc.fieldIsolate(bw, bBit+2, 4);
                } else {
                    yc = this.cc.fieldIsolate(aw, aBit, 6);
                    zc = this.cc.fieldIsolate(bw, bBit, 6);
                }
                if (yc != zc) {
                    Q03F = 1;           // set Q03F to stop further comparison
                    if (numeric) {
                        this.MSFF = (yc > zc ? 1 : 0);
                    } else {
                        this.MSFF = (B5500Processor.collation[yc] > B5500Processor.collation[zc] ? 1 : 0);
                    }
                } else {                // strings still equal -- advance to next character
                    --count;
                    if (bBit < 42) {
                        bBit += 6;
                        ++this.K;
                    } else {
                        bBit = 0;
                        this.K = 0;
                        if (!Q04F) {            // test Q04F to see if B may be dirty
                            this.storeBviaS();  // [S] = B
                            Q04F = 1;           // set Q04F so we won't store B anymore
                        }
                        ++this.S;
                        if (count > 0) {
                            this.loadBviaS();   // B = [S]
                            bw = this.B;
                        } else {
                            this.BROF = 0;
                        }
                    }
                    if (aBit < 42) {
                        aBit += 6;
                        ++this.G;
                    } else {
                        aBit = 0;
                        this.G = 0;
                        ++this.M;
                        if (count > 0) {
                            this.loadAviaM();   // A = [M]
                            aw = this.A;
                        } else {
                            this.AROF = 0;
                        }
                    }
                }
            }
        } while (count);

        this.Q |= (Q03F << 2) | (Q04F << 3);
        this.Y = yc;                    // for display only
        this.Z = zc;                    // for display only
    }
};

/**************************************/
B5500Processor.prototype.fieldArithmetic = function fieldArithmetic(count, adding) {
    /* Handles the Field Add (FAD) or Field Subtract (FSU) syllables.
    "count" indicates the length of the fields to be operated upon.
    "adding" will be false if this call is for FSU, otherwise it's for FAD */
    var aBit;                           // A register bit nr
    var aw;                             // current A register word
    var bBit;                           // B register bit nr
    var bw;                             // current B register word
    var carry = 0;                      // carry/borrow bit
    var compl = false;                  // complement addition (i.e., subtract the digits)
    var TFFF;                           // local copy of MSFF/TFFF
    var Q03F;                           // local copy of Q03F
    var resultNegative;                 // sign of result is negative
    var sd;                             // digit sum
    var ycompl = false;                 // complement source digits
    var yd;                             // source digit
    var zcompl = false;                 // complement destination digits
    var zd;                             // destination digit

    this.compareSourceWithDest(count, true);
    this.cycleCount += 2;               // approximate the timing thus far
    if (this.Q & 0x20) {                // Q06F => count > 0, so there's characters to add
        this.Q &= ~(0x28);              // reset Q06F and Q04F
        TFFF = (this.MSFF != 0);        // get TFFF as a Boolean
        Q03F = ((this.Q & 0x04) != 0);  // get Q03F as a Boolean

        // Back down the pointers to the last characters of their respective fields
        if (this.K > 0) {
            --this.K;
        } else {
            this.K = 7;
            this.BROF = 0;
            --this.S;
        }
        if (this.G > 0) {
            --this.G;
        } else {
            this.G = 7;
            this.AROF = 0;
            --this.M;
        }

        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }

        this.Q |= 0x80;                 // set Q08F (for display only)
        aBit = this.G*6;                // A-bit number
        aw = this.A;
        bBit = this.K*6;                // B-bit number
        bw = this.B;
        yd = (this.cc.fieldIsolate(aw, aBit, 2) == 2 ? 2 : 0);  // source sign
        zd = (this.cc.fieldIsolate(bw, bBit, 2) == 2 ? 2 : 0);  // dest sign
        compl = (yd == zd ? !adding : adding);          // determine if complement needed
        resultNegative = !(                             // determine sign of result
                (zd == 0 && !compl) ||
                (zd == 0 && Q03F && !TFFF) ||
                (zd != 0 && compl && Q03F && TFFF) ||
                (compl && !Q03F));
        if (compl) {
            this.Q |= 0x42;             // set Q07F and Q02F (for display only)
            carry = 1;                  // preset the carry/borrow bit (Q07F)
            if (TFFF) {
                this.Q |= 0x08;         // set Q04F (for display only)
                zcompl = true;
            } else {
                ycompl = true;
            }
        }

        this.cycleCount += 4;
        do {
            --count;
            this.cycleCount += 2;
            yd = this.cc.fieldIsolate(aw, aBit+2, 4);                 // get the source digit
            zd = this.cc.fieldIsolate(bw, bBit+2, 4);                 // get the dest digit
            sd = (ycompl ? 9-yd : yd) + (zcompl ? 9-zd : zd) + carry; // develop binary digit sum
            if (sd <= 9) {
                carry = 0;
            } else {
                carry = 1;
                sd -= 10;
            }
            if (resultNegative) {
                sd += 0x20;             // set sign (BA) bits in char to binary 10
                resultNegative = false;
            }

            bw = this.cc.fieldInsert(bw, bBit, 6, sd);

            if (count == 0) {
                this.B = bw;
                this.storeBviaS();      // [S] = B, store final dest word
            } else {
                if (bBit > 0) {
                    bBit -= 6;
                    --this.K;
                } else {
                    bBit = 42;
                    this.K = 7;
                    this.B = bw;
                    this.storeBviaS();  // [S] = B
                    --this.S;
                    this.loadBviaS();   // B = [S]
                    bw = this.B;
                }
                if (aBit > 0) {
                    aBit -= 6;
                    --this.G;
                } else {
                    aBit = 42;
                    this.G = 7;
                    --this.M;
                    this.loadAviaM();   // A = [M]
                    aw = this.A;
                }
            }
        } while (count);

        // Now restore the character pointers
        count = this.H*8 + this.V;
        while (count >= 8) {
            count -= 8;
            ++this.cycleCount;
            ++this.S;
            ++this.M;
        }
        this.cycleCount += count;
        while (count > 0) {
            --count;
            if (this.K < 7) {
                ++this.K;
            } else {
                this.K = 0;
                ++this.S;
            }
            if (this.G < 7) {
                ++this.G;
            } else {
                this.G = 0;
                ++this.M;
            }
        }
        this.A = aw;
        this.B = bw;
        this.AROF = this.BROF = 0;
        this.H = this.V = this.N = 0;
        this.MSFF = (compl ? 1-carry : carry);  // MSFF/TFFF = overflow indicator
    }
};

/**************************************/
B5500Processor.prototype.streamBitsToDest = function streamBitsToDest(count, mask) {
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
                ++this.S;
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
B5500Processor.prototype.streamProgramToDest = function streamProgramToDest(count) {
    /* Implements the TRP (Transfer Program Characters) character-mode syllable */
    var bBit;                           // B register bit nr
    var bw;                             // current B register value
    var c;                              // current character
    var pBit;                           // P register bit nr
    var pw;                             // current P register value

    this.streamAdjustDestChar();
    if (count) {                        // count > 0
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        if (!this.PROF) {
            this.loadPviaC();           // fetch the program word, if necessary
        }
        this.cycleCount += count;       // approximate the timing
        pBit = (this.L*2 + (count % 2))*6;      // P-reg bit number
        pw = this.P;
        bBit = this.K*6;                        // B-reg bit number
        bw = this.B;
        do {
            c = this.cc.fieldIsolate(pw, pBit, 6);
            bw = this.cc.fieldInsert(bw, bBit, 6, c);
            --count;
            if (bBit < 42) {
                bBit += 6;
                ++this.K;
            } else {
                bBit = 0;
                this.K = 0;
                this.B = bw;
                this.storeBviaS();      // [S] = B
                ++this.S;
                if (count > 0 && count < 8) {   // only need to load B if a partial word is left
                    this.loadBviaS();   // B = [S]
                    bw = this.B;
                } else {
                    this.BROF = 0;
                }
            }
            if (pBit < 42) {
                pBit += 6;
                if (!(count % 2)) {
                    ++this.L;
                }
            } else {
                pBit = 0;
                this.L = 0;
                ++this.C;
                this.loadPviaC();       // P = [C]
                pw = this.P;
            }
        } while (count);
        this.B = bw;
        this.Y = c;                     // for display purposes only
    }
};

/**************************************/
B5500Processor.prototype.streamCharacterToDest = function streamCharacterToDest(count) {
    /* Transfers character transfers from source to destination for the TRS syllable.
    "count" is the number of source characters to transfer */
    var aBit;                           // A register bit nr
    var aw;                             // current A register word
    var bBit;                           // B register bit nr
    var bw;                             // current B register word
    var c;                              // current character

    this.streamAdjustSourceChar();
    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        this.cycleCount += 10 + count*2;// approximate the timing
        aBit = this.G*6;                // A-bit number
        aw = this.A;
        bBit = this.K*6;                // B-bit number
        bw = this.B;
        do {
            c = this.cc.fieldIsolate(aw, aBit, 6);
            bw = this.cc.fieldInsert(bw, bBit, 6, c);
            --count;
            if (bBit < 42) {
                bBit += 6;
                ++this.K;
            } else {
                bBit = 0;
                this.K = 0;
                this.B = bw;
                this.storeBviaS();      // [S] = B
                ++this.S;
                if (count > 0 && count < 8) {   // only need to load B if a partial word is left
                    this.loadBviaS();   // B = [S]
                    bw = this.B;
                } else {
                    this.BROF = 0;
                }
            }
            if (aBit < 42) {
                aBit += 6;
                ++this.G;
            } else {
                aBit = 0;
                this.G = 0;
                ++this.M;
                if (count > 0) {        // only need to load A if there's more to do
                    this.loadAviaM();   // A = [M]
                    aw = this.A;
                } else {
                    this.AROF = 0;
                }
            }
        } while (count);
        this.B = bw;
        this.Y = c;                     // for display purposes only
    }
};

/**************************************/
B5500Processor.prototype.streamNumericToDest = function streamNumericToDest(count, zones) {
    /* Transfers from source to destination for the TRN and TRZ syllables. "count"
    is the number of source characters to transfer. If transferring numerics and the
    low-order character has a negative sign (BA=10), sets MSFF=1 */
    var aBit;                           // A register bit nr
    var aw;                             // current A register word
    var bBit;                           // B register bit nr
    var bw;                             // current B register word
    var c;                              // current character

    this.streamAdjustSourceChar();
    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }
        if (zones) {                    // approximate the timing
            this.cycleCount += 5 + count*4;
        } else {
            this.cycleCount += 10 + count*3;
        }

        aBit = this.G*6;                // A-bit number
        aw = this.A;
        bBit = this.K*6;                // B-bit number
        bw = this.B;
        do {
            c = this.cc.fieldIsolate(aw, aBit, 6);
            if (zones) {                // transfer only the zone portion of the char
                bw = this.cc.fieldInsert(bw, bBit, 2, c >>> 4);
            } else {                    // transfer the numeric portion with a zero zone
                bw = this.cc.fieldInsert(bw, bBit, 6, (c & 0x0F));
            }
            --count;
            if (bBit < 42) {
                bBit += 6;
                ++this.K;
            } else {
                bBit = 0;
                this.K = 0;
                this.B = bw;
                this.storeBviaS();      // [S] = B
                ++this.S;
                if (count > 0) {
                    this.loadBviaS();   // B = [S]
                    bw = this.B;
                } else {
                    this.BROF = 0;
                }
            }
            if (aBit < 42) {
                aBit += 6;
                ++this.G;
            } else {
                aBit = 0;
                this.G = 0;
                ++this.M;
                if (count > 0) {        // only need to load A if there's more to do
                    this.loadAviaM();   // A = [M]
                    aw = this.A;
                } else {
                    this.AROF = 0;
                }
            }
        } while (count);
        this.B = bw;
        this.Y = c;                     // for display purposes only
        if (!zones && (c & 0x30) == 0x20) {
            this.MSFF = 1;              // last char had a negative sign
        }
    }
};

/**************************************/
B5500Processor.prototype.streamBlankForNonNumeric = function streamBlankForNonNumeric(count) {
    /* Implements the TBN (Transfer Blanks for Non-Numeric) syllable, which is
    generally used to suppress leading zeroes in numeric strings. Transfers blanks
    to the destination under control of the count as long as the destination characters
    are not in the range "1"-"9". Sets MSFF (TFFF) true if the count is exhausted.
    "count" is the maximum number of characters to blank */
    var bBit;                           // B register bit nr
    var bw;                             // current B register word
    var c;                              // current destination character

    this.MSFF = 1;                      // assume the count will be exhausted
    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.loadBviaS();           // B = [S]
        }
        bBit = this.K*6;                // B-bit number
        bw = this.B;
        do {
            this.cycleCount += 2;       // approximate the timing
            c = this.cc.fieldIsolate(bw, bBit, 6);
            if (c > 0 && c <= 9) {
                this.MSFF = 0;                  // is numeric and non-zero: stop blanking
                this.Q |= 0x04;                 // set Q03F (display only)
                break;                          // terminate, pointing at this char
            } else {
                bw = this.cc.fieldInsert(bw, bBit, 6, 0x30); // replace with blank
                --count;
                if (bBit < 42) {
                    bBit += 6;
                    ++this.K;
                } else {
                    bBit = 0;
                    this.K = 0;
                    this.B = bw;
                    this.storeBviaS();          // [S] = B
                    ++this.S;
                    if (count > 0) {
                        this.loadBviaS();       // B = [S]
                        bw = this.B;
                    } else {
                        this.BROF = 0;
                    }
                }
            }
        } while (count);
        this.B = bw;
        this.Z = c;                     // for display purposes only
    }
};

/**************************************/
B5500Processor.prototype.streamInputConvert = function streamInputConvert(count) {
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
        ++this.S;
    }
    if (count) {                        // no conversion if count is zero
        this.cycleCount += count*2 + 27;
        count = ((count-1) & 0x07) + 1; // limit the count to 8
        if (!this.AROF) {
            this.loadAviaM();           // A = [M]
        }

        // First, assemble the digits into B as 4-bit BCD
        do {
            b = (b << 4) | ((this.Y = this.cc.fieldIsolate(this.A, this.G*6, 6)) & 0x0F);
            if (this.G < 7) {
                ++this.G;
            } else {
                this.G = 0;
                ++this.M;
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

            /* This next part is tricky, and was done by a switching network in the B5500.
            When a 1 bit is shifted into the high-order position of a BCD decade from its
            decade to the left, that bit has a place value of 8, but because the number
            is decimal, it should have a place value of five. Therefore, in EACH such
            decade, we need to subtract 3 to get the correct place value. The following
            statement constructs a mask of 3s in each decade where the high-order bit is
            set after the shift above, then subtracts that mask from the working B value.
            See the discussion in Section 2.6 in the Training Manual cited above */

            b -= ((b & 0x88888888) >>> 3)*3;
        }

        // Finally, fix up the binary sign and store the result
        if (a) {                        // zero results have sign bit reset
            if ((this.Y & 0x30) == 0x20) {
                a += 0x400000000000;    // set the sign bit
            }
        }
        this.A = a;
        this.storeAviaS();              // [S] = A
        ++this.S;
    }
};

/**************************************/
B5500Processor.prototype.streamOutputConvert = function streamOutputConvert(count) {
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
        ++this.M;
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
        ++this.M;                       // and advance to the next source word

        // Finally, stream the digits from A (whose value is still in local b) to the destination
        this.A = b;                     // for display purposes only
        this.loadBviaS();               // B = [S], restore original value of B
        d = 48 - count*6;               // starting bit in A
        do {
            this.B = this.cc.fieldTransfer(this.B, this.K*6, 6, b, d);
            d += 6;
            if (this.K < 7) {
                ++this.K;
            } else {
                this.storeBviaS();      // [S] = B
                this.K = 0;
                ++this.S;
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
B5500Processor.prototype.storeForInterrupt = function storeForInterrupt(forced, forTest) {
    /* Implements the 3011=SFI operator and the parts of 3411=SFT that are
    common to it. "forced" implies Q07F: a hardware-induced SFI syllable.
    "forTest" implies use from SFT */
    var saveAROF = this.AROF;
    var saveBROF = this.BROF;
    var temp;

    if (forced || forTest) {
        this.NCSF = 0;                  // switch to Control State
    }

    if (this.CWMF) {
        temp = this.S;                  // if CM, get the correct TOS address from X
        this.S = (this.X % 0x40000000) >>> 15;
        this.X = this.X % 0x8000 +
              temp * 0x8000 +
              (this.X - this.X % 0x40000000);
        if (saveAROF || forTest) {
            ++this.S;
            this.storeAviaS();          // [S] = A
        }
        if (saveBROF || forTest) {
            ++this.S;
            this.storeBviaS();          // [S] = B
        }
        this.B = this.X +               // store CM Interrupt Loop-Control Word (ILCW)
              saveAROF * 0x200000000000 +
              0xC00000000000;
        ++this.S;
        this.storeBviaS();              // [S] = B
    } else {
        if (saveBROF || forTest) {
            ++this.S;
            this.storeBviaS();          // [S] = B
        }
        if (saveAROF || forTest) {
            ++this.S;
            this.storeAviaS();          // [S] = A
        }
    }
    this.B = this.M +                   // store Interrupt Control Word (ICW)
          this.N * 0x8000 +
          this.VARF * 0x1000000 +
          this.SALF * 0x40000000 +
          this.MSFF * 0x80000000 +
          this.R * 0x200000000 +
          0xC00000000000;
    ++this.S;
    this.storeBviaS();                  // [S] = B

    this.B = this.C +                   // store Interrupt Return Control Word (IRCW)
          this.F * 0x8000 +
          this.K * 0x40000000 +
          this.G * 0x200000000 +
          this.L * 0x1000000000 +
          this.V * 0x4000000000 +
          this.H * 0x20000000000 +
          saveBROF * 0x200000000000 +
          0xC00000000000;
    ++this.S;
    this.storeBviaS();                  // [S] = B

    if (this.CWMF) {
        temp = this.F;                  // if CM, get correct R value from last MSCW
        this.F = this.S;
        this.S = temp;
        this.loadBviaS();               // B = [S]: get last RCW
        this.S = (this.B % 0x40000000) >>> 15;
        this.loadBviaS();               // B = [S]: get last MSCW
        this.R = (this.B % 0x40000000000 - this.B % 0x200000000)/0x200000000;   // B.[6:9]
        this.S = this.F;
    }

    this.B = this.S +                   // build the Initiate Control Word (INCW)
          this.CWMF * 0x8000 +
          (this.TM & 0x1F) * 0x10000 +
          this.Z * 0x400000 +
          this.Y * 0x10000000 +
          (this.Q & 0x1FF) * 0x400000000 +
          0xC00000000000;
    this.M = this.R*64 + 8;             // store initiate word at R+@10
    this.storeBviaM();                  // [M] = B

    this.M = 0;
    this.R = 0;
    this.MSFF = 0;
    this.SALF = 0;
    this.BROF = 0;
    this.AROF = 0;
    if (forTest) {
        this.TM = 0;
        this.MROF = 0;
        this.MWOF = 0;
    }

    if (forced || forTest) {
        this.CWMF = 0;
    }

    if (!this.isP1) {                   // if it's P2
        this.stop();                        // idle the P2 processor
        this.cc.P2BF = 0;                   // tell CC and P1 we've stopped
    } else {                            // otherwise, if it's P1
        if (!forTest) {
            this.T = 0x89;                  // inject 0211=ITI into P1's T register
        } else {
            this.loadBviaM();               // B = [M]: load DD for test
            this.C = this.B % 0x8000;
            this.L = 0;
            this.PROF = 0;                  // require fetch at SECL
            this.G = 0;
            this.H = 0;
            this.K = 0;
            this.V = 0;
        }
    }
};

/**************************************/
B5500Processor.prototype.preset = function preset(runAddr) {
    /* Presets the processor registers for a load condition at C=runAddr */

    this.C = runAddr;                   // starting execution address
    this.L = 1;                         // preset L to point to the second syllable
    this.loadPviaC();                   // load the program word to P
    this.T = this.cc.fieldIsolate(this.P, 0, 12);
    this.TROF = 1;
    this.R = 0;
    this.S = 0;

};

/**************************************/
B5500Processor.prototype.start = function start() {
    /* Initiates the processor by scheduling it on the Javascript thread */
    var stamp = performance.now();

    this.busy = 1;
    this.procStart = stamp;
    this.procTime -= stamp;
    this.delayLastStamp = stamp;
    this.delayRequested = 0;
    this.scheduler = setCallback(this.mnemonic, this, 0, this.schedule);
};

/**************************************/
B5500Processor.prototype.stop = function stop() {
    /* Stops running the processor on the Javascript thread */
    var stamp = performance.now();

    this.T = 0;
    this.TROF = 0;              // idle the processor
    this.PROF = 0;
    this.busy = 0;
    this.cycleLimit = 0;        // exit this.run()
    if (this.scheduler) {
        clearCallback(this.scheduler);
        this.scheduler = 0;
    }
    while (this.procTime < 0) {
        this.procTime += stamp;
    }
};

/**************************************/
B5500Processor.prototype.initiate = function initiate(forTest) {
    /* Initiates the processor from interrupt control words stored in the
    stack. Assumes the INCW is in TOS. "forTest" implies use from IFT */
    var bw;                             // local copy of B
    var saveAROF = 0;
    var saveBROF = 0;
    var temp;

    if (this.AROF) {
        this.B = bw = this.A;
    } else if (this.BROF) {
        bw = this.B;
    } else {
        this.adjustBFull();
        bw = this.B;
    }

    // restore the Initiate Control Word (INCW) or Initiate Test Control Word
    this.S = bw % 0x8000;
    this.CWMF = (bw % 0x10000) >>> 15;
    if (forTest) {
        this.TM = (bw % 0x100000 - bw % 0x10000)/0x10000 +
                  (bw % 0x200000 - bw % 0x100000)/0x100000 * 16 +                       // NCSF
                  (bw % 0x400000 - bw % 0x200000)/0x200000 * 32 +                       // CCCF
                  (bw % 0x100000000000 - bw % 0x80000000000)/0x80000000000 * 64 +       // MWOF
                  (bw % 0x400000000000 - bw % 0x200000000000)/0x200000000000 * 128;     // MROF
        this.Z = (bw % 0x10000000 - bw % 0x400000)/0x400000;
        this.Y = (bw % 0x400000000 - bw % 0x10000000)/0x10000000;
        this.Q = (bw % 0x80000000000 - bw % 0x400000000)/0x400000000;
        // Emulator doesn't support J register, so can't set that from TM
    }

    // restore the Interrupt Return Control Word (IRCW)
    this.loadBviaS();                   // B = [S]
    --this.S;
    bw = this.B;
    this.C = bw % 0x8000;
    this.F = (bw % 0x40000000) >>> 15;
    this.K = (bw % 0x200000000 - bw % 0x40000000)/0x40000000;
    this.G = (bw % 0x1000000000 - bw % 0x200000000)/0x200000000;
    this.L = (bw % 0x4000000000 - bw % 0x1000000000)/0x1000000000;
    this.V = (bw % 0x20000000000 - bw % 0x4000000000)/0x4000000000;
    this.H = (bw % 0x100000000000 - bw % 0x20000000000)/0x20000000000;
    this.loadPviaC();                   // load program word to P
    if (this.CWMF || forTest) {
        saveBROF = (bw % 0x400000000000 - bw % 0x200000000000)/0x200000000000;
    }

    // restore the Interrupt Control Word (ICW)
    this.loadBviaS();                   // B = [S]
    --this.S;
    bw = this.B;
    this.VARF = (bw % 0x2000000 - bw % 0x1000000)/0x1000000;
    this.SALF = (bw % 0x80000000 - bw % 0x40000000)/0x40000000;
    this.MSFF = (bw % 0x100000000 - bw % 0x80000000)/0x80000000;
    this.R = (bw % 0x40000000000 - bw % 0x200000000)/0x200000000;

    if (!(this.CWMF || forTest)) {
        this.AROF = 0;                  // don't restore A or B for word mode --
        this.BROF = 0;                  // they will pop up as necessary
    } else {
        this.M = bw % 0x8000;
        this.N = (bw % 0x80000 - bw % 0x8000)/0x8000;

        // restore the CM Interrupt Loop Control Word (ILCW)
        this.loadBviaS();               // B = [S]
        --this.S;
        bw = this.B;
        this.X = bw % 0x8000000000;
        saveAROF = (bw % 0x400000000000 - bw % 0x200000000000)/0x200000000000;

        // restore the B register
        if (saveBROF || forTest) {
            this.loadBviaS();           // B = [S]
            --this.S;
        }

        // restore the A register
        if (saveAROF || forTest) {
            this.loadAviaS();           // A = [S]
            --this.S;
        }

        this.AROF = saveAROF;
        this.BROF = saveBROF;
        if (this.CWMF) {
            // exchange S with its field in X
            temp = this.S;
            this.S = (this.X % 0x40000000) >>> 15;
            this.X = this.X % 0x8000 +
                  temp * 0x8000 +
                  (this.X - this.X % 0x40000000);
        }
    }

    this.T = this.cc.fieldIsolate(this.P, this.L*12, 12);
    this.TROF = 1;
    if (!forTest) {
        this.NCSF = 1;
    } else {
        this.NCSF = (this.TM >>> 4) & 0x01;
        this.CCCF = (this.TM >>> 5) & 0x01;
        this.MWOF = (this.TM >>> 6) & 0x01;
        this.MROF = (this.TM >>> 7) & 0x01;
        --this.S;
        if (!this.CCCF) {
            this.TM |= 0x80;
        }
    }
};

/**************************************/
B5500Processor.prototype.initiateAsP2 = function initiateAsP2() {
    /* Called from CentralControl to initiate the processor as P2. Fetches the
    INCW from @10, injects an initiate P2 syllable into T, and calls start() */

    this.NCSF = 0;                      // make sure P2 is in Control State to execute the IP1 & access low mem
    this.M = 0x08;                      // address of the INCW
    this.loadBviaM();                   // B = [M]
    this.AROF = 0;                      // make sure A is invalid
    this.T = 0x849;                     // inject 4111=IP1 into P2's T register
    this.TROF = 1;

    // Now start scheduling P2 on the Javascript thread
    this.start();
};

/**************************************/
B5500Processor.prototype.singlePrecisionCompare = function singlePrecisionCompare() {
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
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F)) + 0x40;
    }
    if (mb == 0) {                      // if B mantissa is zero
        eb = sb = 0;                    // consider B to be completely zero
    } else {
        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F)) + 0x40;
    }
    if (ma) {                           // normalize the A mantissa
        while (ma < 0x1000000000 && ea != eb) {
            ++this.cycleCount;
            ma *= 8;                    // shift left
            --ea;
        }
    }
    if (mb) {                           // normalize the B mantissa
        while (mb < 0x1000000000 && eb != ea) {
            ++this.cycleCount;
            mb *= 8;                    // shift left
            --eb;
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
B5500Processor.prototype.singlePrecisionAdd = function singlePrecisionAdd(adding) {
    /* Adds the contents of the A register to the B register, leaving the result
    in B and invalidating A. If "adding" is not true, the sign of A is complemented
    to accomplish subtraction instead of addition.
    The B5500 did this by complement arithmetic, exchanging operands as necessary,
    and maintaining a bunch of Q-register flags to keep it all straight. This
    routine takes a more straightforward approach, doing algebraic arithmetic on
    the A and B mantissas and maintaining separate extensions (X registers) for
    scaling A and B. Only one register will be scaled, so the other extension will
    always be zero */
    var d = 0;                          // the guard (rounding) digit
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xa = 0;                         // extension to A for scaling (pseudo X)
    var xb = 0;                         // extension to B for scaling (pseudo X)

    this.cycleCount += 2;               // estimate some general overhead
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
    } else {                            // rats, we actually have to do this...
        ea = (this.A - ma)/0x8000000000;
        sa = (adding ? (ea >>> 7) & 0x01 : 1-((ea >>> 7) & 0x01));
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // If the exponents are unequal, normalize the larger and scale the smaller
        // until they are in alignment, or one of the mantissas (mantissae?) becomes zero
        if (ea > eb) {
            // Normalize A for 39 bits (13 octades)
            while (ma < 0x1000000000 && ea != eb) {
                ++this.cycleCount;
                ma *= 8;                // shift left
                --ea;
            }
            // Scale B until its exponent matches or mantissa goes to zero
            while (ea != eb) {
                ++this.cycleCount;
                d = mb % 8;
                mb = (mb - d)/8;        // shift right into extension
                xb = (xb - xb%8)/8 + d*0x1000000000;
                ++eb;
                if (mb == 0 && ea != eb) {
                    eb = ea;            // if B=0, kill the scaling loop: result will have exponent of A
                    xb = 0;             // prevent rounding of result
                }
            }
        } else if (ea < eb) {
            // Normalize B for 39 bits (13 octades)
            while (mb < 0x1000000000 && eb != ea) {
                ++this.cycleCount;
                mb *= 8;                // shift left
                --eb;
            }
            // Scale A until its exponent matches or mantissa goes to zero
            while (eb != ea) {
                ++this.cycleCount;
                d =  ma % 8;
                ma = (ma - d)/8;        // shift right into extension
                xa = (xa - xa%8)/8 + d*0x1000000000;
                ++ea;
                if (ma == 0 && eb != ea) {
                    ea = eb;            // if A=0, kill the scaling loop
                    xa = 0;             // prevent rounding of result
                }
            }
        }

        // At this point, the exponents are aligned (or one of the mantissas
        // is zero), so do the actual 39-bit additions of mantissas and extensions

        xb = (sb ? -xb : xb) + (sa ? -xa : xa);         // compute the extension
        if (xb < 0) {
            xb += 0x8000000000;                                 // adjust for underflow in the extension
            d = -1;                                             // adjust B for borrow into extension
        } else if (xb < 0x8000000000) {
            d = 0;                                              // no adjustment for overflow
        } else {
            xb -= 0x8000000000;                                 // adjust for overflow in the extension
            d = 1;                                              // adjust B for carry from extension
        }

        mb = (sb ? -mb : mb) + (sa ? -ma : ma) + d;     // compute the mantissa
        if (mb >= 0) {                                  // if non-negative...
            sb = 0;                                             // reset the B sign bit
        } else {                                        // if negative...
            sb = 1;                                             // set the B sign bit
            mb = -mb;                                           // negate the B mantissa
            if (xb) {                                           // if non-zero octades have been shifted into X (and ONLY if... learned THAT the hard way...)
                xb = 0x8000000000 - xb;                         // negate the extension in X
                --mb;                                           // and adjust for borrow into X
            }
        }

        // Normalize and round as necessary
        if (mb < 0x1000000000) {                                // Normalization can be required for subtract
            if (xb < 0x800000000) {                             // if first two octades in X < @04 then
                d = 0;                                          // no rounding will take place
            } else {
                ++this.cycleCount;
                d = (xb - xb%0x1000000000)/0x1000000000;        // get the high-order digit from X
                xb = (xb%0x1000000000)*8;                       // shift B and X left together
                mb = mb*8 + d;
                --eb;
                d = (xb - xb%0x1000000000)/0x1000000000;        // get the rounding digit from X
            }
        } else if (mb >= 0x8000000000) {                        // Scaling can be required for add
            ++this.cycleCount;
            d = mb % 8;                                         // get the shifting digit from B
            mb = (mb - d)/8;                                    // shift right due to overflow
            ++eb;
        } else {
            d = (xb - xb%0x1000000000)/0x1000000000;            // another hard-earned lesson...
        }

        // Note: the Training Manual does not say that rounding is suppressed
        // for add/subtract when the mantissa is all ones, but it does say so
        // for multiply/divide, so we assume it's also the case here.
        if (d >= 4) {                   // if the guard digit was >= 4
            if (mb < 0x7FFFFFFFFF) {    // and rounding would not cause overflow
                ++this.cycleCount;
                ++mb;                   // round up the result
            }
        }

        // Check for exponent overflow
        if (eb > 63) {
            eb %= 64;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0xB0;        // set I05/6/8: exponent-overflow
                this.cc.signalInterrupt();
            }
        } else if (eb < 0) {
            eb = (-eb) | 0x40;                          // set the exponent sign bit
        }

        this.X = xb;                                    // for display purposes only
        if (mb == 0) {                                  // if the mantissa is zero...
            this.B = 0;                                         // the whole result is zero, and we're done
        } else {                                        // otherwise, determine the resulting sign
            this.B = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
        }
    }
};

/**************************************/
B5500Processor.prototype.singlePrecisionMultiply = function singlePrecisionMultiply() {
    /* Multiplies the contents of the A register to the B register, leaving the
    result in B and invalidating A. A double-precision mantissa is developed and
    then normalized and rounded */
    var d;                              // current multiplier & shifting digit (octal)
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n;                              // local copy of N (octade counter)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx;                             // local copy of X for multiplier

    this.cycleCount += 2;               // estimate some general overhead
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
        sa = (ea >>> 7) & 0x01;
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
                ++this.cycleCount;
                ma *= 8;                // shift left
                --ea;
            }
            // Normalize B for 39 bits (13 octades)
            while (mb < 0x1000000000) {
                ++this.cycleCount;
                mb *= 8;                // shift left
                --eb;
            }
        }

        // Determine resulting mantissa sign; initialize the product
        sb ^= sa;                       // positive if signs are same, negative if different
        xx = mb;                        // move multiplier to X
        mb = 0;                         // initialize high-order part of product

        // Now we step through the 13 octades of the multiplier, developing the product
        for (n=0; n<13; ++n) {
            d = xx % 8;                 // extract the current multiplier digit from X
            if (d == 0) {               // if multiplier digit is zero
                ++this.cycleCount;      // hardware optimizes this case
            } else {
                this.cycleCount += 3;   // just estimate the average number of clocks
                mb += ma*d;             // develop the partial product
            }

            // Shift B & X together one octade to the right
            xx = (xx - d)/8 + (d = mb % 8)*0x1000000000;
            mb = (mb - d)/8;
        } // for n

        // Normalize the result
        if (this.Q & 0x10 && mb == 0) { // if it's integer multiply (Q05F) with integer result
            mb = xx;                    // just use the low-order 39 bits
            xx = 0;
            eb = 0;                     // and don't normalize
        } else {
            eb += ea+13;                // compute resulting exponent from multiply
            while (mb < 0x1000000000) { // normalization loop
                ++this.cycleCount;
                ma = xx % 0x1000000000; // reuse ma: get low-order 36 bits of mantissa extension
                d = (xx - ma)/0x1000000000;     // get high-order octade of extension
                mb = mb*8 + d;          // shift high-order extension octade into B
                xx = ma*8;              // shift extension left one octade
                --eb;
            }
        }

        // Round the result
        this.Q &= ~(0x10);              // reset Q05F
        this.A = 0;                     // required by specs due to the way rounding addition worked

        if (xx >= 0x4000000000) {       // if high-order bit of remaining extension is 1
            this.Q |= 0x01;             // set Q01F (for display purposes only)
            if (mb < 0x7FFFFFFFFF) {    // if the rounding would not cause overflow
                ++this.cycleCount;
                ++mb;                   // round up the result
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
            } else if (eb < 0) {
                if (eb >= -63) {
                    eb = (-eb) | 0x40;                  // set the exponent sign bit
                } else {
                    eb = ((-eb) % 64) | 0x40;           // mod the exponent and set its sign
                    if (this.NCSF) {
                        this.I = (this.I & 0x0F) | 0xA0;// set I06/8: exponent-underflow
                        this.cc.signalInterrupt();
                    }
                }
            }

            this.B = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
        }
    }
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.singlePrecisionDivide = function singlePrecisionDivide() {
    /* Divides the contents of the A register into the B register, leaving the
    result in B and invalidating A. A 14-octade mantissa is developed and
    then normalized and rounded */
    var ea;                             // signed exponent of A
    var eb;                             // signed exponent of B
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n = 0;                          // local copy of N (octade counter)
    var q;                              // current quotient digit (octal)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx = 0;                         // local copy of X for quotient development

    this.cycleCount += 2;               // estimate some general overhead
    this.adjustABFull();
    this.AROF = 0;                      // A is unconditionally marked empty
    ma = this.A % 0x8000000000;         // extract the A mantissa
    mb = this.B % 0x8000000000;         // extract the B mantissa

    if (ma == 0) {                      // if A mantissa is zero
        if (this.NCSF) {                // and we're in Normal State
            this.I = (this.I & 0x0F) | 0xD0;    // set I05/7/8: divide by zero
            this.cc.signalInterrupt();
        }
    } else if (mb == 0) {               // otherwise, if B is zero,
        this.A = this.B = 0;            // result is all zeroes
    } else {                            // otherwise, may the octades always be in your favor
        ea = (this.A - ma)/0x8000000000;
        sa = (ea >>> 7) & 0x01;
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // Normalize A for 39 bits (13 octades)
        while (ma < 0x1000000000) {
            ++this.cycleCount;
            ma *= 8;                    // shift left
            --ea;
        }
        // Normalize B for 39 bits (13 octades)
        while (mb < 0x1000000000) {
            ++this.cycleCount;
            mb *= 8;                    // shift left
            --eb;
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
            q = 0;                      // initialize the quotient digit
            while (mb >= ma) {
                ++q;                    // bump the quotient digit
                mb -= ma;               // subtract divisor from remainder
            }
            if (xx >= 0x1000000000) {
                break;                  // quotient has become normalized
            } else {
                ++n;                    // tally the shifts
                mb *= 8;                // shift the remainder left one octade
                xx = xx*8 + q;          // shift quotient digit into the working quotient
            }
        } while (true);

        this.cycleCount += n*3;         // just estimate the average number of divide clocks
        eb -= ea + n - 1;               // compute the exponent, accounting for the shifts

        // Round the result (it's already normalized)
        this.A = 0;                     // required by specs due to the way rounding addition worked
        if (q >= 4) {                   // if high-order bit of last quotient digit is 1
            this.Q |= 0x01;             // set Q01F (for display purposes only)
            if (xx < 0x7FFFFFFFFF) {    // if the rounding would not cause overflow
                ++xx;                   // round up the result
            }
        }

        // Check for exponent under/overflow
        if (eb > 63) {
            eb %= 64;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0xB0;    // set I05/6/8: exponent-overflow
                this.cc.signalInterrupt();
            }
        } else if (eb < 0) {
            if (eb >= -63) {
                eb = (-eb) | 0x40;                  // set the exponent sign bit
            } else {
                eb = ((-eb) % 64) | 0x40;           // mod the exponent and set its sign
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xA0;// set I06/8: exponent-underflow
                    this.cc.signalInterrupt();
                }
            }
        }

        this.B = (sb*128 + eb)*0x8000000000 + xx;   // Final Answer
    }
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.integerDivide = function integerDivide() {
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
        if (this.NCSF) {                // and we're in Normal State
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
            ++this.cycleCount;
            ma *= 8;                    // shift left
            --ea;
        }
        // Normalize B for 39 bits (13 octades)
        while (mb < 0x1000000000) {
            ++this.cycleCount;
            mb *= 8;                    // shift left
            --eb;
        }

        if (ea > eb) {                  // if divisor has greater magnitude
            this.A = this.B = 0;        // quotient is < 1, so set result to zero
        } else {                        // otherwise, do the long division
            sb ^= sa;                   // positive if signs are same, negative if different

            // Now we step through the development of the quotient one octade at a time,
            // similar to that for DIV, but in addition to stopping when the high-order
            // octade of xx is non-zero (i.e., normalized), we can stop if the exponents
            // become equal. Since there is no rounding, we do not need to develop an
            // extra quotient digit.
            do {
                this.cycleCount += 3;   // just estimate the average number of clocks
                q = 0;                  // initialize the quotient digit
                while (mb >= ma) {
                    ++q;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                mb *= 8;                // shift the remainder left one octade
                xx = xx*8 + q;          // shift quotient digit into the working quotient
                if (xx >= 0x1000000000) {
                    break;              // quotient has become normalized
                } else if (ea < eb) {
                    --eb;               // decrement the B exponent
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
B5500Processor.prototype.remainderDivide = function remainderDivide() {
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
        if (this.NCSF) {                // and we're in Normal State
            this.I = (this.I & 0x0F) | 0xD0;    // set I05/7/8: divide by zero
            this.cc.signalInterrupt();
        }
    } else if (mb == 0) {               // otherwise, if B is zero,
        this.A = this.B = 0;            // result is all zeroes
    } else {                            // otherwise, continue
        ea = (this.A - ma)/0x8000000000;
        sa = (ea >>> 7) & 0x01;
        ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

        // Normalize A for 39 bits (13 octades)
        while (ma < 0x1000000000) {
            ++this.cycleCount;
            ma *= 8;                    // shift left
            --ea;
        }
        // Normalize B for 39 bits (13 octades)
        while (mb < 0x1000000000) {
            ++this.cycleCount;
            mb *= 8;                    // shift left
            --eb;
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
                    ++q;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                xx = xx*8 + q;          // shift quotient digit into the working quotient
                if (xx >= 0x1000000000) {
                    break;              // quotient has become normalized
                } else if (ea < eb) {
                    mb *= 8;            // shift the remainder left one octade
                    --eb;               // decrement the B exponent
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
B5500Processor.prototype.doublePrecisionAdd = function doublePrecisionAdd(adding) {
    /* Adds the double-precision contents of the A and B registers to the top two
    words in the memory stack, leaving the result in A and B. If "adding" is not true,
    the sign of A is complemented to accomplish subtraction instead of addition.
    The more-significant portion of the double value is in the A register or at the
    higher stack address; the less-significant portion (which consists only of a
    mantissa extension in the low-order 39 bits) is in the B register or at the lower
    stack address. Mechanization of double precision on the B5500 could be called The
    Dance of Insufficient Registers, so hang on -- just getting the operands normalized
    so that we can do the addition is a wild ride */
    var d;                              // shifting digit between registers
    var ea;                             // signed exponent of M2/M4
    var eb;                             // signed exponent of M1/M3
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n = 0;                          // local copy of N
    var q01f = 0;                       // local copy of Q01F for carry/rounding
    var q02f;                           // local copy of Q02F to indicate internal add
    var q04f = 0;                       // local copy of Q04F to track operand exchanges
    var sa;                             // mantissa sign of M2/M4 (0=positive)
    var sb;                             // mantissa sign of M1/M3 (ditto)
    var temp;                           // temp value for exchanging registers
    var xx;                             // extended mantissa

    this.cycleCount += 2;               // estimate some general overhead
    this.adjustABFull();                // load M1/m1 to A/B registers, respectively

    // Initially, we have M1 and m1 (the addend/subtrahend) in A and B, respectively,
    // with M2 and m2 (the augend/minuend) in the stack at S0 and S0-1, respectively.
    // Set up the registers for the instruction's initial operand assumptions.
    xx = this.B % 0x8000000000;         // move m1 to X
    this.B = this.A;                    // move M1 to B
    this.loadAviaS();                   // load M2 to A

    ma = this.A % 0x8000000000;         // extract the M2 mantissa and fields
    ea = (this.A - ma)/0x8000000000;
    sa = (ea >>> 7) & 0x01;
    ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));

    mb = this.B % 0x8000000000;         // extract the M1 mantissa and fields
    eb = (this.B - mb)/0x8000000000;
    sb = (adding ? (eb >>> 7) & 0x01 : 1-((eb >>> 7) & 0x01));
    eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));

    // If the exponents are unequal, normalize the larger and scale the smaller
    // until they are in alignment, or one mantissa becomes zero

    while (ea != eb) {
        ++this.cycleCount;
        if (ea > eb) {
            // B has the smaller exponent: normalize or exchange
            if (ma >= 0x1000000000) {
                // A is normalized, so scale B
                d =  mb % 8;
                mb = (mb - d)/8;                // shift right into extension
                temp = xx % 8;
                xx = (xx - temp)/8 + d*0x1000000000;
                q01f = (temp >>> 2) & 0x01;
                if (n < 14) {
                    ++eb;
                }
                if (mb == 0) {
                    if (n == 13) {
                        eb = ea;                // B and X are both zero, so stop scaling
                    }
                    ++n;
                }
            } else {
                // A is not normalized, so do first exchange of operands
                this.cycleCount += 3;
                this.A = xx;                    // move m1 in X to A
                ++this.S;
                this.storeAviaS();              // store m1 in stack at S0+1
                this.A = this.B;                // move M1 in B to A
                ma = mb;
                this.S -= 2;
                this.loadBviaS();               // load m2 from S0-1 to B
                xx = this.B % 0x8000000000;     // extract m2 to X
                ++this.S;
                this.loadBviaS();               // load M2 from S0 to B
                mb = this.B % 0x8000000000;
                q04f = 1 - q04f;                // complement Q04F to track exchanges
                temp = ea;                      // exchange internal exponents
                ea = eb;
                eb = temp;
                temp = sa;                      // exchange internal signs
                sa = sb;
                sb = temp;
            }
        } else if (ea < eb) {
            // If B has the larger exponent, normalize B and then see where we stand
            if (mb < 0x1000000000) {
                // B is not yet normalized, so shift left one octade
                d = (xx - xx%0x1000000000)/0x1000000000;
                mb = mb*8 + d;          // shift B & X left
                xx = (xx % 0x1000000000)*8;
                if (++n != 13 || mb != 0) {
                    --eb;
                }
            } else {
                // B is now normalized, so see what to do next
                n = 0;
                if (q04f) {
                    // Operands have been exchanged once, exchange again
                    if (n < 14) {
                        this.cycleCount += 3;
                        this.B = mb;
                        this.storeBviaS();      // store M4 over M2 at S0
                        this.B = xx;
                        --this.S;
                        this.storeBviaS();      // store m4 over m2 at S0-1
                        this.S += 2;
                        this.loadBviaS();       // load m1 to B from S0+1
                        xx = this.B % 0x8000000000; // extract m1 to X
                        this.B = this.A;        // move M1 back to B
                        mb = ma;
                        --this.S;
                        this.loadAviaS();       // reload A with M4 from S0
                        ma = this.A % 0x8000000000;
                        q04f = 1 - q04f;        // complement Q04F to track exchanges
                        temp = ea;              // exchange internal exponents
                        ea = eb;
                        eb = temp;
                        temp = sa;              // exchange internal signs
                        sa = sb;
                        sb = temp;
                    }
                } else {
                    // Do first operand exchange
                    this.cycleCount += 3;
                    this.A = xx;                // move m1 in X to A
                    ++this.S;
                    this.storeAviaS();          // store m1 in stack at S0+1
                    this.A = this.B;            // move M1 in B to A
                    ma = mb;
                    this.S -= 2;
                    this.loadBviaS();           // load m2 from S0-1 to B
                    xx = this.B % 0x8000000000; // extract m2 to X
                    ++this.S;
                    this.loadBviaS();           // load M2 from S0 to B
                    mb = this.B % 0x8000000000;
                    q04f = 1 - q04f;            // complement Q04F to track exchanges
                    temp = ea;                  // exchange internal exponents
                    ea = eb;
                    eb = temp;
                    temp = sa;                  // exchange internal signs
                    sa = sb;
                    sb = temp;
                }
            }
        }
    }

    // Exponents are now equal, so set up for the add/subtract
    n = 0;
    q02f = (sa == sb ? 1 : 0);          // true if internal add, false if internal subtract
    if (q04f) {
        // Operands have been exchanged once, so put them back where they belong
        // Note that signs are not exchanged at this point (and exponents are equal,
        // so exchanging would be pointless).
        this.cycleCount += 2;
        this.B = mb;
        this.storeBviaS();              // store M4 over M2 at S0
        mb = xx;                        // retrieve m4 from X to B
        xx = ma;                        // park M3 in X during the LS phase
        ++this.S;
        this.loadAviaS();               // load m3 to A from S0+1
        ma = this.A % 0x8000000000;
    } else {
        // Zero or two exchanges have occurred, so rearrange for the add/subtract
        ++this.cycleCount;
        ma = xx;                        // retrieve m3 from X
        xx = mb;                        // park M3 in X during the LS phase
        --this.S;
        this.loadBviaS();               // load m4 to B from S0-1
        mb = this.B % 0x8000000000;
    }

    // Now we have the operands normalized and ready for LS mantissa addition:
    // M3 is in X, m3 is in A, m4 is in B, and M4 is in the stack at S0.
    // Sign/exponent for M3/m3 is in sb/eb; sign/exponent for M4/m4 is in sa/ea.

    this.cycleCount += 4;               // count basic clocks through overflow/scale/decomp

    // First, if it's internal subtract, complement A and Q01F.
    if (!q02f) {
        ++this.cycleCount;
        ma = 0x7FFFFFFFFF - ma;
        q01f = 1 - q01f;
    }

    // Add the LS mantissa values and any rounding bit generated from scaling
    mb += ma + q01f;
    if (mb < 0x8000000000) {            // check for overflow
        q01f = 0;
    } else {
        mb -= 0x8000000000;             // adjust for overflow
        q01f = 1;
    }

    if (q04f) {
        --this.S;                       // adjust S back to S0
    } else {
        ++this.S;                       // adjust S back to S0
        eb = ea;                        // set result exponent and sign
        sb = sa;
    }

    // Park the LS result in B to X; load the MS mantissa values.
    temp = mb;                          // exchange B (m3+m4) and X (M3)
    mb = xx;
    xx = temp;
    this.loadAviaS();                   // reload M4 to A from S0
    ma = this.A % 0x8000000000;

    // If it's internal subtract, complement A.
    if (!q02f) {
        ++this.cycleCount;
        temp = ma;
        ma = 0x7FFFFFFFFF - mb;
        mb = temp;
    }

    // Add the MS mantissa values and any carry from the LS addition.
    mb += ma + q01f;
    ma = xx;                            // restore LS mantissa from X to A
    q01f = 0;

    // Determine overflow, scaling, and decomplementing
    if (mb < 0x8000000000) {            // if no overflow occurred
        if (!q02f) {                    // if it's internal subtract, must decomplement
            this.cycleCount += 4;
            ma = 0x7FFFFFFFFF - ma;         // decomplement LS mantissa in A
            xx = mb;                        // temporarily park MS mantissa in B to X
            q01f = 1 - q01f;                // complement the carry/rounding bit
            mb = ma + q01f;                 // add LS mantissa to complemented rounding bit
            if (mb >= 0x8000000000) {       // if overflow occurred
                mb -= 0x8000000000;         // clear overflow and
                q01f = 0;                   // reset the (complemented) rounding bit
            }
            ma = 0x7FFFFFFFFF - xx;         // retrieve MS mantissa from X and decomplement
            q01f = 1 - q01f;                // complement the rounding bit
            xx = mb;                        // move LS mantissa in B to X
            mb = ma + q01f;                 // add MS mantissa to complemented rounding bit
            sb = 1 - sb;                    // complement the result sign
        }
    } else {                            // otherwise, in case of overflow
        if (!q02f) {                    // if it's internal subtract
            mb -= 0x8000000000;             // simply discard the overflow (it's a borrow)
        } else {                        // otherwise for add, scale the overflow
            ++this.cycleCount;
            d =  mb % 8;                    // shift B & X right, including the overflow octade
            mb = (mb - d)/8;
            temp = xx % 8;                  // detemine the rounding octade
            xx = (xx - temp)/8 + d*0x1000000000; //??// + (temp < 4 ? 0 : 1);
            if (xx >= 0x8000000000) {
                ++this.cycleCount;
                xx -= 0x8000000000;         // rounding overflowed from X into B
                ++mb;
            }
            ++eb;
        }
    }

    // Do a final normalization, if necessary
    this.cycleCount += 2;               // count clocks for the final steps
    n = 0;
    while (mb < 0x1000000000) {
        ++this.cycleCount;
        d = (xx - xx%0x1000000000)/0x1000000000;
        mb = mb*8 + d;                  // shift B & X left
        xx = (xx % 0x1000000000)*8;
        --eb;
        if (++n == 13 && mb == 0) {
            break;                      // result is zero
        }
    }

    this.S -= 2;                        // cut S to below the original operands
    if (mb == 0 && xx == 0) {           // if resulting mantissa is zero
        this.A = this.B = 0;            // result is all zeroes
    } else {                            // Check for exponent overflow
        if (eb > 63) {
            eb %= 64;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0xB0;        // set I05/6/8: exponent-overflow
                this.cc.signalInterrupt();
            }
        } else if (eb < 0) {
            if (eb >= -63) {
                eb = (-eb) | 0x40;                      // set the exponent sign bit
            } else {
                eb = ((-eb) % 64) | 0x40;               // mod the exponent and set its sign
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xA0;    // set I06/8: exponent-underflow
                    this.cc.signalInterrupt();
                }
            }
        }

        this.A = (sb*128 + eb)*0x8000000000 + mb;       // Final Answer
        this.B = xx;
    }
    this.AROF = this.BROF = 1;
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.doublePrecisionMultiply = function doublePrecisionMultiply() {
    /* Multiplies the contents of the top two words in the memory stack by the A and
    B registers, leaving the result in A and B, with the S register reduced by 2.
    A 26-octade mantissa is developed and then normalized and rounded. The more-
    significant portion of the double value is in the A register or at the higher
    stack address; the less-significant portion (which consists only of a mantissa
    extension in the low-order 39 bits) is in the B register or at the lower stack
    address. */
    var d;                              // current multiplier & shifting digit (octal)
    var ea;                             // signed exponent of A
    var eaf;                            // adjusted exponent of A for storing partial results
    var eb;                             // signed exponent of B
    var ebf;                            // adjusted exponent of B for storing partial results
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var m7h;                            // high order octade of m7 result (stored in bits of M)
    var n;                              // local copy of N (octade counter)
    var sa;                             // mantissa sign of A (0=positive)
    var sb;                             // mantissa sign of B (ditto)
    var xx;                             // local copy of X for multiplier

    // First, load and normalize the multipler
    this.cycleCount += 2;               // estimate some general overhead
    this.adjustABFull();
    xx = this.B % 0x8000000000;         // LS divisor mantissa to X
    mb = this.A % 0x8000000000;         // MS divisor from A to the B fields
    ea = (this.A - mb)/0x8000000000;
    sa = (ea >>> 7) & 0x01;             // get sign & exponent of divisor
    ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));
    n = 0;                              // normalize for at most 13 octades
    while (mb < 0x1000000000) {
        ++this.cycleCount;
        d = (xx - xx%0x1000000000)/0x1000000000;
        mb = mb*8 + d;                  // shift B & X left
        xx = (xx % 0x1000000000)*8;
        --ea;
        if (++n == 13 && mb == 0) {
            break;                      // result is zero
        }
    }

    // Next, check for a zero multiplier
    if (mb == 0 && n == 13) {
        this.A = this.B = 0;
        this.S -= 2;                    // adjust stack to below the multiplicand words, and we're done
    } else {
        // Compute adjusted A exponent field for use in storing partial results
        eaf = (ea < 0 ? 0x40 : 0) + (ea < 0 ? -ea : ea) % 0x40;

        // Move the normalized m2 in X to A; push normalized M3 word in B onto stack
        ma = xx;                        // save m3 in A mantissa
        ++this.S;
        this.B = (sa*128 + eaf)*0x8000000000 + mb;
        this.storeBviaS();              // store M3 above operand words

        // Now load and normalize the multiplicand
        this.cycleCount += 2;           // estimate some general overhead
        this.S -= 2;                    // adjust S down to LS word of multiplicand
        this.loadBviaS();               // load m2
        xx = this.B % 0x8000000000;     // move multiplicand LS mantissa from B to X
        ++this.S;
        this.loadBviaS();
        mb = this.B % 0x8000000000;     // move MS multiplicand to the B fields
        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;         // get sign & exponent of multiplicand
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));
        n = 0;                          // normalize for at most 13 octades
        while (mb < 0x1000000000) {
            ++this.cycleCount;
            d = (xx - xx%0x1000000000)/0x1000000000;
            mb = mb*8 + d;              // shift B & X left
            xx = (xx % 0x1000000000)*8;
            --eb;
            if (++n == 13 && mb == 0) {
                break;                  // result is zero
            }
        }

        // Check for a zero multiplicand
        if (mb == 0 && n == 13) {
            this.A = this.B = 0;
            this.S -= 2;                // adjust stack to below the multiplicand words, and we're done
        } else {
            // Compute adjusted B exponent field for use in storing partial results
            ebf = (eb < 0 ? 0x40 : 0) + (eb < 0 ? -eb : eb) % 0x40;

            // Compute result sign and exponent; set up for first partial product
            this.cycleCount += 10;      // estimate some general overhead
            sb ^= sa;                   // compute the product sign
            eb += ea+13;                // compute resulting exponent from multiply
            this.B = (sb*128 + ebf)*0x8000000000 + mb;
            this.storeBviaS();          // store M4
            --this.S;
            this.A = (sa*128 + eaf)*0x8000000000 + xx;
            this.storeAviaS();          // store m4
            xx = ma;                    // move m3 mantissa to X
            ma = mb;                    // move M4 mantissa to A
            //sa = sb;                  // move result sign to A (not needed)

            // Now we step through the 13 octades of the multiplier, developing
            // the first partial product: M6 in B, m6 in X
            mb = 0;                     // clear initial product in B
            for (n=0; n<13; ++n) {
                d = xx % 8;             // extract the current multiplier digit from X
                if (d == 0) {           // if multiplier digit is zero
                    ++this.cycleCount;  // hardware optimizes this case
                } else {
                    this.cycleCount += 3; // just estimate the average number of clocks
                    mb += ma*d;         // develop the partial product
                }

                // Shift B & X together one octade to the right
                xx = (xx - d)/8 + (d = mb % 8)*0x1000000000;
                mb = (mb - d)/8;
            } // for n

            // Store first partial product; set up for second multiply cycle
            this.loadAviaS();           // load m4 to A
            this.B = (sb*128 + ebf)*0x8000000000 + mb;
            this.storeBviaS();          // store S10 E10 M6 where m4 was
            mb = xx;                    // m6 to B
            xx = this.A % 0x8000000000; // m4 in A to X
            this.S += 2;
            this.loadAviaS();           // get M3 to A
            ma = this.A % 0x8000000000;

            // Step again through the 13 octades of the multiplier, developing
            // the second partial product: M7 in B, m7 in X
            for (n=0; n<13; ++n) {
                d = xx % 8;             // extract the current multiplier digit from X
                if (d == 0) {           // if multiplier digit is zero
                    ++this.cycleCount;  // hardware optimizes this case
                } else {
                    this.cycleCount += 3; // just estimate the average number of clocks
                    mb += ma*d;         // develop the partial product
                }

                // Shift B & X together one octade to the right
                xx = (xx - d)/8 + (d = mb % 8)*0x1000000000;
                mb = (mb - d)/8;
            } // for n

            // Store second partial product; set up for third multiply cycle
            m7h = (xx - xx%0x1000000000)/0x1000000000; // save high-order octade of m7
            xx = ma;                    // M3 in A to X
            --this.S;
            this.loadAviaS();           // load M4 to A
            ma = this.A % 0x8000000000;

            // Step again through the 13 octades of the multiplier, developing
            // the third partial product: M8 in B, m8 in X
            for (n=0; n<13; ++n) {
                d = xx % 8;             // extract the current multiplier digit from X
                if (d == 0) {           // if multiplier digit is zero
                    ++this.cycleCount;  // hardware optimizes this case
                } else {
                    this.cycleCount += 3; // just estimate the average number of clocks
                    mb += ma*d;         // develop the partial product
                }

                // Shift B & X together one octade to the right
                xx = (xx - d)/8 + (d = mb % 8)*0x1000000000;
                mb = (mb - d)/8;
            } // for n

            // At this point, the hardware exchanges B and X, loads M6 to A from
            // the stack, and enters the logic for DLA (0105, DP add) at J=8.
            // It's easier for the emulator to replicate that logic in line here.

            d = xx;
            xx = mb;                    // exchange B (M8) with X (m8)
            mb = d;
            --this.S;
            this.loadAviaS();           // load M6 to A
            ma = this.A % 0x8000000000;

            // The remainder of the multiply was done by DLA logic:
            mb += ma;                   // compute m9=m8+M6 (with possible carry)
            d = xx;
            xx = mb;                    // exchange B (m9) with X (M8)
            mb = d;
            --this.S                    // restore S to below the original operand in the stack
            if (xx >= 0x8000000000) {   // if m9 produced a carry
                xx -= 0x8000000000;     // remove the carry from m9 in X
                ++mb;                   // add the carry to M8 in B to produce M9
                if (mb >= 0x8000000000) { // if M9 in B has an overflow, scale right
                    ++this.cycleCount;
                    d = mb % 8;                         // get the shifting digit from B
                    mb = (mb - d)/8;                    // shift mantissa right due to overflow
                    xx = (xx - xx%8)/8 + d*0x1000000000;// shift extension right and insert mantissa digit
                    ++eb;
                }
            }

            // Perform a final normalization of the B and X registers
            n = 0;
            while (mb < 0x1000000000) {
                ++this.cycleCount;
                ma = xx % 0x1000000000; // reuse ma: get low-order 36 bits of mantissa extension
                d = (xx - ma)/0x1000000000;     // get high-order octade of extension
                mb = mb*8 + d;          // shift high-order extension octade into B
                xx = ma*8 + m7h;        // shift extension left one octade, add H.O. m7 octade
                m7h = 0;
                --eb;
                if (++n == 13 && mb == 0) {
                    break;                      // result is zero
                }
            }

            if (mb == 0 && xx == 0) {           // if resulting mantissa is zero
                this.A = this.B = 0;            // result is all zeroes
            } else {                            // Check for exponent overflow
                // Check for exponent under/overflow
                if (eb > 63) {
                    eb %= 64;
                    if (this.NCSF) {
                        this.I = (this.I & 0x0F) | 0xB0;    // set I05/6/8: exponent-overflow
                        this.cc.signalInterrupt();
                    }
                    /********** dumpState("Exponent Overflow in DLM"); ************************************/
                } else if (eb < 0) {
                    if (eb >= -63) {
                        eb = (-eb) | 0x40;                  // set the exponent sign bit
                    } else {
                        eb = ((-eb) % 64) | 0x40;           // mod the exponent and set its sign
                        if (this.NCSF) {
                            this.I = (this.I & 0x0F) | 0xA0;// set I06/8: exponent-underflow
                            this.cc.signalInterrupt();
                        }
                    }
                }

                this.A = (sb*128 + eb)*0x8000000000 + mb;   // Final Answer
                this.B = xx;
            }
        }
    }
    this.AROF = this.BROF = 1;
    this.X = xx;                        // for display purposes only
};

/**************************************/
B5500Processor.prototype.doublePrecisionDivide = function doublePrecisionDivide() {
    /* Divides the contents of the top two words in the memory stack by the A and
    B registers, leaving the result in A and B, with the S register reduced by 2.
    A 26-octade mantissa is developed and then normalized and rounded. The more-
    significant portion of the double value is in the A register or at the higher
    stack address; the less-significant portion (which consists only of a mantissa
    extension in the low-order 39 bits) is in the B register or at the lower stack
    address */
    var d;                              // shifting digit between registers
    var ea;                             // signed exponent of divisor
    var eb;                             // signed exponent of dividend
    var ma;                             // absolute mantissa of A
    var mb;                             // absolute mantissa of B
    var n;                              // local copy of N (octade counter)
    var q;                              // current quotient digit (octal)
    var sa;                             // mantissa sign of divisor (0=positive)
    var sb;                             // mantissa sign of dividend (ditto)
    var xx;                             // local copy of X for normalization and quotient development

    // First, load and normalize the divisor
    this.cycleCount += 2;               // estimate some general overhead
    this.adjustABFull();                // load the divisor
    xx = this.B % 0x8000000000;         // LS divisor mantissa to X
    mb = this.A % 0x8000000000;         // MS divisor from A to the B fields
    ea = (this.A - mb)/0x8000000000;
    sa = (ea >>> 7) & 0x01;             // get sign & exponent of divisor
    ea = (ea & 0x40 ? -(ea & 0x3F) : (ea & 0x3F));
    n = 0;
    while (mb < 0x1000000000) {
        ++this.cycleCount;
        d = (xx - xx%0x1000000000)/0x1000000000;
        mb = mb*8 + d;                  // shift B & X left
        xx = (xx % 0x1000000000)*8;
        --ea;
        if (++n == 13 && mb == 0) {
            break;
        }
    }

    // Next, check for a zero divisor
    if (mb == 0 && n == 13) {
        if (this.NCSF) {                // and we're in Normal State
            this.I = (this.I & 0x0F) | 0xD0;    // set I05/7/8: divide by zero
            this.cc.signalInterrupt();
        }
        this.AROF = this.BROF = 0;
        this.adjustABFull();            // A & B must load the dividend words on div-zero exit
    } else {
        // Move the normalized B mantissa to A; push normalized m3 extension onto stack
        ma = mb;
        this.B = xx;
        ++this.S;
        this.storeBviaS();

        // Now load and normalize the dividend
        this.cycleCount += 2;           // estimate some general overhead
        this.S -= 2;                    // adjust S down to LS word of dividend
        this.loadBviaS();
        xx = this.B % 0x8000000000;     // move dividend LS mantissa from B to X
        ++this.S;
        this.loadBviaS();
        mb = this.B % 0x8000000000;     // move MS dividend from A to the B fields
        eb = (this.B - mb)/0x8000000000;
        sb = (eb >>> 7) & 0x01;         // get sign & exponent of dividend
        eb = (eb & 0x40 ? -(eb & 0x3F) : (eb & 0x3F));
        n = 0;
        while (mb < 0x1000000000) {
            ++this.cycleCount;
            d = (xx - xx%0x1000000000)/0x1000000000;
            mb = mb*8 + d;              // shift B & X left
            xx = (xx % 0x1000000000)*8;
            --eb;
            if (++n == 13 && mb == 0) {
                break;
            }
        }

        // Check for a zero dividend
        if (mb == 0 && n == 13) {
            this.A = this.B = 0;
            this.AROF = this.BROF = 1;
            this.S -= 2;                // adjust stack to below dividend words, and we're done
        } else {
            sb ^= sa;                   // compute the quotient sign

            // First divide sub-cycle: develop Q1/R1 (see singlePrecisionDivide for details)
            n = 0;
            do {
                q = 0;                  // initialize the quotient digit
                while (mb >= ma) {
                    ++q;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                ++n;                    // tally the shifts
                d = (xx - xx%0x1000000000)/0x1000000000;
                mb = mb*8 + d;          // shift B & X left
                xx = (xx % 0x1000000000)*8 + q;
            } while (n < 13 ? true : (n < 14 ? xx < 0x1000000000 : false));

            this.cycleCount += n*3;     // just estimate the average number of divide clocks
            eb -= ea + n - 1;           // compute the exponent, accounting for the shifts
            this.B = (sb*128 + (eb < 0 ? ((-eb) % 0x40) | 0x40 : eb % 0x40))*0x8000000000 + xx;
            this.storeBviaS();          // store Q1 in the stack

            // Second divide sub-cycle: develop q1/R2
            n = xx = 0;
            do {
                q = 0;                  // initialize the quotient digit
                while (mb >= ma) {
                    ++q;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                ++n;                    // tally the shifts
                mb = mb*8;              // shift B & X left together (but X is initially zero)
                xx = xx*8 + q;          // shift the quotient digits into the working quotient
            } while (n < 13);

            this.cycleCount += n*3;     // just estimate the average number of divide clocks
            this.A = xx;                // move q1 result to A
            --this.S;                   // decrement S to overwrite old m2 value
            this.storeAviaS();          // store q1 in the stack

            // Third divide sub-cycle: develop q2
            this.S += 2;                // increment S to point to m3 value
            this.loadBviaS();           // load m3 LS mantissa value to B
            mb = this.B % 0x8000000000;
            n = xx = 0;
            do {
                q = 0;                  // initialize the quotient digit
                while (mb >= ma) {
                    ++q;                // bump the quotient digit
                    mb -= ma;           // subtract divisor from remainder
                }
                ++n;                    // tally the shifts
                mb = mb*8;              // shift B & X left together (but X is initially zero)
                xx = xx*8 + q;          // shift the quotient digits into the working quotient
            } while (n < 13);

            this.cycleCount += n*3;     // just estimate the average number of divide clocks
            --this.S;

            // Now determine whether Q1:q1 must be multiplied by Q2:q2.
            // The third divide cycle produces the negative of q2, which is the
            // second term in the binomial expansion that implements DP Divide.
            // If the result of the divide is zero, that term evaluates to one,
            // so the term does not need to be multiplied with the first one. If
            // it is not zero, DP Multiply is used to apply the term to the
            // result. Note, however, that q2 is scaled by 8**-26 and occupies the
            // second word of the DP multiplier. Therefore, when complementing
            // its sign, we must supply the high order half of the DP value, which
            // will have a mantissa of all ones due to the rules of 2-s complement
            // arithmetic.

            // The B5500 logic used Q05F to modify the behavior of exponent
            // arithmetic in DLM during this special multiply, but that doesn't
            // work here, as we are passing operands, not register settings (which
            // could have significant exponent bits set in M). Thus, we generate
            // the high-order word of the multiplier with a mantissa of all ones
            // and an exponent to properly scale q2. The weird 0x260FFFFFFFFFF value
            // is octal 1140777777777777, which is a mantissa of all ones with the
            // high-order octade set to zero and a scale of 8**-12 (approximately
            // 0.999999999985). See the Training Manual and flows for details.

            // I have no idea why setting the high-order octade of the mantissa
            // to zero  (which forces a normalization shift in DLM) is necessary
            // or why it works, but it is and it does.

            if (xx == 0) {              // q2 is zero: no multiply needed
                this.cycleCount += 3;
                this.loadAviaS();       // load Q1
                --this.S;
                this.loadBviaS();       // load q1
                --this.S;
                this.X = xx;            // for display purposes only

                // Check for exponent over- or underflow
                if (eb > 63) {
                    if (this.NCSF) {
                        this.I = (this.I & 0x0F) | 0xB0;// set I05/6/8: exponent-overflow
                        this.cc.signalInterrupt();
                    }
                } else if (eb < -63) {
                    if (this.NCSF) {
                        this.I = (this.I & 0x0F) | 0xA0;// set I06/8: exponent-underflow
                        this.cc.signalInterrupt();
                    }
                }
            } else {                    // q2 is non-zero: set up for DP multiply
                // Since having DLM operate against operands in the stack will lose
                // any indication of exponent over- or underflow here, and the multiply
                // uses a factor very close to 1.0, we check the exponent bounds here
                // and throw any necessary interrupt before calling DLM.
                if (eb > 63) {
                    this.AROF = this.BROF = 0;
                    if (this.NCSF) {
                        this.I = (this.I & 0x0F) | 0xB0;// set I05/6/8: exponent-overflow
                        this.cc.signalInterrupt();
                    }
                } else if (eb < -63) {
                    this.AROF = this.BROF = 0;
                    if (this.NCSF) {
                        this.I = (this.I & 0x0F) | 0xA0;// set I06/8: exponent-underflow
                        this.cc.signalInterrupt();
                    }
                } else {
                    this.cycleCount += 2;
                    this.A = 0x260FFFFFFFFF;            // load A with scaled Q2
                    this.B = 0x8000000000 - xx;         // load B with q2
                    this.AROF = this.BROF = 1;
                    this.doublePrecisionMultiply();
                }
            }
        } // non-zero dividend
    } // non-zero divisor
};

/**************************************/
B5500Processor.prototype.computeRelativeAddr = function computeRelativeAddr(offset, cEnabled) {
    /* Computes an absolute memory address from the relative "offset" parameter
    and leaves it in the M register. See Table 6-1 in the B5500 Reference
    Manual. "cEnable" determines whether C-relative addressing is permitted.
    This offset must be in (0..1023) */

    if (this.SALF) {
        this.cycleCount += 2;           // approximate the timing
        switch ((offset % 0x400) >>> 7) {
        case 0:
        case 1:
        case 2:
        case 3:
            this.M = this.R*64 + (offset % 0x200);
            break;
        case 4:
        case 5:
            if (this.MSFF) {
                this.M = this.R*64 + 7;
                this.loadMviaM();       // M = [M].[18:15]
                this.M += (offset % 0x100);
            } else {
                this.M = this.F + (offset % 0x100);
            }
            break;
        case 6:
            if (cEnabled) {
                this.M = (this.L ? this.C : this.C-1) + (offset % 0x80); // adjust C for fetch
            } else {
                this.M = this.R*64 + (offset % 0x80);
            }
            break;
        case 7:
            if (this.MSFF) {
                this.M = this.R*64 + 7;
                this.loadMviaM();       // M = [M].[18:15]
                this.M -= (offset % 0x80);
            } else {
                this.M = this.F - (offset % 0x80);
            }
            break;
        } // switch
    } else {
        this.M = this.R*64 + (offset % 0x400);
    }

    // Reset variant-mode R-relative addressing, if enabled
    if (this.VARF) {
        this.SALF = 1;
        this.VARF = 0;
    }
};

/**************************************/
B5500Processor.prototype.presenceTest = function presenceTest(word) {
    /* Tests and returns the presence bit [2:1] of the "word" parameter,
    which it assumes is a control word. If [2:1] is 0, the p-bit interrupt
    is set; otherwise no further action */

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
B5500Processor.prototype.indexDescriptor = function indexDescriptor() {
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
    xe = (bw - xm)/0x8000000000;
    xs = (xe >>> 7) & 0x01;
    xt = (xe >>> 6) & 0x01;
    xe = (xt ? -(xe & 0x3F) : (xe & 0x3F));

    // Normalize the index, if necessary
    if (xe < 0) {                       // index exponent is negative
        do {
            ++this.cycleCount;
            xo = xm % 8;
            xm = (xm - xo)/8;
        } while (++xe < 0);
        if (xo >= 4) {
            ++xm;                       // round the index
        }
    } else if (xe > 0) {                // index exponent is positive
        do {
            ++this.cycleCount;
            if (xm < 0x1000000000) {
                xm *= 8;
            } else {                // oops... integer overflow normalizing the index
                xe = 0;             // kill the loop
                interrupted = 1;
                if (this.NCSF) {
                    this.I = (this.I & 0x0F) | 0xC0;        // set I07/8: integer overflow
                    this.cc.signalInterrupt();
                }
            }
        } while (--xe > 0);
    }

    // Now we have an integerized index value in xm
    if (!interrupted) {
        if (xs && xm) {                 // oops... negative index
            interrupted = 1;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0x90;                // set I05/8: invalid-index
                this.cc.signalInterrupt();
            }
        } else if (xm % 0x0400 >= (aw % 0x10000000000 - aw % 0x40000000)/0x40000000) {
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
B5500Processor.prototype.integerStore = function integerStore(conditional, destructive) {
    /* Store the value in the B register at the address in the A register (relative
    or descriptor) and marks the A register empty. "conditional" indicates that
    integerization is conditional on the type of word in A, and if a descriptor,
    whether it has the integer bit set */
    var aw;                             // local copy of A reg
    var bw;                             // local copy of B reg
    var be;                             // B exponent
    var bm;                             // B mantissa
    var bo;                             // last B octade shifted off
    var bs;                             // B mantissa sign
    var bt;                             // B exponent sign
    var doStore = 1;                    // okay to store
    var normalize = 1;                  // okay to integerize

    this.adjustABFull();
    aw = this.A;
    if (aw < 0x800000000000) {          // it's an operand
        this.computeRelativeAddr(aw, 0);
    } else {                            // it's a descriptor
        if (this.presenceTest(aw)) {
            this.M = aw % 0x8000;
            if (conditional) {
                if (aw % 0x20000000 < 0x10000000) {     // [19:1] is the integer bit
                    normalize = 0;
                }
            }
        } else {
            doStore = normalize = 0;
        }
    }

    if (normalize) {
        bw = this.B;
        bm = (bw % 0x8000000000);
        be = (bw - bm)/0x8000000000;
        bs = (be >>> 7) & 0x01;
        bt = (be >>> 6) & 0x01;
        be = (bt ? -(be & 0x3F) : (be & 0x3F));

        if (be != 0) {                  // is B non-integer?
            if (be < 0) {               // B exponent is negative
                do {
                    ++this.cycleCount;
                    bo = bm % 8;
                    bm = (bm - bo)/8;
                } while (++be < 0);
                if (bs ? bo > 4 : bo >= 4) {
                    ++bm;               // round the B mantissa
                }
            } else {                    // B exponent is positive and not zero
                do {
                    ++this.cycleCount;
                    if (bm < 0x1000000000) {
                        bm *= 8;
                    } else {            // oops... integer overflow normalizing the mantisa
                        doStore = 0;
                        if (this.NCSF) {
                            this.I = (this.I & 0x0F) | 0xC0;    // set I07/8: integer overflow
                            this.cc.signalInterrupt();
                        }
                        break;          // kill the loop
                    }
                } while (--be > 0);
            }
            if (doStore) {
                this.B = bs*0x400000000000 + bm;
            }
        }
    }

    if (doStore) {
        this.storeBviaM();
        this.AROF = 0;
        if (destructive) {
            this.BROF = 0;
        }
    }
};

/**************************************/
B5500Processor.prototype.buildMSCW = function buildMSCW() {
    /* Return a Mark Stack Control Word from current processor state */

    return  this.F * 0x8000 +
            this.SALF * 0x40000000 +
            this.MSFF * 0x80000000 +
            this.R * 0x200000000 +
            0xC00000000000;
};

/**************************************/
B5500Processor.prototype.applyMSCW = function applyMSCW(word) {
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
B5500Processor.prototype.buildRCW = function buildRCW(descriptorCall) {
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
B5500Processor.prototype.applyRCW = function applyRCW(word, inline) {
    /* Set processor state from fields of the Return Control Word in
    the "word" parameter. If "inline" is truthy, C & L are NOT restored from
    the RCW. Returns the state of the OPDC/DESC bit [2:1] */
    var f;

    f = word % 0x8000;                  // [33:15], C
    if (!inline) {
        this.C = f;
        this.PROF = 0;                  // require fetch at SECL
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
    word = (word - word % 16)/16;
    return word % 2;                    //   [2:1], DESC bit
};

/**************************************/
B5500Processor.prototype.enterCharModeInline = function enterCharModeInline() {
    /* Implements the 4441=CMN syllable */
    var bw;                             // local copy of B reg

    this.adjustAEmpty();                // flush TOS registers, but tank TOS value in A
    if (this.BROF) {
        this.A = this.B;                // tank the DI address in A
        this.adjustBEmpty();
    } else {
        this.loadAviaS();               // A = [S]: load the DI address
        this.AROF = 0;
    }
    this.B = this.buildRCW(0);
    this.BROF = 1;
    this.adjustBEmpty();
    this.MSFF = 0;
    this.SALF = 1;
    this.F = this.S;
    this.R = 0;
    this.CWMF = 1;
    this.X = this.S * 0x8000;           // inserting S into X.[18:15], but X is zero at this point
    this.V = 0;
    this.B = bw = this.A;

    // execute the portion of CM XX04=RDA operator starting at J=2
    this.S = bw % 0x8000;
    if (bw < 0x800000000000) {          // if it's an operand
        this.K = (bw % 0x40000) >>> 15; // set K from [30:3]
    } else {
        this.K = 0;                     // otherwise, force K to zero and
        this.presenceTest(bw);          // just take the side effect of any p-bit interrupt
    }
};

/**************************************/
B5500Processor.prototype.enterSubroutine = function enterSubroutine(descriptorCall) {
    /* Enters a subroutine via the present Program Descriptor in A as part
    of an OPDC or DESC syllable. Also handles accidental entry */
    var aw = this.A;                    // local copy of word in A reg
    var arg = (aw % 0x100000000000 - aw % 0x40000000000)/0x40000000000; // aw.[4:2]
    var mode = arg >>> 1;               // descriptor mode bit (aw.[4:1], 1=char mode)

    arg &= 0x01;                        // descriptor argument bit (aw.[5:1])

    if (arg && !this.MSFF) {
        // just leave the Program Descriptor on TOS
    } else if (mode && !arg) {
        // ditto
    } else {
        // Now we are really going to enter the subroutine
        this.adjustBEmpty();
        if (!arg) {
            // Accidental entry -- mark the stack
            this.B = this.buildMSCW();
            this.BROF = 1;
            this.adjustBEmpty();
            this.F = this.S;
        }

        // Push a RCW
        this.B = this.buildRCW(descriptorCall);
        this.BROF = 1;
        this.adjustBEmpty();

        // Fetch the first word of subroutine code
        this.C = aw % 0x8000;
        this.L = 0;
        this.PROF = 0;                  // require fetch at SECL

        // Fix up the rest of the registers
        if (arg) {
            this.F = this.S;
        } else {
            this.F = (aw % 0x40000000) >>> 15;  // aw.[18:15]
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
B5500Processor.prototype.exitSubroutine = function exitSubroutine(inline) {
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
        this.X = this.B % 0x8000000000; // save F setting from RCW to restore S at end

        this.S = this.F;
        this.loadBviaS();               // B = [S], fetch the MSCW
        this.applyMSCW(this.B);

        if (this.MSFF && this.SALF) {
            this.Q |= 0x20;             // set Q06F, not used except for display
            do {
                this.S = (this.B % 0x40000000) >>> 15;
                this.loadBviaS();       // B = [S], fetch prior MSCW
            } while ((this.B % 0x100000000 - this.B % 0x80000000)/0x80000000); // MSFF
            this.S = this.R*64 + 7;
            this.storeBviaS();          // [S] = B, store last MSCW at [R]+7
        }
        this.S = ((this.X % 0x40000000) >>> 15) - 1;
        this.BROF = 0;
    }
    return result;
};

/**************************************/
B5500Processor.prototype.operandCall = function operandCall() {
    /* OPDC, the moral equivalent of "load accumulator" on lesser
    machines. Assumes the syllable has already loaded a word into A.
    See Figures 6-1, 6-3, and 6-4 in the B5500 Reference Manual */
    var aw = this.A;                    // local copy of A reg value
    var interrupted = 0;                // interrupt occurred

    if (aw >= 0x800000000000) {
        // It's not a simple operand
        switch ((aw % 0x800000000000 - aw % 0x100000000000)/0x100000000000) {     // aw.[1:3]
        case 2:
        case 3:
            // Present data descriptor
            if ((aw % 0x10000000000 - aw % 0x40000000)/0x40000000) {              // aw.[8:10]
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
                this.I = (this.I & 0x0F) | 0x70;        // set I05/6/7: p-bit
                this.cc.signalInterrupt();
            // else if Control State, we're done
            }
            break;

        default:
            // Miscellaneous control word -- leave as is
            break;
        }
    }
};

/**************************************/
B5500Processor.prototype.descriptorCall = function descriptorCall() {
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
        switch ((aw % 0x800000000000 - aw % 0x100000000000)/0x100000000000) {     // aw.[1:3]
        case 2:
        case 3:
            // Present data descriptor
            if ((aw % 0x10000000000 - aw % 0x40000000)/0x40000000) {              // aw.[8:10]
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
            // else if Control State, we're done
            }
            break;

        default:
            // Miscellaneous control word
            this.A = this.M + 0xA00000000000;
            break;
        }
    }
};

/**************************************/
B5500Processor.prototype.run = function run() {
    /* Instruction execution driver for the B5500 processor. This function is
    an artifact of the emulator design and does not represent any physical
    process or state of the processor. This routine assumes the registers are
    set up -- in particular there must be a syllable in T with TROF set, the
    current program word must be in P with PROF set, and the C & L registers
    must point to the next syllable to be executed.
    This routine will continue to run while this.runCycles < this.cycleLimit  */
    var cc = this.cc;                   // optimize local reference to CentralControl
    var noSECL = 0;                     // to support char mode dynamic count from CRF syllable
    var opcode;                         // copy of T register
    var t1;                             // scratch variable for internal instruction use
    var t2;                             // ditto
    var t3;                             // ditto
    var t4;                             // ditto
    var variant;                        // high-order six bits of T register

    this.runCycles = 0;                 // initialze the cycle counter for this time slice
    do {
        this.Q = 0;
        this.Y = 0;
        this.Z = 0;
        opcode = this.T;
        this.cycleCount = 1;            // general syllable execution overhead

        if (this.CWMF) {
            /***********************************************************
            *  Character Mode Syllables                                *
            ***********************************************************/
            do {                        // inner loop to support CRF dynamic repeat count
                variant = opcode >>> 6;
                noSECL = 0;             // force off by default (set by CRF)
                switch (opcode & 0x3F) {
                case 0x00:              // XX00: CMX, EXC: Exit character mode
                    if (this.BROF) {
                        this.storeBviaS();              // store destination string
                    }
                    this.S = this.F;
                    this.loadBviaS();                   // B = [S], fetch the RCW
                    this.exitSubroutine(variant & 0x01);// 0=exit, 1=exit inline
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
                        ++this.S;
                        t1 -= 48;
                    }
                    this.K = (t1 - (this.V = t1 % 6))/6;
                    break;

                case 0x03:              // XX03: BSS=Skip bit source
                    this.cycleCount += variant;
                    t1 = this.G*6 + this.H + variant;
                    while (t1 >= 48) {
                        ++this.M;                       // skipped off initial word, so
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
                    this.V = 0;
                    this.S = this.F - variant;
                    this.loadBviaS();                   // B = [S]
                    this.BROF = 0;
                    this.S = (t1 = this.B) % 0x8000;
                    if (t1 < 0x800000000000) {         // if it's an operand,
                        this.K = (t1 % 0x40000) >>> 15;// set K from [30:3]
                    } else {
                        this.K = 0;                     // otherwise, force K to zero and
                        this.presenceTest(t1);          // just take the side effect of any p-bit interrupt
                    }
                    break;

                case 0x05:              // XX05: TRW=Transfer words
                    if (this.BROF) {
                        this.storeBviaS();              // [S] = B
                        this.BROF = 0;
                    }
                    if (this.G || this.H) {
                        this.G = this.H = 0;
                        ++this.M;
                        this.AROF = 0;
                    }
                    if (this.K || this.V) {
                        this.K = this.V = 0;
                        ++this.S;
                    }
                    if (variant) {                      // count > 0
                        if (!this.AROF) {
                            this.loadAviaM();           // A = [M]
                        }
                        do {
                            this.storeAviaS();          // [S] = A
                            ++this.S;
                            ++this.M;
                            if (--variant) {
                                this.loadAviaM();       // A = [M]
                            } else {
                                break;
                            }
                        } while (true);
                    }
                    this.AROF = 0;
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
                    for (variant=3; variant>0; --variant) {
                        this.B = (this.B % 0x40000000000)*0x40 +
                                 (this.Y = cc.fieldIsolate(this.A, this.G*6, 6));
                        if (this.G < 7) {
                            ++this.G;
                        } else {
                            this.G = 0;
                            ++this.M;
                            this.loadAviaM();           // A = [M]
                        }
                    }
                    this.S = this.B % 0x8000;
                    this.K = (this.B % 0x40000) >>> 15;
                    this.M = t1;                        // restore M & G
                    this.G = t2;
                    this.AROF = this.BROF = 0;          // invalidate A & B
                    break;

                case 0x09:              // XX11: Control State ops
                    switch (variant) {
                    case 0x14:          // 2411: ZPI=Conditional Halt
                        if (this.US14X) {               // STOP OPERATOR switch on
                            this.stop();
                        }
                        break;

                    case 0x18:          // 3011: SFI=Store for Interrupt
                        this.storeForInterrupt(0, 0);
                        break;

                    case 0x1C:          // 3411: SFT=Store for Test
                        this.storeForInterrupt(0, 1);
                        break;

                    default:            // Anything else is a no-op
                        break;
                    } // end switch for XX11 ops
                    break;

                case 0x0A:              // XX12: TBN=Transfer blanks for non-numeric
                    this.streamBlankForNonNumeric(variant);
                    break;

                case 0x0C:              // XX14: SDA=Store destination address
                    this.cycleCount += variant;
                    this.streamAdjustDestChar();
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    this.B = this.K*0x8000 + this.S;
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;
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
                    this.B = this.G*0x8000 + this.M;
                    t1 = this.M;                        // save M (not the way the hardware did it)
                    this.M = this.F - variant;
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
                    t1 = this.S*8 + this.K + variant;
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
                    t1 = cc.fieldIsolate(this.A, this.G*6, 6);
                    this.MSFF = (t1 == variant ? 1 : 0);
                    break;

                case 0x15:              // XX25: TNE=Test for not equal
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = cc.fieldIsolate(this.A, this.G*6, 6);
                    this.MSFF = (t1 != variant ? 1 : 0);
                    break;

                case 0x16:              // XX26: TEG=Test for equal or greater
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collation[cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collation[variant];
                    this.MSFF = (t1 >= t2 ? 1 : 0);
                    break;

                case 0x17:              // XX27: TGR=Test for greater
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collation[cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collation[variant];
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

                case 0x1A:              // XX32: xxx=Field subtract (aux)
                    this.fieldArithmetic(variant, false);
                    break;

                case 0x1B:              // XX33: xxx=Field add (aux)
                    this.fieldArithmetic(variant, true);
                    break;

                case 0x1C:              // XX34: TEL=Test for equal or less
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collation[cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collation[variant];
                    this.MSFF = (t1 <= t2 ? 1 : 0);
                    break;

                case 0x1D:              // XX35: TLS=Test for less
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = B5500Processor.collation[cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collation[variant];
                    this.MSFF = (t1 < t2 ? 1 : 0);
                    break;

                case 0x1E:              // XX36: TAN=Test for alphanumeric
                    this.streamAdjustSourceChar();
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    this.Y = t1 = cc.fieldIsolate(this.A, this.G*6, 6);
                    this.Z = variant;                   // for display only
                    if (B5500Processor.collation[t1] > B5500Processor.collation[variant]) {
                        this.MSFF = (t1 == 0x20 ? 0 : (t1 == 0x3C ? 0 : 1));    // alphanumeric unless | or !
                    } else {                            // alphanumeric if equal
                        this.Q |= 0x04;                 // set Q03F (display only)
                        this.MSFF = (t1 == variant ? 1 : 0);
                    }
                    break;

                case 0x1F:              // XX37: BIT=Test bit
                    if (!this.AROF) {
                        this.loadAviaM();               // A = [M]
                    }
                    t1 = (this.Y = cc.fieldIsolate(this.A, this.G*6, 6)) >>> (5-this.H);
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
                    if (!this.PROF) {
                        this.loadPviaC();               // fetch the program word, if necessary
                    }
                    opcode = cc.fieldIsolate(this.P, this.L*12, 12);
                    if (variant) {
                        // if repeat count from parameter > 0, apply it to the next syllable
                        this.T = opcode = (opcode & 0x3F) + variant*0x40;
                    } else {
                        // otherwise, construct JFW (XX47) using repeat count from next syl (whew!)
                        this.T = opcode = (opcode & 0xFC0) + 0x27;
                    }

                    // Since we are bypassing normal SECL behavior, bump the instruction pointer here.
                    noSECL = 1;                         // >>> override normal instruction fetch <<<
                    this.PROF = 0;
                    if (this.L < 3) {
                        ++this.L;
                    } else {
                        this.L = 0;
                        ++this.C;
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
                        this.jumpSyllables(variant);
                    }
                    break;

                case 0x26:              // XX46: JNS=Jump out of loop
                    this.jumpOutOfLoop(variant);
                    break;

                case 0x27:              // XX47: JFW=Jump forward unconditional
                    this.cycleCount += (variant >>> 2) + (variant & 0x03);
                    this.jumpSyllables(variant);
                    break;

                case 0x28:              // XX50: RCA=Recall control address
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B in A
                    this.AROF = this.BROF;
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;
                    this.loadBviaS();                   // B = [S]
                    this.S = t1;
                    t2 = this.B;
                    if (t2 >= 0x800000000000) {         // if it's a descriptor,
                        if (this.presenceTest(t2)) {    // if present, initiate a fetch to P
                            this.C = this.B % 0x8000;   // get the word address,
                            this.L = 0;                 // force L to zero and
                            this.PROF = 0;              // require fetch at SECL
                        }
                    } else {
                        this.C = t2 % 0x8000;
                        t1 = (t2 % 0x4000000000 - t2 % 0x1000000000)/0x1000000000;
                        if (t1 < 3) {                   // if not a descriptor, increment the address
                            this.L = t1+1;
                        } else {
                            this.L = 0;
                            ++this.C;
                        }
                        this.PROF = 0;                  // require fetch at SECL
                    }
                    this.B = this.A;                    // restore B
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x29:              // XX51: ENS=End loop
                    this.cycleCount += 4;
                    this.A = this.B;                    // save B in A
                    this.AROF = this.BROF;
                    t1 = this.X;
                    variant = cc.fieldIsolate(t1, 12, 6);  // get repeat count
                    if (variant) {                      // loop count exhausted?
                        this.C = cc.fieldIsolate(t1, 33, 15);           // no, restore C, L, and P to loop again
                        this.L = cc.fieldIsolate(t1, 10, 2);
                        this.PROF = 0;                  // require fetch at SECL
                        this.X = cc.fieldInsert(t1, 12, 6, variant-1);  // store decremented count in X
                    } else {
                        t2 = this.S;                    // save S (not the way the hardware did it)
                        this.S = cc.fieldIsolate(t1, 18, 15);           // get prior LCW addr from X value
                        this.loadBviaS();               // B = [S], fetch prior LCW from stack
                        this.S = t2;                    // restore S
                        this.X = cc.fieldIsolate(this.B, 9, 39);        // store prior LCW (less control bits) in X
                    }
                    this.B = this.A;                    // restore B
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2A:              // XX52: BNS=Begin loop
                    this.cycleCount += 4;
                    this.A = this.B;                    // save B in A (note that BROF is not altered)
                    t1 = cc.fieldInsert(                // construct new LCW: insert repeat count
                            cc.fieldInsert(             // insert L
                                cc.fieldInsert(this.X, 33, 15, this.C), // insert C
                                10, 2, this.L),
                            12, 6, (variant ? variant-1 : 0));          // decrement count for first iteration
                    this.B = cc.fieldInsert(this.X, 0, 2, 3);           // set control bits [0:2]=3
                    t2 = this.S;                        // save S (not the way the hardware did it)
                    this.S = cc.fieldIsolate(t1, 18, 15)+1;             // get F value from X value and ++
                    this.storeBviaS();                  // [S] = B, save prior LCW in stack
                    this.X = cc.fieldInsert(t1, 18, 15, this.S);        // update F value in X
                    this.S = t2;                        // restore S
                    this.B = this.A;                    // restore B (note that BROF is still relevant)
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2B:              // XX53: RSA=Recall source address
                    this.cycleCount += variant;
                    this.A = this.B;                    // save B
                    this.AROF = this.BROF;
                    this.H = 0;
                    this.M = this.F - variant;
                    this.loadBviaM();                   // B = [M]
                    t1 = this.B;
                    this.M = t1 % 0x8000;
                    if (t1 < 0x800000000000) {          // if it's an operand,
                        this.G = (t1 % 0x40000) >>> 15; // set G from [30:3]
                    } else {                            //
                        this.G = 0;                     // otherwise, force G to zero and
                        this.presenceTest(t1);          // just take the side effect of any p-bit interrupt
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
                    this.B = this.C +
                             this.F * 0x8000 +
                             this.L * 0x1000000000;
                    this.storeBviaS();                  // [S] = B
                    this.S = t2;                        // restore S
                    this.B = this.A;                    // restore B from A
                    this.BROF = this.AROF;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2D:              // XX55: JRC=Jump reverse conditional
                    if (!this.MSFF) {                   // conditional on TFFF
                        this.cycleCount += (variant >>> 2) + (variant & 0x03);
                        this.jumpSyllables(-variant);
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
                    for (variant=3; variant>0; --variant) {
                        this.B = (this.B % 0x40000000000)*0x40 +
                                 (this.Y = cc.fieldIsolate(this.A, this.G*6, 6));
                        if (this.G < 7) {
                            ++this.G;
                        } else {
                            this.G = 0;
                            ++this.M;
                            this.loadAviaM();           // A = [M]
                        }
                    }
                    this.M = this.B % 0x8000;
                    this.G = (this.B % 0x40000) >>> 15;
                    this.AROF = 0;                      // invalidate A
                    break;

                case 0x2F:              // XX57: JRV=Jump reverse unconditional
                    this.cycleCount += (variant >>> 2) + (variant & 0x03);
                    this.jumpSyllables(-variant);
                    break;

                case 0x30:              // XX60: CEQ=Compare equal
                    this.compareSourceWithDest(variant, false);
                    this.H = this.V = 0;
                    this.MSFF = (this.Q & 0x04 ? 0 : 1);                // if !Q03F, S=D
                    break;

                case 0x31:              // XX61: CNE=Compare not equal
                    this.compareSourceWithDest(variant, false);
                    this.H = this.V = 0;
                    this.MSFF = (this.Q & 0x04 ? 1 : 0);                // if Q03F, S!=D
                    break;

                case 0x32:              // XX62: CEG=Compare greater or equal
                    this.compareSourceWithDest(variant, false);
                    this.H = this.V = 0;
                    this.MSFF = (this.Q & 0x04 ? this.MSFF : 1);        // if Q03F&MSFF, S>D; if !Q03F, S=D
                    break;

                case 0x33:              // XX63: CGR=Compare greater
                    this.compareSourceWithDest(variant, false);
                    this.H = this.V = 0;
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
                    this.compareSourceWithDest(variant, false);
                    this.H = this.V = 0;
                    this.MSFF = (this.Q & 0x04 ? 1-this.MSFF : 1);      // if Q03F&!MSFF, S<D; if !Q03F, S=D
                    break;

                case 0x39:              // XX71: CLS=Compare less
                    this.compareSourceWithDest(variant, false);
                    this.H = this.V = 0;
                    this.MSFF = (this.Q & 0x04 ? 1-this.MSFF : 0);      // if Q03F&!MSFF, S<D
                    break;

                case 0x3A:              // XX72: FSU=Field subtract
                    this.fieldArithmetic(variant, false);
                    break;

                case 0x3B:              // XX73: FAD=Field add
                    this.fieldArithmetic(variant, true);
                    break;

                case 0x3C:              // XX74: TRP=Transfer program characters
                    this.streamProgramToDest(variant);
                    break;

                case 0x3D:              // XX75: TRN=Transfer source numerics
                    this.MSFF = 0;                      // initialize for negative sign test
                    this.streamNumericToDest(variant, false);
                    break;

                case 0x3E:              // XX76: TRZ=Transfer source zones
                    this.streamNumericToDest(variant, true);
                    break;

                case 0x3F:              // XX77: TRS=Transfer source characters
                    this.streamCharacterToDest(variant);
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
                this.computeRelativeAddr(opcode >>> 2, 1);
                this.loadAviaM();
                if (this.A >= 0x800000000000) {                 // if it's a control word,
                    this.operandCall();                         // evaluate it
                }                                               // otherwise, just leave it in A
                break;

            case 3:                     // DESC: Descriptor (name) Call
                this.adjustAEmpty();
                this.computeRelativeAddr(opcode >>> 2, 1);
                this.loadAviaM();
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
                        this.doublePrecisionMultiply();
                        break;

                    case 0x08:          // 1005: DLD=double-precision floating divide
                        this.doublePrecisionDivide();
                        break;
                    }
                    break;

                case 0x09:              // XX11: Control State and communication ops
                    switch (variant) {
                    case 0x01:          // 0111: PRL=Program Release
                        this.adjustAFull();
                        t1 = this.A;
                        if (t1 < 0x800000000000) {      // it's an operand
                            this.computeRelativeAddr(t1, 0);
                            t2 = 1;
                        } else if (this.presenceTest(t1)) {
                            this.M = t1 % 0x8000;       // present descriptor
                            t2 = 1;
                        } else {                        // absent descriptor
                            t2 = 0;
                        }
                        if (t2) {
                            this.loadAviaM();           // fetch IOD
                            if (this.NCSF) {
                                if (this.A % 0x10000000 < 0x8000000) {  // test continuity bit, [20:1]
                                    this.I = (this.I & 0x0F) | 0x50;    // set I07/5: program release
                                } else {
                                    this.I = (this.I & 0x0F) | 0x60;    // set I07/6: continuity bit
                                }
                                cc.signalInterrupt();
                                this.A = this.M;
                                this.M = this.R*64 + 9; // store IOD address in PRT[9]
                                this.storeAviaM();
                            } else {
                                this.A = cc.bitReset(this.A, 2);
                                this.storeAviaM();
                            }
                            this.AROF = 0;
                        }
                        break;

                    case 0x02:          // 0211: ITI=Interrogate Interrupt
                        if (cc.IAR && !this.NCSF) {             // control-state only
                            this.C = cc.IAR;
                            this.L = 0;
                            this.S = 0x40;                      // stack address @100
                            cc.clearInterrupt();
                            this.PROF = 0;                      // require fetch at SECL
                        }
                        break;

                    case 0x04:          // 0411: RTR=Read Timer
                        if (!this.NCSF) {               // control-state only
                            this.adjustAEmpty();
                            this.A = cc.readTimer();
                            this.AROF = 1;
                        }
                        break;

                    case 0x08:          // 1011: COM=Communicate
                        if (this.NCSF) {                        // no-op in Control State
                            this.M = this.R*64 + 9;             // address = R+@11
                            if (this.AROF) {
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            } else if (this.BROF) {
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            } else {
                                this.adjustBFull();
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            }
                            this.I = (this.I & 0x0F) | 0x40;    // set I07: communicate
                            cc.signalInterrupt();
                        }
                        break;

                    case 0x11:          // 2111: IOR=I/O Release
                        if (!this.NCSF) {                       // no-op in Normal State
                            this.adjustAFull();
                            t1 = this.A;
                            if (t1 < 0x800000000000) {          // it's an operand
                                this.computeRelativeAddr(t1, 0);
                                t2 = 1;
                            } else if (t1 % 0x400000000000 >= 0x200000000000) {
                                this.M = t1 % 0x8000;          // present descriptor
                                t2 = 1;
                            } else {
                                // for an absent descriptor, just leave it on the stack
                                t2 = 0;
                            }
                            if (t2) {
                                this.loadAviaM();
                                this.A = cc.bitSet(this.A, 2);
                                this.storeAviaM();
                                this.AROF = 0;
                            }
                        }
                        break;

                    case 0x12:          // 2211: HP2=Halt Processor 2
                        if (!(this.NCSF || cc.HP2F)) {  // control-state only
                            cc.haltP2();
                            this.cycleLimit = 0;        // give P2 a chance to stop
                        }
                        break;

                    case 0x14:          // 2411: ZPI=Conditional Halt
                        if (this.US14X) {               // STOP OPERATOR switch on
                            this.stop();
                        }
                        break;

                    case 0x18:          // 3011: SFI=Store for Interrupt
                        this.storeForInterrupt(0, 0);
                        break;

                    case 0x1C:          // 3411: SFT=Store for Test
                        this.storeForInterrupt(0, 1);
                        break;

                    case 0x21:          // 4111: IP1=Initiate Processor 1
                        if (!this.NCSF) {               // control-state only
                            this.initiate(0);
                        }
                        break;

                    case 0x22:          // 4211: IP2=Initiate Processor 2
                        if (!this.NCSF) {                       // control-state only
                            this.M = 0x08;                      // INCW is stored in @10
                            if (this.AROF) {
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            } else if (this.BROF) {
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            } else {
                                this.adjustAFull();
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            }
                            cc.initiateP2();
                            this.cycleLimit = 0;                // give P2 a chance to run
                        }
                        break;

                    case 0x24:          // 4411: IIO=Initiate I/O
                        if (!this.NCSF) {
                            this.M = 0x08;                      // address of IOD is stored in @10
                            if (this.AROF) {
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            } else if (this.BROF) {
                                this.storeBviaM();              // [M] = B
                                this.BROF = 0;
                            } else {
                                this.adjustAFull();
                                this.storeAviaM();              // [M] = A
                                this.AROF = 0;
                            }
                            cc.initiateIO();                    // let CentralControl choose the I/O Unit
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
                        this.A %= 0x800000000000;
                        break;

                    case 0x20:          // 4015: MDS=set flag bit (make descriptor)
                        this.adjustAFull();
                        this.A = this.A % 0x800000000000 + 0x800000000000;      // set [0:1]
                        break;
                    }
                    break;

                case 0x11:              // XX21: load & store ops
                    switch (variant) {
                    case 0x01:          // 0121: CID=Conditional integer store destructive
                        this.integerStore(1, 1);
                        break;

                    case 0x02:          // 0221: CIN=Conditional integer store nondestructive
                        this.integerStore(1, 0);
                        break;

                    case 0x04:          // 0421: STD=Store destructive
                        this.adjustABFull();
                        if (this.A < 0x800000000000) {          // it's an operand
                            this.computeRelativeAddr(this.A, 0);
                            this.storeBviaM();
                            this.AROF = this.BROF = 0;
                        } else {                                // it's a descriptor
                            if (this.presenceTest(this.A)) {
                                this.M = this.A % 0x8000;
                                this.storeBviaM();
                                this.AROF = this.BROF = 0;
                            }
                        }
                        break;

                    case 0x08:          // 1021: SND=Store nondestructive
                        this.adjustABFull();
                        if (this.A < 0x800000000000) {          // it's an operand
                            this.computeRelativeAddr(this.A, 0);
                            this.storeBviaM();
                            this.AROF = 0;
                        } else {                                // it's a descriptor
                            if (this.presenceTest(this.A)) {
                                this.M = this.A % 0x8000;
                                this.storeBviaM();
                                this.AROF = 0;
                            }
                        }
                        break;

                    case 0x10:          // 2021: LOD=Load operand
                        this.adjustAFull();
                        if (this.A < 0x800000000000) {          // simple operand
                            this.computeRelativeAddr(this.A, 1);
                            this.loadAviaM();
                        } else if (this.presenceTest(this.A)) {
                            this.M = this.A % 0x8000;           // present descriptor
                            this.loadAviaM();
                        }
                        break;

                    case 0x21:          // 4121: ISD=Integer store destructive
                        this.integerStore(0, 1);
                        break;

                    case 0x22:          // 4221: ISN=Integer store nondestructive
                        this.integerStore(0, 0);
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
                        this.adjustABFull();
                        t1 = (this.A % 0x40000000) >>> 15;
                        this.B -= this.B % 0x8000 - t1;
                        this.AROF = 0;
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
                        this.adjustABFull();
                        t1 = (this.A % 0x40000000 - this.A % 0x8000);
                        t2 = (this.B % 0x40000000 - this.B % 0x8000);
                        this.B -= t2 - t1;
                        this.AROF = 0;
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
                        this.adjustABFull();
                        this.B -= this.B % 0x8000 - this.A % 0x8000;
                        this.AROF = 0;
                        break;

                    case 0x3C:          // 7425: CTF=core field to F field
                        this.adjustABFull();
                        t2 = (this.B % 0x40000000 - this.B % 0x8000);
                        this.B -= t2 - (this.A % 0x8000)*0x8000;
                        this.AROF = 0;
                        break;
                    }
                    break;

                case 0x19:              // XX31: branch, sign-bit, interrogate ops
                    switch (variant) {
                    case 0x01:          // 0131: BBC=branch backward conditional
                        this.adjustABFull();
                        if (this.B % 0x02) {
                            this.AROF = this.BROF = 0;          // true => no branch
                        } else {
                            this.BROF = 0;
                            if (this.A < 0x800000000000) {      // simple operand
                                this.jumpSyllables(-(this.A % 0x1000));
                                this.AROF = 0;
                            } else {                            // descriptor
                                if (this.L == 0) {
                                    --this.C;                   // adjust for Inhibit Fetch
                                }
                                if (this.presenceTest(this.A)) {
                                    this.C = this.A % 0x8000;
                                    this.L = 0;
                                    this.PROF = 0;              // require fetch at SECL
                                    this.AROF = 0;
                                }
                            }
                        }
                        break;

                    case 0x02:          // 0231: BFC=branch forward conditional
                        this.adjustABFull();
                        if (this.B % 0x02) {
                            this.AROF = this.BROF = 0;          // true => no branch
                        } else {
                            this.BROF = 0;
                            if (this.A < 0x800000000000) {      // simple operand
                                this.jumpSyllables(this.A % 0x1000);
                                this.AROF = 0;
                            } else {                            // descriptor
                                if (this.L == 0) {
                                    --this.C;                   // adjust for Inhibit Fetch
                                }
                                if (this.presenceTest(this.A)) {
                                    this.C = this.A % 0x8000;
                                    this.L = 0;
                                    this.PROF = 0;              // require fetch at SECL
                                    this.AROF = 0;
                                }
                            }
                        }
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
                        this.A = (this.B < 0x800000000000 ? 1 : 0);
                        this.AROF = 1;
                        break;

                    case 0x11:          // 2131: LBC=branch backward word conditional
                        this.adjustABFull();
                        if (this.B % 0x02) {
                            this.AROF = this.BROF = 0;          // true => no branch
                        } else {
                            this.BROF = 0;
                            if (this.L == 0) {
                                --this.C;                       // adjust for Inhibit Fetch
                            }
                            if (this.A < 0x800000000000) {      // simple operand
                                this.jumpWords(-(this.A % 0x0400));
                                this.AROF = 0;
                            } else {                            // descriptor
                                if (this.presenceTest(this.A)) {
                                    this.C = this.A % 0x8000;
                                    this.L = 0;
                                    this.PROF = 0;              // require fetch at SECL
                                    this.AROF = 0;
                                }
                            }
                        }
                        break;

                    case 0x12:          // 2231: LFC=branch forward word conditional
                        this.adjustABFull();
                        if (this.B % 0x02) {
                            this.AROF = this.BROF = 0;          // true => no branch
                        } else {
                            this.BROF = 0;
                            if (this.L == 0) {
                                --this.C;                       // adjust for Inhibit Fetch
                            }
                            if (this.A < 0x800000000000) {      // simple operand
                                this.jumpWords(this.A % 0x0400);
                                this.AROF = 0;
                            } else {                            // descriptor
                                if (this.presenceTest(this.A)) {
                                    this.C = this.A % 0x8000;
                                    this.L = 0;
                                    this.PROF = 0;              // require fetch at SECL
                                    this.AROF = 0;
                                }
                            }
                        }
                        break;

                    case 0x14:          // 2431: TUS=interrogate peripheral status
                        this.adjustAEmpty();
                        this.A = cc.interrogateUnitStatus();
                        this.AROF = 1;
                        break;

                    case 0x21:          // 4131: BBW=branch backward unconditional
                        this.adjustAFull();
                        if (this.A < 0x800000000000) {          // simple operand
                            this.jumpSyllables(-(this.A % 0x1000));
                            this.AROF = 0;
                        } else {                                // descriptor
                            if (this.L == 0) {
                                --this.C;                       // adjust for Inhibit Fetch
                            }
                            if (this.presenceTest(this.A)) {
                                this.C = this.A % 0x8000;
                                this.L = 0;
                                this.PROF = 0;                  // require fetch at SECL
                                this.AROF = 0;
                            }
                        }
                        break;

                    case 0x22:          // 4231: BFW=branch forward unconditional
                        this.adjustAFull();
                        if (this.A < 0x800000000000) {          // simple operand
                            this.jumpSyllables(this.A % 0x1000);
                            this.AROF = 0;
                        } else {                                // descriptor
                            if (this.L == 0) {
                                --this.C;                       // adjust for Inhibit Fetch
                            }
                            if (this.presenceTest(this.A)) {
                                this.C = this.A % 0x8000;
                                this.L = 0;
                                this.PROF = 0;                  // require fetch at SECL
                                this.AROF = 0;
                            }
                        }
                        break;

                    case 0x24:          // 4431: SSP=reset sign bit (set positive)
                        this.adjustAFull();
                        t1 = this.A % 0x400000000000;
                        t2 = (this.A - t1)/0x400000000000;
                        this.A = (t2 & 0x02)*0x400000000000 + t1;
                        break;

                    case 0x31:          // 6131: LBU=branch backward word unconditional
                        this.adjustAFull();
                        if (this.L == 0) {
                            --this.C;                           // adjust for Inhibit Fetch
                        }
                        if (this.A < 0x800000000000) {          // simple operand
                            this.jumpWords(-(this.A % 0x0400));
                            this.AROF = 0;
                        } else {                                // descriptor
                            if (this.presenceTest(this.A)) {
                                this.C = this.A % 0x8000;
                                this.L = 0;
                                this.PROF = 0;                  // require fetch at SECL
                                this.AROF = 0;
                            }
                        }
                        break;

                    case 0x32:          // 6231: LFU=branch forward word unconditional
                        this.adjustAFull();
                        if (this.L == 0) {
                            --this.C;                           // adjust for Inhibit Fetch
                        }
                        if (this.A < 0x800000000000) {          // simple operand
                            this.jumpWords(this.A % 0x0400);
                            this.AROF = 0;
                        } else {                                // descriptor
                            if (this.presenceTest(this.A)) {
                                this.C = this.A % 0x8000;
                                this.L = 0;
                                this.PROF = 0;                  // require fetch at SECL
                                this.AROF = 0;
                            }
                        }
                        break;

                    case 0x34:          // 6431: TIO=interrogate I/O channel
                        this.adjustAEmpty();
                        this.A = cc.interrogateIOChannel();
                        this.AROF = 1;
                        break;

                    case 0x38:          // 7031: FBS=stack search for flag
                        this.adjustAFull();
                        this.M = this.A % 0x8000;
                        do {
                            this.cycleCount += 2;               // approximate the timing
                            this.loadAviaM();
                            if (this.A < 0x800000000000) {
                                this.M = (this.M+1) % 0x8000;
                            } else {
                                this.A = t1 = this.M + 0xA00000000000;
                                break;                          // flag bit found: stop the search
                            }
                        } while (true);
                        break;
                    }
                    break;

                case 0x1D:              // XX35: exit & return ops
                    switch (variant) {
                    case 0x01:          // 0135: BRT=branch return
                        this.adjustAEmpty();
                        if (!this.BROF) {
                            this.Q |= 0x04;             // Q03F: not used, except for display purposes
                            this.adjustBFull();
                        }
                        if (this.presenceTest(this.B)) {
                            this.S = (this.B % 0x40000000) >>> 15;
                            this.C = this.B % 0x8000;
                            this.L = 0;
                            this.PROF = 0;              // require fetch at SECL
                            this.loadBviaS();           // B = [S], fetch MSCW
                            --this.S;
                            this.applyMSCW(this.B);
                            this.BROF = 0;
                        }
                        break;

                    case 0x02:          // 0235: RTN=return normal
                        this.adjustAFull();
                        // If A is an operand or a present descriptor, proceed with the return,
                        // otherwise throw a p-bit interrupt (this isn't well-documented)
                        if (this.A < 0x800000000000 || this.presenceTest(this.A)) {
                            this.S = this.F;
                            this.loadBviaS();           // B = [S], fetch the RCW
                            switch (this.exitSubroutine(0)) {
                            case 0:
                                this.X = 0;
                                this.operandCall();
                                break;
                            case 1:
                                this.Q |= 0x10;         // set Q05F, for display only
                                this.X = 0;
                                this.descriptorCall();
                                break;
                            case 2:                     // flag-bit interrupt occurred, do nothing
                                break;
                            }
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
                        // If A is an operand or a present descriptor, proceed with the return,
                        // otherwise throw a p-bit interrupt (this isn't well-documented)
                        if (this.A < 0x800000000000 || this.presenceTest(this.A)) {
                            // Note that RTS assumes the RCW is pointed to by S, not F
                            this.loadBviaS();           // B = [S], fetch the RCW
                            switch (this.exitSubroutine(0)) {
                            case 0:
                                this.X = 0;
                                this.operandCall();
                                break;
                            case 1:
                                this.Q |= 0x10;         // set Q05F, for display only
                                this.X = 0;
                                this.descriptorCall();
                                break;
                            case 2:                     // flag-bit interrupt occurred, do nothing
                                break;
                            }
                        }
                        break;
                    }
                    break;

                case 0x21:              // XX41: index, mark stack, etc.
                    switch (variant) {
                    case 0x01:          // 0141: INX=index
                        this.adjustABFull();
                        t1 = this.A % 0x8000;
                        this.M = (t1 + this.B % 0x8000) % 0x8000;
                        this.A += this.M - t1;
                        this.BROF = 0;
                        break;

                    case 0x02:          // 0241: COC=construct operand call
                        this.exchangeTOS();
                        this.A = this.A % 0x800000000000 + 0x800000000000;      // set [0:1]
                        this.operandCall();
                        break;

                    case 0x04:          // 0441: MKS=mark stack
                        this.adjustABEmpty();
                        this.B = this.buildMSCW();
                        this.BROF = 1;
                        this.adjustBEmpty();
                        this.F = this.S;
                        if (!this.MSFF) {
                            if (this.SALF) {            // store the MSCW at R+7
                                this.M = this.R*64 + 7;
                                this.storeBviaM();      // [M] = B
                            }
                            this.MSFF = 1;
                        }
                        break;

                    case 0x0A:          // 1241: CDC=construct descriptor call
                        this.exchangeTOS();
                        this.A = this.A % 0x800000000000 + 0x800000000000;      // set [0:1]
                        this.descriptorCall();
                        break;

                    case 0x11:          // 2141: SSF=F & S register set/store
                        this.adjustABFull();
                        switch (this.A % 0x04) {
                        case 0:                                 // store F into B.[18:15]
                            this.B -= (this.B % 0x40000000 - this.B % 0x8000) - this.F*0x8000;
                            break;
                        case 1:                                 // store S into B.[33:15]
                            this.B -= this.B % 0x8000 - this.S;
                            break;
                        case 2:                                 // set   F from B.[18:15]
                            this.F = (this.B % 0x40000000) >>> 15;
                            this.SALF = 1;
                            this.BROF = 0;
                            break;
                        case 3:                                 // set   S from B.[33:15]
                            this.S = this.B % 0x8000;
                            this.BROF = 0;
                            break;
                        }
                        this.AROF = 0;
                        break;

                    case 0x15:          // 2541: LLL=link list look-up
                        this.adjustABFull();
                        t1 = this.A % 0x8000000000;             // test value
                        this.M = this.B % 0x8000;               // starting link address
                        do {
                            this.cycleCount += 2;               // approximate the timing
                            this.loadBviaM();
                            t2 = this.B % 0x8000000000;
                            if (t2 < t1) {
                                this.M = t2 % 0x8000;
                            } else {
                                this.A = this.M + 0xA00000000000;
                                break;                          // B >= A: stop look-up
                            }
                        } while (true);
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
                        t2 = t2*6 - (variant & 7) - this.H;     // number of bits
                        if (t1+t2 <= 48) {
                            this.A = cc.fieldIsolate(this.A, t1, t2);
                        } else {                                // handle wrap-around in the source value
                            this.A = cc.fieldInsert(
                                    cc.fieldIsolate(this.A, 0, t2-48+t1), 48-t2, 48-t1,
                                    cc.fieldIsolate(this.A, t1, 48-t1));
                        }
                        // approximate the shift cycle counts
                        this.cycleCount += (variant >>> 3) + (variant & 7) + this.G + this.H;
                        this.G = (this.G + variant >>> 3) & 7;
                        this.H = 0;
                    }
                    break;

                case 0x29:              // XX51: delete & conditional branch ops
                    if (variant < 4) {  // 0051=DEL: delete TOS (or field branch with zero-length field)
                       if (this.AROF) {
                           this.AROF = 0;
                       } else if (this.BROF) {
                           this.BROF = 0;
                       } else {
                           --this.S;
                       }
                    } else {
                        this.adjustABFull();
                        t2 = variant >>> 2;                     // field length (1-15 bits)
                        t1 = cc.fieldIsolate(this.B, this.G*6+this.H, t2);
                        this.cycleCount += this.G + this.H + (t2 >>> 1);        // approximate the shift counts
                        this.AROF = 0;                          // A is unconditionally empty at end

                        switch (variant & 0x03) {
                        case 0x02:      // X251/X651: CFD=non-zero field branch forward destructive
                            this.BROF = 0;
                            // no break: fall through
                        case 0x00:      // X051/X451: CFN=non-zero field branch forward nondestructive
                            if (t1) {
                                if (this.A < 0x800000000000) {  // simple operand
                                    this.jumpSyllables(this.A % 0x1000);
                                } else {                        // descriptor
                                    if (this.L == 0) {
                                        --this.C;               // adjust for Inhibit Fetch
                                    }
                                    if (this.presenceTest(this.A)) {
                                        this.C = this.A % 0x8000;
                                        this.L = 0;
                                        this.PROF = 0;          // require fetch at SEQL
                                    }
                                }
                            }
                            break;

                        case 0x03:      // X351/X751: CBD=non-zero field branch backward destructive
                            this.BROF = 0;
                            // no break: fall through
                        case 0x01:      // X151/X551: CBN=non-zero field branch backward nondestructive
                            if (t1) {
                                if (this.A < 0x800000000000) {  // simple operand
                                    this.jumpSyllables(-(this.A % 0x1000));
                                } else {                        // descriptor
                                    if (this.L == 0) {
                                        --this.C;               // adjust for Inhibit Fetch
                                    }
                                    if (this.presenceTest(this.A)) {
                                        this.C = this.A % 0x8000;
                                        this.L = 0;
                                        this.PROF = 0;          // require fetch at SEQL
                                    }
                                }
                            }
                            break;
                        }
                    }
                    break;

                case 0x2D:              // XX55: NOP & DIA=Dial A ops
                    if (opcode & 0xFC0) {
                        this.G = variant >>> 3;
                        this.H = variant & 7;
                    // else             // 0055: NOP=no operation (the official one, at least)
                    }
                    break;

                case 0x31:              // XX61: XRT & DIB=Dial B ops
                    if (opcode & 0xFC0) {
                        this.K = variant >>> 3;
                        this.V = variant & 7;
                    } else {            // 0061=XRT: temporarily set full PRT addressing mode
                        this.VARF = this.SALF;
                        this.SALF = 0;
                    }
                    break;

                case 0x35:              // XX65: TRB=Transfer Bits
                    this.adjustABFull();
                    if (variant > 0) {
                        t1 = this.G*6 + this.H; // A register starting bit nr
                        if (t1+variant > 48) {
                            variant = 48-t1;
                        }
                        t2 = this.K*6 + this.V; // B register starting bit nr
                        if (t2+variant > 48) {
                            variant = 48-t2;
                        }
                        this.B = cc.fieldTransfer(this.B, t2, variant, this.A, t1);
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
                    if (variant == 0) {
                        this.A = 1;
                    } else if (cc.fieldIsolate(this.B, t2, variant) < cc.fieldIsolate(this.A, t1, variant)) {
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
                    if (variant == 0) {
                        this.A = 1;
                    } else if (cc.fieldIsolate(this.B, t2, variant) == cc.fieldIsolate(this.A, t1, variant)) {
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

        if ((this.isP1 ? cc.IAR : (this.I || cc.HP2F)) && this.NCSF) {
            // there's an interrupt and we're in Normal State
            // reset Q09F (R-relative adder mode) and set Q07F (hardware-induced SFI) (for display only)
            this.Q = (this.Q & 0xFFFEFF) | 0x40;
            this.T = 0x0609;            // inject 3011=SFI into T
            this.storeForInterrupt(1, 0); // call directly to avoid resetting registers at top of loop
        } else {
            // otherwise, fetch the next instruction
            if (!this.PROF) {
                this.loadPviaC();
            }
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
                ++this.C;               // assume no Inhibit Fetch for now and bump C
                this.PROF = 0;          // invalidate current program word
                break;
            }
        }

        // Accumulate Normal and Control State cycles for use by Console in
        // making the pretty lights blink. If the processor is no longer busy,
        // accumulate the cycles as Normal State, as we probably just did SFI.
        if (this.NCSF || !this.busy) {
            this.normalCycles += this.cycleCount;
        } else {
            this.controlCycles += this.cycleCount;
        }
    } while ((this.runCycles += this.cycleCount) < this.cycleLimit);
};

/**************************************/
B5500Processor.prototype.schedule = function schedule() {
    /* Schedules the processor running time and attempts to throttle performance
    to approximate that of a real B5500 -- well, at least we hope this will run
    fast enough that the performance will need to be throttled. It establishes
    a timeslice in terms of a number of processor "cycles" of 1 microsecond
    each and calls run() to execute at most that number of cycles. run()
    counts up cycles until it reaches this limit or some terminating event
    (such as a halt), then exits back here. If the processor remains active,
    this routine will reschedule itself after an appropriate delay, thereby
    throttling the performance and allowing other modules a chance at the
    single Javascript execution thread */
    var clockOff = performance.now();   // ending time for the delay and the run() call, ms
    var delayTime;                      // delay from/until next run() for this processor, ms
    var runTime;                        // real-world processor running time, ms

    this.scheduler = 0;
    delayTime = clockOff - this.delayLastStamp;
    this.procSlack += delayTime;

    // Compute the exponential weighted average of scheduling delay
    this.delayDeltaAvg = (1-B5500Processor.delayAlpha)*(delayTime - this.delayRequested) +
                         B5500Processor.delayAlpha*this.delayDeltaAvg;
    this.procSlackAvg = (1-B5500Processor.slackAlpha)*delayTime +
                        B5500Processor.slackAlpha*this.procSlackAvg;

    if (this.busy) {
        this.cycleLimit = B5500Processor.timeSlice;

        this.run();                     // execute syllables for the timeslice

        clockOff = performance.now();
        this.procRunAvg = (1.0-B5500Processor.slackAlpha)*(clockOff - this.delayLastStamp) +
                     B5500Processor.slackAlpha*this.procRunAvg;
        this.delayLastStamp = clockOff;
        this.totalCycles += this.runCycles;
        if (!this.busy) {
            this.delayRequested = 0;
        } else {
            runTime = this.procTime;
            while (runTime < 0) {
                runTime += clockOff;
            }

            delayTime = this.totalCycles/B5500Processor.cyclesPerMilli - runTime;
            // delayTime is the number of milliseconds the processor is running ahead of
            // real-world time. Web browsers have a certain minimum setTimeout() delay. If the
            // delay is less than our estimate of that minimum, setCallback will yield to
            // the event loop but otherwise continue (real time should eventually catch up --
            // we hope). If the delay is greater than the minimum, setCallback will reschedule
            // us after that delay.

            this.delayRequested = delayTime;
            this.scheduler = setCallback(this.mnemonic, this, delayTime, this.schedule);
        }
    }
};

/**************************************/
B5500Processor.prototype.step = function step() {
    /* Single-steps the processor. Normally this will cause one instruction to
    be executed, but note that in the case of an interrupt or char-mode CRF, one
    or two injected instructions (e.g., SFI followed by ITI) could also be executed */

    this.cycleLimit = 1;
    this.run();
    this.totalCycles += this.runCycles;
};
