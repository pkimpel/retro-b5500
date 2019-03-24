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
B5500Util.popupOpenDelayIncrement = 250;// increment for pop-up open delay adjustment, ms
B5500Util.popupOpenDelay = 500;         // current pop-up open delay, ms
B5500Util.popupOpenQueue = [];          // queue of pop-up open argument objects

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
B5500Util.octize = function octize(v, n) {
    /* Converts "v" to an octal digit string and truncates or pads with zeroes
    on the left as necessary to make a string of length "n" */
    var s = v.toString(8);
    var z = s.length;

    if (z > n) {
        s = s.substring(z-n);
    } else {
        while (z < n) {
           ++z;
           s = "0" + s;
        }
    }

    return s;
};

/**************************************/
B5500Util.pic9n = function pic9n(v, n) {
    /* Converts "v" to a trimmed string and truncates or pads with zeroes on
    the left as necessary to make a string of length "n" */
    var s = v.toString().trim();
    var z = s.length;

    if (z > n) {
        s = s.substring(z-n);
    } else {
        while (z < n) {
            ++z;
            s = "0" + s;
        }
    }

    return s;
};

/**************************************/
B5500Util.picXn = function picXn(v, n) {
    /* Converts "v" to a trimmed string and truncates or pads with spaces on
    the right as necessary to make a string of length "n" */
    var s = v.toString().trim();
    var z = s.length;

    if (z > n) {
        s = s.substring(0, n);
    } else {
        while (z < n) {
            ++z;
            s += " ";
        }
    }

    return s;
};

/**************************************/
B5500Util.picZn = function picZn(v, n) {
    /* Converts "v" to a trimmed string and truncates or pads with spaces on
    the left as necessary to make a string of length "n" */
    var s = v.toString().trim();
    var z = s.length;

    if (z > n) {
        s = s.substring(z-n);
    } else {
        while (z < n) {
            ++z;
            s = " " + s;
        }
    }

    return s;
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

/**************************************/
B5500Util.openPopup = function openPopup(parent, url, windowName, options, context, onload) {
    /* Schedules the opening of a pop-up window so that browsers such as Apple
    Safari (11.0+) will not block the opens if they occur too close together.
    Parameters:
        parent:     parent window for the pop-up
        url:        url of window context, passed to window.open()
        windowName: internal name of the window, passed to window.open()
        options:    string of window options, passed to window.open()
        context:    object context ("this") for the onload function (may be null)
        onload:     event handler for the window's onload event (may be null).
    If the queue of pending pop-up opens in B5500Util.popupOpenQueue[] is empty,
    then attempts to open the window immediately. Otherwise queues the open
    parameters, which will be dequeued and acted upon after the previously-
    queued entries are completed by B5500Util.dequeuePopup() */

    B5500Util.popupOpenQueue.push({
        parent: parent,
        url: url,
        windowName: windowName,
        options: options,
        context: context,
        onload: onload});
    if (B5500Util.popupOpenQueue.length == 1) { // queue was empty
        B5500Util.dequeuePopup();
    }
};

/**************************************/
B5500Util.dequeuePopup = function dequeuePopup() {
    /* Dequeues a popupOpenQueue[] entry and attempts to open the pop-up window.
    Called either directly by B5500Util.openPopup() when an entry is inserted
    into an empty queue, or by setTimeout() after a delay. If the open fails,
    the entry is reinserted into the head of the queue, the open delay is
    incremented, and this function is rescheduled for the new delay. If the
    open is successful, and the queue is non-empty, then this function is
    scheduled for the current open delay to process the next entry in the queue */
    var entry = B5500Util.popupOpenQueue.shift();
    var loader1 = null;
    var loader2 = null;
    var win = null;

    if (entry) {
        try {
            win = entry.parent.open(entry.url, entry.windowName, entry.options);
        } catch (e) {
            win = null;
        }

        if (!win) {                     // window open failed, requeue
            B5500Util.popupOpenQueue.unshift(entry);
            B5500Util.popupOpenDelay += B5500Util.popupOpenDelayIncrement;
            setTimeout(B5500Util.dequeuePopup, B5500Util.popupOpenDelay);
            //console.log("Pop-up open failed: " + entry.windowName + ", new delay=" + B5500Util.popupOpenDelay + "ms");
        } else {                        // window open was successful
            if (entry.onload) {
                loader1 = entry.onload.bind(entry.context);
                win.addEventListener("load", loader1, false);
            }

            loader2 = function(ev) {    // remove the load event listeners after loading
                win.removeEventListener("load", loader2, false);
                if (loader1) {
                    win.removeEventListener("load", loader1, false);
                }
            };

            win.addEventListener("load", loader2, false);
            if (B5500Util.popupOpenQueue.length > 0) {
                setTimeout(B5500Util.dequeuePopup, B5500Util.popupOpenDelay);
            }
        }
    }
};