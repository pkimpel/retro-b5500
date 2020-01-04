/***********************************************************************
* retro-b5500/webUI B5500SetCallback.js
************************************************************************
* Copyright (c) 2013,2017, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 emulator universal function call-back module.
*
* Implements a combination setTimeout() and setImmediate() facility for the
* B5500 emulator web-based user interface. setCallback() is used in a manner
* similar to setTimeout(), except that for low values of the timeout parameter
* it merely yields control to any other pending events and timers before calling
* the call-back function.
*
* This facility is needed because modern browsers implement a minimum delay
* when calling setTimeout(). HTML5 specs require 4ms, but browsers vary in the
* minimum they use, and their precision in activating the call-back function
* once the actual delay is established varies even more. This module will use
* setTimeout() if the requested delay time is above a certain threshold, and
* a setImmediate-like mechanism (based on Promise) if the requested delay is
* below that threshold.
*
* To help compensate for the fact that the call-back function may be called
* sooner than requested, and that due either to other activity or to browser
* limitations the delay may be longer than requested, the timing behavior of
* setCallback() may be divided into "categories." For each category, a separate
* record is kept of the current total deviation between the requested delay and
* the actual delay. A portion of this deviation is then applied to the requested
* delay on subsequent calls in an attempt to smooth out the differences. We are
* going for good average behavior here, and some too-quick call-backs are better
* than consistently too-long callbacks in this environment, particularly so that
* I/Os can be initiated and their finish detected in finer-grained time increments.
*
* The SetCallback mechanism defines three functions that become members of the
* global (window) object:
*
*   token = setCallback(category, context, delay, fcn[, arg])
*
*       Requests that the function "fcn" be called after "delay" milliseconds.
*       The function will be called as a method of "context", passing a
*       single optional argument "arg". The call-back "fcn" may be called
*       earlier or later than the specified delay. The string "category" (which
*       may be empty, null, or undefined) defines the category under which the
*       average delay difference will be maintained. setCallBack returns a
*       numeric token identifying the call-back event, which can be used with
*       clearCallback() to cancel the callback. Note that passing a string in
*       lieu of a function object is not permitted.
*
*   clearCallBack(token)
*
*       Cancels a pending call-back event, if in fact it is still pending.
*       The "token" parameter is a value returned from setCallback().
*
*   object = getCallbackState(optionMask)
*
*       This is a diagnostic function intended for use in monitoring the callback
*       mechanism. It returns an object that, depending upon bits set in its mask
*       parameter, contains copies of the lastTokenNr value, poolLength
*       value, current delayDev hash, pendingCallbacks hash, and pool array.
*       The optionMask parameter supports the following bit values:
*           bit 0x01: delayDev hash
*           bit 0x02: pendingCallbacks hash
*           bit 0x04: pool array
*       The lastTokenNr and poolLength values are always returned. If no mask
*       is supplied, no additional items are returned.
*
* This implementation has been inspired by Domenic Denicola's shim for the
* setImmediate() API at https://github.com/NobleJS/setImmediate, and
* David Baron's setZeroTimeout() implemenmentation described in his blog
* at http://dbaron.org/log/20100309-faster-timeouts.
*
* I stole a little of their code, too.
*
************************************************************************
* 2013-08-04  P.Kimpel
*   Original version, cloned from B5500DiskUnit.js.
* 2014-04-05  P.Kimpel
*   Change calling sequence to add "category" parameter; reorder setCallback
*   parameters into a more reasonable sequence; implement call-back pooling.
* 2014-12-14  P.Kimpel
*   Added getCallbackState() diagnostic function, changed "cookie" to "token".
* 2015-08-09  P.Kimpel
*   Implement new method of delay deviation accounting and delay adjustment.
* 2017-11-23  P.Kimpel
*   Redesign yet again the delay adjustment mechanism with one from the
*   retro-205  project. Replace window.postMessage yield mechanism with one
*   from the retro-220 project based on Promise().
* 2018-07-05  P.Kimpel
*   Simplify delay and deviation adjustment algorithm.
***********************************************************************/
"use strict";

(function (global) {
    /* Define a closure for the setCallback() mechanism */
    var delayDev = {NUL: 0};            // hash of delay time deviations by category
    var minTimeout = 4;                 // minimum setTimeout() threshold, milliseconds
    var lastTokenNr = 0;                // last setCallback token return value
    var pendingCallbacks = {};          // hash of pending callbacks, indexed by token as a string
    var perf = global.performance;      // cached window.performance object
    var pool = [];                      // pool of reusable callback objects
    var poolLength = 0;                 // length of active entries in pool

    /**************************************/
    function activateCallback(token) {
        /* Activates a callback after its delay period has expired */
        var endStamp = perf.now();
        var thisCallback;
        var tokenName = token.toString();

        thisCallback = pendingCallbacks[tokenName];
        if (thisCallback) {
            delete pendingCallbacks[tokenName];
            delayDev[thisCallback.category] += endStamp - thisCallback.startStamp - thisCallback.delay;
            try {
                thisCallback.fcn.call(thisCallback.context, thisCallback.arg);
            } catch (err) {
                console.log("B5500SetCallback.activateCallback: " + err.name + ", " + err.message);
            }

            thisCallback.context = null;
            thisCallback.fcn = null;
            thisCallback.arg = null;
            pool[poolLength++] = thisCallback;
        }
    }

    /**************************************/
    function clearCallback(token) {
        /* Disables a pending callback, if it still exists and is still pending */
        var thisCallback;
        var tokenName = token.toString();

        thisCallback = pendingCallbacks[tokenName];
        if (thisCallback) {
            delete pendingCallbacks[tokenName];
            if (thisCallback.cancelToken) {
                global.clearTimeout(thisCallback.cancelToken);
            }

            thisCallback.context = null;
            thisCallback.fcn = null;
            thisCallback.arg = null;
            pool[poolLength++] = thisCallback;
        }
    }

    /**************************************/
    function setCallback(category, context, callbackDelay, fcn, arg) {
        /* Sets up and schedules a callback for function "fcn", called with context
        "context", after a delay of "delay" ms. An optional "arg" value will be passed
        to "fcn". If the delay is less than "minTimeout", a setImmediate-like mechanism
        based on DOM Promise() will be used; otherwise the environment's standard
        setTimeout mechanism will be used */
        var categoryName = (category || "NUL").toString();
        var delay = callbackDelay || 0; // actual delay to be generated
        var delayBias = 0;              // current amount of delay deviation
        var thisCallback = null;        // call-back object to be used
        var token = ++lastTokenNr;      // call-back token number
        var tokenName = token.toString(); // call-back token ID

        // Allocate a call-back object from the pool.
        if (poolLength <= 0) {
            thisCallback = {};
        } else {
            thisCallback = pool[--poolLength];
            pool[poolLength] = null;
        }

        // Fill in the call-back object and tank it in pendingCallbacks.
        thisCallback.startStamp = perf.now();
        thisCallback.category = categoryName;
        thisCallback.delay = delay;
        thisCallback.context = context || this;
        thisCallback.fcn = fcn;
        thisCallback.arg = arg;
        pendingCallbacks[tokenName] = thisCallback;

        // Adjust the requested delay based on the current delay deviation
        // for this category.
        delayBias = delayDev[categoryName];
        if (!delayBias) {
            delayDev[categoryName] = 0;         // bias was zero, or got a new one: no adjustment
        } else {
            if (delayBias > 0) {
                // We are delaying too much and should try to delay less.
                if (delay > 0) {        // don't make a negative delay any more so
                    delay -= Math.min(delay, delayBias, minTimeout);
                }
            } else { // delayBias <= 0
                // We are delaying too little and should try to delay more.
                if (delay < 0) {
                    delay -= Math.max(delay, delayBias);
                } else {
                    delay += Math.min(-delayBias, minTimeout);
                }
            }
        }

        // Decide whether to do a time wait or just a yield.
        if (delay > minTimeout) {
            thisCallback.cancelToken = global.setTimeout(activateCallback, delay, token);
        } else {
            thisCallback.cancelToken = 0;
            Promise.resolve(token).then(activateCallback);
        }

        return token;
    }

    /**************************************/
    function getCallbackState(optionMask) {
        /* Diagnostic function. Returns an object that, depending upon bits in
        the option mask, contains copies of the lastTokenNr value, poolLength
        value, current delayDev hash, pendingCallbacks hash, and pool array.
            bit 0x01: delayDev hash
            bit 0x02: pendingCallbacks hash
            bit 0x04: pool array
        If no mask is supplied, no additional items are returned */
        var e;
        var mask = optionMask || 0;
        var state = {
            lastTokenNr: lastTokenNr,
            poolLength: poolLength,
            delayDev: {},
            pendingCallbacks: {},
            pool: []};

        if (mask & 0x01) {
            for (e in delayDev) {
                state.delayDev[e] = delayDev[e];
            }
        }
        if (mask & 0x02) {
            for (e in pendingCallbacks) {
                state.pendingCallbacks[e] = pendingCallbacks[e];
            }
        }
        if (mask & 0x04) {
            for (e=0; e<poolLength; ++e) {
                state.pool[e] = pool[e];
            }
        }

        return state;
    }

    /********** Outer block of anonymous closure **********/
    if (!global.setCallback && !global.importScripts) {
        // Attach to the prototype of global, if possible, otherwise to global itself
        var attachee = global;

        /*****
        if (typeof Object.getPrototypeOf === "function") {
            if ("setTimeout" in Object.getPrototypeOf(global)) {
                attachee = Object.getPrototypeOf(global);
            }
        }
        *****/

        attachee.setCallback = setCallback;
        attachee.clearCallback = clearCallback;
        attachee.getCallbackState = getCallbackState;
    }
}(typeof global === "object" && global ? global : this));
