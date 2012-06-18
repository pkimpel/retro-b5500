/***********************************************************************
* retro-b5500/emulator B5500ProcessorPanel.js
************************************************************************
* Copyright (c) 2012, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript object definition for the B5500 D&D Processor panels.
************************************************************************
* 2012-06-18  P.Kimpel
*   Original version, from thin air.
***********************************************************************/

/**************************************/
function B5500ProcessorPanel(win) {
    /* Constructor for the B5500 D&D Processor Panel object. Creates the
    panel UI on window "win" */
    var body = win.document.body;

    this.X = new B5500DDRegister(39, 1, 1, 3, "X REG");
    body.appendChild(this.X.element);

    this.J = new B5500DDRegister(4, 14, 1, 3, "J REG");
    body.appendChild(this.J.element);
}
