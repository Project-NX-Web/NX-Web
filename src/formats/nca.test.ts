import { describe, expect, it } from 'vitest';
import {
  decryptAesCtr,
  encryptAesXtsWithTweak,
  parseKeysFile,
  splitNcaHeaderKeys,
} from './crypto';
import {
  NcaEncryptionType,
  NcaFsType,
  decryptNcaHeader,
  decryptNcaSection,
  parseNcaHeader,
} from './nca';

function hex(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function buildPlainNcaHeader(): Uint8Array {
  const header = new Uint8Array(0x600);
  const view = new DataView(header.buffer);

  header.set(hex('4e434133'), 0x200);
  header[0x204] = 0; // Download distribution
  header[0x205] = 0; // Program content
  header[0x206] = 1; // key generation
  header[0x207] = 0; // key area encryption key index
  view.setBigUint64(0x208, 0x1000n, true);
  view.setBigUint64(0x210, 0x0100000000000001n, true);
  view.setUint32(0x21c, 0x06000000, true);

  view.setUint32(0x240, 2, true);
  view.setUint32(0x244, 4, true);
  view.setUint8(0x248, NcaFsType.RomFS);
  view.setUint8(0x249, NcaEncryptionType.AesCtr);
  view.setUint8(0x24a, 1);

  view.setUint8(0x402, 0); // FsType RomFS
  view.setUint8(0x404, NcaEncryptionType.AesCtr);
  view.setUint8(0x405, 1);

  return header;
}

describe('NCA header and section decryption', () => {
  it('decrypts and parses an encrypted NCA header', async () => {
    const keySet = parseKeysFile(`
      header_key = ${'00'.repeat(32)}
      key_area_key_application_01 = ${'11'.repeat(16)}
    `);
    const plainHeader = buildPlainNcaHeader();
    const { key1, key2 } = splitNcaHeaderKeys(keySet.headerKey!);
    const encryptedHeader = await encryptAesXtsWithTweak(plainHeader, key1, key2, new Uint8Array(16));
    const nca = new Uint8Array(0x600);
    nca.set(encryptedHeader, 0);

    const decrypted = await decryptNcaHeader(nca, keySet);
    expect(decrypted.slice(0x200, 0x204)).toEqual(hex('4e434133'));

    const parsed = parseNcaHeader(nca, decrypted);
    expect(parsed.header.magic).toBe('NCA3');
    expect(parsed.header.fsEntries).toHaveLength(1);
    expect(parsed.header.fsEntries[0].startOffset).toBe(0x400);
    expect(parsed.header.fsEntries[0].encryptionType).toBe(NcaEncryptionType.AesCtr);
  });

  it('decrypts an AES-CTR NCA section with the resolved section key', async () => {
    const sectionKey = hex('000102030405060708090a0b0c0d0e0f');
    const counter = new Uint8Array(16);
    counter[15] = 7;
    const plainSection = hex('48656c6c6f204e4341');
    const encryptedSection = await decryptAesCtr(plainSection, sectionKey, counter);
    const entry = {
      startOffset: 0,
      endOffset: encryptedSection.length,
      fsType: NcaFsType.RomFS,
      encryptionType: NcaEncryptionType.AesCtr,
      generation: 0,
    };

    const decrypted = await decryptNcaSection(encryptedSection, entry, sectionKey, counter);
    expect(decrypted).toEqual(plainSection);
  });

  it('returns unencrypted sections unchanged', async () => {
    const section = hex('1122334455');
    const entry = {
      startOffset: 0,
      endOffset: section.length,
      fsType: NcaFsType.RomFS,
      encryptionType: NcaEncryptionType.None,
      generation: 0,
    };

    await expect(decryptNcaSection(section, entry, new Uint8Array(16))).resolves.toEqual(section);
  });
});
