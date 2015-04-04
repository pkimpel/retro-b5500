A maximum configuration of the Burroughs B5500 allows for:

  * Two central processing units.
  * Eight independent memory modules (each 4,096 48-bit words).
  * Four floating input/output channels.
  * Sixteen magnetic tape drives.
  * Two billion characters (2GB) of on-line disk storage.
  * Two line printers.
  * Two card readers.
  * Two paper tape readers.
  * One card punch.
  * One paper tape punch.
  * One supervisory console.
  * 240 communication line buffers.

In October-1970, Burroughs renamed the B5500 to B5700 as part of the introduction of the 700-series family (that inluded the B6700 and B7700) and added new capabilities:

  * Support for B6700 DataComm for communications
  * Support for adding B6700 memory modules as auxiliary memory.

B5700 AuxMem was implemented primarily as an overlay mechanism, and the extra memory appeared as the deprecated B5000-era drum storage devices. These appear as devices DRA and DRB in the MCP. Use of the drum device interface limited the auxiliary memory to 32kWords each, for a total of 64kWords of AuxMem.