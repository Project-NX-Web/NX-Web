import { describe, it, expect } from 'vitest';
import {
  parseKeysFile,
  parseTitleKeysFile,
  decryptAesCtr,
  encryptAesCtr,
  decryptAesXts,
  decryptAesXtsWithTweak,
  splitNcaHeaderKeys,
  resolveNcaSectionKey,
  decryptTitleKey,
  deriveAreaKey,
  aesCmac,
  validateKeySet,
  bytesToHex,
} from './crypto';

describe('Key File Parser', () => {
  it('parses prod.keys format', () => {
    const content = `
header_key = 00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
key_area_key_application_00 = aabbccddeeff00112233445566778899
key_area_key_application_01 = 112233445566778899aabbccddeeff00
titlekek_00 = ffeeddccbbaa99887766554433221100
# comment line
`;
    const keys = parseKeysFile(content);

    expect(keys.headerKey).not.toBeNull();
    expect(keys.headerKey!.length).toBe(32);
    expect(keys.headerKey![0]).toBe(0x00);
    expect(keys.headerKey![1]).toBe(0x11);

    expect(keys.areaKeys.size).toBe(2);
    expect(keys.areaKeys.has(0)).toBe(true);
    expect(keys.areaKeys.has(1)).toBe(true);

    expect(keys.titleKeks.size).toBe(1);
    expect(keys.titleKeks.get(0)![0]).toBe(0xFF);
  });

  it('parses title.keys format', () => {
    const content = `
01000320000000000000000000000000 = aabbccddeeff00112233445566778899
02000640000000000000000000000000 = 112233445566778899aabbccddeeff00
`;
    const titleKeys = parseTitleKeysFile(content);

    expect(titleKeys.size).toBe(2);
    expect(titleKeys.has('01000320000000000000000000000000')).toBe(true);
    expect(titleKeys.get('01000320000000000000000000000000')![0]).toBe(0xAA);
  });

  it('ignores invalid lines', () => {
    const content = `
invalid line without equals
# comment
= no key name
key_without_value =
header_key = zzzz_not_hex
header_key = aabbccdd
`;
    const keys = parseKeysFile(content);
    // "aabbccdd" is valid hex but only 4 bytes — still parsed
    expect(keys.headerKey).not.toBeNull();
    expect(keys.headerKey!.length).toBe(4);
  });
});

describe('AES-CTR Encryption/Decryption', () => {
  it('round-trips data correctly', async () => {
    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) key[i] = i;

    const counter = new Uint8Array(16);
    counter[15] = 1;

    const plaintext = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"

    const encrypted = await encryptAesCtr(plaintext, key, counter);
    expect(encrypted.length).toBe(5);
    expect(encrypted).not.toEqual(plaintext);

    const decrypted = await decryptAesCtr(encrypted, key, counter);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces correct output for known vector', async () => {
    // NIST AES-CTR test vector (AES-128)
    // Key: 2b7e151628aed2a6abf7158809cf4f3c
    // Counter (initial): f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff
    // Plaintext: 6bc1bee22e409f96e93d7e117393172a
    // Ciphertext: 874d6191b620e3261bef6864990db6ce

    const key = new Uint8Array([
      0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
      0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c
    ]);

    const counter = new Uint8Array([
      0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7,
      0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff
    ]);

    const plaintext = new Uint8Array([
      0x6b, 0xc1, 0xbe, 0xe2, 0x2e, 0x40, 0x9f, 0x96,
      0xe9, 0x3d, 0x7e, 0x11, 0x73, 0x93, 0x17, 0x2a
    ]);

    const expected = new Uint8Array([
      0x87, 0x4d, 0x61, 0x91, 0xb6, 0x20, 0xe3, 0x26,
      0x1b, 0xef, 0x68, 0x64, 0x99, 0x0d, 0xb6, 0xce
    ]);

    const encrypted = await encryptAesCtr(plaintext, key, counter);
    expect(bytesToHex(encrypted)).toBe(bytesToHex(expected));
  });
});

describe('AES-XTS NCA Header Decryption', () => {
  it('matches the NIST AES-XTS-AES-128 test vector', async () => {
    const key1 = hex('2b7e151628aed2a6abf7158809cf4f3c');
    const key2 = hex('829526457f1eb175d2a0d3cab75f5465');
    const ciphertext = hex('4e8a953ec2fb5a3fb829c6a8fab62113');
    const plaintext = hex('6bc1bee22e409f96e93d7e117393172a');
    const tweak = hex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');

    const decrypted = await decryptAesXtsWithTweak(ciphertext, key1, key2, tweak);
    expect(decrypted).toEqual(plaintext);
  });

  it('splits a 32-byte NCA header_key into XTS key pair', () => {
    const headerKey = new Uint8Array(32);
    for (let i = 0; i < headerKey.length; i++) headerKey[i] = i;

    const keys = splitNcaHeaderKeys(headerKey);
    expect(bytesToHex(keys.key1)).toBe('000102030405060708090a0b0c0d0e0f');
    expect(bytesToHex(keys.key2)).toBe('101112131415161718191a1b1c1d1e1f');
  });

  it('validates prod.keys completeness and rejects weak header keys', () => {
    const complete = parseKeysFile(`
      header_key = ${'00'.repeat(32)}
      key_area_key_application_00 = ${'11'.repeat(16)}
      titlekek_00 = ${'22'.repeat(16)}
    `);
    expect(validateKeySet(complete)).toEqual([]);

    const missingHeader = parseKeysFile(`
      key_area_key_application_00 = ${'11'.repeat(16)}
    `);
    expect(validateKeySet(missingHeader)).toContain('prod.keys is missing header_key');

    const shortHeader = parseKeysFile('header_key = aabbccdd');
    expect(validateKeySet(shortHeader)).toContain('header_key must be exactly 32 bytes for NCA AES-XTS decryption');
  });

  it('resolves NCA section keys from rights-id title keys or key-area keys', async () => {
    const rightsId = hex('01000320000000000000000000000000');
    const titleKey = hex('aabbccddeeff00112233445566778899');
    const areaKey = hex('112233445566778899aabbccddeeff00');
    const keys = parseKeysFile(`
      header_key = ${'00'.repeat(32)}
      key_area_key_application_01 = ${bytesToHex(areaKey)}
    `);
    keys.titleKeys.set(bytesToHex(rightsId), titleKey);

    expect(resolveNcaSectionKey(keys, rightsId, 1)).toEqual(titleKey);
    expect(resolveNcaSectionKey(keys, new Uint8Array(16), 1)).toEqual(areaKey);
    expect(resolveNcaSectionKey(keys, new Uint8Array(16), 9)).toBeNull();
  });

  it('decrypts title keys and derives key-area keys with AES-CMAC', async () => {
    const titleKek = hex('000102030405060708090a0b0c0d0e0f');
    const encryptedTitleKey = hex('69c4e0d86a7b0430d8cdb78070b4c55a');
    const expectedTitleKey = hex('00112233445566778899aabbccddeeff');
    expect(await decryptTitleKey(encryptedTitleKey, titleKek)).toEqual(expectedTitleKey);

    const derived = await deriveAreaKey(titleKek, 1);
    expect(derived.length).toBe(16);
    const cmacKey = hex('2b7e151628aed2a6abf7158809cf4f3c');
    expect(await aesCmac(cmacKey, hex('6bc1bee22e409f96e93d7e117393172a')))
      .toEqual(hex('070a16b46b4d4144f79bdd9dd04a287c'));
  });
});

function hex(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
