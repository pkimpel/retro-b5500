/***********************************************************************
* retro-b5500/webSite TapeImageDL.js
************************************************************************
* Copyright (c) 2013, Paul Kimpel. All rights reserved.
* Licensed under the MIT License,
*       see http://www.opensource.org/licenses/mit-license.php
************************************************************************
* 2013-06-07  P.Kimpel
*   Original version.
***********************************************************************/
"use strict";

window.onload = function() {
    var acceptanceCheck = document.getElementById("AcceptanceCheck");
    var acceptanceBtn = document.getElementById("AcceptanceBtn");

    function acceptanceCheck_Click(ev) {
        acceptanceBtn.disabled = !acceptanceCheck.checked;
    }

    function acceptanceBtn_Click(ev) {
        var image = acceptanceCheck.value;
        var s1 = String.fromCharCode(46,46,47,77,97,114,107,45,88,73,73,73,47,66,53,53,48,48,45,88,73,73,73,45);
        var s2 = String.fromCharCode(45);
        var s3 = String.fromCharCode(46,122,105,112);
        var s4 = String.fromCharCode(108,111,99,97,116,105,111,110);
        var s5 = String.fromCharCode(104,114,101,102);
        var images = {
            SYSTEM: String.fromCharCode(97,100,99,48,48,50,53,55),
            SYMBOL1: String.fromCharCode(97,100,99,48,48,50,53,53),
            SYMBOL2: String.fromCharCode(97,100,99,48,48,50,53,51)};

        if (acceptanceCheck.checked) {
            window[s4][s5] = s1 + image + s2 + images[image] + s3;
        }
    }

    /********** Start of window.onload() **********/

    acceptanceBtn.disabled = true;
    acceptanceCheck.checked = false;
    acceptanceCheck.onclick = acceptanceCheck_Click;
    acceptanceBtn.onclick = acceptanceBtn_Click;
};
