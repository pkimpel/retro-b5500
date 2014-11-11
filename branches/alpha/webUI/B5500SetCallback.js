/***********************************************************************
* retro-b5500/webUI B5500SetCallback.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 emulator universal function call-back module.
*
* Implements a combination setTimeout() and setImmediate() facility for the
* B5500 emulator web-based user interface. setCallback() is used the same way
* that setTimeout() is used, except that for low values of the timeout parameter,
* it merely yields control to any other pending events and timers before calling
* the call-back function.
*
* This facility is needed because modern browsers implement a minimum delay
* when calling setTimeout(). HTML5 specs require 4ms, but on Microsoft Windows
* systems (at least through Win7), the minimum precision of setTimeout() is
* about 15ms, unless you are running Google Chrome. This module will use
* setTimeout() if the requested delay time is above a certain threshold, and
* a setImmediate()-like mechanism (based on window.postMessage) if the requested
* delay is below that threshold.
*
* To help compensate for the fact that the call-back function may be called
* sooner than requested, and that due to either other activity or browser
* limitations the delay may be longer than requested, the timing behavior of
* setCallback() may be divided into "categories." For each category, a separate
* record is kept of the exponential-moving-average difference between the
* requested delay and the actual delay. This difference is used to adjust the
* requested delay on subsequent calls in an attempt to smooth out the differences.
* We are going for good average behavior here, and quick call-backs are better
* than consistently too-long callbacks in this environment, so that I/Os can be
* initiated and their finish detected in finer-grained time increments.
*
* The SetCallback mechanism defines two functions, which become members of the
* global (window) object:
*
*   cookie = setCallback(category, context, delay, fcn[, arg])
*
*       Requests that the function "fcn" be called after "delay" milliseconds.
*       The function will be called as a method of "context", passing a
*       single optional argument "arg". The call-back "fcn" may be called
*       earlier or later than the specified delay. The string "category" (which
*       may be empty, null, or undefined) defines the category under which the
*       average delay difference will be maintained. setCallBack returns a
*       numeric token identifying the call-back event, which can be used
*       with clearCallback(). Note that passing a string in lieu of a function
*       object is not permitted.
*
*   clearCallBack(cookie)
*
*       Cancels a pending call-back event, if in fact it is still pending.
*       The "cookie" parameter is a value returned from setCallback().
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
***********************************************************************/
"use strict";

(function (global) {
    /* Define a closure for the setCallback() mechanism */
    var delayAlpha = 0.99;              // exponential-moving-average decay factor
    var delayDev = {NUL: 0};            // hash of average delay time deviations by category
    var minTimeout = 4;                 // minimum setTimeout() threshold, milliseconds
    var nextCookieNr = 1;               // next setCallback cookie return value
    var pendingCallbacks = {};          // hash of pending callbacks, indexed by cookie as a string
    var perf = global.performance;      // cached window.performance object
    var pool = [];                      // pool of reusable callback objects
    var poolLength = 0;                 // length of active entries in pool
    var secretPrefix = "com.google.code.p.retro-b5500.webUI." + Date.now().toString(16);

    /**************************************/
    function activateCallback(cookie) {
        /* Activates a callback after its delay period has expired */
        var category;
        var cookieName = cookie.toString();
        var endStamp = perf.now();
        var thisCallback;

        thisCallback = pendingCallbacks[cookieName];
        if (thisCallback) {
            delete pendingCallbacks[cookieName];
            category = thisCallback.category;
            if (category) {
                delayDev[category] = (delayDev[category] || 0)*delayAlpha +
                    (endStamp - thisCallback.startStamp - thisCallback.delay)*(1.0-delayAlpha);
            }
            try {
                thisCallback.fcn.call(thisCallback.context, thisCallback.arg);
            } catch (err) {
                console.log("B5500SetCallback.activateCallback: " + err.name + ", " + err.message);
            }

            thisCallback.context = null;
            thisCallback.fcn = null;
            pool[poolLength++] = thisCallback;
        }
    }

    /**************************************/
    function clearCallback(cookie) {
        /* Disables a pending callback, if it still exists and is still pending */
        var cookieName = cookie.toString();
        var thisCallback;

        thisCallback = pendingCallbacks[cookieName];
        if (thisCallback) {
            delete pendingCallbacks[cookieName];
            if (thisCallback.isTimeout) {
                if (thisCallback.cancelToken) {
                    global.clearTimeout(thisCallback.cancelToken);
                }
            }

            thisCallback.context = null;
            thisCallback.fcn = null;
            pool[poolLength++] = thisCallback;
        }
    }

    /**************************************/
    function _setCallback_Old(fcn, context, callbackDelay, arg) {
        /* Sets up and schedules a callback for function "fcn", called with context
        "context", after a delay of "delay" ms. An optional "arg" value will be passed
        to "fcn". If the delay is less than "minTimeout", a setImmediate-like mechanism
        based on window.postsMessage() will be used; otherwise the environment's standard
        setTimeout mechanism will be used */
        var delay = callbackDelay || 0;
        var cookie = nextCookieNr++;
        var cookieName = cookie.toString();
        var thisCallback;

        if (poolLength > 0) {
            thisCallback = pool[--poolLength];
            pool[poolLength] = null;
        } else {
            thisCallback = {};
        }

        thisCallback.startStamp = perf.now();
        thisCallback.category = "NUL";
        thisCallback.context = context || this;
        thisCallback.delay = delay;
        thisCallback.fcn = fcn;
        thisCallback.arg = arg;
        pendingCallbacks[cookieName] = thisCallback;

        if (delay < minTimeout) {
            thisCallback.isTimeout = false;
            global.postMessage(secretPrefix + cookieName, "*");
            thisCallback.cancelToken = 0;
        } else {
            thisCallback.isTimeout = true;
            thisCallback.cancelToken = global.setTimeout(activateCallback, delay, cookie);
        }

        return cookie;
    }

    /**************************************/
    function setCallback(category, context, callbackDelay, fcn, arg) {
        /* Sets up and schedules a callback for function "fcn", called with context
        "context", after a delay of "delay" ms. An optional "arg" value will be passed
        to "fcn". If the delay is less than "minTimeout", a setImmediate-like mechanism
        based on window.postsMessage() will be used; otherwise the environment's standard
        setTimeout mechanism will be used */
        var categoryName = (category || "NUL").toString();
        var cookie = nextCookieNr++;
        var cookieName = cookie.toString();
        var delay = callbackDelay || 0;
        var thisCallback;

        // Allocate a call-back object from the pool.
        if (poolLength <= 0) {
            thisCallback = {};
        } else {
            thisCallback = pool[--poolLength];
            pool[poolLength] = null;
        }

        // Fill in the object and tank it in pendingCallbacks.
        thisCallback.startStamp = perf.now();
        thisCallback.category = categoryName;
        thisCallback.context = context || this;
        thisCallback.delay = (delay < 0 ? 0 : delay);
        thisCallback.fcn = fcn;
        thisCallback.arg = arg;

        pendingCallbacks[cookieName] = thisCallback;

        // Decide whether to do a time wait or just a yield.
        if (delay >= minTimeout) {
            thisCallback.isTimeout = true;
            thisCallback.cancelToken = global.setTimeout(activateCallback,
                    delay - (delayDev[categoryName] || 0), cookie);
        } else {
            thisCallback.isTimeout = false;
            global.postMessage(secretPrefix + cookieName, "*");
            thisCallback.cancelToken = 0;
        }

        return cookie;
    }

    /**************************************/
    function onMessage(ev) {
        /* Handler for the global.onmessage event. Activates the callback */
        var payload;

        // if (ev.source === global) {
            payload = ev.data.toString();
            if (payload.substring(0, secretPrefix.length) === secretPrefix) {
                activateCallback(payload.substring(secretPrefix.length));
            }
        // }
    }

    /********** Outer block of anonymous closure **********/
    if (!global.setCallback && global.postMessage && !global.importScripts) {
        // Attach to the prototype of global, if possible, otherwise to global itself
        var attachee = global;

        /*****
        if (typeof Object.getPrototypeOf === "function") {
            if ("setTimeout" in Object.getPrototypeOf(global)) {
                attachee = Object.getPrototypeOf(global);
            }
        }
        *****/

        global.addEventListener("message", onMessage, false);
        attachee.setCallback = setCallback;
        attachee.clearCallback = clearCallback;
    }
}(typeof global === "object" && global ? global : this));
