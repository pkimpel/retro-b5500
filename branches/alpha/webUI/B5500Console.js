/***********************************************************************
* retro-b5500/emulator B5500Console.js
************************************************************************
* Copyright (c) 2012,2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Operations Console Javascript module.
*
* Implements event handlers and control functions for the B5500 emulator
* operations console.
*
************************************************************************
* 2014-07-20  P.Kimpel
*   Original version, extracted from B5500Console.html.
***********************************************************************/
"use strict";

window.addEventListener("load", function() {
    var consolePanel;
    var statusMsgTimer = 0;             // status message timer control cookie

    /**************************************/
    function clearStatusMsg(inSeconds) {
        /* Delays for "inSeconds" seconds, then clears the StatusMsg element */

        if (statusMsgTimer) {
            clearTimeout(statusMsgTimer);
        }

        statusMsgTimer = setTimeout(function(ev) {
            document.getElementById("StatusMsg").textContent = "";
            statusMsgTimer = 0;
        }, inSeconds*1000);
    }

    /**************************************/
    function checkBrowser() {
        /* Checks whether this browser can support the necessary stuff */
        var missing = "";

        if (!window.indexedDB) {missing += ", IndexedDB"}
        if (!window.ArrayBuffer) {missing += ", ArrayBuffer"}
        if (!window.DataView) {missing += ", DataView"}
        if (!window.Blob) {missing += ", Blob"}
        if (!window.File) {missing += ", File"}
        if (!window.FileReader) {missing += ", FileReader"}
        if (!window.FileList) {missing += ", FileList"}
        if (!window.postMessage) {missing += ", window.postMessage"}
        if (!(window.performance && "now" in performance)) {missing += ", performance.now"}

        if (missing.length == 0) {
            return true;
        } else {
            alert("The emulator cannot run...\n" +
                "your browser does not support the following features:\n\n" +
                missing.substring(2));
            return false;
        }
    }

    /***** window.onload() outer block *****/

    document.getElementById("EmulatorVersion").textContent = B5500CentralControl.version;
    if (checkBrowser()) {
        window.applicationCache.addEventListener("checking", function(ev) {
            document.getElementById("StatusMsg").textContent = "Checking for emulator update...";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("noupdate", function(ev) {
            document.getElementById("StatusMsg").textContent = "Emulator version is current.";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("obsolete", function(ev) {
            document.getElementById("StatusMsg").textContent = "Emulator off-line installation has been disabled.";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("downloading", function(ev) {
            document.getElementById("StatusMsg").textContent = "Initiating download for emulator update...";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("progress", function(ev) {
            var text = (ev.loaded && ev.total ? ev.loaded.toString() + "/" + ev.total.toString() : "Unknown number of");
            document.getElementById("StatusMsg").textContent = text + " resources downloaded thus far...";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("updateready", function(ev) {
            document.getElementById("StatusMsg").textContent = "Emulator update completed. Reload this page to activate the new version.";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("cached", function(ev) {
            document.getElementById("StatusMsg").textContent = "Emulator is now installed for off-line use.";
            clearStatusMsg(15);
        });
        window.applicationCache.addEventListener("error", function(ev) {
            document.getElementById("StatusMsg").textContent = "Browser reported error during emulator version check.";
            clearStatusMsg(15);
        });

        consolePanel = new B5500ConsolePanel(window);
    }
});
