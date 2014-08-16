/***********************************************************************
* retro-b5500/webUI B5500SystemConfiguration.js
************************************************************************
* Copyright (c) 2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 System Configuration management object.
*
* Defines the system configuration used internally by the emulator and the
* methods used to manage that configuration data.
*
* The configuration data consists of two parts, (a) the processors, I/O
* units, and peripheral devices that make up the system, and (b) a disk
* storage configuration that defines the EUs and sizes and types of each
* of the EUs.
*
* Each system configuration is identified by a unique "configName" property.
* Each system configuration specifies the components in item (a) above,
* plus the name of a disk storage configuration that is currently associated
* with that system configuration. The disk storage configurations themselves
* are maintained in the storage databases described below. Thus, multiple
* system configurations can be defined to use the same storage configuration,
* and the storage used with a given system configuration can, within some
* limits, be changed. Only one system configuration at a time can be the
* default (or active) one, however.
*
*
* The system configuration data is persisted in an IndexedDB database,
* "retro-B5500-Config", that contains the following object stores:
*
*    1. Global:
*       This is a single-object store that holds global values for the
*       emulator, e.g., the name of the current default system configuration.
*
*    2. SysConfig:
*       This holds one system object for each system configuration that
*       has been defined to the emulator. The store is indexed by the
*       "configName" property.
*
* See the constructor below for the structure of the system configuration
* data.
*
* Each disk storage subsystem is maintained as a separate IndexedDB database.
* Each database contains a single-object store named "CONFIG" which holds the
* configuration data for the subsystem. In addition, there are one or more
* "EUn" object stores, where n is a one- or two-digit decimal number in the
* range 0-19. Each of these object stores represents the storage capacity for
* one Electronics Unit and its associated Storage Units (SU). At present,
* each object in an EU store represents one segment of 240 characters (30 words)
* and is implemented as a Uint8Array(240).
*
* The "CONFIG" object store contains one object which itself contains a set of
* objects of the form:
*
*       EUn: {size: 200000, slow: false, lockoutMask: 0}
*
* where
*
*       n               is the EU number (0-19).
*       size            is the capacity of the EU in segments:
*                           40000-200000 for model I disk
*                           80000-400000 for model IB (slow) disk.
*       slow            indicates model I (false) or model IB (true) disk,
*       lockoutMask     is a binary integer, the low-order 20 bits of which
*                       represent the 20 disk lockout switches. A bit in this
*                       mask will be 1 if the associated switch is on. If
*                       this integer is negative, that indicates the master
*                       lockout switch is on.
*
* The "EUn" objects in "CONFIG" MUST match the "EUn" object stores in the
* database one-for-one. Object stores without a matching CONFIG entry will not
* be used by the emulator (the EU will be reported as being not ready). CONFIG
* entries without a matching object store will cause an error when an IndexedDB
* transaction is created that references the missing EU.
*
************************************************************************
* 2014-08-10  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500SystemConfiguration() {
    /* Constructor for the SystemConfiguration object */

    /**********
    this.window = window.open("", mnemonic);
    if (this.window) {
        this.shutDown();                // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.window = window.open("../webUI/B5500SystemConfiguration.html", "B5500Config",
        "scrollbars=no,resizable,width=560,height=120,left=280,top=0");
    this.window.addEventListener("load", function windowLoad() {
        that.tapeDriveOnLoad();
    }, false);
    **********/
}

/**************************************/
B5500SystemConfiguration.prototype.configDBName = "retro-B5500-Config";
B5500SystemConfiguration.prototype.configDBVersion = 1;
B5500SystemConfiguration.prototype.sysGlobalName = "Global";
B5500SystemConfiguration.prototype.sysConfigName = "SysConfig";

// Template for the Global configuration store
B5500SystemConfiguration.prototype.globalConfig = {
    defaultConfigName: "Default"
};

// Current system configuration properties
B5500SystemConfiguration.prototype.systemConfig = {
    configName: "Default",
    storageName: "B5500DiskUnit",
    PA: true,                           // Processor A available
    PB: false,                          // Processor B available

    PB1L: false,                        // PA is P1 (false) | PB is P1 (true)

    IO1: true,                          // I/O Unit 1 available
    IO2: true,                          // I/O Unit 2 available
    IO3: true,                          // I/O Unit 3 available
    IO4: false,                         // I/O Unit 4 available

    DFX: true,                          // Use Disk File Exchange
    FPM: false,                         // Use File Protect Memory (shared systems)
    LPAlgolGlyphs: true,                // Line printers use Algol glyphs
    CPAlgolGlyphs: false,               // Card punch uses Algol glyphs
    MTAlgolGlyphs: false,               // Mag tape uses Algol glyphs (text images only)

    memMod: [
                true,                   // Memory module 0 available (4KW)
                true,                   // Memory module 1 available (4KW)
                true,                   // Memory module 2 available (4KW)
                true,                   // Memory module 3 available (4KW)
                true,                   // Memory module 4 available (4KW)
                true,                   // Memory module 5 available (4KW)
                true,                   // Memory module 6 available (4KW)
                true],                  // Memory module 7 available (4KW)

    units: {
        SPO:    true,                   // SPO keyboard/printer
        DKA:    true,                   // Disk File Control A
        DKB:    true,                   // Disk File Control B
        CRA:    true,                   // Card Reader A
        CRB:    false,                  // Card Reader B
        CPA:    true,                   // Card Punch A
        LPA:    true,                   // Line Printer A
        LPB:    false,                  // Line Printer B
        PRA:    false,                  // Paper Tape Reader A
        PRB:    false,                  // Paper Tape Reader B
        PPA:    false,                  // Paper Tape Punch A
        PPB:    false,                  // Paper Tape Punch A
        DCA:    true,                   // Data Communications Control A
        DRA:    false,                  // Drum/Auxmem A
        DRB:    false,                  // Drum/Auxmem B
        MTA:    true,                   // Magnetic Tape Unit A
        MTB:    false,                  // Magnetic Tape Unit B
        MTC:    false,                  // Magnetic Tape Unit C
        MTD:    false,                  // Magnetic Tape Unit D
        MTE:    false,                  // Magnetic Tape Unit E
        MTF:    false,                  // Magnetic Tape Unit F
        MTH:    false,                  // Magnetic Tape Unit H
        MTJ:    false,                  // Magnetic Tape Unit J
        MTK:    false,                  // Magnetic Tape Unit K
        MTL:    false,                  // Magnetic Tape Unit L
        MTM:    false,                  // Magnetic Tape Unit M
        MTN:    false,                  // Magnetic Tape Unit N
        MTP:    false,                  // Magnetic Tape Unit P
        MTR:    false,                  // Magnetic Tape Unit R
        MTS:    false,                  // Magnetic Tape Unit S
        MTT:    false                   // Magnetic Tape Unit T
    },

    terminalUnits: {
        // adapters: number of terminal adapters
        // buffers:  number of 28-char buffers per adapter
        // pingPong: use ping-pong buffer mechanism
        TU1: {adapters:  1, buffers: 2, pingPong: false}
    }
};

// Current disk storage configuration
B5500SystemConfiguration.prototype.storageConfig = {
        storageName: "B5500DiskUnit",
        EU0: {size: 200000, slow: false, lockoutMask: 0},
        EU1: {size: 200000, slow: false, lockoutMask: 0}
    };

/**************************************/
B5500SystemConfiguration.prototype.deepCopy = function deepCopy(source, dest) {
    /* Performs a deep copy of the object "source" into the object "dest".
    If "dest" is null or undefined, simply returns a deep copy of "source".
    Note that this routine clones the primitive Javascript types, basic
    objects (hash tables), Arrays, Dates, RegExps, and Functions. Other
    types may be supported by extending the switch statement. Also note
    this is a static function.
    Adapted (with thanks) from the "extend" routine by poster Kamarey on 2011-03-26 at
    http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-an-object
    */
    var constr;
    var copy;
    var name;

    if (source === null) {
        return source;
    } else if (!(source instanceof Object)) {
        return source;
    } else {
        constr = source.constructor;
        if (constr !== Object && constr !== Array) {
            return source;
        } else {
            switch (constr) {
            case String:
            case Number:
            case Boolean:
            case Date:
            case Function:
            case RegExp:
                copy = new constr(source);
                break;
            default:
                copy = dest || new constr();
                break;
            }

            for (name in source) {
                copy[name] = deepCopy(source[name], null);
            }

            return copy;
        }
    }

    /********************************
    // Original version:
    // extends 'from' object with members from 'to'. If 'to' is null, a deep clone of 'from' is returned
    function extend(from, to)
    {
        if (from == null || typeof from != "object") return from;
        if (from.constructor != Object && from.constructor != Array) return from;
        if (from.constructor == Date || from.constructor == RegExp || from.constructor == Function ||
            from.constructor == String || from.constructor == Number || from.constructor == Boolean)
            return new from.constructor(from);

        to = to || new from.constructor();

        for (var name in from)
        {
            to[name] = typeof to[name] == "undefined" ? extend(from[name], null) : to[name];
        }

        return to;
    }
    ********************************/
};

/**************************************/
B5500SystemConfiguration.prototype.genericDBError = function genericDBError(ev) {
    // Formats a generic alert message when an otherwise-unhandled database error occurs */

    alert("Database \"" + target.result.name + "\" UNHANDLED ERROR: " + ev.target.result.error);
};

/**************************************/
B5500SystemConfiguration.prototype.updateConfigSchema = function updateConfigSchema(ev, req) {
    /* Handles the onupgradeneeded event for the System Configuration database.
    Update the schema to the current version. For a new database, creates the
    default configuration and stores it in the database.
    "ev" is the upgradeneeded event, "req" is the DB open request object */
    var configStore = null;
    var db = ev.target.result;
    var globalStore = null;
    var stores = db.objectStoreNames;
    var txn = req.transaction;

    switch (true) {
    case ev.oldVersion < 1:
        if (!confirm("retro-B5500 System Configuration database does not exist." +
                     "\nDo you want to create it?")) {
            txn.abort();
            db.close();
            db = null;
            alert("No System Configuration database created -- " +
                  "cannot continue -- please close this page");
        } else {
            globalStore = db.createObjectStore(this.sysGlobalName);
            globalStore.put(B5500SystemConfiguration.prototype.globalConfig, 0);

            configStore = db.createObjectStore(this.sysConfigName, {keyPath: "configName"});
            configStore.put(B5500SystemConfiguration.prototype.systemConfig);
        }
        break;

    default:
        alert("System Configuration database is at higher version than implementation -- aborting");
    } // switch
};

/**************************************/
B5500SystemConfiguration.prototype.deleteConfigDB = function deleteConfigDB() {
    /* Attempts to permanently delete the System Configuration database */
    var req;

    if (confirm("This will PERMANENTLY DELETE the retro-B5500 emulator's\n" +
                "System Configuration Database." +
                "\n\nAre you sure you want to do this?")) {
        if (confirm("Deletion of the Configuration Database CANNOT BE UNDONE.\n\n" +
                    "Are you really sure?")) {
            req = window.indexedDB.deleteDatabase(this.configDBName);

            req.onerror = function(ev) {
                alert("CANNOT DELETE the System Configuration database:\n" + ev.target.error);
            };

            req.onblocked = function(ev) {
                alert("Deletion of the System Configuration database is BLOCKED -- cannot continue");
            };

            req.onsuccess = function(ev) {
                alert("System Configuration database deleted successfully.");
            };
        }
    }
};

/**************************************/
B5500SystemConfiguration.prototype.openConfigDB = function openConfigDB(uponOpen, uponError) {
    /* Attempts to open the System Configuration database. Handles, if necessary,
    a change in database version. If successful, calls the "uponOpen" function
    passing the success event. If not successfl, calls the "uponError" function
    passing the error event */
    var req;                            // IndexedDB open request
    var that = this;

    req = window.indexedDB.open(this.configDBName, this.configDBVersion);

    req.onblocked = function(ev) {
        alert("Database \"" + this.configDBName + "\" open is blocked -- cannot continue");
    };

    req.onupgradeneeded = function(ev) {
        that.updateConfigSchema(ev, req);
    };

    req.onerror = function(ev) {
        uponError.call(that, ev);
    };

    req.onsuccess = function(ev) {
        ev.target.result.onerror = that.genericDBError; // set up global error handler
        uponOpen.call(that, ev);
    };
};

/**************************************/
B5500SystemConfiguration.prototype.getSystemConfig = function getSystemConfig(configName, successor) {
    /* Attempts to retrieve the system configuration structure under "configName".
    If "configName" is falsy, retrieves the current default configuration.
    If successful, calls the "successor" function passing the configuration object;
    otherwise calls "successor" passing null. Closes the database after a successful get.
    Displays alerts for any errors encountered */
    var that = this;

    function uponError(ev) {
        /* Called when an error occurred during database open -- just report
        it and quit */

        alert("Cannot open \"" + this.configDBName + "\" database:\n" + ev.target.error);
    }

    function readConfig(db, configName) {
        /* Reads the named system configuration structure from the database,
        then closes the database */
        var txn = db.transaction(that.sysConfigName);

        txn.objectStore(that.sysConfigName).get(configName).onsuccess = function(ev) {
            that.systemConfig = ev.target.result;       // <<<<<<<<<< may not need this >>>>>>>>>>>>
            successor(ev.target.result);
            db.close();
        };
    }

    function uponOpen(ev) {
        /* Called on successful database open. Retrieve the configuration specified by
        the "configName" parameter to getSystemConfig. If the configName is falsy,
        first get the default configuration name from the configuration global structure,
        and get that configuration */
        var db = ev.target.result;
        var txn;

        if (configName) {
            readConfig(db, configName);
        } else {
            txn = db.transaction(that.sysGlobalName);
            txn.objectStore(that.sysGlobalName).get(0).onsuccess = function(ev) {
                readConfig(db, ev.target.result.defaultConfigName);
            };
        }
    }

    this.openConfigDB(uponOpen, uponError);
};







/**************************************/
B5500SystemConfiguration.prototype.loadTape = function loadTape() {
    /* Loads a tape into memory based on selections in the MTLoad window */
    var $$$ = null;                     // getElementById shortcut for loader window
    var doc = null;                     // loader window.document
    var eotInches = 0;                  // tape inches until EOT marker
    var file = null;                    // FileReader instance
    var fileSelect = null;              // file picker element
    var formatSelect = null;            // tape format list element
    var maxInches = 0;                  // maximum tape inches in tape image
    var mt = this;                      // this B5500SystemConfiguration instance
    var tapeFormat = "";                // tape format code (bcd, aod, aev, etc.)
    var tapeInches = 0;                 // selected tape length in inches
    var tapeLengthSelect = null;        // tape length list element
    var win = this.window.open("B5500MagTapeLoadPanel.html", this.mnemonic + "Load",
        "scrollbars=no,resizable,width=508,height=112,left=" + this.screenX +",top=" + this.screenY);
    var writeRing = false;              // true if write-enabled
    var writeRingCheck = null;          // tape write ring checkbox element

    function fileSelector_onChange(ev) {
        /* Handle the <input type=file> onchange event when a file is selected */
        var fileExt;
        var fileName;
        var x;

        file = ev.target.files[0];
        fileName = file.name;
        x = fileName.lastIndexOf(".");
        fileExt = (x > 0 ? fileName.substring(x) : "");
        writeRingCheck.checked = false;
        tapeLengthSelect.disabled = true;

        switch (fileExt) {
        case ".bcd":
            tapeFormat = "bcd";
            break;
        case ".tap":
            tapeFormat = "tap";
            break;
        default:
            tapeFormat = "aod";
            break;
        } // switch fileExt

        for (x=formatSelect.length-1; x>=0; x--) {
            if (formatSelect.options[x].value == tapeFormat) {
                formatSelect.selectedIndex = x;
                break;
            }
        } // for x
    }

    function finishLoad() {
        /* Finishes the tape loading process and closes the loader window */

        mt.imgIndex = 0;
        mt.imgLength = mt.image.length;
        mt.tapeInches = 0;
        mt.imgEOTInches = eotInches;
        mt.imgMaxInches = tapeInches;
        mt.reelBar.max = mt.imgMaxInches;
        mt.reelBar.value = mt.imgMaxInches;
        mt.setAtEOT(false);
        mt.setAtBOT(true);
        mt.tapeState = mt.tapeLocal;    // setTapeRemote() requires it not be unloaded
        mt.setTapeRemote(false);
        mt.reelIcon.style.visibility = "visible";
        B5500Util.removeClass(mt.$$("MTUnloadedLight"), "annunciatorLit");

        mt.imgWritten = false;
        mt.writeRing = writeRing;
        if (writeRing) {
            B5500Util.addClass(mt.$$("MTWriteRingBtn"), "redLit");
        } else {
            B5500Util.removeClass(mt.$$("MTWriteRingBtn"), "redLit");
        }

        win.close();
    }

    function bcdLoader_onLoad(ev) {
        /* Loads a ".bcd" tape image into the drive */
        var blockLength;
        var image = new Uint8Array(ev.target.result);
        var imageSize;
        var x;

        mt.imgTopIndex = image.length;
        if (writeRing) {
            eotInches = tapeInches;
            tapeInches += mt.postEOTLength;
            imageSize = tapeInches*mt.density;
            if (image.length > imageSize) {
                eotInches = image.length/mt.density;
                imageSize = image.length + mt.postEOTLength*mt.density;
                tapeInches = imageSize/mt.density;
            }
            mt.image = new Uint8Array(new ArrayBuffer(imageSize));
            for (x=image.length-1; x>=0; x--) {
                mt.image[x] = image[x];
            }
        } else {
            mt.image = image;
            imageSize = image.length;
            tapeInches = 0;
            x = 0;
            while (x < imageSize) {
                x++;
                blockLength = 1;
                while (x < imageSize && image[x] < 0x80) {
                    x++;
                    blockLength++;
                } // while for blockLength
                tapeInches += blockLength/mt.density + mt.gapLength;
            } // while for imageSize
            eotInches = tapeInches + mt.postEOTLength;
        }
        finishLoad();
    }

    function blankLoader() {
        /* Loads a blank tape image into the drive */

        writeRing = true;
        eotInches = tapeInches;
        tapeInches += mt.postEOTLength;
        mt.image = new Uint8Array(new ArrayBuffer(tapeInches*mt.density));
        mt.image[0] = 0x81;             // put a little noise on the tape to avoid blank-tape timeouts
        mt.image[1] = 0x03;
        mt.image[2] = 0x8F;
        mt.imgTopIndex = 3;
        finishLoad();
    }

    function tapLoader_onLoad(ev) {
        /* Loads a ".tap" tape image into the drive */

        /* To be Provided */
    }

    function textLoader_onLoad(ev) {
        /* Loads a text image as either odd or even parity bcd data */
        var block;                      // ANSI text of current block
        var blockLength;                // length of current ASCII block
        var eolRex = /([^\n\r\f]*)((:?\r[\n\f]?)|\n|\f)?/g;
        var image = ev.target.result;   // ANSI tape image
        var imageLength = image.length; // length of ANSI tape image
        var imageSize;                  // size of final tape image [bytes]
        var inches = 0;                 // tape inches occupied by image data
        var index = 0;                  // image index of next ANSI block
        var match;                      // result of eolRex.exec()
        var offset = 0;                 // index into mt.image
        var table = (tapeFormat == "aev" ? mt.bcdXlateOutEven : mt.bcdXlateOutOdd);
        var x;                          // for loop index

        if (!writeRing) {
            imageSize = imageLength;
        } else {
            eotInches = tapeInches;
            tapeInches += mt.postEOTLength;
            imageSize = tapeInches*mt.density;
            if (imageLength > imageSize) {
                eotInches = imageLength/mt.density;
                imageSize = imageLength + mt.postEOTLength*mt.density;
                tapeInches = imageSize/mt.density;
            }
        }

        mt.image = new Uint8Array(new ArrayBuffer(imageSize));
        do {
            eolRex.lastIndex = index;
            match = eolRex.exec(image);
            if (!match) {
                break;
            } else {
                index += match[0].length;
                block = match[1];
                blockLength = block.length;
                inches += blockLength/mt.density + mt.gapLength;
                if (block == "}") {
                    mt.image[offset++] = mt.bcdTapeMark;
                } else if (blockLength > 0) {
                    mt.image[offset++] = table[block.charCodeAt(0) & 0x7F] | 0x80;
                    for (x=1; x<blockLength; x++) {
                        mt.image[offset++] = table[block.charCodeAt(x) & 0x7F];
                    }
                }
            }
        } while (index < imageLength);

        mt.imgTopIndex = offset;
        if (!writeRing) {
            tapeInches = inches;
            eotInches = tapeInches + mt.postEOTLength;
        }
        finishLoad();
    }

    function tapeLoadOK(ev) {
        /* Handler for the OK button. Does the actual tape load */
        var tape;

        tapeFormat = formatSelect.value;
        if (!(file || tapeFormat == "blank")) {
            win.alert("File must be selected unless loading a blank tape");
        } else {
            tapeInches = (parseInt(tapeLengthSelect.value) || 2400)*12;
            writeRing = writeRingCheck.checked;
            mt.$$("MTFileName").value = (file ? file.name : "");

            switch (tapeFormat) {
            case "aod":
            case "aev":
                tape = new FileReader();
                tape.onload = textLoader_onLoad;
                tape.readAsText(file);
                break;
            case "bcd":
                tape = new FileReader();
                tape.onload = bcdLoader_onLoad;
                tape.readAsArrayBuffer(file);
                break;
            case "tap":
                tape = new FileReader();
                tape.onload = tapLoader_onLoad;
                tape.readAsArrayBuffer(file);
                break;
            default:
                mt.$$("MTFileName").value = (file ? file.name : "(blank tape)");
                blankLoader();
                break;
            } // switch
        }
    }

    function tapeLoadOnLoad (ev) {
        /* Driver for the tape loader window */
        var de;

        doc = win.document;
        de = doc.documentElement;
        win.focus();
        $$$ = function $$$(id) {
            return doc.getElementById(id);
        };

        fileSelect = $$$("MTLoadFileSelector");
        formatSelect = $$$("MTLoadFormatSelect");
        writeRingCheck = $$$("MTLoadWriteRingCheck");
        tapeLengthSelect = $$$("MTLoadTapeLengthSelect")

        doc.title = "B5500 " + mt.mnemonic + " Tape Loader";
        fileSelect.addEventListener("change", fileSelector_onChange, false);

        formatSelect.addEventListener("change", function loadFormatSelect(ev) {
            tapeFormat = ev.target.value;
            if (tapeFormat == "blank") {
                file = null;
                fileSelect.value = null;
                writeRingCheck.checked = true;
                tapeLengthSelect.disabled = false;
                tapeLengthSelect.selectedIndex = tapeLengthSelect.length-1;
            }
        }, false);

        writeRingCheck.addEventListener("click", function loadWriteRingCheck(ev) {
            tapeLengthSelect.disabled = !ev.target.checked;
        }, false);

        $$$("MTLoadOKBtn").addEventListener("click", tapeLoadOK, false);
        $$$("MTLoadCancelBtn").addEventListener("click", function loadCancelBtn(ev) {
            file = null;
            mt.$$("MTFileName").value = "";
            win.close();
        }, false);

        win.resizeBy(de.scrollWidth - win.innerWidth + 4,       // kludge for right-padding/margin
                         de.scrollHeight - win.innerHeight);
        win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    }

    // Outer block of loadTape
    mt.$$("MTLoadBtn").disabled = true;
    win.addEventListener("load", tapeLoadOnLoad, false);
    win.addEventListener("unload", function tapeLoadUnload(ev) {
        if (win.closed) {
            mt.$$("MTLoadBtn").disabled = (mt.tapeState != mt.tapeUnloaded);
        }
    }, false);
};

/**************************************/
B5500SystemConfiguration.prototype.unloadTape = function unloadTape() {
    /* Reformats the tape image data as ASCII text and displays it in a new
    window so the user can save or copy/paste it elsewhere */
    var doc = null;                     // loader window.document
    var mt = this;                      // tape drive object
    var win = this.window.open("./B5500FramePaper.html", this.mnemonic + "-Unload",
        "scrollbars=yes,resizable,width=800,height=600");

    function unloadDriver() {
        /* Converts the tape image to ASCII once the window has displayed the
        waiting message */
        var buf = new Uint8Array(new ArrayBuffer(8192));
        var bufIndex;                   // offset into ASCII block data
        var bufLength = buf.length-2;   // max usable block size
        var c;                          // current image byte;
        var image = mt.image;           // tape image data
        var imgLength = mt.imgTopIndex; // tape image active length
        var table;                      // even/odd parity translate table
        var tape;                       // <pre> element to receive tape data
        var x = 0;                      // image data index

        doc = win.document;
        doc.title = "B5500 " + mt.mnemonic + " Unload Tape";
        tape = doc.getElementById("Paper");
        while (tape.firstChild) {               // delete any existing <pre> content
            tape.removeChild(tape.firstChild);
        }

        c = image[x];
        do {
            c &= 0x7F;                  // clear the start-of-block bit
            table = (mt.bcdXlateInEven[c] < 0xFF ? mt.bcdXlateInEven : mt.bcdXlateInOdd);
            bufIndex = 0;
            do {
                if (bufIndex >= bufLength) { // ASCII block size exceeded
                    tape.appendChild(doc.createTextNode(
                            String.fromCharCode.apply(null, buf.subarray(0, bufIndex))));
                    bufIndex = 0;
                }
                if (c > 0) {            // drop any unrecorded tape frames
                    buf[bufIndex++] = table[c];
                }
                if (++x < imgLength) {
                    c = image[x];
                } else {
                    break;
                }
            } while (c < 0x80);
            buf[bufIndex++] = 0x0A;
            tape.appendChild(doc.createTextNode(
                    String.fromCharCode.apply(null, buf.subarray(0, bufIndex))));
        } while (x < imgLength);

        mt.setTapeUnloaded();
    }

    // Outer block of unloadTape
    win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
    win.focus();
    win.addEventListener("load", unloadDriver, false);
};

/**************************************/
B5500SystemConfiguration.prototype.tapeDriveOnLoad = function tapeDriveOnLoad() {
    /* Initializes the reader window and user interface */
    var de;
    var y = ((this.mnemonic.charCodeAt(2) - "A".charCodeAt(0))*30);

    this.doc = this.window.document;
    de = this.doc.documentElement;
    this.doc.title = "retro-B5500 " + this.mnemonic;

    this.reelBar = this.$$("MTReelBar");
    this.reelIcon = this.$$("MTReel");

    this.tapeState = this.tapeLocal;    // setTapeUnloaded() requires it to be in local
    this.atBOT = true;                  // and also at BOT
    this.setTapeUnloaded();

    this.window.addEventListener("beforeunload",
        B5500SystemConfiguration.prototype.tapeDriveBeforeUnload, false);
    this.$$("MTUnloadBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500SystemConfiguration.prototype.MTUnloadBtn_onclick), false);
    this.$$("MTLoadBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500SystemConfiguration.prototype.MTLoadBtn_onclick), false);
    this.$$("MTRemoteBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500SystemConfiguration.prototype.MTRemoteBtn_onclick), false);
    this.$$("MTLocalBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500SystemConfiguration.prototype.MTLocalBtn_onclick), false);
    this.$$("MTWriteRingBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500SystemConfiguration.prototype.MTWriteRingBtn_onclick), false);
    this.$$("MTRewindBtn").addEventListener("click",
        B5500CentralControl.bindMethod(this, B5500SystemConfiguration.prototype.MTRewindBtn_onclick), false);

    this.window.resizeBy(de.scrollWidth - this.window.innerWidth + 4, // kludge for right-padding/margin
                         de.scrollHeight - this.window.innerHeight);
    this.window.moveTo(280, y);
};
