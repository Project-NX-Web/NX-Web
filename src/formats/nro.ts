// NRO Format Parser
// NRO is the homebrew executable format for Nintendo Switch.
// Structure: NRO header → segments (text/ro/data) → optional ASET (asset) section

export interface NroHeader {
  magic: string;           // "NRO0"
  version: number;
  size: number;            // Total NRO file size
  textOffset: number;
  textSize: number;
  roOffset: number;
  roSize: number;
  dataOffset: number;
  dataSize: number;
  bssSize: number;
  moduleId: Uint8Array;    // 32 bytes build ID
}

export interface NroAssetHeader {
  magic: string;           // "ASET"
  version: number;
  icon: { offset: bigint; size: bigint };
  nacp: { offset: bigint; size: bigint };
  romfs: { offset: bigint; size: bigint };
}

export interface NroFile {
  header: NroHeader;
  asset: NroAssetHeader | null;
  textSegment: Uint8Array;
  roSegment: Uint8Array;
  dataSegment: Uint8Array;
  icon: Uint8Array | null;
  nacp: Uint8Array | null;
  romfs: Uint8Array | null;
}

export function parseNro(data: Uint8Array): NroFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // NRO starts at offset 0 for homebrew, but may have a MOD0 prefix
  // The actual NRO header starts where we find "NRO0" magic
  let headerOffset = 0;

  // Check for NRO0 magic at offset 0x10 (standard location after unused branch instruction)
  const magic = String.fromCharCode(
    data[0x10], data[0x11], data[0x12], data[0x13]
  );

  if (magic !== 'NRO0') {
    throw new Error(`Invalid NRO magic: expected "NRO0", got "${magic}"`);
  }

  headerOffset = 0x10;

  const header: NroHeader = {
    magic,
    version: view.getUint32(headerOffset + 0x04, true),
    size: view.getUint32(headerOffset + 0x08, true),
    textOffset: view.getUint32(headerOffset + 0x10, true),
    textSize: view.getUint32(headerOffset + 0x14, true),
    roOffset: view.getUint32(headerOffset + 0x18, true),
    roSize: view.getUint32(headerOffset + 0x1c, true),
    dataOffset: view.getUint32(headerOffset + 0x20, true),
    dataSize: view.getUint32(headerOffset + 0x24, true),
    bssSize: view.getUint32(headerOffset + 0x28, true),
    moduleId: data.slice(headerOffset + 0x30, headerOffset + 0x50),
  };

  const textSegment = data.slice(header.textOffset, header.textOffset + header.textSize);
  const roSegment = data.slice(header.roOffset, header.roOffset + header.roSize);
  const dataSegment = data.slice(header.dataOffset, header.dataOffset + header.dataSize);

  // Check for ASET (asset) section after the NRO body
  let asset: NroAssetHeader | null = null;
  let icon: Uint8Array | null = null;
  let nacp: Uint8Array | null = null;
  let romfs: Uint8Array | null = null;

  const assetOffset = header.size;
  if (assetOffset + 0x38 <= data.length) {
    const asetMagic = String.fromCharCode(
      data[assetOffset], data[assetOffset + 1],
      data[assetOffset + 2], data[assetOffset + 3]
    );

    if (asetMagic === 'ASET') {
      const asetView = new DataView(data.buffer, data.byteOffset + assetOffset, data.byteLength - assetOffset);
      asset = {
        magic: asetMagic,
        version: asetView.getUint32(0x04, true),
        icon: {
          offset: asetView.getBigUint64(0x08, true),
          size: asetView.getBigUint64(0x10, true),
        },
        nacp: {
          offset: asetView.getBigUint64(0x18, true),
          size: asetView.getBigUint64(0x20, true),
        },
        romfs: {
          offset: asetView.getBigUint64(0x28, true),
          size: asetView.getBigUint64(0x30, true),
        },
      };

      const absBase = assetOffset;
      if (asset.icon.size > 0n) {
        const off = absBase + Number(asset.icon.offset);
        icon = data.slice(off, off + Number(asset.icon.size));
      }
      if (asset.nacp.size > 0n) {
        const off = absBase + Number(asset.nacp.offset);
        nacp = data.slice(off, off + Number(asset.nacp.size));
      }
      if (asset.romfs.size > 0n) {
        const off = absBase + Number(asset.romfs.offset);
        romfs = data.slice(off, off + Number(asset.romfs.size));
      }
    }
  }

  return { header, asset, textSegment, roSegment, dataSegment, icon, nacp, romfs };
}
