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

    // Row 1

    this.X = new B5500DDRegister(39, 1, 1, 3, "X REG");
    body.appendChild(this.X.element);

    this.J = new B5500DDRegister(4, 14, 1, 3, "J REG");
    body.appendChild(this.J.element);
    this.J.lamps[1].setCaption("1");
    this.J.lamps[2].setCaption("2");
    this.J.lamps[3].setCaption("4");
    this.J.lamps[4].setCaption("8");
    // adjust the weird position of the "8" bit
    this.J.lamps[4].element.style.top = String(B5500DDRegister.vOffset) + "px";

    this.Q = new B5500DDRegister(21, 16, 1, 3, "Q REG");
    body.appendChild(this.Q.element);
    this.Q.lamps[2].setCaption("CCCF");
    this.Q.lamps[3].setCaption("VARF");
    this.Q.lamps[4].setCaption("1");
    this.Q.lamps[5].setCaption("2");
    this.Q.lamps[6].setCaption("3");
    this.Q.lamps[7].setCaption("4");
    this.Q.lamps[8].setCaption("5");
    this.Q.lamps[9].setCaption("6");
    this.Q.lamps[10].setCaption("7");
    this.Q.lamps[11].setCaption("8");
    this.Q.lamps[12].setCaption("9");
    this.Q.lamps[13].setCaption("12");
    this.Q.lamps[14].setCaption("MRAF");
    this.Q.lamps[15].setCaption("MROF");
    this.Q.lamps[16].setCaption("HLTF");
    this.Q.lamps[17].setCaption("EIHF");
    this.Q.lamps[18].setCaption("MWOF");
    this.Q.lamps[19].setCaption("NCSF");
    this.Q.lamps[20].setCaption("SALF");
    this.Q.lamps[21].setCaption("CWMF");

    this.R = new B5500DDRegister(9, 23, 1, 3, "R REG");
    body.appendChild(this.R.element);

    // Row 2

    this.A = new B5500DDRegister(48, 1, 5, 3, "A REG");
    body.appendChild(this.A.element);

    this.AROF = new B5500DDRegister(1, 17, 5, 1, null);
    body.appendChild(this.AROF.element);
    this.AROF.lamps[1].setCaption("AROF");

    this.G = new B5500DDRegister(3, 18, 5, 3, "G");
    body.appendChild(this.G.element);

    this.H = new B5500DDRegister(3, 19, 5, 3, "H");
    body.appendChild(this.H.element);

    this.Y = new B5500DDRegister(6, 21, 5, 6, "Y");
    body.appendChild(this.Y.element);

    this.Z = new B5500DDRegister(6, 22, 5, 6, "Z");
    body.appendChild(this.Z.element);

    this.M = new B5500DDRegister(15, 23, 5, 3, "M REG");
    body.appendChild(this.M.element);

    // Row 3

    this.B = new B5500DDRegister(48, 1, 9, 3, "B REG");
    body.appendChild(this.B.element);

    this.BROF = new B5500DDRegister(1, 17, 9, 1, null);
    body.appendChild(this.BROF.element);
    this.BROF.lamps[1].setCaption("BROF");

    this.K = new B5500DDRegister(3, 18, 9, 3, "K");
    body.appendChild(this.K.element);

    this.V = new B5500DDRegister(3, 19, 9, 3, "V");
    body.appendChild(this.V.element);

    this.N = new B5500DDRegister(4, 20, 8, 4, "N");
    body.appendChild(this.N.element);

    this.S = new B5500DDRegister(15, 23, 9, 3, "S REG");
    body.appendChild(this.S.element);

    // Row 4

    this.P = new B5500DDRegister(48, 1, 13, 3, "P REG");
    body.appendChild(this.P.element);

    this.PROF = new B5500DDRegister(3, 17, 13, 3, null);
    body.appendChild(this.PROF.element);
    this.PROF.lamps[1].setCaption("L1");
    this.PROF.lamps[2].setCaption("L2");
    this.PROF.lamps[3].setCaption("PROF");

    this.T = new B5500DDRegister(12, 18, 13, 3, "T REG");
    body.appendChild(this.T.element);

    this.TROF = new B5500DDRegister(1, 22, 13, 1, null);
    body.appendChild(this.TROF.element);
    this.TROF.lamps[1].setCaption("TROF");

    this.C = new B5500DDRegister(15, 23, 13, 3, "C REG");
    body.appendChild(this.C.element);

    // Row 5

    this.I = new B5500DDRegister(9, 3, 17, 1, "I REG");
    body.appendChild(this.I.element);

    this.TM = new B5500DDRegister(9, 3, 19, 1, "TM REG");
    body.appendChild(this.TM.element);

    this.E = new B5500DDRegister(6, 17, 17, 1, "E REG");
    body.appendChild(this.E.element);

    this.F = new B5500DDRegister(15, 23, 17, 3, "F REG");
    body.appendChild(this.F.element);
}

/**************************************/
B5500ProcessorPanel.prototype.updateDisplay = function() {
    /* Update the processor panel lamps.
    For now, just supply random values */

}