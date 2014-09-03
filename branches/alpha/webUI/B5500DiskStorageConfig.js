/***********************************************************************
* retro-b5500/webUI B5500DiskStorageConfig.js
************************************************************************
* Copyright (c) 2014, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Disk Storage Configuration management object.
*
* Defines the disk configuration used internally by the emulator, along
* with the methods used to manage that configuration data.
*
* The configuration data consists of two parts, (a) the processors, I/O
* units, memory modules, and peripheral devices that make up the system,
* and (b) a disk storage configuration that defines the disk Electronics
* Units (EU) and sizes and types of each of the EUs. This module addresses
* the second part.
*
* Each disk storage subsystem is maintained as a separate IndexedDB database.
* Each database contains a single-object store named "CONFIG" that holds the
* configuration data for that subsystem. In addition, there are one or more
* "EUn" object stores, where "n" is a one- or two-digit decimal number in the
* range 0-19. Each of these object stores represents the storage capacity for
* one Electronics Unit and its associated Storage Units (SU). At present, each
* object in an EU store represents one segment of 30 B5500 words (240 6-bit
* characters) and is implemented as a Uint8Array(240). The SUs are not
* represented individually, as their address space was monolithic within an EU
* (i.e., one I/O could cross SU boundaries but not EU boundaries).
*
* The "CONFIG" object store contains one object which in turn contains a set
* of objects of the form:
*
*       EUn: {size: 200000, slow: false, lockoutMask: 0}
*
* where
*
*       n:              is the EU number (0-19).
*       size:           is the capacity of the EU in segments:
*                           40000-200000 for Model-I disk
*                           80000-400000 for Model-IB (slow) disk.
*       slow:           indicates Model-I (false) or Model-IB (true) disk,
*       lockoutMask:    is a binary integer, the low-order 20 bits of which
*                       represent the 20 disk lockout switches. A bit in this
*                       mask will be 1 if the associated switch is on. If
*                       this integer is negative, that indicates the master
*                       lockout switch is on. [not presently implemented]
*
* Model-I SU disks rotate at 1500 RPM, thus have an average access time of
* 20ms. Each Model-I SU stores 40,000 30-word segments. Model-IB (slow) SU
* disks have twice the capacity but half the speed: they rotate at 750 RPM,
* and thus have an average access time of 40ms. Each Model-IB SU stores 80,000
* 30-word segments. The disks have fixed heads, so rotational latency is the
* only component of access time; there is no delay due to radial head
* positioning.
*
* In addition to the "EUn" structures, the "CONFIG" object contains two global
* properties:
*
*       configLevel:    the revision level of the CONFIG object.
*       storageName:    the name of the storage subsystem. This should match
*                       the name of the IndexedDB database (db.name).
*
* The "EUn" objects in "CONFIG" MUST match one-for-one the "EUn" object stores
* in the database. Object stores without a matching "CONFIG" entry entry will
* not be used by the emulator (the EU will be reported as being not ready).
* "CONFIG" entries without a matching object store will cause an error when the
* disk device driver attempts to create an IndexedDB transaction that references
* the missing EU.
*
* Once created, EU object stores are permanent and must not be deleted. They
* also must not be configured with a smaller size than they currently have.
* These restrictions are designed to prevent problems with the MCP file
* system, where removing storage space may render some files or parts of
* files inaccessible. In the configuration UI, you may add EUs, or you may
* increase the capacity of existing EUs, but you cannot delete or shrink
* them. Thus, the number of SUs for an existing EU may be increased, and
* Model-I disk may be changed to Model-IB (slow) disk, but not vice versa.
*
* If you need to reduce the storage size of a disk subsystem, your only
* option is to dump it to tape, delete it, create a new, smaller one, and
* then load the new subsystem from tape.
*
* EU0-9 may be used in any system configuration. EU10-19 may be used only
* in system configurations that have DKB enabled and do NOT have a Disk File
* Exchange (DFX) enabled. Any EUs in the range 10-19 will be ignored by a
* system that has a DFX. For systems without a DFX, EU0-9 will be accessed
* by DKA; EU11-19 will be accessed by DKB.
*
* Note that software support for a DFX is enabled by an MCP compile-time
* option ("$SET DFX=TRUE"). The setting of the MCP's DFX option *MUST MATCH*
* the DFX setting in the system configuration.
*
*                            W A R N I N G !
*                            ---------------
*       Attempting to run a DFX-enabled MCP on a non-DFX hardware
*       configuration, or vice versa, will likely corrupt the data
*       in the disk subsystem and require a Cold Start to resolve.
*
* Also note that in emulator 0.20 and earlier, there was a single disk storage
* database named "B5500DiskUnit". That database also contained a single-object
* store named "CONFIG", but with a simpler set of "EUn" objects that indicated
* only the size of the EU. The "B5500DiskUnit" name is retained as a default
* storage name for the initial disk subsystem to be created. If the emulator
* encounters a database with the older form of EU object, it will use it
* implying slow=true and lockoutMask=0. If you modify the EU configuration in
* any way, however, the older form of object will be converted to the new form.
*
* With this approach, disk subsystem databases from older versions of the
* emulator will work with the later versions, but ONLY IF THE DISK CONFIGURATION
* IS NOT MODIFIED. Once you click the "SAVE" button on the Disk Subsystem
* Configuration dialog, the "CONFIG" structure will be updated to the newer
* format, and the database will no longer work with older versions of the
* emulator.
*
************************************************************************
* 2014-08-19  P.Kimpel
*   Original version, from B5500SystemConfig.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500DiskStorageConfig() {
    /* Constructor for the DiskStorageConfig object */

    this.db = null;                     // the IndexedDB database connection (null if closed)
    this.storageConfig = null;          // the current storage subsystem configuration
    this.window = null;                 // configuration UI window object
    this.alertWin = window;             // current base window for alert/confirm/prompt
}

/**************************************/
B5500DiskStorageConfig.prototype.dbConfigLevel = 1;     // configuration object version
B5500DiskStorageConfig.prototype.storageConfigName = "CONFIG";

// Current disk storage configuration object
B5500DiskStorageConfig.prototype.storageConfig = {
        configLevel: B5500DiskStorageConfig.prototype.dbConfigLevel,
        storageName: B5500SystemConfiguration.prototype.sysDefaultStorageName
        // The "EUn" strucures will be added here as they are created.
};

// Disk Electronics Unit configuration object
B5500DiskStorageConfig.prototype.defaultEUConfig = {
        size: 200000,   // 5 Model-I SUs
        slow: false,    // Model-I SUs
        lockoutMask: 0  // no lockout switches set [not yet implemented]
};

/**************************************/
B5500DiskStorageConfig.prototype.$$ = function $$(id) {
    return this.window.document.getElementById(id);
    }

/**************************************/
B5500DiskStorageConfig.prototype.genericDBError = function genericDBError(ev) {
    // Formats a generic alert message when an otherwise-unhandled database error occurs */

    alert("Database \"" + target.result.name +
          "\" UNHANDLED ERROR: " + ev.target.result.error);
};


/***********************************************************************
*   Disk Storage Database Configuration Interface                      *
***********************************************************************/

/**************************************/
B5500DiskStorageConfig.prototype.upgradeStorageSchema = function upgradeStorageSchema(ev) {
    /* Handles the onupgradeneeded event for this Disk Storage database. Upgrades
    the schema to the current version. For a new database, creates the default
    configuration and stores it in the database. "ev" is the upgradeneeded event.
    Must be called in the context of the DiskStorageConfig object */
    var aborted = false;
    var configStore = null;
    var db = ev.target.result;
    var req = ev.target;
    var sysConfig;
    var txn = req.transaction;
    var that = this;

    function putConfig(config) {
        /* Stores "config" as the configuration object to the "CONFIG"
        object store */
        config.configLevel = B5500DiskStorageConfig.prototype.dbConfigLevel;
        config.storageName = db.name;
        configStore.put(config, 0);
        that.storageConfig = config;
        sysConfig = new B5500SystemConfig();
        sysConfig.addStorageName(db.name, function successor() {});
    }

    function applyNewConfig(config) {
        /* Applies the new configuration structure in "CONFIG" to the database.
        If CONFIG contains EU* structures that are not in the database, those
        new structures are created. If the database contains EU* structures
        that are not in CONFIG, they are ignored (the storage UI should
        prevent this from happening, however) */
        var name;
        var euRex = /^EU\d{1,2}$/;

        for (name in config) {                  // for each property in config
            if (name.search(euRex) == 0) {      // filter name for "EUn" or "EUnn"
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name); // create a new EU store
                }
            }
        }
        putConfig(config);
    }

    function createDefaultConfig() {
        /* Create an initial disk subsystem configuration for a new database,
        containing a single EU having the default EU configuration */
        var config = B5500Util.deepCopy(B5500DiskStorageConfig.prototype.storageConfig);
        var euName = "EU0";

        db.createObjectStore(euName);
        config[euName] = B5500Util.deepCopy(B5500DiskStorageConfig.prototype.defaultEUConfig);
        putConfig(config);
    }

    /*** Start of upgradeStorageSchema ***/

    txn.onabort = function upgradeOnAbort(ev) {
        // do nothing
    };

    if (ev.oldVersion < 1) {
        // New database -- start by creating a store for the config structure.
        if (!this.alertWin.confirm("Disk Storage database \"" + db.name +
                     "\"\ndoes not exist. Do you want to create it?")) {
            aborted = true;
            txn.abort();
            db.close();
        } else {
            this.alertWin.alert("Disk Storage database \"" + db.name + "\" created.");
        }
    }

    if (aborted) {
        this.alertWin.alert("Disk Storage database creation aborted.");
    } else if (db.objectStoreNames.contains(this.storageConfigName)) {
        // Normal upgrade: get the updated config structure from the DB and apply it
        configStore = txn.objectStore(this.storageConfigName);
        configStore.get(0).onsuccess = function(ev) {
            applyNewConfig(that.normalizeStorageConfig(ev.target.result, db.Name));
        };
    } else {
        // No config structure exists in the database. We assume this is a
        // database just being created, so simply create a Disk Storage CONFIG
        // structure for it.
        configStore = db.createObjectStore(this.storageConfigName);
        createDefaultConfig();
    }
};

/**************************************/
B5500DiskStorageConfig.prototype.deleteStorageDB = function deleteStorageDB(
        storageName, onsuccess, onfailure) {
    /* Attempts to permanently delete the Disk Storage database named in
    "storageName". If successful, calls the "onsuccess" function passing
    the resulting event; if not successful, calls onfailure passing the
    resulting event */
    var req;
    var sysConfig;
    var that = this;

    if (this.alertWin.confirm("This will PERMANENTLY DELETE the\n" +
                "Disk Storage database \"" + storageName + "\".\n\n" +
                "Are you sure you want to do this?\n")) {
        if (this.alertWin.confirm("Deletion of the Disk Storage database\n" +
                    "CANNOT BE UNDONE.\n\nAre you really sure?\n")) {
            if (this.db && this.db.name == storageName) {
                this.storageConfig = null;
                this.closeStorageDB();
            }

            req = window.indexedDB.deleteDatabase(storageName);

            req.onerror = function(ev) {
                that.alertWin.alert("CANNOT DELETE Disk Storage database:\n" + ev.target.error);
                onfailure(ev);
            };

            req.onblocked = function(ev) {
                that.alertWin.alert("Deletion of Disk Storage database is BLOCKED");
            };

            req.onsuccess = function(ev) {
                that.alertWin.alert("Disk Storage database \"" + storageName +
                                    "\"\n successfully deleted.");
                onsuccess(ev);
                sysConfig = new B5500SystemConfig();
                sysConfig.removeStorageName(storageName, function successor() {});
            };
        }
    }
};

/**************************************/
B5500DiskStorageConfig.prototype.modifyStorageSchema =
        function modifyStorageSchema(onsuccess, onfailure) {
    /* Called to trigger a schema upgrade. Before calling this method, the new
    EU configuration must be established and stored in the "CONFIG" store.
    This method simply closes the database and then reopens with with the next
    higher version number. That will trigger the onupgradeneeded event, and
    upgradeStorageSchema() will examine the new config structure, creating any
    new EUs as necessary. The "onsuccess" or "onfailure" callbacks are called
    as appropriate */
    var dbName = this.db.name;
    var ver = this.db.version;
    var req;                            // IndexedDB open request
    var that = this;

    this.closeStorageDB();
    req = window.indexedDB.open(dbName, ver+1); // trigger the schema upgrade

    req.onblocked = function(ev) {
        that.alertWin.alert("Database \"" + dbName +
                            "\"\n open for schema upgrade is blocked");
    };

    req.onupgradeneeded = function(ev) {
        that.upgradeStorageSchema(ev);
    };

    req.onerror = function(ev) {
        onfailure(ev);
        that.db = null;
    };

    req.onsuccess = function(ev) {
        that.db = ev.target.result;
        that.db.onerror = that.genericDBError;  // set up global error handler
        // Since we know we just went through an onupgradeneeded event, we know
        // this database now has a "CONFIG" structure, so the extra tests in
        // openStorageDB() are not necessary.
        that.alertWin.alert("Database \"" + dbName + "\" schema upgrade successful");
        delete that.storageConfig;
        onsuccess(ev);
    };
};

/**************************************/
B5500DiskStorageConfig.prototype.openStorageDB = function openStorageDB(
        storageName, onsuccess, onfailure) {
    /* Attempts to open the Disk Storage database named in "storageName".
    Handles, if necessary, a change in database version. If successful,
    calls the "onsuccess" function passing the success event. If not successful,
    calls the "onfailure" function passing the error event.

    This process is just a little bit nasty, because the only time we can
    modify the DB schema to add new EUs is during an onupgradeneeded event.
    That event is fired only when the DB version increases. Therefore, we
    must normally open the database without specifying a version, as we have
    no aprori idea what it might me. There are three possibilities:
         1. This is an open for a database that does not currently exist.
            The old version is 0 and the new version will be 1. The onupgrade-
            needed event will automatically fire, and upgradeStorageSchema()
            will create the "CONFIG" structure and an initial default EU.
         2. This is an open for an existing database that has a "CONFIG"
            structure. This is the simplest case, and proceeds like a normal
            IndexedDB open.
         3. This is an open for an existing database that does not have a
            "CONFIG" structure. We have no idea what it is, so we throw up
            an alert, call onfailure(), and close the database before we do
            any damage. The failure routine can, if it wishes, still access
            the database.
    */
    var req;                            // IndexedDB open request
    var that = this;

    req = window.indexedDB.open(storageName);   // open the current version, whatever it may be

    req.onblocked = function(ev) {
        that.alertWin.alert("Database \"" + storageName + "\" open is blocked");
        that.closeStorageDB();
    };

    req.onupgradeneeded = function(ev) {
        that.upgradeStorageSchema(ev);
    };

    req.onerror = function(ev) {
        onfailure(ev);
        that.db = null;
    };

    req.onsuccess = function(ev) {
        that.db = ev.target.result;
        that.db.onerror = that.genericDBError;  // set up global error handler
        if (that.db.objectStoreNames.contains(that.storageConfigName)) {
            delete that.storageConfig;
            onsuccess(ev);
        } else {
            that.alertWin.alert("ERROR: Disk Storage database \"" + storageName +
                    "\"\nhas no CONFIG store");
            onfailure(ev);
            that.closeStorageDB();
        }
    };
};

/**************************************/
B5500DiskStorageConfig.prototype.closeStorageDB = function closeStorageDB() {
    /* Closes the IndexedDB instance if it is open */

    if (this.db) {
        this.db.close();
        this.db = null;
    }
};

/**************************************/
B5500DiskStorageConfig.prototype.normalizeStorageConfig = function normalizeStorageConfig(config, storageName) {
    /* Reformats as necessary an older-format storage CONFIG structure to the
    current structure format and returns the current format */
    var eu;
    var name;
    var newConfig = null;
    var euRex = /^EU\d{1,2}$/;

    switch(true) {
    case config.configLevel || 0 < 1:
        // Original CONFIG format from 0.20 and earlier.
        newConfig = B5500Util.deepCopy(B5500DiskStorageConfig.prototype.storageConfig);
        newConfig.configLevel = 1;
        newConfig.storageName = storageName;

        for (name in config) {                  // for each property in config
            if (name.search(euRex) == 0) {      // filter name for "EUn" or "EUnn"
                eu = config[name];
                if (eu.constructor === Number) {    // An older-format EU structure -- convert it
                    eu = B5500Util.deepCopy(B5500DiskStorageConfig.prototype.defaultEUConfig);
                    eu.size = config[name];
                    eu.slow = false;
                }
                newConfig[name] = eu;
            }
        } // for name
        break;

    default:
        newConfig = config;
    } // switch true

    if (newConfig.configLevel != this.dbConfigLevel) {
        this.alertWin.alert("ERROR: Cannot normalize existing CONFIG\nlevel " +
                            newConfig.configLevel + " to current level " + that.dbConfigLevel);
    }

    return newConfig;
};

/**************************************/
B5500DiskStorageConfig.prototype.getStorageConfig = function getStorageConfig(storageName, successor) {
    /* Attempts to retrieve the Disk Storage structure under "storageName".
    If successful, calls the "successor" function passing the configuration object;
    otherwise calls "successor" passing null. Displays alerts for any errors encountered */
    var that = this;

    function readConfig() {
        /* Reads the named system configuration structure from the database,
        then calls the successor function with the configuration object */
        var txn = that.db.transaction(that.storageConfigName);

        txn.objectStore(that.storageConfigName).get(0).onsuccess = function(ev) {
            that.storageConfig = that.normalizeStorageConfig(ev.target.result, storageName);
            successor(that.storageConfig);
        };
    }

    function onOpenFailure(ev) {
        that.storageConfig = null;
        that.alertWin.alert("getStorageConfig cannot open \"" + storageName +
                            "\" database:\n" + ev.target.error);
        successor(that.storageConfig);
    }

    if (this.db && this.db.name == storageName) {
        readConfig();
    } else {
        this.closeStorageDB();
        this.openStorageDB(storageName, readConfig, onOpenFailure);
    }
};

/**************************************/
B5500DiskStorageConfig.prototype.putStorageConfig = function putStorageConfig(
        config, successor) {
    /* Attempts to store the structure "config" to the Disk Storage
    database. The database name must be in config.storageName.
    If successful, calls "successor" passing the success event */
    var that = this;

    function putConfig() {
        var txn = that.db.transaction(that.storageConfigName, "readwrite");

        txn.onerror = function(ev) {
            that.alertWin.alert("putStorageConfig put error: " + ev.target.error);
        }

        txn.oncomplete = function(ev) {
            that.storageConfig = config;
            successor(ev);
        };

        txn.objectStore(that.storageConfigName).put(config, 0);
    }

    function onOpenFailure(ev) {
        that.storageConfig = null;
        that.alertWin.alert("putStorageConfig cannot open \"" + storageName +
                            "\" database:\n" + ev.target.error);
    }

    if (this.db && this.db.name == config.storageName) {
        putConfig();
    } else {
        this.closeStorageDB();
        this.openStorageDB(config.storageName, putConfig, onOpenFailure);
    }
};


/***********************************************************************
*   Disk Storage Subsystem Configuration UI Support                    *
***********************************************************************/

/**************************************/
B5500DiskStorageConfig.prototype.loadStorageDialog = function loadStorageDialog(config) {
    /* Loads the configuration UI window with the settings from "config" */
    var enableBox;
    var euName;
    var eu;
    var eux;
    var sizeList;
    var suCount;
    var suSize;
    var typeList;
    var x;

    if (!config) {
        this.window.close();
    } else {
        this.$$("StorageName").textContent = config.storageName;
        for (eux=0; eux<20; ++eux) {
            euName = "EU" + eux.toString();
            enableBox = this.$$(euName);
            sizeList = this.$$(euName + "SU");
            typeList = this.$$(euName + "Type");
            if (!(euName in config)) {
                suCount = suSize = 0;
                enableBox.checked = false;
                enableBox.disabled = false;
                sizeList.selectedIndex = 0;
                typeList.selectedIndex = 0;
                typeList.options[0].disabled = false;
            } else {
                eu = config[euName];
                suSize = (eu.slow ? 80000 : 40000);
                suCount = Math.max(Math.min(Math.floor((eu.size+suSize-1)/suSize), 5), 1);
                enableBox.checked = true;
                enableBox.disabled = true;
                sizeList.selectedIndex = suCount-1;
                typeList.selectedIndex = (eu.slow ? 1 : 0);
                typeList.options[0].disabled = eu.slow;
            }

            for (x=sizeList.length-1; x>=0; --x) {
                sizeList.options[x].disabled = (x+1 < suCount);
            }
        } // for eux

        this.$$("MessageArea").textContent = "Storage subsystem \"" + config.storageName + "\" loaded.";
        this.window.focus();
    }
};

/**************************************/
B5500DiskStorageConfig.prototype.saveStorageDialog = function saveStorageDialog(ev) {
    /* Saves the configuration UI window settings to the System Config database.
    A new config object is cloned from the prototype, then the current configuration
    is merged with the settings on the window form into the new object. If there
    are no errors, the new object is stored in "CONFIG" and the window is closed */
    var config = this.storageConfig;    // current subsystem configuration object
    var enableBox;                      // ref to EU check box
    var fatal = false;                  // true if any errors
    var eu;                             // current EU config structure
    var euName;                         // current EU name
    var euSize;                         // EU size in sectors from UI form
    var euSlow;                         // true => Model-IB selected on UI form
    var eux;                            // current EU index
    var newConfig;                      // new configuration object
    var sizeList;                       // ref to SUs list
    var suCount;                        // number of SUs from UI form
    var suSize;                         // new SU size based on euSlow
    var that = this;                    // for closure use
    var typeList;                       // ref to disk-type list
    var upgradeNeeded = false;          // true if schema upgrade needed

    function finalFailure(ev) {
        that.alertWin.alert("Disk Storage \"" + newConfig.storageName +
                "\"\nconfiguration update failed: " + ev.target.error);
    }

    function finalSuccess(ev) {
        that.alertWin.alert("Disk Storage \"" + newConfig.storageName +
                "\"\nconfiguration updated successfully.");
        that.window.close();
    }

    function putConfigSuccess(ev) {
        /* Called back on a successful put of the new configuration structure.
        Initiates a schema update if the new configuration requires one */

        that.storageConfig = newConfig;
        if (upgradeNeeded) {
            that.modifyStorageSchema(finalSuccess, finalFailure);
        } else {
            finalSuccess(ev);
        }
    }

    newConfig = B5500Util.deepCopy(B5500DiskStorageConfig.prototype.storageConfig);
    newConfig.storageName = config.storageName;

    for (eux=0; eux<20; ++eux) {
        euName = "EU" + eux.toString();
        enableBox = this.$$(euName);
        sizeList = this.$$(euName + "SU");
        typeList = this.$$(euName + "Type");
        if (euName in config) {
            eu = config[euName];
            if (!enableBox.checked) {
                fatal = true;
                this.alertWin.alert("ERROR: Cannot remove " + euName + ".");
            }
        } else if (enableBox.checked) {
            eu = B5500Util.deepCopy(B5500DiskStorageConfig.prototype.defaultEUConfig);
            eu.size = 0;
            eu.slow = false;
            upgradeNeeded = true;
        } else {
            eu = null;
        }

        if (enableBox.checked) {
            euSlow = typeList.selectedIndex == 1;
            suSize = (euSlow ? 80000 : 40000);
            suCount = sizeList.selectedIndex + 1;
            euSize = suSize*suCount;
            if (eu.slow && !euSlow) {
                fatal = true;
                this.alertWin.alert("ERROR: Cannot change " + euName +
                                    " from\nModel-IB (slow) to Model-I disk.");
            } else if (euSize < eu.size) {
                fatal = true;
                this.alertWin.alert("ERROR: Cannot reduce size of " + euName + ".");
            } else {
                eu.size = euSize;
                eu.slow = euSlow;
            }
        }

        if (eu) {
            newConfig[euName] = eu;
        }
    } // for eux

    if (!fatal) {
        this.$$("MessageArea").textContent = "Saving Disk Storage configuration \"" +
                newConfig.storageName + "\".";
        this.putStorageConfig(newConfig, putConfigSuccess);
    }
};

/**************************************/
B5500DiskStorageConfig.prototype.deleteStorageDialog = function deleteStorageDialog(storageName) {
    /* Initiates deletion of the currently-selected system configuration */

    function deleteFailed(ev) {
        that.alertWin.alert("Deletion of database \"" + storageName +
                "\" failed: " + ev.target.error);
    }
    function deleteOK(ev) {
        that.window.close();
    }

    this.deleteStorageDB(storageName, deleteOK, deleteFailed);
};

/**************************************/
B5500DiskStorageConfig.prototype.closeStorageUI = function closeStorageUI() {
    /* Closes this Storage Subsystem update dialog */

    this.closeStorageDB();
    this.alertWin = window;             // revert alerts to the global window
    if (this.window) {
        if (!this.window.closed) {
            this.window.close();
        }
        this.window = null;
    }
}

/**************************************/
B5500DiskStorageConfig.prototype.openStorageUI = function openStorageUI(storageName) {
    /* Opens this Storage Subsystem update dialog and displays the disk
    subsystem configuration for "storageName" */
    var that = this;

    function storageUI_Open(ev) {
        this.getStorageConfig(storageName,
                B5500CentralControl.bindMethod(this, this.loadStorageDialog));
        this.$$("StorageDeleteBtn").addEventListener("click", function(ev) {
                that.deleteStorageDialog(storageName);
        });
        this.$$("SaveBtn").addEventListener("click",
                B5500CentralControl.bindMethod(this, this.saveStorageDialog));
        this.$$("CancelBtn").addEventListener("click", function(ev) {
                that.window.close();
        });
        this.window.addEventListener("unload",
                B5500CentralControl.bindMethod(this, this.closeStorageUI), false);
    }

    this.window = window.open("", this.storageConfigName);
    if (this.window) {
        this.window.close();
        this.window = null;
    }
    this.doc = null;
    this.window = window.open("../webUI/B5500DiskStorageConfig.html", storageName+"_Config",
            "location=no,scrollbars,resizable,width=560,height=480");
    this.window.moveTo(screen.availWidth-this.window.outerWidth-80,
               (screen.availHeight-this.window.outerHeight)/2);
    this.window.focus();
    this.alertWin = this.window;
    this.window.addEventListener("load",
            B5500CentralControl.bindMethod(this, storageUI_Open), false);
};
