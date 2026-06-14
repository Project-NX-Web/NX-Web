import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseNro } from './nro';
import { parseRomFs } from './romfs';
import { VirtualFileSystem } from './vfs';

function buildNroBuffer(opts: { textSize?: number; roSize?: number; dataSize?: number; includeAset?: boolean } = {}): Uint8Array {
  const textSize = opts.textSize ?? 0x100;
  const roSize = opts.roSize ?? 0x80;
  const dataSize = opts.dataSize ?? 0x40;

  const textOffset = 0x80; // After the header
  const roOffset = textOffset + textSize;
  const dataOffset = roOffset + roSize;
  const totalSize = dataOffset + dataSize;

  const buffer = new Uint8Array(opts.includeAset ? totalSize + 0x38 + 16 : totalSize);
  const view = new DataView(buffer.buffer);

  // Branch instruction at 0x00 (MOV X0, X0 — effectively NOP)
  buffer.set([0x00, 0x00, 0x00, 0x14], 0x00); // unconditional branch

  // NRO0 magic at 0x10
  buffer[0x10] = 0x4E; // 'N'
  buffer[0x11] = 0x52; // 'R'
  buffer[0x12] = 0x4F; // 'O'
  buffer[0x13] = 0x30; // '0'

  // Version
  view.setUint32(0x14, 0, true);

  // Total size
  view.setUint32(0x18, totalSize, true);

  // Segment offsets and sizes
  view.setUint32(0x20, textOffset, true);
  view.setUint32(0x24, textSize, true);
  view.setUint32(0x28, roOffset, true);
  view.setUint32(0x2C, roSize, true);
  view.setUint32(0x30, dataOffset, true);
  view.setUint32(0x34, dataSize, true);
  view.setUint32(0x38, 0x1000, true); // bssSize

  // Module ID (32 bytes at offset 0x40)
  for (let i = 0; i < 32; i++) buffer[0x40 + i] = i;

  // Fill segments with recognizable patterns
  for (let i = 0; i < textSize; i++) buffer[textOffset + i] = 0xAA;
  for (let i = 0; i < roSize; i++) buffer[roOffset + i] = 0xBB;
  for (let i = 0; i < dataSize; i++) buffer[dataOffset + i] = 0xCC;

  // Optional ASET section
  if (opts.includeAset) {
    const asetOffset = totalSize;
    buffer[asetOffset] = 0x41;     // 'A'
    buffer[asetOffset + 1] = 0x53; // 'S'
    buffer[asetOffset + 2] = 0x45; // 'E'
    buffer[asetOffset + 3] = 0x54; // 'T'
    view.setUint32(asetOffset + 4, 0, true); // version

    // Icon: offset=0x38, size=16
    const asetView = new DataView(buffer.buffer, asetOffset);
    asetView.setBigUint64(0x08, 0x38n, true); // icon offset
    asetView.setBigUint64(0x10, 16n, true);   // icon size
    asetView.setBigUint64(0x18, 0n, true);    // nacp offset
    asetView.setBigUint64(0x20, 0n, true);    // nacp size
    asetView.setBigUint64(0x28, 0n, true);    // romfs offset
    asetView.setBigUint64(0x30, 0n, true);    // romfs size

    // Icon data
    for (let i = 0; i < 16; i++) buffer[asetOffset + 0x38 + i] = 0xDD;
  }

  return buffer;
}

describe('NRO Parser', () => {
  it('parses valid NRO header', () => {
    const data = buildNroBuffer();
    const nro = parseNro(data);

    expect(nro.header.magic).toBe('NRO0');
    expect(nro.header.textSize).toBe(0x100);
    expect(nro.header.roSize).toBe(0x80);
    expect(nro.header.dataSize).toBe(0x40);
    expect(nro.header.bssSize).toBe(0x1000);
  });

  it('extracts text/ro/data segments', () => {
    const nro = parseNro(buildNroBuffer());

    expect(nro.textSegment.length).toBe(0x100);
    expect(nro.roSegment.length).toBe(0x80);
    expect(nro.dataSegment.length).toBe(0x40);

    expect(nro.textSegment[0]).toBe(0xAA);
    expect(nro.roSegment[0]).toBe(0xBB);
    expect(nro.dataSegment[0]).toBe(0xCC);
  });

  it('parses ASET section when present', () => {
    const nro = parseNro(buildNroBuffer({ includeAset: true }));

    expect(nro.asset).not.toBeNull();
    expect(nro.asset!.magic).toBe('ASET');
    expect(nro.icon).not.toBeNull();
    expect(nro.icon!.length).toBe(16);
    expect(nro.icon![0]).toBe(0xDD);
  });

  it('handles NRO without ASET section', () => {
    const nro = parseNro(buildNroBuffer());

    expect(nro.asset).toBeNull();
    expect(nro.icon).toBeNull();
    expect(nro.nacp).toBeNull();
    expect(nro.romfs).toBeNull();
  });

  it('rejects invalid magic', () => {
    const data = buildNroBuffer();
    data[0x10] = 0x00; // corrupt magic
    expect(() => parseNro(data)).toThrow('Invalid NRO magic');
  });

  it('extracts module ID', () => {
    const nro = parseNro(buildNroBuffer());
    expect(nro.header.moduleId.length).toBe(32);
    expect(nro.header.moduleId[0]).toBe(0);
    expect(nro.header.moduleId[31]).toBe(31);
  });

  it('parses the official switchbrew nx-hbmenu fixture when present', () => {
    const fixturePath = 'hbmenu.nro';
    if (!existsSync(fixturePath)) {
      return;
    }

    const nro = parseNro(readFileSync(fixturePath));

    expect(nro.header.magic).toBe('NRO0');
    expect(nro.header.size).toBeGreaterThan(nro.textSegment.length);
    expect(nro.asset).not.toBeNull();
    expect(nro.icon).not.toBeNull();
    expect(nro.nacp).not.toBeNull();
    expect(nro.romfs).not.toBeNull();

    const romFs = parseRomFs(nro.romfs!);
    expect(romFs.has('assets.zip')).toBe(true);

    const vfs = new VirtualFileSystem();
    vfs.mountRomFs(romFs);
    expect(vfs.exists('romfs/assets.zip')).toBe(true);
  });
});
