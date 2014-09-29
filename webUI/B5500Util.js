/***********************************************************************
* retro-b5500/emulator B5500Util.js
************************************************************************
* Copyright (c) 2012-2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 emulator common Javascript utilities module.
************************************************************************
* 2014-07-26  P.Kimpel
*   Original version, from various existing scripts.
***********************************************************************/
"use strict";

/**************************************/
function B5500Util() {
    /* Constructor for the B5500Util object */
    // Nothing to construct at present...
}

/**************************************/
B5500Util.xlateASCIIToAlgolRex =        // For translation of BIC-as-ASCII to Unicode Algol glyphs
        /[^\r\n\xA0 "#$%&()*+,\-./0-9:;<=>?@A-Z\[\]a-z\u00D7\u2190\u2260\u2264\u2265]/g;
B5500Util.xlateASCIIToAlgolGlyph = {
        "!": "\u2260",  // not-equal
        "_": "\u2190",  // Sid McHarg's left-arrow
        "{": "\u2264",  // less-than-or-equal
        "|": "\u00D7",  // multiply (x)
        "}": "\u2265",  // greater-than-or-equal
        "~": "\u2190"}; // left-arrow

B5500Util.xlateAlgolToASCIIRex =        // For translation of Unicode Algol glyphs to BIC-as-ASCII
        /[^\r\n\xA0 !"#$%&()*+,\-./0-9:;<=>?@A-Z\[\]a-z{|}~]/g;
B5500Util.xlateAlgolToASCIIGlyph = {
        "_":      "~",  // Sid McHarg's left-arrow
        "\u00D7": "|",  // multiply (x)
        "\u2190": "~",  // left-arrow
        "\u2260": "!",  // not-equal
        "\u2264": "{",  // less-than-or-equal
        "\u2265": "}"}; // greater-than-or-equal

/**************************************/
B5500Util.$$ = function $$(e) {
    return document.getElementById(e);
};

/**************************************/
B5500Util.hasClass = function hasClass(e, name) {
    /* returns true if element "e" has class "name" in its class list */
    var classes = e.className;

    if (!e) {
        return false;
    } else if (classes == name) {
        return true;
    } else {
        return (classes.search("\\b" + name + "\\b") >= 0);
    }
};

/**************************************/
B5500Util.addClass = function addClass(e, name) {
    /* Adds a class "name" to the element "e"s class list */

    if (!B5500Util.hasClass(e, name)) {
        e.className += (" " + name);
    }
};

/**************************************/
B5500Util.removeClass = function removeClass(e, name) {
    /* Removes the class "name" from the element "e"s class list */

    e.className = e.className.replace(new RegExp("\\b" + name + "\\b\\s*", "g"), "");
};

/**************************************/
B5500Util.deepCopy = function deepCopy(source, dest) {
    /* Performs a deep copy of the object "source" into the object "dest".
    If "dest" is null or undefined, simply returns a deep copy of "source".
    Note that this routine clones the primitive Javascript types, basic
    objects (hash tables), Arrays, Dates, RegExps, and Functions. Other
    types may be supported by extending the switch statement. Also note
    this is a static function.
    Adapted (with thanks) from the "extend" routine by poster Kamarey on 2011-03-26 at
    http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-an-object
    */
    var constr;
    var copy;
    var name;

    if (source === null) {
        return source;
    } else if (!(source instanceof Object)) {
        return source;
    } else {
        constr = source.constructor;
        if (constr !== Object && constr !== Array) {
            return source;
        } else {
            switch (constr) {
            case String:
            case Number:
            case Boolean:
            case Date:
            case Function:
            case RegExp:
                copy = new constr(source);
                break;
            default:
                copy = dest || new constr();
                break;
            }

            for (name in source) {
                copy[name] = deepCopy(source[name], null);
            }

            return copy;
        }
    }

    /********************************
    // Original version:
    // extends 'from' object with members from 'to'. If 'to' is null, a deep clone of 'from' is returned
    function extend(from, to)
    {
        if (from == null || typeof from != "object") return from;
        if (from.constructor != Object && from.constructor != Array) return from;
        if (from.constructor == Date || from.constructor == RegExp || from.constructor == Function ||
            from.constructor == String || from.constructor == Number || from.constructor == Boolean)
            return new from.constructor(from);

        to = to || new from.constructor();

        for (var name in from)
        {
            to[name] = typeof to[name] == "undefined" ? extend(from[name], null) : to[name];
        }

        return to;
    }
    ********************************/
};

/**************************************/
B5500Util.xlateToAlgolChar = function xlateToAlgolChar(c) {
    /* Translates one BIC-as-ASCII Algol glyph character to Unicode */

    return B5500Util.xlateASCIIToAlgolGlyph[c] || "?";
};

/**************************************/
B5500Util.xlateASCIIToAlgol = function xlateASCIIToAlgol(text) {
    /* Translates the BIC-as-ASCII characters in "text" to equivalent Unicode glyphs */

    return text.replace(B5500Util.xlateASCIIToAlgolRex, B5500Util.xlateToAlgolChar);
};

/**************************************/
B5500Util.xlateToASCIIChar = function xlateToASCIIChar(c) {
    /* Translates one Unicode Algol glyph to its BIC-as-ASCII equivalent */

    return B5500Util.xlateAlgolToASCIIGlyph[c] || "?";
};

/**************************************/
B5500Util.xlateAlgolToASCII = function xlateAlgolToASCII(text) {
    /* Translates the Unicode characters in "text" equivalent BIC-as-ASCII glyphs */

    return text.replace(B5500Util.xlateAlgolToASCIIRex, B5500Util.xlateToASCIIChar);
};

/**************************************/
B5500Util.xlateDOMTreeText = function xlateDOMTreeText(n, xlate) {
    /* If Node "n" is a text node, translates its value using the "xlate"
    function. For all other Node types, translates all subordinate text nodes */
    var kid;

    if (n.nodeType == Node.TEXT_NODE) {
        n.nodeValue = xlate(n.nodeValue);
    } else {
        kid = n.firstChild;
        while (kid) {
            xlateDOMTreeText(kid, xlate);
            kid = kid.nextSibling;
        }
    }
};
