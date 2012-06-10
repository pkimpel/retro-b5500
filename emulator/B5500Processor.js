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

    this.timeSlice = 5000;              // Standard run() timeslice, about 5ms (we hope)

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
    this.R = 0;                         // PRT base address (low-order 6 bits are always zero in word mode)
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
    this.procTime = 0;                  // Current processor running time, based on cycles executed
    this.busy = false;                  // Proessor is running, not idle or halted

    this.accessor = {                   // Memory access control block
        addr: 0,                           // Memory address
        word: 0,                           // 48-bit data word
        MAIL: 0,                           // Truthy if attempt to access @000-@777 in normal state
        MPED: 0,                           // Truthy if memory parity error
        MAED: 0};                          // Truthy if memory address/inhibit error
}

/**************************************/
B5500Processor.prototype.access(eValue) {
    /* Access memory based on the E register. If the processor is in normal
    state, it cannot access the first 512 words of memory => invalid address */

    this.E = eValue;                    // Just to show the world what's happening
    this.accessor.MAIL = (addr < 0x0200 && this.NCSF);
    switch (eValue) {
    case 0x02:                          // A = [S]
        this.accessor.addr = this.S;
        cc.fetch(this);
        this.A = this.accessor.word;
        this.AROF = 1;
        break;
    case 0x03:                          // B = [S]
        this.accessor.addr = this.S;
        cc.fetch(this);
        this.B = this.accessor.word;
        this.BROF = 1;
        break;
    case 0x04:                          // A = [M]
        this.accessor.addr = this.M;
        cc.fetch(this);
        this.A = this.accessor.word;
        this.AROF = 1;
        break;
    case 0x05:                          // B = [M]
        this.accessor.addr = this.M;
        cc.fetch(this);
        this.B = this.accessor.word;
        this.BROF = 1;
        break;
    case 0x06:                          // M = [M].[18:15]
        this.accessor.addr = this.M;
        cc.fetch(this);
        this.M = (this.accessor.word >>> 15) & 0x7FFF;
        break;
    case 0x0A:                          // [S] = A
        this.accessor.addr = this.S;
        this.accessor.word = this.A;
        cc.store(this);
        break;
    case 0x0B:                          // [S] = B
        this.accessor.addr = this.S;
        this.accessor.word = this.B;
        cc.store(this);
        break;
    case 0x0C:                          // [M] = A
        this.accessor.addr = this.M;
        this.accessor.word = this.A;
        cc.store(this);
        break;
    case 0x0D:                          // [M] = B
        this.accessor.addr = this.M;
        this.accessor.word = this.B;
        cc.store(this);
        break;
    case 0x30:                          // P = [C]
        this.accessor.addr = this.C;
        cc.fetch(this);
        this.P = this.accessor.word;
        this.PROF = 1;
        break;
    default:
        throw "Invalid E register value: " + eReg.toString(2);
        break;
    }

    this.cycleCount += 6;               // assume 6 us memory cycle time
    if (this.accessor.MAED) {
        this.I |= 0x02;                 // set I02F - memory address/inhibit error
        if (this.NCSF || this !== cc.P1) {
            cc.signalInterrupt();
        } else {
            this.busy = false;          // P1 invalid address in control state stops the proc
        }
    } else if (this.accessor.MPED) {
        this.I |= 0x01;                 // set I01F - memory parity error
        if (this.NCSF || this !== cc.P1) {
            cc.signalInterrupt();
        } else {
            this.busy = false;          // P1 memory parity in control state stops the proc
        }
    }
}

/**************************************/
B5500Processor.prototype.adjustAEmpty() {
    /* Adjusts the A register so that it is empty pushing the prior
    contents of A into B and B into memory, as necessary. */

    if (this.AROF} {
        if (this.BROF) {
            if (this.S < this.R || !this.NCSF) {
                this.S++;
                this.access(0x0B);      // [S] = B
            } else {
                this.I |= 0x04;         // set I03F: stack overflow
                cc.signalInterrupt();
            }
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
        if (this.S < this.R || !this.NCSF) {
            this.S++;
            this.access(0x0B);          // [S] = B
        } else {
            this.I |= 0x04;             // set I03F: stack overflow
            cc.signalInterrupt();
        }
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
B5500Processor.storeForInterrupt(p, forTest) {
    /* Implements the 3011=SFI operator and the parts of SFT that are
    common to it for the processor referenced as "p". "forTest" implies use
    from SFT */
    var forced = p.Q & 0x0040;          // Q07F: Hardware-induced SFI syllable
    var temp;

    if (forced || forTest) {
        p.NCSF = 0;                     // switch to control state
    }

    if (p.CWMF) {
        temp = p.S;                     // get the correct TOS address from X
        p.S = (p.X % 0x40000000) >>> 15;
        p.X = p.X % 0x8000 +
              temp * 0x8000 +
              Math.floor(p.X / 0x40000000) * 0x40000000;
        if (p.AROF || forTest) {
            p.access(0x0A);             // [S] = A
        }
        if (p.BROF || forTest) {
            p.access(0x0B);             // [S] = B
        }
        p.B = p.X +                     // store CM loop-control word
              p.AROF * 0x200000000000 +
              0xC00000000000;
        p.access(0x0B);                 // [S] = B
    } else {
        if (p.BROF || forTest) {
            p.access(0x0B);             // [S] = B
        }
        if (p.AROF || forTest) {
            p.access(0x0A);             // [S] = A
        }
    }
    p.B = p.M +                         // store interrupt control word (ICW)
          p.N * 0x8000 +
          p.VARF * 0x1000000 +
          p.SALF * 0x40000000 +
          p.MSFF * 0x80000000 +
          (p.R >>> 6) * 0x200000000 +
          0xC00000000000;
    p.access(0x0B);                     // [S] = B

    p.B = p.C +                         // store interrupt return control word (IRCW)
          p.F * 0x8000 +
          p.K * 0x40000000 +
          p.G * 0x200000000 +
          p.L * 0x1000000000 +
          p.V * 0x4000000000 +
          p.H * 0x20000000000 +
          p.BROF * 0x200000000000 +
          0xC00000000000;
    p.access(0x0B);                     // [S] = B

    if (p.CWMF) {
        temp = p.F;                     // if CM, get correct R value from last MSCW
        p.F = p.S;
        p.S = temp;
        p.access(0x03);                 // B = [S]: get last RCW
        p.S = ((p.B % 0x40000000) >>> 15) & 0x7FFF;
        p.access(0x03);                 // B = [S]: get last MSCW
        p.R = (Math.Floor(p.B / 0x200000000) % 0x200) << 6;
        p.S = p.F;
    }

    p.B = p.S +                         // store the initiate control word (INCW)
          p.CWMF * 0x8000 +
          0xC00000000000;
    if (forTest) {
        p.B += (p.TM & 0x1F) * 0x10000 +
               p.Z * 0x400000 +
               p.Y * 0x10000000 +
               (p.Q & 0x1FF) * 0x400000000;
        p.TM = 0;
   }

    p.M = p.R + 8;                      // store initiate word at R+@10
    p.access(0x0D);                     // [M] = B

    p.M = 0;
    p.R = 0;
    p.MSFF = 0;
    p.SALF = 0;
    p.BROF = 0;
    p.AROF = 0;
    if (forced) {
        if (p === cc.P1) {
            p.T = 0x89;                 // inject 0211=ITI into T register
        } else {
            p.T = 0;                    // idle the processor
            p.TROF = 0;
            p.PROF = 0;
            cc.HP2F = 1;
            cc.P2BF = 0;
            this.busy = false;
        }
        p.CWMF = 0;
    } else if (forTest) {
        p.CWMF = 0;
        if (p === cc.P1) {
            p.access(0x05);             // B = [M]: load DD for test
            p.C = p.B % 0x7FFF;
            p.L = 0;
            p.access(0x30);             // P = [C]: first word of test routine
            p.G = 0;
            p.H = 0;
            p.K = 0;
            p.V = 0;
        } else {
            p.T = 0;                    // idle the processor
            p.TROF = 0;
            p.PROF = 0;
            cc.HP2F = 1;
            cc.P2BF = 0;
            this.busy = false;
        }
    }
}

/**************************************/
B5500Processor.prototype.run() {
    /* Instruction execution driver for the B5500 processor. This function is
    an artifact of the emulator design and does not represent any physical
    process or state of the processor. This routine assumes the registers are
    set up, and in particular a syllable is in T with TROF set. It will run
    until cycleCount >= cycleLimit or !this.busy */
    var opcode;
    var repeat;

    do {
        this.Q = 0;
        this.Y = 0;
        this.Z = 0;
        opcode = this.T;
        if (this.CWMF) {
            /***********************************************************
            *  Character Mode Syllables                                *
            ***********************************************************/
            this.M = 0;
            this.N = 0;
            this.X = 0;
            repeat = opcode >>> 6;
            switch (opcode & 0x3F) {
            case 0x00:                  // XX00: CMX, EXC: Exit character mode
                break;

            case 0x02:                  // XX02: BSD=Skip bit destination
                break;

            case 0x03:                  // XX03: BSS=Skip bit source
                break;

            case 0x04:                  // XX04: RDA=Recall destination address
                break;

            case 0x05:                  // XX05: TRW=Transfer words
                break;

            case 0x06:                  // XX06: SED=Set destination address
                break;

            case 0x07:                  // XX07: TDA=Transfer destination address
                break;

            case 0x0A:                  // XX12: TBN=Transfer blank for numeric
                break;

            case 0x0C:                  // XX14: SDA=Store destination address
                break;

            case 0x0D:                  // XX15: SSA=Store source address
                break;

            case 0x0E:                  // XX16: SFD=Skip forward destination
                break;

            case 0x0F:                  // XX17: SRD=Skip reverse destination
                break;

            case 0x11:                  // XX11: control state ops
                switch (repeat) {
                case 0x14:              // 2411: ZPI=Conditional Halt
                    break;

                case 0x18:              // 3011: SFI=Store for Interrupt
                    this.storeForInterrupt(this, false);
                    break;

                case 0x1C:              // 3411: SFT=Store for Test
                    this.storeForInterrupt(this, true);
                    break;

                default:                // Anything else is a no-op
                    break;
                } // end switch for XX11 ops
                break;

            case 0x12:                  // XX22: SES=Set source address
                break;

            case 0x14:                  // XX24: TEQ=Test for equal
                break;

            case 0x15:                  // XX25: TNE=Test for not equal
                break;

            case 0x16:                  // XX26: TEG=Test for greater or equal
                break;

            case 0x17:                  // XX27: TGR=Test for greater
                break;

            case 0x18:                  // XX30: SRS=Skip reverse source
                break;

            case 0x19:                  // XX31: SFS=Skip forward source
                break;

            case 0x1A:                  // XX32: ---=Field subtract (aux)       !! ??
                break;

            case 0x1B:                  // XX33: ---=Field add (aux)            !! ??
                break;

            case 0x1C:                  // XX34: TEL=Test for equal
                break;

            case 0x1D:                  // XX35: TLS=Test for less
                break;

            case 0x1E:                  // XX36: TAN=Test for alphanumeric
                break;

            case 0x1F:                  // XX37: BIT=Test bit
                break;

            case 0x20:                  // XX40: INC=Increase TALLY
                if (repeat) {
                    this.R = (this.R + repeat) & 0x3F;
                // else it's a character-mode no-op
                }
                break;

            case 0x21:                  // XX41: STC=Store TALLY
                break;

            case 0x22:                  // XX42: SEC=Set TALLY
                this.R = repeat;
                break;

            case 0x23:                  // XX43: CRF=Call repeat field
                break;

            case 0x24:                  // XX44: JNC=Jump out of loop conditional
                break;

            case 0x25:                  // XX45: JFC=Jump forward conditional
                break;

            case 0x26:                  // XX46: JNS=Jump out of loop
                break;

            case 0x27:                  // XX47: JFW=Jump forward unconditional
                break;

            case 0x28:                  // XX50: RCA=Recall control address
                break;

            case 0x29:                  // XX51: ENS=End loop
                break;

            case 0x2A:                  // XX52: BNS=Begin loop
                break;

            case 0x2B:                  // XX53: RSA=Recall source address
                break;

            case 0x2C:                  // XX54: SCA=Store control address
                break;

            case 0x2D:                  // XX55: JRC=Jump reverse conditional
                break;

            case 0x2E:                  // XX56: TSA=Transfer source address
                break;

            case 0x2F:                  // XX57: JRV=Jump reverse unconditional
                break;

            case 0x30:                  // XX60: CEQ=Compare equal
                break;

            case 0x31:                  // XX61: CNE=Compare not equal
                break;

            case 0x32:                  // XX62: CEG=Compare greater or equal
                break;

            case 0x33:                  // XX63: CGR=Compare greater
                break;

            case 0x34:                  // XX64: BIS=Set bit
                break;

            case 0x35:                  // XX65: BIR=Reset bit
                break;

            case 0x36:                  // XX66: OCV=Output convert
                break;

            case 0x37:                  // XX67: ICV=Input convert
                break;

            case 0x38:                  // XX70: CEL=Compare equal or less
                break;

            case 0x39:                  // XX71: CLS=Compare less
                break;

            case 0x3A:                  // XX72: FSU=Field subtract
                break;

            case 0x3B:                  // XX73: FAD=Field add
                break;

            case 0x3C:                  // XX74: TRP=Transfer program characters
                break;

            case 0x3D:                  // XX75: TRN=Transfer numerics
                break;

            case 0x3E:                  // XX76: TRZ=Transfer zones
                break;

            case 0x3F:                  // XX77: TRS=Transfer source characters
                break;

            default:                    // everything else is a no-op
                break;
            } // end switch for character mode operators
        } else {
            /***********************************************************
            *  Word Mode Syllables                                     *
            ***********************************************************/
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
                case 0x01:              // XX01: single-precision numerics
                    break;

                case 0x05:              // XX05: double-precision numerics
                    break;

                case 0x09:              // XX11: control state and communication ops
                    switch (opcode >>> 6) {
                    case 0x01:          // 0111: PRL=Program Release
                        break;

                    case 0x10:          // 1011: COM=Communicate
                        if (this.NCSF) {        // no-op in control state
                            this.adjustAFull();
                            this.M = 0x09;      // address = @11
                            this.access(0x0C);  // [M] = A
                            this.AROF = 0;
                            this.I = (this.I & 0x0F) | 0x40;    // set I07
                            cc.signalInterrupt();
                        }
                        break;

                    case 0x02:          // 0211: ITI=Interrogate Interrupt
                        if (cc.IAR && !this.NCSF) {
                            this.C = cc.IAR;
                            this.L = 0;
                            this.S = 0x40;      // address @100
                            cc.clearInterrupt();
                            cc.access(0x30);    // P = [C]
                        }
                        break;

                    case 0x04:          // 0411: RTR=Read Timer
                        if (!this.NCSF) {      // control-state only
                            this.adjustAEmpty();
                            this.A = cc.CCI03F << 6 | cc.TM;
                        }
                        break;

                    case 0x11:          // 2111: IOR=I/O Release
                        break;

                    case 0x12:          // 2211: HP2=Halt Processor 2
                        break;

                    case 0x14:          // 2411: ZPI=Conditional Halt
                        break;

                    case 0x18:          // 3011: SFI=Store for Interrupt
                        this.storeForInterrupt(this, false);
                        break;

                    case 0x1C:          // 3411: SFT=Store for Test
                        this.storeForInterrupt(this, true);
                        break;

                    case 0x21:          // 4111: IP1=Initiate Processor 1
                        break;

                    case 0x22:          // 4211: IP2=Initiate Processor 2
                        break;

                    case 0x24:          // 4411: IIO=Initiate I/O
                        break;

                    case 0x29:          // 5111: IFT=Initiate For Test
                        break;

                    default:            // Anything else is a no-op
                        break;
                    } // end switch for XX11 ops
                    break;

                case 0x0D:              // XX15: logical (bitmask) ops
                    break;

                case 0x11:              // XX21: load & store ops
                    break;

                case 0x15:              // XX25: comparison & misc. stack ops
                    break;

                case 0x19:              // XX31: branch, sign-bit, interrogate ops
                    break;

                case 0x1D:              // XX35: exit & return ops
                    break;

                case 0x21:              // XX41: index, mark stack, etc.
                    break;

                case 0x25:              // XX45: ISO=Variable Field Isolate op
                    break;

                case 0x29:              // XX51: delete & conditional branch ops
                    break;

                case 0x2D:              // XX55: NOOP & DIA=Dial A ops
                    if (opcode & 0xFC0) {
                        this.G = opcode >>> 9;
                        this.H = (opcode >>> 6) & 7;
                    // else 0055=NOOP
                    }
                    break;

                case 0x31:              // XX61: XRT & DIB=Dial B ops
                    if (opcode & 0xFC0) {
                        this.K = opcode >>> 9;
                        this.V = (opcode >>> 6) & 7;
                    } else {            // 0061=XRT: temporarily set full PRT addressing mode
                        this.VARF = this.SALF;
                        this.SALF = 0;
                    }
                    break;

                case 0x35:              // XX65: TRB=Transfer Bits op
                    break;

                case 0x39:              // XX71: FCL=Compare Field Low op
                    break;

                case 0x3D:              // XX75: FCE=Compare Field Equal op
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
        if ((this === cc.P1 ? cc.IAR : this.I) && this.NCSF) {
            // there's an interrupt and we're in normal state
            this.T = 0x0609;            // inject 3011=SFI into T
            this.Q |= 0x40              // set Q07F to indicate hardware-induced SFI
            this.Q &= ~(0x100);         // reset Q09F: adder mode for R-relative addressing
        } else {
            // otherwise, fetch the next instruction
            switch (this.L) {
            case 0:
                this.T = Math.Floor(this.P / 0x1000000000) % 0x1000;
                this.L++;
            case 1:
                this.T = Math.Floor(this.P / 0x1000000) % 0x1000;
                this.L++;
            case 2:
                this.T = Math.Floor(this.P / 0x1000) % 0x1000;
                this.L++;
            case 3:
                this.T = this.P % 0x1000;
                this.L = 0;
                this.C++;
                this.access(0x30);      // P = [C]
            }
        }
    } while (++this.cycleCount < this.cycleLimit && this.busy);
}

/**************************************/
B5500Processor.prototype.schedule() {
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

    this.cycleLimit = this.timeSlice;
    this.cycleCount = 0;
    this.run();
    this.procTime += this.cycleCount;
    if (this.busy) {
        delayTime = this.procTime/1000 - new Date().getTime();
        setTimer(this.schedule, (delayTime < 0 ? 0 : delayTime));
    }
}