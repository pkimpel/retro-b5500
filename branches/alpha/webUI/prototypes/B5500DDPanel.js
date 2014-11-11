/***********************************************************************
* retro-b5500/emulator B5500DDPanel.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the B5500 Distribution & Display panel
* utility constructors.
************************************************************************
* 2012-06-18  P.Kimpel
*   Original version, from thin air.
***********************************************************************/

/***********************************************************************
*  Panel Lamp                                                          *
***********************************************************************/
function B5500DDLamp(x, y) {
    /* Constructor for the lamp objects used within D&D. x & y are the
    coordinates of the lamp within its containing element */

    this.state = 0;                     // current lamp state, 0=off

    // visible DOM element
    this.element = document.createElement("div");
    this.element.className = "ddLamp";
    this.element.style.left = String(x) + "px";
    this.element.style.top = String(y) + "px";
}

/**************************************/

B5500DDLamp.lampClass = "ddLamp";
B5500DDLamp.litClass = "ddLamp ddLampLit";

/**************************************/
B5500DDLamp.prototype.set = function(v) {
    /* Changes the visible state of the lamp according to the low-order
    bit of "v". */
    var newState = v & 1;

    if (this.state ^ newState) {         // the state has changed
        this.element.className = (newState ? B5500Lamp.litClass : B5500Lamp.lampClass);
        this.state = newState;
    }
};

/**************************************/
B5500DDLamp.prototype.flip = function() {
    /* Complements the visible state of the lamp */
    var newState = this.state ^ 1;

    this.element.className = (newState ? B5500Lamp.litClass : B5500Lamp.lampClass);
    this.state = newState;
};

/**************************************/
B5500DDLamp.prototype.setCaption = function(caption) {
    /* Establishes an optional caption for a single lamp */
    var e = document.createElement("div");

    e.className = "ddLampCaption";
    e.appendChild(document.createTextNode(caption));
    this.element.appendChild(e);
};


/***********************************************************************
*  Panel Register                                                      *
***********************************************************************/
function B5500DDRegister(bits, x, y, rows, caption) {
    /* Constructor for the register objects used within D&D:
        bits:   number of bits in register
        x:      horizontal coordinate of upper-left corner [hSpacing increments]
        y:      vertical coordinate of upper-left corner [vSpacing increments]
        rows:   number of rows used to display the bit lamps
    */
    var cols = Math.floor((bits+rows-1)/rows);
    var height = rows*B5500DDRegister.vSpacing;
    var width = cols*B5500DDRegister.hSpacing;
    var b;
    var cx = Math.floor((x-0.25)*B5500DDRegister.hSpacing);
    var cy = Math.floor((y-0.25)*B5500DDRegister.vSpacing);
    var lamp;

    this.bits = bits;                   // number of bits in the register
    this.left = cx;                     // horizontal offset relative to container
    this.top = cy;                      // vertical offset relative to container
    this.caption = caption || "";       // panel caption
    this.lastValue = 0;                 // prior register value
    this.lamps = new Array(bits+1);     // bit lamps

    // visible DOM element
    this.element = document.createElement("div");
    this.element.className = "ddRegister";
    this.element.style.left = String(cx) + "px";
    this.element.style.top = String(cy) + "px";
    this.element.style.width = String(width) + "px";
    this.element.style.height = String(height) + "px";

    cx = cols*B5500DDRegister.hSpacing + B5500DDRegister.hOffset;
    for (b=1; b<=bits; b++) {
        if ((b-1)%rows == 0) {
            cy = (rows-1)*B5500DDRegister.vSpacing + B5500DDRegister.vOffset;
            cx -= B5500DDRegister.hSpacing;
        } else {
            cy -= B5500DDRegister.vSpacing;
        }
        lamp = new B5500DDLamp(cx, cy);
        this.lamps[b] = lamp;
        this.element.appendChild(lamp.element);
    }

    this.captionDiv = document.createElement("div");
    this.captionDiv.className = "ddRegCaption";
    this.captionDiv.style.left = "2px";
    this.captionDiv.style.right = "2px";
    this.captionDiv.style.top = String(-B5500DDRegister.vOffset) + "px";
    if (caption) {
        lamp = document.createElement("span");
        lamp.className = "ddRegSpan";
        lamp.appendChild(document.createTextNode(caption));
        this.captionDiv.appendChild(lamp);
    }
    this.element.appendChild(this.captionDiv);

}

/**************************************/

B5500DDRegister.hSpacing = 24;          // horizontal lamp spacing, pixels
B5500DDRegister.hOffset = 5;            // horizontal lamp offset within container
B5500DDRegister.vSpacing = 24;          // vertical lamp spacing, pixels
B5500DDRegister.vOffset = 5;            // vertical lamp offset within container

/**************************************/
B5500DDRegister.prototype.xCoord = function(col) {
    /* Returns the horizontal lamp coordinate in "px" format */

    return String((col-1)*B5500DDRegister.hSpacing + B5500DDRegister.hOffset) + "px";
};

/**************************************/
B5500DDRegister.prototype.yCoord = function(row) {
    /* Returns the vertical lamp coordinate in "px" format */

    return String((row-1)*B5500DDRegister.vSpacing + B5500DDRegister.vOffset) + "px";
};

/**************************************/
B5500DDRegister.prototype.YYupdate = function(value) {
    /* Update the register lamps from the value of the parameter */
    var bitNr = 0;
    var low = (this.lastValue % 0x1000000) ^ (value % 0x1000000);
    var high = (Math.floor(this.lastValue / 0x1000000) % 0x1000000) ^ (Math.floor(value / 0x1000000) % 0x1000000);

    while (low) {
        bitNr++;
        if (low & 1) {
            this.lamps[bitNr].flip();
        }
        low >>>= 1;
    }
    bitNr = 23;
    while (high) {
        bitNr++;
        if (high & 1) {
            this.lamps[bitNr].flip();
        }
        high >>>= 1;
    }
    this.lastValue = value;
};

/**************************************/
B5500DDRegister.prototype.XXupdate = function(value) {
    /* Update the register lamps from the value of the parameter */
    var bitNr = 0;
    var bit;
    var mask = value % 0x1000000000000;

    while (mask) {
        bitNr++;
        bit = mask % 2;
        this.lamps[bitNr].set(bit);
        mask = (mask-bit)/2;
    }
};

/**************************************/
B5500DDRegister.prototype.update = function(value) {
    /* Update the register lamps from the value of the parameter */
    var bitNr = 0;
    var bit;
    var mask = value % 0x1000000000000;

    while (bitNr < this.bits) {
        bitNr++;
        bit = mask % 2;
        this.lamps[bitNr].element.className = (bit ? B5500DDLamp.litClass : B5500DDLamp.lampClass);
        mask = (mask-bit)/2;
    }
};
