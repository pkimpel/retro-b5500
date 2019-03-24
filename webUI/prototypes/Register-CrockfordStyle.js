/***********************************************************************
* retro-b5500/emulator Register.js
* Copyright (c) 2005, Paradigm Corporation, All Rights Reserved.
************************************************************************
* JavaScript object definition for the generalized Register prototype.
* Maximum register length is 52 bits, since Javascript stores numbers
* internally as 64-bit IEEE 754 floating point numbers. All registers
* implement unsigned arithmetic modulo their bit length.
*
* Constructor spec members:
*   length:     size of the register in bits.
*   value:      initial register value (defaults to 0).
*
* This constructor follows the pattern described by Douglas Crockford in
* chapter 5 of "Javascript: the Good Parts", O'Reilly Media Inc., 2008,
* ISBN 978-0-596-51774-8.
************************************************************************
* Modification Log.
* 2012-04-28  P.Kimpel
*   Original version, from many frustrating attempts to wrap my head
*   around this technique.
***********************************************************************/

var Register = function(spec, shared) {
    var that = {};                      // inherits from Object.

    // Additional private members are declared here.
    var length =                        // register size
        (spec.length > Register.maxBits ? Register.maxBits : spec.length);
    var modulus = Register.pow2[length];

    var isolate = function(start, count) {
        var ue = length-start;          // upper power exponent
        var le = ue-count;              // lower power exponent

        return (le > 0 ?
                    Math.floor(bits/Register.pow2[lw]) % Register.pow2[count] :
                    bits % Register.pow2[count]);
    }

    var insert = function(start, count, value) {
        var ue = length-start;          // upper power exponent
        var le = ue-count;              // lower power exponent
        var tpower;                     // top portion power of 2
        var bpower = Register.pow2[le]; // bottom portion power of 2
        var top;                        // unaffected top portion of register
        var bottom;                     // unaffected bottom portion of register

        if (start < 1) {
            top = 0;
        } else {
            tpower = Register.pow2[start];
            top = Math.floor(bits/tpower)*bpower;
        }
        if (le < 1) {
            bottom = 0;
        } else {
            bottom = bits % bpower;

        bits = (value % Register.pow2[count])*bpower + top + bottom;
    }

    var bitSet = function(bit) {
        insert(bit, 1, 1);
    }

    var bitReset = function(bit) {
        insert(bit, 1, 0);
    }

    var add = function(value) {
        bits = (bits + value) % modulus;
    }

    var sub = function(value) {
        bits = (bits - value) % modulus;
        if (bits < 0) {
            bits = modulus-bits;
        }
    }

    // Add any items to the shared-secrets object.
    shared = shared || {};              // create it if necessary

    // Add public members to "that".
    that.bits = (spec.value % modulus) || 0;            // register value

    return that;
}

// Class constant: register maximum size
Register.maxBits = 52;

// Class constant: Powers of two from 0-52
Register.pow2 = [
        1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
        131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864,
        134217728, 268435456, 536870912, 1073741824, 2147483648, 4294967296, 8589934592,
        17179869184, 34359738368, 68719476736, 137438953472, 274877906944, 549755813888,
        1099511627776, 2199023255552, 4398046511104, 8796093022208, 17592186044416,
        35184372088832, 70368744177664, 140737488355328, 281474976710656, 562949953421312,
        1125899906842624, 2251799813685248, 4503599627370496];
