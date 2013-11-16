/***********************************************************************
* retro-b5500/webUI B5500SetCallback.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 universal function call-back module.
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
* delay is above that threshold.
*
* Even though this mechanism may execute the call-back function sooner than the
* requested delay specifies, the timing and throttling mechanisms in the
* emulator will correct for that in subsequent delay cycles. We are going for
* good average behavior, and quick call-backs are better than consistently
* too-long callbacks in this environment, so that I/Os can be initiated and
* their finish detected in finer-grained time increments.
*
* The SetCallback mechanism defines two functions, which become members of the
* global (window) object:
*
*   cookie = setCallback(fcn, context, delay, args...)
*
*       Requests that the function "fcn" be called after "delay" milliseconds.
*       The function will be called as a method of "context", passing the
*       list of arguments "args...". The call-back "fcn" may be called
*       earlier or later than the specified delay. setCallBack returns a
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
* Stole a little of their code, too.
*
************************************************************************
* 2013-08-04  P.Kimpel
*   Original version, cloned from B5500DiskUnit.js.
***********************************************************************/
"use strict";

(function (global) {
    /* Define a closure for the setCallback() mechanism */
    var minTimeout = 4;                 // minimum setTimeout() threshold, milliseconds
    var nextCookieNr = 1;               // next setCallback cookie return value
    var pendingCallbacks = {};          // hash of pending callbacks, indexed by cookie as a string
    var secretPrefix = "com.google.code.p.retro-b5500.webUI." + new Date().getTime().toString(16);

    /**************************************/
    function activateCallback(cookieName) {
        /* Activates a callback after its delay period has expired */
        var thisCallback;

        if (cookieName in pendingCallbacks) {
            thisCallback = pendingCallbacks[cookieName];
            delete pendingCallbacks[cookieName];
            try {
                thisCallback.fcn.apply(thisCallback.context, thisCallback.args);
            } catch (err) {
                console.log("B5500SetCallback.activateCallback: " + err);
            }
        }
    }

    /**************************************/
    function clearCallback(cookie) {
        /* Disables a pending callback, if it still exists and is still pending */
        var cookieName = cookie.toString();
        var thisCallback;

        if (cookieName in pendingCallbacks) {
            thisCallback = pendingCallbacks[cookieName];
            delete pendingCallbacks[cookieName];
            if (thisCallback.cancelToken) {
                if (thisCallback.type == 2) {
                    global.clearTimeout(thisCallback.cancelToken);
                }
            }
        }
    }

    /**************************************/
    function setCallback(fcn, context, callbackDelay, args) {
        /* Sets up and schedules a callback for function "fcn", called with context
        "context", after a delay of "delay" ms. Any "args" will be passed to "fcn".
        If the delay is less than "minTimeout", a setImmediate-like mechanism based on
        window.postsMessage() will be used; otherwise the environment's standard
        setTimeout mechanism will be used */
        var delay = callbackDelay || 0;
        var cookie = nextCookieNr++;
        var cookieName = cookie.toString();
        var thisCallback = {
            args: null,
            fcn: fcn,
            context: context || this,
        };

        pendingCallbacks[cookieName] = thisCallback;
        if (arguments.length > 3) {
          thisCallback.args = Array.slice(arguments, 3);
        }

        if (delay < minTimeout) {
            thisCallback.type = 1;
            global.postMessage(secretPrefix + cookieName, "*");
        } else {
            thisCallback.type = 2;
            thisCallback.cancelToken = global.setTimeout(activateCallback, delay, cookieName);
        }

        return cookie;
    }

    /**************************************/
    function onMessage(ev) {
        /* Handler for the global.onmessage event. Activates the callback */
        var cookieName;
        var payload;

        if (ev.source === global) {
            payload = ev.data.toString();
            if (payload.substring(0, secretPrefix.length) === secretPrefix) {
                cookieName = payload.substring(secretPrefix.length);
                activateCallback(cookieName);
            }
        }
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
