/***********************************************************************
* retro-b5500/emulator B5500Processor.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the B5500 Processor (CPU) module.
************************************************************************
* 2012-06-03  P.Kimpel
*   Original version, from thin air.
***********************************************************************/

/**************************************/
function B5500Processor() {
    /* Constructor for the Processor module object */

    this.A = 0;                         // Top-of-stack register 1
    this.AROF = 0;                      // A contents valid
    this.B = 0;                         // Top-of-stack register 2
    this.BROF = 0;                      // B contents valid
    this.C = 0;                         // Current program instruction word address
    this.CCCF = 0;                      // Clock-count control FF (maintenance only)
    this.CWMF = 0;                      // Character/word mode FF (1=CM)
    this.E = 0;                         // Memory access control register
    this.EIHF = 0;                      // ??
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
    this.R = 0;                         // PRT base address (high-order 9 bits only)
    this.S = 0;                         // Top-of-stack memory address (DI.w in CM)
    this.SALF = 0;                      // Program/subroutine state FF (1=subroutine)
    this.T = 0;                         // Current program syllable register
    this.TALLY = 0;                     // CM TALLY register (physically, low-order 6 bits of R)
    this.TM = 0;                        // Temporary maintenance storage register
    this.TROF = 0;                      // T contents valid
    this.V = 0;                         // Bit index register for K (in B)
    this.VARF = 0;                      // Variant-mode FF (enables full PRT indexing)
    this.X = 0;                         // Mantissa extension for B (loop control in CM)
    this.Y = 0;                         // Serial character register for A
    this.Z = 0;                         // Serial character register for B

    this.cycleLimit = 0;                // Count-down cycle limit for this.run()
    this.isP1 = true;                   // Control processor flag
}

/**************************************/
B5500Processor.prototype.access(eValue) {
    /* Access memory based on the E register */
    var addr;

    /****************************************************************
    HOW TO HANDLE INVALID ADDRESS INTERRUPTS DETECTED BY CENTRAL CONTROL?
    ****************************************************************/

    this.E = eValue;
    switch (eValue) {
        case 0x02:                      // A = [S]
            this.A = cc.fetch(this.S);
            this.AROF = 1;
            break;
        case 0x03:                      // B = [S]
            this.B = cc.fetch(this.S);
            this.BROF = 1;
            break;
        case 0x04:                      // A = [M]
            this.A = cc.fetch(this.M);
            this.AROF = 1;
            break;
        case 0x05:                      // B = [M]
            this.B = cc.fetch(this.M);
            this.BROF = 1;
            break;
        case 0x06:                      // M = [M].[18:15]
            this.M = (cc.fetch(this.M) >>> 15) & 0x7FFF;
            break;
        case 0x0A:                      // [S] = A
            cc.store(this.S, this.A);
            break;
        case 0x0B:                      // [S] = B
            cc.store(this.S, this.B);
            break;
        case 0x0C:                      // [M] = A
            cc.store(this.M, this.A);
            break;
        case 0x0D:                      // [M] = B
            cc.store(this.M, this.B);
        case 0x30:                      // P = [C]
            this.P = cc.fetch(this.C);
            this.PROF = 1;
            break;
        default:
            throw "Invalid E register value: " + eReg.toString(2);
            break;
    }
    this.cycleLimit -= 6;               // assume 6 us memory cycle time

    if (addr < 0x0200 && this.NCSF) {   // normal-state cannot address @000-@777 [?? first 512 or 1024 words ??]
        this.I |= 0x0500;               // set I02F & I04F
        cc.signalInterrupt();
    } else {
        cc.store(addr, word);
    }
}

/**************************************/
B5500Processor.prototype.adjustAEmpty() {
    /* Adjusts the A register so that it is empty pushing the prior
    contents of A into B and B into memory, as necessary. */

    if (this.AROF} {
        if (this.BROF) {
            this.S++;
            this.access(0x0B);          // [S] = B
        }
        this.B = this.A;
        this.AROF = 0;
        this.BROF = 1;
    // else we're done -- A is already empty
    }
}

/**************************************/
B5500Processor.prototype.adjustAFull() {
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
}

/**************************************/
B5500Processor.prototype.adjustBEmpty() {
    /* Adjusts the B register so that it is empty pushing the prior
    contents of B into memory, as necessary. */

    if (this.BROF) {
        this.S++;
        this.access(0x0B);              // [S] = B
    // else we're done -- B is already empty
    }
}

/**************************************/
B5500Processor.prototype.adjustBFull() {
    /* Adjusts the B register so that it is full popping the contents of
    [S] into B, as necessary. */

    if (!this.BROF) {
        this.access(0x03);              // B = [S]
        this.S--;
    // else we're done -- B is already full
    }
}

/**************************************/
B5500Processor.storeForInterrupt() {
    /* Implements the 3011=SFI operator */

    if (this.CWMF) {
        if (this.BROF) {
            this.access(0x0B);          // [S] = B, save B if valid
        }
        if (this.AROF) {
            this.access(0x0A);          // [S] = A, save A if valid
        }
        this.B = ((((0x30*512 +
                 (this.R >>> 6))*4 +
                 this.MSFF)*2 +
                 this.SALF)*32768 +
                 this.N)*16 +
                 this.M;
        this.S++;
        this.access(0x0B);
    } else
    }
}

/**************************************/
B5500Processor.prototype.run() {
    /* Instruction execution driver for the B5500 processor. This function is
    an artifact of the emulator design and does not represent any physical
    process or state of the processor. This routine assumes the registers are
    set up, and in particular a syllable is in T with TROF set. */
    var opcode;

    /* HOW TO ENTER, EXIT, AND RESUME CHARACTER MODE? */

    this.cycleLimit = 5000;             // max CPU cycles to run
    do {
        opcode = this.T;
        switch (opcode & 3) {
            case 0:                     // LITC: Literal Call
                this.adjustAEmpty();
                this.A = opcode >>> 2;
                this.AROF = 1;
                break;

            case 2:                     // OPDC: Operand Call
                this.adjustAEmpty();
                // TO BE PROVIDED
                break;

            case 3:                     // DESC: Descriptor (name) Call
                this.adjustAEmpty();
                // TO BE PROVIDED
                break;

            case 1:                     // all other word-mode operators
                switch (opcode & 0x3F) {
                    case 0x01:          // XX01: single-precision numerics
                        break;

                    case 0x05:          // XX05: double-precision numerics
                        break;

                    case 0x09:          // XX11: control state and communication ops
                        switch (opcode >>> 6) {
                            case 0x01:  // 0111: PRL=Program Release
                                 break;

                            case 0x10:  // 1011: COM=Communicate
                                 this.adjustAFull();
                                 this.M = 0x09;         // address @11
                                 this.access(0x0C);     // [M] = A
                                 this.AROF = 0;
                                 break;

                            case 0x02:  // 0211: ITI=Interrogate Interrupt
                                 break;

                            case 0x04:  // 0411: RTR=Read Timer
                                 adjustAEmpty();
                                 this.A = cc.CCI03F << 6 | cc.TM;
                                 break;

                            case 0x11:  // 2111: IOR=I/O Release
                                 break;

                            case 0x12:  // 2211: HP2=Halt Processor 2
                                 break;

                            case 0x14:  // 2411: ZPI=Conditional Halt
                                 break;

                            case 0x18:  // 3011: SFI=Store for Interrupt
                                 this.storeForInterrupt();
                                 break;

                            case 0x1C:  // 3411: SFT=Store for Test
                                 break;

                            case 0x21:  // 4111: IP1=Initiate Processor 1
                                 break;

                            case 0x22:  // 4211: IP2=Initiate Processor 2
                                 break;

                            case 0x24:  // 4411: IIO=Initiate I/O
                                 break;

                            case 0x29:  // 5111: IFT=Initiate For Test
                                 break;

                            default:
                                break;  // Anything else is a no-op
                        } / end switch for XX11 ops
                        break;

                    case 0x0D:          // XX15: logical (bitmask) ops
                        break;

                    case 0x11:          // XX21: load & store ops
                        break;

                    case 0x15:          // XX25: comparison & misc. stack ops
                        break;

                    case 0x19:          // XX31: branch, sign-bit, interrogate ops
                        break;

                    case 0x1D:          // XX35: exit & return ops
                        break;

                    case 0x21:          // XX41: index, mark stack, etc.
                        break;

                    case 0x25:          // XX45: ISO=Variable Field Isolate op
                        break;

                    case 0x29:          // XX51: delete & conditional branch ops
                        break;

                    case 0x2D:          // XX55: NOOP & DIA=Dial A ops
                        if (opcode & 0xFC0) {
                            this.G = opcode >>> 9;
                            this.H = (opcode >>> 6) & 7;
                        // else 0055=NOOP
                        }
                        break;

                    case 0x31:          // XX61: XRT & DIB=Dial B ops
                        if (opcode & 0xFC0) {
                            this.K = opcode >>> 9;
                            this.V = (opcode >>> 6) & 7;
                        } else {        // 0061=XRT: temporarily set full PRT addressing mode
                            this.VARF = this.SALF;
                            this.SALF = 0;
                        }
                        break;

                    case 0x35:          // XX65: TRB=Transfer Bits op
                        break;

                    case 0x39:          // XX71: FCL=Compare Field Low op
                        break;

                    case 0x3D:          // XX75: FCE=Compare Field Equal op
                        break;

                    default:
                        break;          // should never get here, but in any case it'd be a no-op
                } // end switch for word-mode operators
                break;
        } // end switch for main opcode dispatch

        // SECL: Syllable Execution Complete Level
        this.Q = 0;
        this.Y = 0;
        this.Z = 0;
        if (this.CWMF) {
            this.M = 0;
            this.N = 0;
            this.X = 0;
        }
        if (cc.IAR && this.NCSF) {      // there's an interrupt and we're in normal state
            this.T = 0x0609;            // inject 3011=SFI into T
            this.Q |= 0x40              // set Q07F=hardware-induced SFI
            this.Q &= ~(0x100);         // reset Q09F=adder mode for R-relative addressing
        } else {
            if (this.L < 3) {
                this.T = (this.P >>> (36-this.L*12)) & 0x0FFF;
                this.L++;
            } else {
                this.T = this.P & 0x0FFF;
                this.L = 0;
                this.C++;
                this.access(0x30);      // P = [C]
            }
        }
    } while (--this.Limit > 0);
}