# WebUI Configuring the System #


From its initial release, the retro-B5500 emulator has had a configuration mechanism that allowed you to select the system components and I/O peripherals that make up the emulated environment. Prior to release 1.00, though, that configuration was specified by a static Javascript file. If you were running your own web server, you could change that file quite easily, but if you were relying on an external web site to host the emulator, you were limited to whatever configuration was hosted on that server.

Starting with release 1.00, the emulator now has a more flexible configuration mechanism. Individual users can specify the system and I/O components they wish to have for their local instance. They can also have multiple, named configurations, and easily switch among them. In addition, users can now create multiple disk subsystems with different configurations and assign a disk subsystem to a system configuration. Multiple system configurations may share the same disk subsystem, and the disk subsystem assigned to a given configuration can be easily changed.

This wiki page describes the new configuration mechanism for both system components and disk subsystems.


# Overview of Configuration Components #

This section gives a brief overview of the components of system configurations and disk subsystems.

## System Components ##

A B5500 computer system is made up from some combination of the following components and peripheral I/O units:

  * A Central Control Unit. This is required. It connects the major system components -- processors, I/O Control Units, and memory modules. It also provides an exchange to connect the I/O Control Units to the peripheral devices.
  * One or two processors, PA and PB. One of the selected processors must be designated as the control processor, P1.
  * One to four Input/Output Control Units, IO1 through IO4. Most systems had at least three of these. They are I/O channels, and have direct access to memory through Central Control.
  * One to eight 4K-word memory modules. Most systems eventually had a full complement of eight modules, totaling 32K-words of memory.
  * A Teletype printer/keyboard unit, known as the SPO. This is required in order for the system to run the MCP.
  * One or two card readers, CRA and CRB.
  * One card punch, CPA.
  * One or two line printers, LPA and LPB.
  * One or two paper-tape readers, PRA and PRB.
  * One or two paper-tape punches, PPA and PPB. A system can have a maximum of three paper-tape devices, either two readers and one punch, or one reader and two punches. The emulator does not presently support paper tape devices, however.
  * One to 16 7-track magnetic tape units, MTA through MTT, with letters G, I, O, and Q not used.
  * One or two 32K-word high-speed drums, DRA and DRB. These were a standard feature of B5000 systems that were converted to B5500s, but most later systems did not have them. The emulator does not presently support drum devices.
  * One or two Disk File Control Units (DFCU), DKA and DKB. DKA is required to boot the system from Head-per-Track disk. The DFCU can also be associated with a Disk File Exchange (DFX), which allows it to connect to multiple EUs (disk units). The DFX also allows two DFCUs to service a common set of EUs. See the Disk Subsystem section next for more detail on disk configurations.

A system configuration specifies the subset of these components that will be used by the emulator in a given instance. On a real B5500, changing the set of system components generally required the system to be powered off first. The emulator also requires that configuration changes take place only when the system is in a powered-off state.

## Disk Subsystem ##

One of the elements that distinguished the B5500 from its B5000 predecessor was the Head-per-Track disk subsystem. A disk subsystem can be configured in a number of ways, using the following components:

  * Disk File Control Units (DFCUs). As mentioned above, a B5500 can have one or two of these, DKA and DKB. These contain the logic to interface the disk units to the I/O Control Units. A DFCU can connect directly to a single Electronics Unit (EU), or through a Disk File Exchange (DFX) to a maximum of five EUs. One DFCU can support up to two DFX units, or a maximum of ten EUs.
  * Electronics Units (EUs), numbered `EU0` through `EU19`. An EU contains the common electronics and air pressure controls for up to five Storage Units.
  * Storage Units (SUs), numbered 1 through 5. An SU contains four 30-inch aluminum disk platters that are the storage medium. These disk platters rotate within a framework that holds fixed heads. As there is no head movement, the only components of access time are rotational latency and data transfer time. There are two models of SU, but all SUs for an EU must be the of same type:
    * Model-I units rotate at 1500 RPM and hold 40,000 30-word sectors of data. Thus, each SU holds 1.2M 48-bit words or 9.6M 6-bit characters of data. A fully-configured EU can therefore hold 48M 6-bit characters of data.
    * Model-IB units have twice the storage capacity of Model-I disks, but accomplish that by rotating at half the speed, 750 RPM. These are sometimes referred to as "bulk" or "slow" disks.

A DFCU can support up to ten EUs, for a total of 480M 6-bit characters using Model-I SUs. If you have two DFCUs, you have a choice on how they can be associated with EUs:

  * You can support up to 20 EUs, but each EU can be accessed by only one DFCU. `EU0`-`9` will be addressed by DKA; `EU10`-`19` will be addressed by DKB.
  * You can support up to 10 EUs, numbered `EU0`-`9`, with both DFCUs able to access any EU through the DFX. Unless you need the storage capacity of more than ten EUs, this second approach is the one you should choose, as it generally allows more disk I/Os to operate in parallel.

The EUs are the addressable I/O unit. An I/O operation can cross SU boundaries, but not an EU boundary. The MCP always allocates a disk area (row, extent) wholly within the address range for a single EU.

The MCP considers the disk subsystem, however it was configured, to be a monolithic storage space. Programs running under the MCP do not address any of the physical components of the disk subsystem. From the perspective of user-level software, there is just "disk."


# Configuring System Components #

To establish a system configuration for the emulator, you first configure the system components you need, and then add a disk subsystem to that configuration. This section discusses configuring the system components.

The emulator stores system configurations in a small IndexedDB database named "`retro-B5500-Config`". This database is separate from the ones used for disk subsystems. It is managed entirely by the configuration interface.

To modify the system configuration, create a new configuration, or select a previously-defined configuration for use, the emulator must be in a powered-off state. It is in this state when you first open the Console window, and after you click the **POWER OFF** button on the Console.

To open the system configuration interface, simply click the B5500 logo on the right side of the Console, under the Burroughs logo, when the emulator is in a powered-off state. Normally this logo reads "retro-B5500," but if you have previously clicked the Burroughs logo to put the Console in "purist" mode, the logo will simply read "B 5500". The configuration interface will open the System Configuration dialog window that will look similar to this:

> https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/System-Config-Dialog.PNG

At the top of the dialog is a pull-down list of system configurations you can choose from. Initially, the only name listed will be "`Default`", which is the configuration that the emulator creates automatically the first time you load it. See [WebUI Getting Started](WebUIGettingStarted.md) for a description of this default configuration.

When you first open the configuration dialog, the "current" configuration will be loaded into the window. This is the configuration that will be used by the emulator when the system is next powered on. To load a different configuration into the dialog window, simply select it from the pull-down list.

There are four buttons on the dialog that you use to control maintenance of the configurations:

  * **NEW** -- Click this button to initiate the creation of a new system configuration. The dialog will prompt you for a name for the new configuration. Configuration names may contain any combination of characters and are case-sensitive. After supplying the new name, select the configuration components as described below and click the **SAVE** button to store the new configuration in the emulator's configuration database.
  * **DELETE** -- Click this button to delete the configuration currently selected in the pull-down list to its left. The dialog will prompt you for confirmation before deleting the configuration, but once accomplished, the delete cannot be undone.
  * **CANCEL** -- Click this button to discard any changes you have made on the configuration dialog (except deletion of one or more configurations) and close the dialog window.
  * **SAVE** -- Click this button to save any changes you have made on the configuration dialog and close the dialog window. Clicking this button will also establish the configuration being saved as the "current" configuration. To make another previously-defined configuration the current one, simply open the configuration dialog, select the desired configuration from the pull-down list, and click **SAVE**.

The remaining buttons on the dialog apply to disk subsystems, and will be discussed in the next section.

You may have as many system configurations as you wish. You may modify and switch among them at any time the emulator is in a powered-off state.

You select components for a system configuration by simply checking their corresponding boxes on the configuration dialog. Central Control is implicitly included in every configuration; it does not have a selection on the dialog. There are a few constraints to keep in mind when selecting components for a configuration:

  * At least one processor must be selected in order for the system to run.
  * One of the selected processors must be designated as the control processor, P1. If only PA is selected, leave the **PB is P1** checkbox unchecked, designating PA as P1. If only PB is selected, check the **PB is P1** checkbox, designating PB as P1. If both processors are selected, it is your choice which should be P1.
  * At least one I/O Control Unit must be selected in order for the system to run. The MCP generally runs best with at least three I/O units.
  * At least memory module M0 must be selected. The system will not boot without M0 present. In most cases, you will want to run with all eight memory modules. It is possible to run with "holes" in the module configuration; the MCP will allocate memory around the holes. Attempting to run the MCP without module M1, or with fewer than a total of six memory modules, may prove to be problematic.
  * The SPO must be selected in order to run the MCP.
  * Paper tape and drum units are not presently supported by the emulator. Their checkboxes are disabled.
  * Disk File Control Unit DKA must be selected in order to load from disk, and therefore to run the MCP. DKB is optional, as is the DFX. File Protect Memory (FPM) is presently not supported by the emulator; its checkbox is disabled. See the next section for more information on configuring disk subsystems and components.
  * If disk is included in the configuration, you must select a disk subsystem from the **Storage name** pull-down list.
  * The Data Communications adapter, DCA, is optional, but should be included if you want to run the Timesharing MCP and CANDE. At present, the emulator supports only one fixed teletype station; thus the additional controls under the DCA checkbox are disabled.

The SPO, line printers, and card punch have an additional option labeled "Algol Glyphs." These checkboxes set the default mode of those devices for translating the five special Algol characters on output. When the checkbox is checked, the special Algol characters will be output as their corresponding Unicode glyphs. When the box is unchecked, those characters will be output using their ASCII substitutions. This setting can be overridden temporarily on the individual devices. See the respective wiki pages for the devices for details on how to do this.

Note that you can easily create a system configuration that is either non-functional (e.g., no processor) or that will not support the MCP. The emulator will refuse to perform a load if the minimum components necessary for a running system are not present.


# Configuring Disk Subsystems #

Prior to release 1.00, the emulator supported a single disk subsystem using an IndexedDB database named "`B5500DiskUnit`". This subsystem had a fixed configuration of two EUs, each with five Model-I SUs, for a total of 200,000 30-word sectors, or 96M 6-bit characters of storage.

As part of the new configuration mechanism introduced in release 1.00, you can now modify the configuration of a disk subsystem to provide more storage. You can select between Model-I and Model-IB SUs to trade off access time vs. storage space. You can also create multiple disk subsystems and associate them with one or more system configurations. Only one disk subsystem can be associated and used with a given system configuration at a time, however.

A disk subsystem from an earlier release can be used with 1.00 and later releases. Such a subsystem can continue to be used with earlier releases as well, subject to the constraints discussed in [Upgrading from Earlier Emulator Versions](WebUIConfiguringTheSystem#Upgrading_from_Earlier_Emulator_Versions.md), below.

Each disk subsystem is implemented as a separate IndexedDB database. Each subsystem has a name you assign when the subsystem is created. That name is also the name of the IndexedDB database for the subsystem. Disk subsystems from earlier versions of the emulator continue to have the name `B5500DiskUnit`.

Disk subsystems are associated with system configurations by means of the pull-down list on the System Configuration dialog window labeled **Storage name**. This list contains the names of all disk subsystems known to the emulator. The entry selected in this list will become the subsystem that is associated with the configuration when the **SAVE** button on the configuration dialog is clicked.

Next to the pull-down list are two buttons that allow you to access the disk subsystem configuration interface:

  * **NEW** -- Click this button to create a new disk subsystem and its IndexedDB database. The dialog will prompt you for the name of the new subsystem and then display the Disk Storage Configuration dialog discussed below. If you supply the name of an existing disk subsystem, that subsystem will be updated as if you had clicked the **EDIT** button for it instead.
  * **EDIT** -- Click this button to view or modify the subsystem currently selected in the pull-down list.

Clicking either of these buttons will open the Disk Storage Configuration dialog, which will look similar to this:

> https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU//Disk-Config-Dialog.PNG

The name of the new or selected disk subsystem is shown in the area labeled **Subsystem**. The storage configuration dialog is controlled using three buttons:

  * **DELETE** -- Click this yellow button after opening an existing disk subsystem configuration to delete that subsystem and its IndexedDB database. The dialog will ask for confirmation that you want to delete the subsystem. Once accomplished, the delete cannot be undone. After deleting the database, the dialog window will close. Note that if you attempt to delete a subsystem that was opened as new, the dialog window will simply close without creating the new subsystem.
  * **CANCEL** -- Click this button to close the dialog window without modifying or creating the disk subsystem.
  * **SAVE** -- Click this button to save the current disk subsystem configuration, close the dialog window, and return to the System Configuration dialog window.

The remainder of the dialog has a set of 20 groups of controls, labeled `EU0` through `EU20`. Each of these represents one Disk Electronics Unit in the configuration, and each has the following controls:

  * A checkbox. Checking the box will include the EU in the configuration. If the box is not checked, the other controls are ignored.
  * A pull-down list to select the number of SUs, `1` to `5`, to be configured for this EU.
  * A pull-down list to select to the model of SU to be configured for this EU, "`I`" or "`IB`". The model selection applies to all of the SUs for that EU.

The primary constraint on configuration of a disk subsystem is that once storage space has been assigned to a disk subsystem, it cannot be removed. Once you click the **SAVE** button, any items you have selected on the Disk Subsystem Configuration dialog become a permanent part of the subsystem. The primary reason for this constraint is that, since the B5500 MCP considers disk to be a monolithic resource, parts of files could be spread across multiple EUs and located anywhere on the respective disk units. Removing storage space from the configuration may cause parts of files to disappear, so the emulator does not allow this.

This constraint manifests itself in three ways on the configuration dialog window:

  1. Once an EU is included in a subsystem, it may not be removed. Its checkbox will be disabled.
  1. The number of SUs specified for an EU may be increased, but not decreased. Selections for smaller numbers of SUs are disabled in the pull-down list.
  1. An EU with Model-I SUs may be changed to Model-IB SUs, but not the reverse. Since Model-IB SUs have twice the storage capacity of Model-Is, switching from Model-IB to Model-I would reduce the space allocated to the subsystem. If "`IB`" is selected in the pull-down list, the "`I`" selection is disabled.

If you absolutely must reduce the size of a disk subsystem, the only way to do this that the emulator supports is to dump the files to tape using the MCP `?DUMP` or `?UNLOAD` control-card command, delete the disk subsystem, recreate it, Cold Start the new subsystem, and reload the files using the MCP `?LOAD` or `?ADD` command.

Another constraint on disk subsystem configuration concerns the number of DFCUs in the system configuration, whether a DFX is included in the system configuration, and the EU numbers selected for the disk subsystem:

  * A configuration with a single DFCU (i.e., DKA) can support up to 10 EUs. These must be numbered in the range of `EU0`-`9`.
  * A configuration with two DFCUs and no DFX can support up to 20 EUs, with `EU0`-`9` being addressed by DKA and `EU10`-`19` addressed by DKB.
  * A configuration with two DFCUs and the DFX enabled can support up to 10 EUs, numbered in the range `EU0`-`9`. Either DFCU can address any EU, although a given EU can be addressed by only one DFCU at a time. `EU10`-`19` are not addressable in this configuration. This choice generally gives the best performance, as it increases the chance that multiple disk I/Os can occur in parallel.

IndexedDB implementations in web browsers generally allocate physical disk space on the workstation incrementally, as sectors that had previously been unwritten are written for the first time. Thus, there is generally little, if any, penalty for configuring a disk subsystem that is significantly larger than you initially need.

Also note that most browsers have a limit on the amount of physical disk space an IndexedDB database may use without approval from the user. This limit varies, but is often in the range of 10-50MB. If you are loading files from tape, or running programs under the emulator that are creating new disk files, and notice that the emulator appears to hang -- check the Console window for an alert requesting permission to use more disk space. Since other windows, such as the SPO, are often on top of the Console window, this alert may not be visible until the Console window is brought to the top and given the focus.

Finally, note that IndexedDB databases are subject to the "same-origin" policy within the browser. This means that access to an IndexedDB database is constrained in two ways:

  1. You must use the same browser. IndexedDB implementations vary from browser to browser, and are likely incompatible with each other. An IndexedDB database created by Google Chrome cannot be accessed by Mozilla Firefox.
  1. You must access the web site hosting the emulator using the same host name and port number. For example, our hosting site for the emulator can be accessed using either `phkimpel.us` or `www.phkimpel.us` (we recommend the latter). Even though those two host names reference the same set of files on the same server, they are considered to be separate origins, and will have separate sets of IndexedDB databases. A disk subsystem created using the emulator loaded from one host name will be inaccessible to an emulator loaded from the other.


# Creating an Initial Configuration #

When you load the emulator into a browser on a workstation for the first time, the emulator will automatically create a default system configuration and disk subsystem when the emulator is first powered on. This configuration is generally adequate for most people in their initial use of the emulator.

See [Create the Initial System Configuration](WebUIGettingStarted#Create_the_Initial_System_Configuration.md) for details on how this occurs and [Default System Configuration](WebUIGettingStarted#Default_System_Configuration.md) for a description of the components in the default configuration.

You can, of course, use the configuration mechanism described above in this wiki to modify that default configuration and create one that is more suited to your needs. You can also leave that default configuration as is and create one or more additional configurations with different components and disk subsystems.

If you want to inhibit establishment of that default configuration and create your own from scratch, however, you must create that configuration before you power on the emulator for the first time. After loading the emulator into the browser, simply click the B5500 logo to open the System Configuration dialog. That dialog will show a configuration entry for `Default` and a disk subsystem entry for `B5500DiskUnit`. The default system configuration will have been created, but the disk subsystem at this point will not have been created yet. You can proceed to create a new system configuration by clicking the **NEW** button. Afterwards, you can delete the original `Default` configuration or not, as you prefer.


# Upgrading from Earlier Emulator Versions #

The static system configuration used in emulator releases before 1.00 cannot be brought forward into later versions of the emulator, although you can modify the default configuration or create a new one to reproduce its characteristics. Disk subsystems are persistent, however, and the IndexedDB databases from earlier versions of the emulator can still be used without change on release 1.00 and later versions.

Disk subsystems created by release 1.00 and later versions of the emulator cannot be used by earlier versions. The format of the configuration data stored within the subsystem database has changed in a way that earlier versions cannot use.

Disk subsystems created by versions prior to 1.00 can be used by 1.00 and later versions. Such subsystems can also continue to be used by versions of the emulator earlier than 1.00, _provided the configuration of the disk subsystem is not changed_. Once you modify the configuration of a disk subsystem, the configuration data stored in its database is converted to the new format and the subsystem is no longer usable by earlier versions of the emulator. If you plan to run multiple versions of the emulator from the same host server, you should keep this restriction in mind.