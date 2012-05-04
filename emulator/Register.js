/***********************************************************************
* retro-b5500/emulator Register.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT Licensed, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the generalized Register prototype.
* Maximum register width is 52 bits, since Javascript stores numbers
* internally as 64-bit IEEE 754 floating point numbers. All registers
* implement unsigned arithmetic modulo their bit width.
*
* Constructor spec members:
*   width:      size of the register in bits.
*   value:      initial register value (defaults to 0).
************************************************************************
* Modification Log.
* 2012-04-28  P.Kimpel
*   Original version, from many frustrating attempts to wrap my head
*   around this technique.
***********************************************************************/

define(["exports", "emu/compose"], function(exports, Compose) {

/***********************************************************************
*   Register() supports binary registers up to 31 bits in width. Where
*   applicable, this constructor is more efficient than LongRegister(),
*   since it can use Javascript bitmask operators, which are limited to
*   operating on 32-bit SIGNED integers.
***********************************************************************/
var Register = Compose(function(width, value) {
    this.width = (width > this.maxBits ? this.maxBits : width);
    this.mask = Register.mask2[this.width];
    this.modulus = Register.pow2[this.width];
    this.bits = (value ? value % this.modulus : 0);  // initial register value
},{
    maxBits: 31,                        // maximum register size

    isolate: function(start, width) {
        var ue = this.width-start;      // upper power exponent
        var le = ue-width;              // lower power exponent

        return (le > 0 ? this.bits >>> le : this.bits) & Register.mask2[width];
    },

    bit: function(bit) {
        var e = this.width - bit - 1;

        return (e > 0 ? this.bits >>> e : this.bits) & 1;
    },

    insert: function(start, width, value) {
        var ue = this.width-start;      // upper power exponent
        var le = ue-width;              // lower power exponent

        this.bits = (this.bits & ((this.mask & ~Register.mask2[ue]) | Register.mask2[le])) |
                    ((value & Register.mask2[width]) << le);
    },

    bitSet: function(bit) {
        this.bits |= Register.pow2[bit];
    },

    bitReset: function(bit) {
        this.bits &= ~Register.pow2[bit];
    },

    add: function(value) {
        var temp = this.bits + value;

        this.bits = (temp < 0 ? (this.modulus + temp) : temp) & this.mask;
    },

    sub: function(value) {
        var temp = this.bits - value;

        this.bits = (temp < 0 ? (this.modulus + temp) : temp) & this.mask;
    },

    set: function(value) {
        this.bits = (value < 0 ? -value : value) & this.mask;
    },

    valueOf: function() {
        return this.bits;
    },

    toString: function(radix) {
        return this.bits.toString(radix)
    }
});

Register.pow2 = [ // powers of 2 from 0 to 52
                       1,               2,                4,                8,
                      16,              32,               64,              128,
                     256,             512,             1024,             2048,
                    4096,            8192,            16384,            32768,
                   65536,          131072,           262144,           524288,
                 1048576,         2097152,          4194304,          8388608,
                16777216,        33554432,         67108864,        134217728,
               268435456,       536870912,       1073741824,       2147483648,
              4294967296,      8589934592,      17179869184,      34359738368,
             68719476736,    137438953472,     274877906944,     549755813888,
           1099511627776,   2199023255552,    4398046511104,    8796093022208,
          17592186044416,  35184372088832,   70368744177664,  140737488355328,
         281474976710656, 562949953421312, 1125899906842624, 2251799813685248,
        4503599627370496];

Register.mask2 = [ // (2**n)-1 for n from 0 to 52
                       0,               1,                3,                7,
                      15,              31,               63,              127,
                     255,             511,             1023,             2047,
                    4095,            8191,            16383,            32767,
                   65535,          131071,           262143,           524287,
                 1048575,         2097151,          4194303,          8388607,
                16777215,        33554431,         67108863,        134217727,
               268435455,       536870911,       1073741823,       2147483647,
              4294967295,      8589934591,      17179869183,      34359738367,
             68719476735,    137438953471,     274877906943,     549755813887,
           1099511627775,   2199023255551,    4398046511103,    8796093022207,
          17592186044415,  35184372088831,   70368744177663,  140737488355327,
         281474976710655, 562949953421311, 1125899906842623, 2251799813685247,
        4503599627370495];


/***********************************************************************
*   LongRegister() supports binary registers up to 52 bits in width.
*   Since Javascript bitmask operators only with up to 32 bits, this
*   contructor must use div/mod operations to manipulate the bit fields.
***********************************************************************/
var LongRegister = Compose(Register, {
    maxBits: 52,                        // maximum register size

    isolate: function(start, width) {
        var ue = this.width-start;      // upper power exponent
        var le = ue-width;              // lower power exponent

        return (le > 0 ? Math.floor(this.bits/Register.pow2[le]) : this.bits) % Register.pow2[width];
    },

    bit: function(bit) {
        var e = this.width - bit - 1;

        return (e > 0 ? Math.floor(this.bits/Register.pow2[e]) : this.bits) % 2;
    },

    insert: function(start, width, value) {
        var ue = this.width-start;      // upper power exponent
        var le = ue-width;              // lower power exponent
        var tpower;                     // top portion power of 2
        var bpower = Register.pow2[le]; // bottom portion power of 2
        var top = 0;                    // unaffected top portion of register
        var bottom = 0;                 // unaffected bottom portion of register

        if (start > 0) {
            tpower = Register.pow2[ue];
            top = Math.floor(this.bits/tpower)*tpower;
        }
        if (le > 0) {
            bottom = this.bits % bpower;
        }
        this.bits = (value % Register.pow2[width])*bpower + top + bottom;
    },

    bitSet: function(bit) {
        this.insert(bit, 1, 1);
    },

    bitReset: function(bit) {
        this.insert(bit, 1, 0);
    },

    add: function(value) {
        var temp = this.bits + value;

        this.bits = (temp < 0 ? (this.modulus + temp) : temp) % this.modulus;
    },

    sub: function(value) {
        var temp = this.bits - value;

        this.bits = (temp < 0 ? (this.modulus + temp) : temp) % this.modulus;
    },

    set: function(value) {
        this.bits = (value < 0 ? -value : value) % this.modulus;
    }
});

exports.Register = Register;
exports.LongRegister = LongRegister;
});