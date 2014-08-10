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
function B5500Util() {}

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
