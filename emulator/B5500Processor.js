/***********************************************************************
* retro-b5500/emulator B5500Processor.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
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
*       [0:1]   Flag bit (1=descriptor)
*       [1:1]   Mantissa sign bit (1=negative)
*       [2:1]   Exponent sign bit (1=negative)
*       [3:6]   Exponent (power of 8, signed-magnitude)
*       [9:39]  Mantissa (signed-magnitude, scaling point after bit 47)
*
************************************************************************
* B5500 Processor (CPU) module.
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

    this.cycleCount = 0;                // Current cycle count for this.run()
    this.cycleLimit = 0;                // Cycle limit for this.run()
    this.totalCycles = 0;               // Total cycles executed on this processor
    this.procTime = 0;                  // Current processor running time, based on cycles executed
    this.scheduleSlack = 0;             // Total processor throttling delay, milliseconds
    this.busy = 0;                      // Proessor is running, not idle or halted
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

    this.cycleCount += 6;               // assume 6 us memory cycle time (the other option is 4 usec)
    if (acc.MAED) {
        this.I |= 0x02;                 // set I02F - memory address/inhibit error
        if (this.NCSF || this !== this.cc.P1) {
            this.cc.signalInterrupt();
        } else {
            this.busy = 0;              // P1 invalid address in control state stops the proc
        }
    } else if (acc.MPED) {
        this.I |= 0x01;                 // set I01F - memory parity error
        if (this.NCSF || this !== this.cc.P1) {
            this.cc.signalInterrupt();
        } else {
            this.busy = 0;              // P1 memory parity in control state stops the proc
        }
    }
};

/**************************************/
B5500Processor.prototype.adjustAEmpty = function() {
    /* Adjusts the A register so that it is empty, pushing the prior
    contents of A into B and B into memory, as necessary. */

    if (this.AROF) {
        if (this.BROF) {
            if ((this.S >>> 6) == this.R || !this.NCSF) {
                this.I |= 0x04;         // set I03F: stack overflow
                this.cc.signalInterrupt();
            } else {
                this.S++;
                this.access(0x0B);      // [S] = B
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
            this.access(0x02);          // A = [S]
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
        if ((this.S >>> 6) == this.R || !this.NCSF) {
            this.I |= 0x04;             // set I03F: stack overflow
            this.cc.signalInterrupt();
        } else {
            this.S++;
            this.access(0x0B);          // [S] = B
        }
    // else we're done -- B is already empty
    }
};

/**************************************/
B5500Processor.prototype.adjustBFull = function() {
    /* Adjusts the B register so that it is full, popping the contents of
    [S] into B, as necessary. */

    if (!this.BROF) {
        this.access(0x03);              // B = [S]
        this.S--;
    // else we're done -- B is already full
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
            this.access(0x03);          // B = [S]
            this.S--;
        }
    } else {
        if (this.BROF) {
            // A is empty and B is full, so copy B to A and load B from [S]
            this.A = this.B;
            this.AROF = 1;
        } else {
            // A and B are empty, so simply load them from [S]
            this.access(0x02);          // A = [S]
            this.S--;
        }
        this.access(0x03);              // B = [S]
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
            this.access(0x02);          // A = [S]
            this.S--;
        }
    } else {
        if (this.BROF) {
            // A is empty and B is full, so copy B to A and load B from [S]
            this.A = this.B;
            this.AROF = 1;
            this.access(0x03);          // B = [S]
            this.S--;
        } else {
            // A and B are empty, so simply load them in reverse order
            this.access(0x03);          // B = [S]
            this.S--;
            this.access(0x02);          // A = [S]
            this.S--;
        }
    }
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
                this.access(0x0B);
                this.BROF = 0;
            }
            this.S++;
        }
    }
};

/**************************************/
B5500Processor.prototype.streamSourceToDest = function(count, transform) {
    /* General driver for character-mode character transfers from source to
    destination. "count" is the number of source characters to transfer.
    "transform" is a function(bBit, count) that determines how the
    characters are transferred from the source (A) to destination (B). The
    Y register will contain the current char during this call */
    var aBit;
    var bBit;

    this.streamAdjustSourceChar();
    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.access(0x03);          // B = [S]
        }
        if (!this.AROF) {
            this.access(0x04);          // A = [M]
        }
        this.cycleCount += count;       // approximate the timing
        aBit = this.G*6;                // A-bit number
        bBit = this.K*6;                // B-bit number
        while (count) {
            this.Y = this.cc.fieldIsolate(this.A, aBit, 6);
            transform(bBit, count)
            count--;
            if (bBit < 42) {
                bBit += 6;
                this.K++;
            } else {
                bBit = 0;
                this.K = 0;
                this.access(0x0B);      // [S] = B
                this.S++;
                if (count < 8) {      // just a partial word left
                    this.access(0x03);  // B = [S]
                }
            }
            if (aBit < 42) {
                aBit += 6;
                this.G++;
            } else {
                aBit = 0;
                this.G = 0;
                this.M++;
                this.access(0x04);      // A = [M]
            }
        }
    }
};

/**************************************/
B5500Processor.prototype.streamToDest = function(count, transform) {
    /* General driver for character-mode character operations on the
    destination from a non-A register source. "count" is the number of
    characters to transfer. "transform" is a function(bBit, count) that
    determines how the characters are stored to the destination (B).
    Returning truthy terminates the process without incrementing the
    destination address */
    var bBit;

    this.streamAdjustDestChar();
    if (count) {
        if (!this.BROF) {
            this.access(0x03);          // B = [S]
        }
        this.cycleCount += count;       // approximate the timing
        bBit = this.K*6;                // B-bit number
        while (count) {
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
                    this.access(0x0B);   // [S] = B
                    this.S++;
                    if (count < 8) {     // just a partial word left
                        this.access(0x03);  // B = [S]
                    }
                }
            }
        }
    }
};

/**************************************/
B5500Processor.storeForInterrupt = function(forTest) {
    /* Implements the 3011=SFI operator and the parts of 3411=SFT that are
    common to it. "forTest" implies use from SFT */
    var forced = this.Q & 0x0040;       // Q07F: Hardware-induced SFI syllable
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
            this.access(0x0A);          // [S] = A
        }
        if (this.BROF || forTest) {
            this.S++;
            this.access(0x0B);          // [S] = B
        }
        this.B = this.X +               // store CM loop-control word
              saveAROF * 0x200000000000 +
              0xC00000000000;
        this.S++;
        this.access(0x0B);              // [S] = B
    } else {
        if (this.BROF || forTest) {
            this.S++;
            this.access(0x0B);          // [S] = B
        }
        if (this.AROF || forTest) {
            this.S++;
            this.access(0x0A);          // [S] = A
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
    this.access(0x0B);                  // [S] = B

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
    this.access(0x0B);                  // [S] = B

    if (this.CWMF) {
        temp = this.F;                  // if CM, get correct R value from last MSCW
        this.F = this.S;
        this.S = temp;
        this.access(0x03);              // B = [S]: get last RCW
        this.S = ((this.B % 0x40000000) >>> 15) & 0x7FFF;
        this.access(0x03);              // B = [S]: get last MSCW
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
    this.access(0x0D);                  // [M] = B

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
            this.cc.HP2F = 1;
            this.cc.P2BF = 0;
            if (this.cc.P2.scheduler) {
                clearTimeout(this.cc.P2.scheduler);
                this.cc.P2.scheduler = null;
            }
        }
        this.CWMF = 0;
    } else if (forTest) {
        this.CWMF = 0;
        if (this === this.cc.P1) {
            this.access(0x05);          // B = [M]: load DD for test
            this.C = this.B % 0x7FFF;
            this.L = 0;
            this.access(0x30);          // P = [C]: first word of test routine
            this.G = 0;
            this.H = 0;
            this.K = 0;
            this.V = 0;
        } else {
            this.T = 0;                 // idle the processor
            this.TROF = 0;
            this.PROF = 0;
            this.busy = 0;
            this.cc.HP2F = 1;
            this.cc.P2BF = 0;
            if (this.cc.P2.scheduler) {
                clearTimeout(this.cc.P2.scheduler);
                this.cc.P2.scheduler = null;
            }
        }
    }
};

/**************************************/
B5500Processor.initiate = function(forTest) {
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
    this.access(0x03);                  // B = [S]
    this.S--;
    this.C = this.B % 0x8000;
    this.F = Math.floor(this.B / 0x8000) % 0x8000;
    this.K = Math.floor(this.B / 0x40000000) % 0x08;
    this.G = Math.floor(this.B / 0x200000000) % 0x08;
    this.L = Math.floor(this.B / 0x1000000000) % 0x04;
    this.V = Math.floor(this.B / 0x4000000000) % 0x08;
    this.H = Math.floor(this.B / 0x20000000000) % 0x08;
    this.access(0x30);                  // P = [C]
    if (this.CWMF || forTest) {
        saveBROF = Math.floor(this.B / 200000000000) % 0x02;
    }

    // restore the Interrupt Control Word
    this.access(0x03);                  // B = [S]
    this.S--;
    this.VARF = Math.floor(this.B / 0x1000000) % 0x02;
    this.SALF = Math.floor(this.B / 0x40000000) % 0x02;
    this.MSFF = Math.floor(this.B / 0x80000000) % 0x02;
    this.R = (Math.floor(this.B / 0x200000000) % 0x200);

    if (this.CWMF || forTest) {
        this.M = this.B % 0x8000;
        this.N = Math.floor(this.B / 0x8000) % 0x10;

        // restore the CM Interrupt Loop Control Word
        this.access(0x03);              // B = [S]
        this.S--;
        this.X = this.B % 0x8000000000;
        saveAROF = Math.floor(this.B / 0x400000000000) % 0x02;

        // restore the B register
        if (saveBROF || forTest) {
            this.access(0x03);          // B = [S]
            this.S--;
        }

        // restore the A register
        if (saveAROF || forTest) {
            this.access(0x02);          // A = [S]
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

    this.T = Math.floor(this.P / Math.pow(2, 36-this.L*12)) % 0x1000;   // ugly
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
                this.access(0x06);  // M = [M].[18:15]
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
                this.access(0x06);  // M = [M].[18:15]
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

    this.adjustBFull();
    bw = this.B;
    xm = (bw % 0x8000000000);
    xe = this.cc.fieldIsolate(bw, 3, 6);

    // Normalize the index, if necessary
    if (xe > 0) {                       // index is not an integer
        if (this.cc.bit(bw, 2)) {            // index exponent is negative
            do {
                xo = xm % 8;
                xm = (xm - xo)/8;
                this.cycleCount++;
            } while (--xe > 0);
            if (xo >= 4) {
                xm++;
            }
        } else {                        // index exponent is positive
            do {
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
                this.cycleCount++;
            } while (--xe > 0);
        }
    }

    // Now we have an integerized index value in xm
    if (!interrupted) {
        if (xm && this.cc.bit(bw, 1)) {      // oops... negative index
            interrupted = 1;
            if (this.NCSF) {
                this.I = (this.I & 0x0F) | 0x90;                // set I05/8: invalid-index
                this.cc.signalInterrupt();
            }
        } else if (xm >= this.cc.fieldIsolate(bw, 8, 10)) {
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

    f = word % 0x8000;                  // [33:15]
    word = (word-f)/0x8000;
    this.F = f = word % 0x8000;         // [18:15]
    word = (word-f)/0x8000;
    this.SALF = f = word % 2;           // [17:1]
    word = (word-f)/0x02;
    this.MSFF = word % 0x02;            // [16:1]
    word = (word - word%0x04)/0x04;
    this.R = word % 0x200;              // [6:9]
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

    f = word % 0x8000;                  // [33:15]
    if (!inline) {
        this.C = f;
        this.access(0x30);              // P = [C], fetch new program word
    }
    word = (word-f)/0x8000;
    this.F = f = word % 0x8000;         // [18:15]
    word = (word-f)/0x8000;
    this.K = f = word % 0x08;           // [15:3]
    word = (word-f)/0x08;
    this.G = f = word % 0x08;           // [12:3]
    word = (word-f)/0x08;
    f = word % 0x04;                    // [10:2]
    if (!inline) {
        this.L = f;
    }
    word = (word-f)/0x04;
    this.V = f = word % 0x08;           // [7:3]
    word = (word-f)/0x08;
    this.H = word % 0x08;               // [4:3]
    word = (word - word % 0x10)/0x10;
    return word % 0x02;                 // [2:1]
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
        this.access(0x02)               // A = [S]: tank the DI address
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
            if (!this.NCSF) {
                // NOTE: docs do not mention if this is inhibited in control state, but we assume it is
                this.I = (this.I & 0x0F) | 0x70;    // set I05/6/7: p-bit
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
    var arg = this.cc.bit(aw, 5);            // descriptor argument bit
    var mode = this.cc.bit(aw, 4);           // descriptor mode bit (1-char mode)

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
        this.access(0x30);

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
        this.access(0x03);              // B = [S], fetch the MSCW
        this.applyMSCW(this.B);

        if (this.MSFF && this.SALF) {
            this.Q |= 0x20;             // set Q06F, not used except for display
            do {
                this.S = (this.B % 0x40000000) >>> 15;
                this.access(0x03);      // B = [S], fetch prior MSCW
            } while (((this.B - this.B % 0x40000000)/0x40000000) % 0x04 == 3); // MSFF & SALF
            this.S = (this.R*64) + 7;
            this.access(0x0B);          // [S] = B, store last MSCW at [R]+7
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
                this.access(0x04);      // A = [M]
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
    /* DESC, the moral equivalent of "load address" on lesser
    machines. Assumes the syllable has already loaded a word into A, and
    that the address of that word is in M.
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
    This routine will run until cycleCount >= cycleLimit or !this.busy */
    var noSECL = 0;                     // to support char mode dynamic count from CRF
    var opcode;
    var t1;
    var t2;
    var variant;
    var flagBit;                            // bit 0 indicates operand(off) or control word/descriptor(on).
    var aLo,aHi,bLo,bHi;                    // upper/lower pieces of a word for bitwise operators.
    var w32 = B5500CentralControl.pow2[32]; // 32-bit boundary constant for bitwise operators.

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
                    this.access(0x03);                  // B = [S], fetch the RCW
                    this.exitSubroutine(variant & 0x01);// exit vs. exit inline
                    this.AROF = this.BROF = 0;
                    this.X = this.M = this.N = 0;
                    this.CWMF = 0;
                    break;

                case 0x02:              // XX02: BSD=Skip bit destination
                    break;

                case 0x03:              // XX03: BSS=Skip bit source
                    break;

                case 0x04:              // XX04: RDA=Recall destination address
                    break;

                case 0x05:              // XX05: TRW=Transfer words
                    if (this.BROF) {
                        this.access(0x0B);              // [S] = B
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
                            this.access(0x04);          // A = [M]
                        }
                        do {
                            this.access(0x0A);          // [S] = A
                            this.S++;
                            this.M++;
                            this.access(0x04);          // A = [M]
                        } while (--variant);
                    }
                    break;

                case 0x06:              // XX06: SED=Set destination address
                    break;

                case 0x07:              // XX07: TDA=Transfer destination address
                    break;

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
                    break;

                case 0x0D:              // XX15: SSA=Store source address
                    break;

                case 0x0E:              // XX16: SFD=Skip forward destination
                    break;

                case 0x0F:              // XX17: SRD=Skip reverse destination
                    break;

                case 0x11:              // XX11: control state ops
                    switch (variant) {
                    case 0x14:          // 2411: ZPI=Conditional Halt
                        // TODO: this needs to test for the STOP OPERATOR switch
                        // TODO: on the maintenance panel otherwise it is a NOP.
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
                    break;

                case 0x12:              // XX22: SES=Set source address
                    break;

                case 0x14:              // XX24: TEQ=Test for equal
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 == t2 ? 1 : 0);
                    break;

                case 0x15:              // XX25: TNE=Test for not equal
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 != t2 ? 1 : 0);
                    break;

                case 0x16:              // XX26: TEG=Test for equal or greater
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 >= t2 ? 1 : 0);
                    break;

                case 0x17:              // XX27: TGR=Test for greater
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 > t2 ? 1 : 0);
                    break;

                case 0x18:              // XX30: SRS=Skip reverse source
                    break;

                case 0x19:              // XX31: SFS=Skip forward source
                    break;

                case 0x1A:              // XX32: ---=Field subtract (aux)       !! ??
                    break;

                case 0x1B:              // XX33: ---=Field add (aux)            !! ??
                    break;

                case 0x1C:              // XX34: TEL=Test for equal or less
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 <= t2 ? 1 : 0);
                    break;

                case 0x1D:              // XX35: TLS=Test for less
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    t1 = B5500Processor.collate[this.cc.fieldIsolate(this.A, this.G*6, 6)];
                    t2 = B5500Processor.collate[variant];
                    this.MSFF = (t1 < t2 ? 1 : 0);
                    break;

                case 0x1E:              // XX36: TAN=Test for alphanumeric
                    this.streamAdjustSource();
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
                    }
                    this.Y = t1 = this.cc.fieldIsolate(this.A, this.G*6, 6);
                    this.Z = variant;                   // for display only
                    if (B5500Processor.collate[t1] > B5500Processor.collate[variant]) {                      // alphanumeric unless | or !
                        this.MSFF = (t1 == 0x20 ? 0 : (t1 == 0x3C ? 0 : 1));
                    } else {                            // alphanumeric if equal
                        this.Q |= 0x04;                 // set Q03F (display only)
                        this.MSFF = (t1 == variant ? 1 : 0);
                    }
                    break;

                case 0x1F:              // XX37: BIT=Test bit
                    if (!this.AROF) {
                        this.access(0x04);              // A = [M]
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
                    break;

                case 0x22:              // XX42: SEC=Set TALLY
                    this.R = variant;
                    break;

                case 0x23:              // XX43: CRF=Call repeat field
                    this.A = this.B;                    // save B in A
                    this.AROF = this.BROF;
                    t1 = this.S;                        // save S (not the way the hardware did it)
                    this.S = this.F - variant;          // compute parameter address
                    this.access(0x03);                  // B = [S]
                    variant = this.B % 0x40;            // dynamic repeat count is low-order 6 bits
                    this.S = t1;                        // restore S
                    this.B = this.A;                    // restore B
                    this.BROF = this.AROF;
                    this.AROF = 0;
                    noSECL = 1;                         // override normal instruction fetch
                    opcode = this.cc.fieldIsolate(this.P, this.L*12, 12);
                    if (variant) {
                        this.T = opcode & 0x3F + variant*64;    // use repeat count from parameter
                    } else {
                        if (opcode & 0xFC) {            // repeat field in next syl > 0
                            this.T = opcode;
                            variant = opcode >>> 6;     // execute next syl as is
                        } else {
                            this.T = opcode = 0x27;     // inject JFW 0 into T (effectively a no-op)
                        }
                    }
                    break;

                case 0x24:              // XX44: JNC=Jump out of loop conditional
                    break;

                case 0x25:              // XX45: JFC=Jump forward conditional
                    break;

                case 0x26:              // XX46: JNS=Jump out of loop
                    break;

                case 0x27:              // XX47: JFW=Jump forward unconditional
                    break;

                case 0x28:              // XX50: RCA=Recall control address
                    break;

                case 0x29:              // XX51: ENS=End loop
                    break;

                case 0x2A:              // XX52: BNS=Begin loop
                    break;

                case 0x2B:              // XX53: RSA=Recall source address
                    break;

                case 0x2C:              // XX54: SCA=Store control address
                    break;

                case 0x2D:              // XX55: JRC=Jump reverse conditional
                    break;

                case 0x2E:              // XX56: TSA=Transfer source address
                    break;

                case 0x2F:              // XX57: JRV=Jump reverse unconditional
                    break;

                case 0x30:              // XX60: CEQ=Compare equal
                    break;

                case 0x31:              // XX61: CNE=Compare not equal
                    break;

                case 0x32:              // XX62: CEG=Compare greater or equal
                    break;

                case 0x33:              // XX63: CGR=Compare greater
                    break;

                case 0x34:              // XX64: BIS=Set bit
                    break;

                case 0x35:              // XX65: BIR=Reset bit
                    break;

                case 0x36:              // XX66: OCV=Output convert
                    break;

                case 0x37:              // XX67: ICV=Input convert
                    break;

                case 0x38:              // XX70: CEL=Compare equal or less
                    break;

                case 0x39:              // XX71: CLS=Compare less
                    break;

                case 0x3A:              // XX72: FSU=Field subtract
                    break;

                case 0x3B:              // XX73: FAD=Field add
                    break;

                case 0x3C:              // XX74: TRP=Transfer program characters
                    this.streamAdjustDestChar();
                    if (variant) {                  // count > 0
                        if (!this.BROF) {
                            this.access(0x03);          // B = [S]
                        }
                        this.cycleCount += variant;     // approximate the timing
                        t1 = (this.L*2 + variant & 0x01)*6;     // P-bit number
                        t2 = this.K*6;                  // B-bit number
                        while (variant--) {
                            this.Y = this.cc.fieldIsolate(this.P, t1, 6);
                            this.B = this.cc.fieldInsert(this.B, t2, 6, this.Y)
                            if (t2 < 42) {
                                t2 += 6;
                                this.K++;
                            } else {
                                t2 = 0;
                                this.K = 0;
                                this.access(0x0B);      // [S] = B
                                this.S++;
                                if (variant < 8) {      // just a partial word left
                                    this.access(0x03);  // B = [S]
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
                                this.access(0x30);      // P = [C]
                            }
                        }
                    }
                    break;

                case 0x3D:              // XX75: TRN=Transfer numerics
                    this.MSFF = 0;                      // initialize true-false FF
                    this.streamSourceToDest(variant, function(bb, count) {
                        var c = this.Y;

                        if (count == 1 && (c & 0x30) == 0x20) {
                            this.MSFF = 1;              // neg. sign
                        }
                        this.B = this.cc.fieldInsert(this.B, bb, 6, c & 0x0F);
                    });
                    break;

                case 0x3E:              // XX76: TRZ=Transfer zones
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
            switch (opcode & 3) {
            case 0:                     // LITC: Literal Call
                this.adjustAEmpty();
                this.A = opcode >>> 2;
                this.AROF = 1;
                break;

            case 2:                     // OPDC: Operand Call
                this.adjustAEmpty();
                computeRelativeAddr(opcode >>> 2, 1);
                this.access(0x04);                  // A = [M]
                this.operandCall();
                break;

            case 3:                     // DESC: Descriptor (name) Call
                this.adjustAEmpty();
                computeRelativeAddr(opcode >>> 2, 1);
                this.access(0x04);                      // A = [M]
                this.descriptorCall();
                break;

            case 1:                     // all other word-mode operators
                variant = opcode >>> 6;
                switch (opcode & 0x3F) {
                case 0x01:              // XX01: single-precision numerics
                    switch (variant) {
                    case 0x01:          // 0101: ADD=single-precision add
                        break;

                    case 0x03:          // 0301: SUB=single-precision subtract
                        break;

                    case 0x04:          // 0401: MUL=single-precision multiply
                        break;

                    case 0x08:          // 1001: DIV=single-precision floating divide
                        break;

                    case 0x18:          // 3001: IDV=integer divide
                        break;

                    case 0x38:          // 7001: RDV=remainder divide
                        break;
                    }
                    break;

                case 0x05:              // XX05: double-precision numerics
                    switch (variant) {
                    case 0x01:          // 0105: DLA=double-precision add
                        break;

                    case 0x03:          // 0305: DLS=double-precision subtract
                        break;

                    case 0x04:          // 0405: DLM=double-precision multiply
                        break;

                    case 0x08:          // 1005: DLD=double-precision floating divide
                        break;
                    }
                    break;

                case 0x09:              // XX11: control state and communication ops
                    switch (variant) {
                    case 0x01:          // 0111: PRL=Program Release
                        break;

                    case 0x10:          // 1011: COM=Communicate
                        if (this.NCSF) {        // no-op in control state
                            this.adjustAFull();
                            this.M = (this.R*64) + 0x09;        // address = R+@11
                            this.access(0x0C);  // [M] = A
                            this.AROF = 0;
                            this.I = (this.I & 0x0F) | 0x40;    // set I07
                            this.cc.signalInterrupt();
                        }
                        break;

                    case 0x02:          // 0211: ITI=Interrogate Interrupt
                        if (this.cc.IAR && !this.NCSF) {
                            this.C = this.cc.IAR;
                            this.L = 0;
                            this.S = 0x40;      // address @100
                            this.cc.clearInterrupt();
                            this.cc.access(0x30);    // P = [C]
                        }
                        break;

                    case 0x04:          // 0411: RTR=Read Timer
                        if (!this.NCSF) {      // control-state only
                            this.adjustAEmpty();
                            this.A = this.cc.CCI03F*64 + this.cc.TM;
                        }
                        break;

                    case 0x11:          // 2111: IOR=I/O Release
                        break;

                    case 0x12:          // 2211: HP2=Halt Processor 2
                        if (!this.NCSF && this.cc.P2 && this.cc.P2BF) {
                            this.cc.HP2F = 1;
                            // We know P2 is not currently running on this thread, so save its registers
                            this.cc.P2.storeForInterrupt(0);
                        }
                        break;

                    case 0x14:          // 2411: ZPI=Conditional Halt
                        break;

                    case 0x18:          // 3011: SFI=Store for Interrupt
                        this.storeForInterrupt(0);
                        break;

                    case 0x1C:          // 3411: SFT=Store for Test
                        this.storeForInterrupt(1);
                        break;

                    case 0x21:          // 4111: IP1=Initiate Processor 1
                        if (!this.NCSF) {
                            this.initiate(0);
                        }
                        break;

                    case 0x22:          // 4211: IP2=Initiate Processor 2
                        if (!this.NCSF) {
                            this.adjustAFull();
                            this.M = 8;             // INCW is stored in @10
                            this.access(0x0C);      // [M] = A
                            this.AROF = 0;
                            this.cc.initiateP2();
                            this.cycleLimit = 0;    // give P2 a chance to run
                        }
                        break;

                    case 0x24:          // 4411: IIO=Initiate I/O
                        break;

                    case 0x29:          // 5111: IFT=Initiate For Test
                        break;
                    } // end switch for XX11 ops
                    break;

                case 0x0D:              // XX15: logical (bitmask) ops
                    switch (variant) {
                    case 0x01:          // 0115: LNG=logical negate
                        // assert(this.AROF == 1);
                        flagBit = this.cc.bit(this.A, 0);    // save flag bit
                        aHi = this.A / w32;
                        aLo = this.A % w32;
                        this.A = (~aHi) * w32 + (~aLo); // negate as two chunks
                        this.A = this.cc.fieldInsert(this.A, 0, 1, flagBit); // restore flag bit
                        this.AROF == 1;
                        break;

                    case 0x02:          // 0215: LOR=logical OR
                        // assert(this.AROF == 1 && this.BROF == 1);
                        flagBit = this.cc.bit(this.B, 0); // save B flag bit
                        aHi = this.A / w32;
                        aLo = this.A % w32;
                        bHi = this.B / w32;
                        bLo = this.B % w32;
                        this.A = (aHi | bHi) * w32 + (aLo | bLo);
                        this.A = this.cc.fieldInsert(this.A, 0, 1, flagBit); // restore flag bit to A
                        this.AROF = 1;
                        this.BROF = 0;
                        break;

                    case 0x04:          // 0415: LND=logical AND
                        // assert(this.AROF == 1 && this.BROF == 1);
                        flagBit = this.cc.bit(this.B, 0); // save flag bit
                        aHi = this.A / w32;
                        aLo = this.A % w32;
                        bHi = this.B / w32;
                        bLo = this.B % w32;
                        this.A = (aHi & bHi) * w32 + (aLo & bLo);
                        this.A = this.cc.fieldInsert(this.A, 0, 1, flagBit); // restore flag bit to A
                        this.AROF = 1;
                        this.BROF = 0;
                        break;

                    case 0x08:          // 1015: LQV=logical EQV
                        // assert(this.AROF == 1 && this.BROF == 1);
                        flagBit = this.cc.bit(this.B, 0); // save B flag bit
                        aHi = this.A / w32;
                        aLo = this.A % w32;
                        bHi = this.B / w32;
                        bLo = this.B % w32;
                        this.B = (~(aHi ^ bHi)) * w32 + (~(aLo ^ bLo));
                        this.B = this.cc.fieldInsert(this.B, 0, 1, flagBit); // restore B flag bit
                        this.AROF = 0;
                        this.BROF = 1;
                        break;

                    case 0x10:          // 2015: MOP=reset flag bit (make operand)
                        this.A = this.cc.bitReset(this.A, 0);
                        break;

                    case 0x20:          // 4015: MDS=set flag bit (make descriptor)
                        this.A = this.cc.bitSet(this.A, 0);
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
                    case 0x01:          // 0125: CEQ=compare B greater or equal to A
                        break;

                    case 0x02:          // 0225: CGR=compare B greater to A
                        break;

                    case 0x04:          // 0425: NEQ=compare B not equal to A
                        // assert(this.AROF == 1 && this.BROF == 1);
                        // TODO: should this be excluding the flag bit in the comparison?
                        this.B = (this.A != this.B) ? 1 : 0;
                        this.AROF = 0;
                        this.BROF = 1;
                        break;

                    case 0x08:          // 1025: XCH=exchange TOS words
                        this.exchangeTOS();
                        break;

                    case 0x0C:          // 1425: FTC=F field to core field
                        break;

                    case 0x10:          // 2025: DUP=Duplicate TOS
                        this.adjustAEmpty();
                        this.adjustBFull();
                        this.A = this.B;
                        this.AROF = 1;
                        break;

                    case 0x1C:          // 3425: FTF=F field to F field
                        break;

                    case 0x21:          // 4125: LEQ=compare B less or equal to A
                        // assert(this.AROF == 1 && this.BROF == 1);
                        // TODO: should this be excluding the flag bit in the comparison?
                        this.B = (this.A >= this.B) ? 1 : 0;
                        this.AROF = 0;
                        this.BROF = 1;
                        break;

                    case 0x22:          // 4225: LSS=compare B less to A
                        // assert(this.AROF == 1 && this.BROF == 1);
                        // TODO: should this be excluding the flag bit in the comparison?
                        this.B = (this.A > this.B) ? 1 : 0;
                        this.AROF = 0;
                        this.BROF = 1;
                        break;

                    case 0x24:          // 4425: EQL=compare B equal to A
                        // assert(this.AROF == 1 && this.BROF == 1);
                        // TODO: should this be excluding the flag bit in the comparison?
                        this.B = (this.A == this.B) ? 1 : 0;
                        this.AROF = 0;
                        this.BROF = 1;
                        break;

                    case 0x2C:          // 5425: CTC=core field to C field
                        break;

                    case 0x3C:          // 7425: CTF=cre field to F field
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
                        // assert(this.AROF == 1);
                        this.A = this.cc.bitSet(this.A, 1);
                        this.AROF = 1;
                        break;

                    case 0x08:          // 1031: CHS=change sign bit
                        // the sign-bit is bit 1
                        // assert(this.AROF == 1);
                        if (this.cc.bit(this.A, 1)) {
                            this.A = this.cc.bitReset(this.A, 1);
                        } else {
                            this.A = this.cc.bitSet(this.A, 1);
                        }
                        this.AROF = 1;
                        break;

                    case 0x10:          // 2031: TOP=test flag bit (test for operand)
                        if (this.cc.bit(this.B, 1)) {
                            this.A = 0;
                        } else {
                            this.A = 1;
                        }
                        this.AROF = 1;
                        break;

                    case 0x11:          // 2131: LBC=branch backward word conditional
                        break;

                    case 0x12:          // 2231: LFC=branch forward word conditional
                        break;

                    case 0x14:          // 2431: TUS=interrogate peripheral status
                        break;

                    case 0x21:          // 4131: BBW=branch backward unconditional
                        break;

                    case 0x22:          // 4231: BFW=branch forward unconditional
                        break;

                    case 0x24:          // 4431: SSP=reset sign bit (set positive)
                        // the sign-bit is bit 1
                        // assert(this.AROF == 1);
                        this.A = this.cc.bitReset(this.A, 1);
                        this.AROF = 1;
                        break;

                    case 0x31:          // 6131: LBU=branch backward word unconditional
                        break;

                    case 0x32:          // 6231: LFU=branch forward word unconditional
                        break;

                    case 0x34:          // 6431: TIO=interrogate I/O channel
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
                            this.access(0x30);          // P = [C]
                            this.L = 0;
                            this.access(0x03);          // B = [S], fetch MSCW
                            this.S--;
                            this.applyMSCW(this.B);
                            this.BROF = 0;
                        }
                        break;

                    case 0x02:          // 0235: RTN=return normal
                        this.adjustAFull();
                        this.S = this.F;
                        this.access(0x03);              // B = [S], fetch the RCW
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
                        this.access(0x03);              // B = [S], fetch the RCW
                        this.exitSubroutine(0);
                        break;

                    case 0x0A:          // 1235: RTS=return special
                        this.adjustAFull();
                        this.access(0x03);              // B = [S], fetch the RCW
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
                        this.adjustAEmpty();
                        this.adjustBEmpty();
                        this.B = this.buildMSCW();
                        this.adjustBEmpty();
                        this.F = this.S;
                        if (!this.MSFF) {
                            if (this.SALF) {            // store the MSCW at R+7
                                this.M = (this.R*64) + 7;
                                this.access(0x0D);      // [M] = B
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
            this.Q |= 0x40              // set Q07F to indicate hardware-induced SFI
            this.Q &= ~(0x100);         // reset Q09F: adder mode for R-relative addressing
        } else {
            // otherwise, fetch the next instruction
            switch (this.L) {
            case 0:
                this.T = ((this.P - this.P % 0x1000000000) / 0x1000000000) % 0x1000;
                this.L = 1;
                break;
            case 1:
                this.T = ((this.P - this.P % 0x1000000) / 0x1000000) % 0x1000;
                this.L = 2;
                break;
            case 2:
                this.T = ((this.P - this.P % 0x1000) / 0x1000) % 0x1000;
                this.L = 3;
                break;
            case 3:
                this.T = this.P % 0x1000;
                this.L = 0;
                this.C++;
                this.access(0x30);      // P = [C]
                break;
            }
        }
    } while ((this.cycleCount += 2) < this.cycleLimit && this.busy);
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
        that.scheduleSlack += delayTime;
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

