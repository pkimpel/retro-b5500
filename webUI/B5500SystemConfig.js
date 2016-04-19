/***********************************************************************
* retro-b5500/webUI B5500SystemConfig.js
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
* units, memory modules, and peripheral devices that make up the system,
* and (b) a disk storage configuration that defines the disk Electronics
* Units (EU) and sizes and types of each of the EUs. This module addresses
* the first part.
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
*       This holds one system configuration object for each system that
*       has been defined to the emulator. The store is indexed by the
*       "configName" property of the configuration object.
*
*    3. StorageNames:
*       Each object in this store is simply a string giving the name of one
*       of the disk storage subsystem databases that have been previously
*       defined. This structure is necessary, as there is no facility in
*       IndexedDB to  enumerate the databases that currently exist for an
*       origin. The store is indexed by the value of the string.
*
* See the constructor below for the structure of the system configuration
* data.
*
* Each disk storage subsystem is maintained as a separate IndexedDB database.
* See the B5500DiskStorageConfig.js module for the configuration
* management interface for disk subsystems.
*
************************************************************************
* 2014-08-10  P.Kimpel
*   Original version, from thin air.
***********************************************************************/
"use strict";

/**************************************/
function B5500SystemConfig() {
    /* Constructor for the SystemConfig configuration management object */

    this.db = null;                     // the IndexedDB database connection (null if closed)
    this.systemConfig = null;           // the currently-loaded system configuration
    this.window = null;                 // configuration UI window object
    this.alertWin = window;             // current base window for alert/confirm/prompt
}

/**************************************/
B5500SystemConfig.prototype.configDBName = "retro-B5500-Config";
B5500SystemConfig.prototype.configDBVersion = 1;
B5500SystemConfig.prototype.sysGlobalName = "Global";
B5500SystemConfig.prototype.sysConfigName = "SysConfig";
B5500SystemConfig.prototype.sysStorageNamesName = "StorageNames";

// Template for the Global configuration store
B5500SystemConfig.prototype.globalConfig = {
    currentConfigName: B5500SystemConfiguration.prototype.sysDefaultConfigName
};

// Template for current system configuration properties
B5500SystemConfig.prototype.systemConfig = B5500SystemConfiguration.prototype.systemConfig;


/**************************************/
B5500SystemConfig.prototype.$$ = function $$(id) {
    return this.window.document.getElementById(id);
    }

/**************************************/
B5500SystemConfig.prototype.genericDBError = function genericDBError(ev) {
    // Formats a generic alert message when an otherwise-unhandled database error occurs */

    window.alert("Database \"" + target.result.name +
          "\" UNHANDLED ERROR: " + ev.target.result.error);
};

/**************************************/
B5500SystemConfig.prototype.upgradeConfigSchema = function upgradeConfigSchema(ev) {
    /* Handles the onupgradeneeded event for the System Configuration database.
    Upgrade the schema to the current version. For a new database, creates the
    default configuration and stores it in the database. "ev" is the upgradeneeded
    event. Must be called in the context of the SystemConfiguration object */
    var configStore = null;
    var db = ev.target.result;
    var globalStore = null;
    var namesStore = null;
    var req = ev.target;
    var txn = req.transaction;

    switch (true) {
    case ev.oldVersion < 1:
        if (!this.alertWin.confirm("The retro-B5500 System Configuration database\n" +
                     "does not exist. Do you want to create it?")) {
            txn.abort();
            db.close();
            this.alertWin.alert("System Configuration database creation refused --\n" +
                  "CANNOT CONTINUE.");
        } else {
            globalStore = db.createObjectStore(this.sysGlobalName);
            configStore = db.createObjectStore(
                    this.sysConfigName, {keyPath: "configName", unique: true});
            // The StorageNames store holds strings, so the keypath is simply the stored value.
            namesStore = db.createObjectStore(
                    this.sysStorageNamesName, {keyPath: "", unique: true});

            // Populate a default initial configuration.
            globalStore.put(B5500SystemConfig.prototype.globalConfig, 0);
            configStore.put(B5500SystemConfig.prototype.systemConfig);
            namesStore.put(B5500SystemConfig.prototype.systemConfig.units.DKA.storageName ||
                           B5500SystemConfig.prototype.systemConfig.units.DKB.storageName);
            this.alertWin.alert("System Configuration database created...\n" +
                        "An initial configuration \"" +
                        B5500SystemConfig.prototype.systemConfig.configName +
                        "\" was created and set as current.");
        }
        break;

    default:
        this.alertWin.alert("System Configuration database at\n" +
                "higher version than implementation --\nCANNOT CONTINUE");
    } // switch
};

/**************************************/
B5500SystemConfig.prototype.deleteConfigDB = function deleteConfigDB(onsuccess, onfailure) {
    /* Attempts to permanently delete the System Configuration database. If
    successful, calls the "onsuccess" function passing the resulting event;
    if not successful, calls onfailure passing the resulting event */
    var req;
    var that = this;

    if (this.alertWin.confirm("This will PERMANENTLY DELETE the emulator's\n" +
                "System Configuration Database.\n\n" +
                "Are you sure you want to do this?\n")) {
        if (this.alertWin.confirm("Deletion of the Configuration Database\n" +
                    "CANNOT BE UNDONE.\n\nAre you really sure?\n")) {
            req = window.indexedDB.deleteDatabase(this.configDBName);

            req.onerror = function(ev) {
                that.alertWin.alert("CANNOT DELETE the System Configuration database:\n" + ev.target.error);
                onfailure(ev);
            };

            req.onblocked = function(ev) {
                that.alertWin.alert("Deletion of the System Configuration database is BLOCKED");
            };

            req.onsuccess = function(ev) {
                that.alertWin.alert("System Configuration database successfully deleted.");
                onsuccess(ev);
            };
        }
    }
};

/**************************************/
B5500SystemConfig.prototype.openConfigDB = function openConfigDB(onsuccess, onfailure) {
    /* Attempts to open the System Configuration database. Handles, if necessary,
    a change in database version. If successful, calls the "onsuccess" function
    passing the success event. If not successful, calls the "onfailure" function
    passing the error event */
    var req;                            // IndexedDB open request
    var that = this;

    req = window.indexedDB.open(this.configDBName, this.configDBVersion);

    req.onblocked = function(ev) {
        that.alertWin.alert("Database \"" + that.configDBName + "\" open is blocked");
        that.closeConfigDB();
    };

    req.onupgradeneeded = function(ev) {
        that.upgradeConfigSchema(ev);
    };

    req.onerror = function(ev) {
        onfailure(ev);
        that.db = null;
    };

    req.onsuccess = function(ev) {
        that.db = ev.target.result;
        that.db.onerror = that.genericDBError;  // set up global error handler
        delete that.globalConfig;
        delete that.systemConfig;
        onsuccess(ev);
    };
};

/**************************************/
B5500SystemConfig.prototype.closeConfigDB = function closeConfigDB() {
    /* Closes the IndexedDB instance if it is open */

    if (this.db) {
        this.db.close();
        this.db = null;
    }
};

/**************************************/
B5500SystemConfig.prototype.getSystemConfig = function getSystemConfig(configName, successor) {
    /* Attempts to retrieve the system configuration structure under "configName".
    If "configName" is falsy, retrieves the current default configuration.
    If successful, calls the "successor" function passing the configuration object;
    otherwise calls "successor" passing null. Closes the database after a successful get.
    Displays alerts for any errors encountered */
    var that = this;

    function readConfig(configName) {
        /* Reads the named system configuration structure from the database,
        then calls the successor function with the configuration object */
        var txn = that.db.transaction(that.sysConfigName);

        txn.onerror = function(ev) {
            successor(null);
            that.alertWin.alert("getSystemConfig cannot get config data:\n" +
                                ev.target.error);
        }
        txn.objectStore(that.sysConfigName).get(configName || "").onsuccess = function(ev) {
            that.systemConfig = ev.target.result;
            successor(that.systemConfig);
        };
    }

    function getConfig() {
        /* Retrieve the configuration specified by the outer "configName"
        parameter. Unconditionally retrieve the global configuration structure.
        If configName is falsy, retrieve the configuration with the current
        configuration name in the global structure, otherwise retrieve the one
        named by "configName" */
        var txn;

        if (configName) {
            readConfig(configName);
        } else {
            txn = that.db.transaction(that.sysGlobalName);
            txn.onerror = function(ev) {
                that.alertWin.alert("getSystemConfig cannot get default config name:\n" +
                                    ev.target.error);
                successor(null);
            }
            txn.objectStore(that.sysGlobalName).get(0).onsuccess = function(ev) {
                that.globalConfig = ev.target.result;
                readConfig(that.globalConfig.currentConfigName);
            }
        };
    }

    function onOpenSuccess(ev) {
        getConfig();
    }

    function onOpenFailure(ev) {
        that.systemConfig = null;
        successor(null);
        that.alertWin.alert("getSystemConfig cannot open \"" + that.configDBName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db) {
        getConfig();
    } else {
        this.openConfigDB(onOpenSuccess, onOpenFailure);
    }
};

/**************************************/
B5500SystemConfig.prototype.putSystemConfig = function putSystemConfig(
        config, successor) {
    /* Attempts to store the system configuration structure "config" to the
    database. The configuration name must be in config.configName. If a
    configuration by that name already exists, it will be replaced by "config".
    Unconditionally sets this as the current system configuration.
    If successful, calls "successor" passing the success event */
    var that = this;

    function putConfig() {
        var txn = that.db.transaction([that.sysGlobalName, that.sysConfigName], "readwrite");

        txn.oncomplete = function(ev) {
            that.systemConfig = config;
            successor(ev);
        };

        that.globalConfig.currentConfigName = config.configName;
        txn.objectStore(that.sysGlobalName).put(that.globalConfig, 0);
        txn.objectStore(that.sysConfigName).put(config);
    }

    function onOpenSuccess(ev) {
        putConfig();
    }

    function onOpenFailure(ev) {
        that.systemConfig = null;
        that.alertWin.alert("putSystemConfig cannot open \"" + that.configDBName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db) {
        putConfig();
    } else {
        this.openConfigDB(onOpenSuccess, onOpenFailure);
    }
};

/**************************************/
B5500SystemConfig.prototype.deleteSystemConfig = function deleteSystemConfig(
        configName, successor) {
    /* Attempts to delete the system configuration structure identified by
    "configName" from the database.
    If successful, calls "successor" passing the success event */
    var that = this;

    function deleteConfig() {
        var txn = that.db.transaction([that.sysGlobalName, that.sysConfigName], "readwrite");

        txn.oncomplete = function(ev) {
            if (that.systemConfig.configName == configName) {
                delete that.systemConfig;
            }
            successor(ev);
        };

        txn.objectStore(that.sysConfigName).delete(configName);
        if (that.globalConfig.currentConfigName == configName) {
            that.globalConfig.currentConfigName = "";
            txn.objectStore(that.sysGlobalName).put(that.globalConfig, 0);
        }
    }

    function onOpenSuccess(ev) {
        deleteConfig();
    }

    function onOpenFailure(ev) {
        that.systemConfig = null;
        that.alertWin.alert("deleteSystemConfig cannot open \"" + that.configDBName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db) {
        deleteConfig();
    } else {
        this.openConfigDB(onOpenSuccess, onOpenFailure);
    }
};

/**************************************/
B5500SystemConfig.prototype.addStorageName = function addStorageName(
        storageName, successor) {
    /* Adds a storage subsystem name to the "StorageNames" object store.
    If successful, calls "successor" passing the success event */
    var that = this;

    function addName() {
        var txn = that.db.transaction(that.sysStorageNamesName, "readwrite");

        txn.oncomplete = function(ev) {
            successor(ev);
        };

        txn.objectStore(that.sysStorageNamesName).put(storageName);
    }

    function onOpenSuccess(ev) {
        addName();
    }

    function onOpenFailure(ev) {
        that.systemConfig = null;
        that.alertWin.alert("addStorageName cannot open \"" + that.configDBName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db) {
        addName();
    } else {
        this.openConfigDB(onOpenSuccess, onOpenFailure);
    }
};

/**************************************/
B5500SystemConfig.prototype.removeStorageName = function removeStorageName(
        storageName, successor) {
    /* Removes a storage subsystem name from the "StorageNames" object store.
    If successful, calls "successor" passing the success event */
    var that = this;

    function removeName() {
        var txn = that.db.transaction(that.sysStorageNamesName, "readwrite");

        txn.oncomplete = function(ev) {
            successor(ev);
        };

        txn.objectStore(that.sysStorageNamesName).delete(storageName);
    }

    function onOpenSuccess(ev) {
        removeName();
    }

    function onOpenFailure(ev) {
        that.systemConfig = null;
        that.alertWin.alert("removeStorageName cannot open \"" + that.configDBName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db) {
        removeName();
    } else {
        this.openConfigDB(onOpenSuccess, onOpenFailure);
    }
};

/**************************************/
B5500SystemConfig.prototype.enumerateStorageNames = function enumerateStorageNames(
        successor) {
    /* Enumerates the storage subsystem keys in the "StorageNames" object store
    to an array. If successful, calls "successor" passing the success event
    and the array */
    var that = this;

    function enumerateNames() {
        var names = [];
        var txn = that.db.transaction(that.sysStorageNamesName);

        txn.oncomplete = function(ev) {
            successor(ev, names);
        };

        txn.objectStore(that.sysStorageNamesName).openCursor().onsuccess = function(ev) {
            var cursor = ev.target.result;

            if (cursor) {
                names.push(cursor.key);
                cursor.continue();
            }
        };

    }

    function onOpenSuccess(ev) {
        enumerateNames();
    }

    function onOpenFailure(ev) {
        that.systemConfig = null;
        that.alertWin.alert("enumerateStoragesNames cannot open \"" + that.configDBName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db) {
        enumerateNames();
    } else {
        this.openConfigDB(onOpenSuccess, onOpenFailure);
    }
};


/***********************************************************************
*   System Configuration UI Support                                    *
***********************************************************************/

/**************************************/
B5500SystemConfig.prototype.loadConfigDialog = function loadConfigDialog(config) {
    /* Loads the configuration UI window with the settings from "config" */

    function loadNameList(listID, storeName, keyName) {
        /* Loads a list of names from the specified object store to a <select>.
            "listID" is the DOM id of the <select> list to be loaded.
            "storeName" is the name of the object store.
            "keyName is the name to be selected in the list.
        If "keyName" does not exist in the list obtained from the store, it
        is unconditionally appended to the list and selected */
        var list = this.$$(listID);
        var txn = this.db.transaction(storeName);
        var selected = false;

        while (list.length) {           // empty the <select> list
            list.remove(0);
        }

        txn.objectStore(storeName).openCursor().onsuccess = function(ev) {
            var cursor = ev.target.result;
            var matched;
            var name;

            if (!cursor) {
                if (keyName && !selected) {
                    list.add(new Option(keyName, keyName, true, true));
                }
            } else {
                name = cursor.key;
                matched = (name == keyName);
                list.add(new Option(name, name, matched, matched));
                cursor.continue();
                if (matched) {
                    selected = true;
                }
            }
        };
    }

    if (!config) {
        this.window.close();
    } else {
        loadNameList.call(this, "ConfigNameList", this.sysConfigName, config.configName);
        loadNameList.call(this, "DiskStorageList", this.sysStorageNamesName,
                          config.units.DKA.storageName || config.units.DKB.storageName);

        this.$$("PA").checked = config.PA.enabled;
        this.$$("PB").checked = config.PB.enabled;
        this.$$("PB1L").checked = config.PB1L;

        this.$$("IO1").checked = config.IO1.enabled;
        this.$$("IO2").checked = config.IO2.enabled;
        this.$$("IO3").checked = config.IO3.enabled;
        this.$$("IO4").checked = config.IO4.enabled;

        this.$$("M0").checked = config.memMod[0].enabled;
        this.$$("M1").checked = config.memMod[1].enabled;
        this.$$("M2").checked = config.memMod[2].enabled;
        this.$$("M3").checked = config.memMod[3].enabled;
        this.$$("M4").checked = config.memMod[4].enabled;
        this.$$("M5").checked = config.memMod[5].enabled;
        this.$$("M6").checked = config.memMod[6].enabled;
        this.$$("M7").checked = config.memMod[7].enabled;

        this.$$("SPO").checked = config.units.SPO.enabled;
        this.$$("SPAlgolGlyphs").checked = config.units.SPO.algolGlyphs;

        this.$$("LPA").checked = config.units.LPA.enabled;
        this.$$("LPB").checked = config.units.LPB.enabled;
        this.$$("LPAlgolGlyphs").checked =
                (config.units.LPA.enabled && config.units.LPA.algolGlyphs) ||
                (config.units.LPB.enabled && config.units.LPB.algolGlyphs);

        this.$$("CRA").checked = config.units.CRA.enabled;
        this.$$("CRB").checked = config.units.CRB.enabled;
        this.$$("CPA").checked = config.units.CPA.enabled;
        this.$$("CPAlgolGlyphs").checked = config.units.CPA.algolGlyphs;

        this.$$("PRA").checked = config.units.PRA.enabled;
        this.$$("PRB").checked = config.units.PRB.enabled;
        this.$$("PPA").checked = config.units.PPA.enabled;
        this.$$("PPB").checked = config.units.PPB.enabled;

        this.$$("MTA").checked = config.units.MTA.enabled;
        this.$$("MTB").checked = config.units.MTB.enabled;
        this.$$("MTC").checked = config.units.MTC.enabled;
        this.$$("MTD").checked = config.units.MTD.enabled;
        this.$$("MTE").checked = config.units.MTE.enabled;
        this.$$("MTF").checked = config.units.MTF.enabled;
        this.$$("MTH").checked = config.units.MTH.enabled;
        this.$$("MTJ").checked = config.units.MTJ.enabled;
        this.$$("MTK").checked = config.units.MTK.enabled;
        this.$$("MTL").checked = config.units.MTL.enabled;
        this.$$("MTM").checked = config.units.MTM.enabled;
        this.$$("MTN").checked = config.units.MTN.enabled;
        this.$$("MTP").checked = config.units.MTP.enabled;
        this.$$("MTR").checked = config.units.MTR.enabled;
        this.$$("MTS").checked = config.units.MTS.enabled;
        this.$$("MTT").checked = config.units.MTT.enabled;

        this.$$("DRA").checked = config.units.DRA.enabled;
        this.$$("DRB").checked = config.units.DRB.enabled;

        this.$$("DKA").checked = config.units.DKA.enabled;
        this.$$("DKB").checked = config.units.DKB.enabled;
        this.$$("DFX").checked =
                (config.units.DKA.enabled && config.units.DKA.DFX) ||
                (config.units.DKB.enabled && config.units.DKB.DFX);
        this.$$("FPM").checked =
                (config.units.DKA.enabled && config.units.DKA.FPM) ||
                (config.units.DKB.enabled && config.units.DKB.FPM);

        /***** TEMP to fix configuration structure change *****/
        if (config.terminalUnits) {
            config.units.DCA.terminalUnits = config.terminalUnits;
            delete config.terminalUnits;
        }

        this.$$("DCA").checked = config.units.DCA.enabled;
        this.$$("TU1").checked = config.units.DCA.terminalUnits.TU1.enabled;
        this.$$("TUAdapters1").value = config.units.DCA.terminalUnits.TU1.adapters;
        this.$$("TUBuffers1").value = config.units.DCA.terminalUnits.TU1.buffers;
        this.$$("TUPingPong1").checked = config.units.DCA.terminalUnits.TU1.pingPong;

        this.$$("MessageArea").textContent = "Configuration \"" + config.configName + "\" loaded.";
        this.window.focus();
    }
};

/**************************************/
B5500SystemConfig.prototype.saveConfigDialog = function saveConfigDialog() {
    /* Saves the configuration UI window settings to the System Config database */
    var config;
    var configList = this.$$("ConfigNameList");
    var storageList = this.$$("DiskStorageList");
    var that = this;

    if (configList.length < 1 || configList.selectedIndex < 0) {
        this.alertWin.alert("ERROR: A System Configuration name must be selected");
    } else if (storageList.length < 1 || storageList.selectedIndex < 0) {
        this.alertWin.alert("ERROR: A Disk Storage name must be selected");
    } else {
        config = B5500Util.deepCopy(B5500SystemConfig.prototype.systemConfig);

        config.configName = configList.options[configList.selectedIndex].value;

        config.PA.enabled = this.$$("PA").checked;
        config.PB.enabled = this.$$("PB").checked;
        config.PB1L = this.$$("PB1L").checked;

        config.IO1.enabled = this.$$("IO1").checked;
        config.IO2.enabled = this.$$("IO2").checked;
        config.IO3.enabled = this.$$("IO3").checked;
        config.IO4.enabled = this.$$("IO4").checked;

        config.memMod[0].enabled = this.$$("M0").checked;
        config.memMod[1].enabled = this.$$("M1").checked;
        config.memMod[2].enabled = this.$$("M2").checked;
        config.memMod[3].enabled = this.$$("M3").checked;
        config.memMod[4].enabled = this.$$("M4").checked;
        config.memMod[5].enabled = this.$$("M5").checked;
        config.memMod[6].enabled = this.$$("M6").checked;
        config.memMod[7].enabled = this.$$("M7").checked;

        config.units.SPO.enabled = this.$$("SPO").checked;
        config.units.SPO.algolGyphs = this.$$("SPAlgolGlyphs").checked;

        config.units.LPA.enabled = this.$$("LPA").checked;
        config.units.LPB.enabled = this.$$("LPB").checked;
        config.units.LPA.algolGlyphs = this.$$("LPAlgolGlyphs").checked;
        config.units.LPB.algolGlyphs = this.$$("LPAlgolGlyphs").checked;

        config.units.CRA.enabled = this.$$("CRA").checked;
        config.units.CRB.enabled = this.$$("CRB").checked;
        config.units.CPA.enabled = this.$$("CPA").checked;
        config.units.CPA.algolGlyphs = this.$$("CPAlgolGlyphs").checked;

        config.units.PRA.enabled = this.$$("PRA").checked;
        config.units.PRB.enabled = this.$$("PRB").checked;
        config.units.PPA.enabled = this.$$("PPA").checked;
        config.units.PPB.enabled = this.$$("PPB").checked;

        config.units.MTA.enabled = this.$$("MTA").checked;
        config.units.MTB.enabled = this.$$("MTB").checked;
        config.units.MTC.enabled = this.$$("MTC").checked;
        config.units.MTD.enabled = this.$$("MTD").checked;
        config.units.MTE.enabled = this.$$("MTE").checked;
        config.units.MTF.enabled = this.$$("MTF").checked;
        config.units.MTH.enabled = this.$$("MTH").checked;
        config.units.MTJ.enabled = this.$$("MTJ").checked;
        config.units.MTK.enabled = this.$$("MTK").checked;
        config.units.MTL.enabled = this.$$("MTL").checked;
        config.units.MTM.enabled = this.$$("MTM").checked;
        config.units.MTN.enabled = this.$$("MTN").checked;
        config.units.MTP.enabled = this.$$("MTP").checked;
        config.units.MTR.enabled = this.$$("MTR").checked;
        config.units.MTS.enabled = this.$$("MTS").checked;
        config.units.MTT.enabled = this.$$("MTT").checked;

        config.units.DRA.enabled = this.$$("DRA").checked;
        config.units.DRB.enabled = this.$$("DRB").checked;

        config.units.DKA.DFX = this.$$("DFX").checked;
        config.units.DKA.enabled = this.$$("DKA").checked;
        config.units.DKA.FPM = this.$$("FPM").checked;
        config.units.DKA.storageName = storageList.options[storageList.selectedIndex].value;
        config.units.DKB.DFX = this.$$("DFX").checked;
        config.units.DKB.enabled = this.$$("DKB").checked;
        config.units.DKB.FPM = this.$$("FPM").checked;
        config.units.DKB.storageName = storageList.options[storageList.selectedIndex].value;

        config.units.DCA.enabled = this.$$("DCA").checked;
        config.units.DCA.terminalUnits.TU1.enabled = this.$$("TU1").checked;
        config.units.DCA.terminalUnits.TU1.adapters = this.$$("TUAdapters1").value;
        config.units.DCA.terminalUnits.TU1.buffers = this.$$("TUBuffers1").value;
        config.units.DCA.terminalUnits.TU1.pingPong = this.$$("TUPingPong1").checked;

        if (!(config.PA.enabled || config.PB.enabled)) {
            this.alertWin.alert("ERROR: At least one Processor must be selected");
        } else if (config.PB1L ? !config.PB.enabled : !config.PA.enabled) {
            this.alertWin.alert("ERROR: No P1 Processor selected");
        } else if (!(config.IO1.enabled || config.IO2.enabled ||
                     config.IO3.enabled || config.IO4.enabled)) {
            this.alertWin.alert("ERROR: No I/O Units selected");
        } else if (!config.memMod[0].enabled) {
            this.alertWin.alert("ERROR: At a minimum, Memory[0] must be selected");
        } else {
            if (!config.units.DKA.enabled) {
                this.alertWin.alert("WARNING: DKA is required to load from disk");
            }
            if (!config.units.CRA.enabled) {
                this.alertWin.alert("WARNING: CRA is required to load from cards");
            }
            if (!config.units.SPO.enabled) {
                this.alertWin.alert("WARNING: SPO is required for MCP operation");
            }
            this.$$("MessageArea").textContent = "Saving configuration \"" + config.configName + "\".";
            this.putSystemConfig(config, function(ev) {
                that.alertWin.alert("System configuration \"" + config.configName +
                        "\" saved and\nselected as current.");
                that.window.close();
            });
        }
    }
};

/**************************************/
B5500SystemConfig.prototype.newConfigDialog = function newConfigDialog(ev) {
    /* Prompts the user for a new configuration name, clones the currently-
    selected configuration, and displays the clone properties in the window */
    var config;
    var newName;

    newName = this.alertWin.prompt("Enter the name of the new configuration");
    if (!newName) {
        this.alertWin.alert("New configuration must have a name.");
    } else {
        config = B5500Util.deepCopy(this.systemConfig || B5500SystemConfig.prototype.systemConfig);
        config.configName = newName;
        this.loadConfigDialog(config);
        this.$$("MessageArea").textContent = "New configuration cloned for \"" +
                config.configName + "\".";
    }
};

/**************************************/
B5500SystemConfig.prototype.deleteConfigDialog = function deleteConfigDialog(ev) {
    /* Initiates deletion of the currently-selected system configuration */
    var configName;
    var nameList = this.$$("ConfigNameList");
    var selection = nameList.selectedIndex;
    var that = this;

    if (selection < 0) {
        this.alertWin.alert("No configuration selected for delete");
    } else {
        configName = nameList.options[selection].value;
        if (this.alertWin.confirm("Are you sure you want to delete the configuration \"" +
                    configName + "\"?")) {
            this.deleteSystemConfig(configName, function(ev) {
                that.alertWin.alert("Configuration \"" + configName + "\" deleted.");
                that.window.close();
            });
        }
    }
};

/**************************************/
B5500SystemConfig.prototype.selectConfigDialog = function selectConfigDialog(ev) {
    /* Initiates display of the currently-selected system configuration */
    var configName;
    var nameList = this.$$("ConfigNameList");
    var selection = nameList.selectedIndex;

    if (selection < 0) {
        this.alertWin.alert("No configuration selected");     // should never happen
    } else {
        configName = nameList.options[selection].value;
        this.getSystemConfig(configName,
                B5500CentralControl.bindMethod(this, this.loadConfigDialog));
    }
};

/**************************************/
B5500SystemConfig.prototype.openStorageUI = function openStorageUI() {
    /* Opens the Disk Storage configuration UI, passing the name of the
    currently-selected storage name */
    var storageName;
    var storage;
    var storageList = this.$$("DiskStorageList");
    var selection = storageList.selectedIndex;

    if (selection < 0) {
        this.alertWin.alert("No storage name selected");
    } else {
        storageName = storageList.options[selection].value;
        storage = new B5500DiskStorageConfig();
        storage.openStorageUI(storageName);
    }
};

/**************************************/
B5500SystemConfig.prototype.newStorageDialog = function newStorageDialog(ev) {
    /* Prompts the user for a new storage name and opens a window to create
    the new disk storage subsystem */
    var newName;
    var storage;
    var storageList = this.$$("DiskStorageList");

    newName = this.alertWin.prompt("Enter the name of the new Disk Storage subsystem");
    if (!newName) {
        this.alertWin.alert("The new Disk Storage subsystem must have a name.");
    } else {
        storage = new B5500DiskStorageConfig();
        storage.openStorageUI(newName);
        storageList.add(new Option(newName, newName, true, true));
    }
};

/**************************************/
B5500SystemConfig.prototype.closeConfigUI = function closeConfigUI() {
    /* Closes the system configuration update dialog */

    this.closeConfigDB();
    this.alertWin = window;             // revert alerts to the global window
    if (this.window) {
        if (!this.window.closed) {
            this.window.close();
        }
        this.window = null;
    }
}

/**************************************/
B5500SystemConfig.prototype.openConfigUI = function openConfigUI() {
    /* Opens the system configuration update dialog and displays the current
    default system configuration */

    function configUI_Open(ev) {
        this.getSystemConfig(null,
                B5500CentralControl.bindMethod(this, this.loadConfigDialog));
        this.$$("ConfigNewBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, this.newConfigDialog));
        this.$$("ConfigDeleteBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, this.deleteConfigDialog));
        this.$$("ConfigNameList").addEventListener("change",
                B5500CentralControl.bindMethod(this, this.selectConfigDialog));
        this.$$("DiskEditBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, this.openStorageUI));
        this.$$("DiskNewBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, this.newStorageDialog));
        this.$$("SaveBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, this.saveConfigDialog));
        this.$$("CancelBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, function(ev) {
                    this.window.close();
        }));
        this.window.addEventListener("unload",
                B5500CentralControl.bindMethod(this, this.closeConfigUI), false);
    }

    this.doc = null;
    this.window = window.open("../webUI/B5500SystemConfig.html", this.configDBName,
            "location=no,scrollbars,resizable,width=640,height=700");
    this.window.moveTo(screen.availWidth-this.window.outerWidth-40,
               (screen.availHeight-this.window.outerHeight)/2);
    this.window.focus();
    this.alertWin = this.window;
    this.window.addEventListener("load",
            B5500CentralControl.bindMethod(this, configUI_Open), false);
};
