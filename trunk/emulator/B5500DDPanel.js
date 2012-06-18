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

B5500DDLamp.prototype.onColor = "#FF9900";
B5500DDLamp.prototype.offColor = "#999999";

/**************************************/
B5500DDLamp.prototype.set = function(v) {
    /* Changes the visible state of the lamp according to the low-order
    bit of "v". */
    newState = v & 1;

    if (this.state ^ newState) {         // the state has changed
        this.element.backgroundColor = (v & 1 ? this.onColor : this.offColor);
        this.state = newState;
    }
}


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
    var height = rows*this.vSpacing;
    var width = cols*this.hSpacing;
    var b;
    var cx = Math.floor((x-0.25)*this.hSpacing);
    var cy = Math.floor((y-0.25)*this.vSpacing);
    var lamp;

    this.bits = bits;                   // number of bits in the register
    this.left = cx;                     // horizontal offset relative to container
    this.top = cy;                      // vertical offset relative to container
    this.caption = caption;             // panel caption
    this.lamps = new Array(bits+1);     // bit lamps

    // visible DOM element
    this.element = document.createElement("div");
    this.element.className = "ddRegister";
    this.element.style.left = String(cx) + "px";
    this.element.style.top = String(cy) + "px";
    this.element.style.width = width;
    this.element.style.height = height;

    cx = Math.floor((cols+0.25)*this.hSpacing);
    for (b=1; b<=bits; b++) {
        if ((b-1)%rows == 0) {
            cy = Math.floor((rows-0.75)*this.vSpacing);
            cx -= this.hSpacing;
        } else {
            cy -= this.vSpacing;
        }
        lamp = new B5500DDLamp(cx, cy);
        this.lamps[b] = lamp;
        this.element.appendChild(lamp.element);
    }
}

/**************************************/

B5500DDRegister.prototype.hSpacing = 24; // horizontal lamp spacing, pixels
B5500DDRegister.prototype.vSpacing = 24; // vertical lamp spacing, pixels

