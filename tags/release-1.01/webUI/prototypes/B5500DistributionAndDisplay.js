/***********************************************************************
* retro-b5500/emulator B5500DistributionAndDisplay.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the B5500 Distribution & Display module.
************************************************************************
* 2012-06-16  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500DistributionAndDisplay(cc) {
    /* Constructor for the Distribution And Display module object */

    this.cc = cc;                       // Reference back to Centrol Control module

    /* Global system modules */

    this.nextRefresh = 0;               // Next actual Date.getTime() expected
    this.timer = null;                  // Reference to the RTC setTimeout id.

    this.panels = {};                   // D&D panel object collection

    this.updateDisplay.that = this;     // Establish contexts for when called from setTimeout().

    this.clear();                       // Create and initialize the Central Control state
}

/**************************************/
    /* Global constants */

B5500DistributionAndDisplay.prototype.refreshPeriod = 50; // milliseconds

/**************************************/
B5500DistributionAndDisplay.prototype.clear = function() {
    /* Initializes the displays and starts the refresh timer */

    if (this.timer) {
        clearTimeout(this.timer);
    }

    this.nextTimeStamp = new Date().getTime() + this.refreshPeriod;
    this.timer = setTimeout(this.tock, this.refreshPeriod);
    }
};

/**************************************/
B5500DistributionAndDisplay.prototype.openProcessorPanel = function(p, caption) {
    /* Creates a D&D panel window for a processor */
    var x;
    var panel = this.panels[caption];

    if (panel) {
        win = panel.window;
    } else {
        win = window.open("B5500ProcessorPanel.html", "P"+caption,
                          "resizable=yes,scrollbars=yes");
        panel = {module:p, window:win, caption:caption};
        this.panels[caption] = panel;
    }
};

/**************************************/
B5500DistributionAndDisplay.prototype.updateDisplay = function updateDisplay() {
    /* Schedules itself to update the display on a periodic basis. */
    var delayTime;
    var that = updateDisplay.that;
    var thisTime = new Date().getTime();

    // Schedule ourself for the next refresh period
    that.nextRefresh += that.refreshPeriod;
    delayTime = that.nextRefresh - thisTime;
    that.timer = setTimeout(that.updateDisplay, (delayTime < 0 ? 1 : delayTime);
};