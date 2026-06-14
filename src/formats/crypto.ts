// AES Cryptography for NCA decryption
// Implements AES-128-CTR, AES-128-XTS, AES-CMAC, and prod.keys/title.keys parsing.
// NCA headers use AES-128-XTS with the 32-byte header_key split into two 16-byte keys.
// NCA body sections use either a rights-id title key or a key-area key derived by the user's prod.keys.

// Helper: Web Crypto requires Uint8Array backed by plain ArrayBuffer, not SharedArrayBuffer.
// TypeScript 6+ is strict about this distinction.
function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer instanceof ArrayBuffer
    ? data.buffer
    : data.slice().buffer as ArrayBuffer;
}

const AES_SBOX = [
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
] as const;

const AES_INV_SBOX = [
  0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
  0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
  0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
  0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
  0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
  0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
  0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
  0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
  0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
  0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
  0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
  0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
  0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
  0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
  0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
  0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d,
] as const;

const AES_RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36] as const;

export interface KeySet {
  headerKey: Uint8Array | null;         // 32 bytes (XTS key pair)
  titleKeks: Map<number, Uint8Array>;   // key_area_key_application_XX
  areaKeys: Map<number, Uint8Array>;    // Per key-generation
  titleKeys: Map<string, Uint8Array>;   // Rights ID → title key
}

export interface NcaHeaderKeys {
  key1: Uint8Array;
  key2: Uint8Array;
}

export function parseKeysFile(content: string): KeySet {
  const keys: KeySet = {
    headerKey: null,
    titleKeks: new Map(),
    areaKeys: new Map(),
    titleKeys: new Map(),
  };

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const name = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const hexValue = trimmed.slice(eqIdx + 1).trim();

    const value = hexToBytes(hexValue);
    if (!value) continue;

    if (name === 'header_key') {
      keys.headerKey = value;
    } else if (name.startsWith('key_area_key_application_')) {
      const gen = parseInt(name.replace('key_area_key_application_', ''), 16);
      if (Number.isInteger(gen)) keys.areaKeys.set(gen, value);
    } else if (name.startsWith('titlekek_')) {
      const gen = parseInt(name.replace('titlekek_', ''), 16);
      if (Number.isInteger(gen)) keys.titleKeks.set(gen, value);
    }
  }

  return keys;
}

export function parseTitleKeysFile(content: string): Map<string, Uint8Array> {
  const titleKeys = new Map<string, Uint8Array>();

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const rightsId = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const hexKey = trimmed.slice(eqIdx + 1).trim();
    const key = hexToBytes(hexKey);
    if (key && key.length === 16 && /^[0-9a-f]{32}$/.test(rightsId)) {
      titleKeys.set(rightsId, key);
    }
  }

  return titleKeys;
}

export function validateKeySet(keySet: KeySet): string[] {
  const errors: string[] = [];

  if (!keySet.headerKey) {
    errors.push('prod.keys is missing header_key');
  } else if (keySet.headerKey.length !== 32) {
    errors.push('header_key must be exactly 32 bytes for NCA AES-XTS decryption');
  }

  if (keySet.areaKeys.size === 0 && keySet.titleKeks.size === 0) {
    errors.push('prod.keys contains neither key_area_key_application_* nor titlekek_* entries');
  }

  for (const [gen, key] of keySet.areaKeys) {
    if (key.length !== 16) errors.push(`key_area_key_application_${gen.toString(16)} must be 16 bytes`);
  }

  for (const [gen, key] of keySet.titleKeks) {
    if (key.length !== 16) errors.push(`titlekek_${gen.toString(16)} must be 16 bytes`);
  }

  return errors;
}

export async function decryptAesCtr(
  data: Uint8Array,
  key: Uint8Array,
  counter: Uint8Array
): Promise<Uint8Array> {
  assertAes128Key(key);
  assertBlock(counter);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', toBuffer(key), { name: 'AES-CTR' }, false, ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter: toBuffer(counter), length: 64 },
    cryptoKey,
    toBuffer(data)
  );

  return new Uint8Array(decrypted);
}

export async function encryptAesCtr(
  data: Uint8Array,
  key: Uint8Array,
  counter: Uint8Array
): Promise<Uint8Array> {
  assertAes128Key(key);
  assertBlock(counter);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', toBuffer(key), { name: 'AES-CTR' }, false, ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: toBuffer(counter), length: 64 },
    cryptoKey,
    toBuffer(data)
  );

  return new Uint8Array(encrypted);
}

// AES-128-XTS decryption (used for NCA headers and some section data).
// XTS uses two AES-128 keys: key1 for data encryption, key2 for tweak encryption.
// This implementation supports whole 16-byte blocks, which matches NCA's 0x200 media-unit sectors.
export async function decryptAesXts(
  data: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  sectorIndex: number,
  sectorSize: number = 0x200
): Promise<Uint8Array> {
  assertAes128Key(key1);
  assertAes128Key(key2);
  if (data.length % 16 !== 0) {
    throw new Error('AES-XTS input must be a whole number of 16-byte blocks');
  }

  const result = new Uint8Array(data.length);
  const sectorCount = Math.ceil(data.length / sectorSize);

  for (let s = 0; s < sectorCount; s++) {
    const offset = s * sectorSize;
    const size = Math.min(sectorSize, data.length - offset);
    const sector = data.slice(offset, offset + size);

    const tweak = computeXtsTweak(sectorIndex + s);
    const decrypted = await decryptXtsSector(sector, key1, key2, tweak);
    result.set(decrypted, offset);
  }

  return result;
}

export async function decryptAesXtsWithTweak(
  data: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  tweak: Uint8Array
): Promise<Uint8Array> {
  assertAes128Key(key1);
  assertAes128Key(key2);
  assertBlock(tweak);
  if (data.length % 16 !== 0) {
    throw new Error('AES-XTS input must be a whole number of 16-byte blocks');
  }

  return decryptXtsSector(data, key1, key2, tweak);
}

export async function encryptAesXtsWithTweak(
  data: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  tweak: Uint8Array
): Promise<Uint8Array> {
  assertAes128Key(key1);
  assertAes128Key(key2);
  assertBlock(tweak);
  if (data.length % 16 !== 0) {
    throw new Error('AES-XTS input must be a whole number of 16-byte blocks');
  }

  return encryptXtsSector(data, key1, key2, tweak);
}

export function splitNcaHeaderKeys(headerKey: Uint8Array): NcaHeaderKeys {
  if (headerKey.length !== 32) {
    throw new Error('NCA header_key must be 32 bytes');
  }

  return {
    key1: headerKey.slice(0, 16),
    key2: headerKey.slice(16, 32),
  };
}

export function resolveNcaSectionKey(
  keySet: KeySet,
  rightsId: Uint8Array,
  keyGeneration: number
): Uint8Array | null {
  if (!rightsId.every((byte) => byte === 0)) {
    return keySet.titleKeys.get(bytesToHex(rightsId)) ?? null;
  }

  return keySet.areaKeys.get(keyGeneration) ?? null;
}

async function decryptXtsSector(
  sector: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  tweak: Uint8Array
): Promise<Uint8Array> {
  let currentTweak = await aes128EncryptBlock(tweak, key2);
  const result = new Uint8Array(sector.length);

  for (let i = 0; i < sector.length; i += 16) {
    const block = sector.slice(i, i + 16);
    const xored = xorBlocks(block, currentTweak);
    const decrypted = await aes128DecryptBlock(xored, key1);
    result.set(xorBlocks(decrypted, currentTweak), i);
    currentTweak = gfMul2(currentTweak);
  }

  return result;
}

async function encryptXtsSector(
  sector: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  tweak: Uint8Array
): Promise<Uint8Array> {
  let currentTweak = await aes128EncryptBlock(tweak, key2);
  const result = new Uint8Array(sector.length);

  for (let i = 0; i < sector.length; i += 16) {
    const block = sector.slice(i, i + 16);
    const xored = xorBlocks(block, currentTweak);
    const encrypted = await aes128EncryptBlock(xored, key1);
    result.set(xorBlocks(encrypted, currentTweak), i);
    currentTweak = gfMul2(currentTweak);
  }

  return result;
}

function computeXtsTweak(sectorIndex: number): Uint8Array {
  const tweak = new Uint8Array(16);
  const view = new DataView(tweak.buffer as ArrayBuffer);
  view.setUint32(0, sectorIndex & 0xFFFFFFFF, true);
  view.setUint32(4, Math.floor(sectorIndex / 0x100000000) & 0xFFFFFFFF, true);
  return tweak;
}

export async function decryptTitleKey(
  encryptedTitleKey: Uint8Array,
  titleKek: Uint8Array
): Promise<Uint8Array> {
  assertAes128Key(titleKek);
  assertBlock(encryptedTitleKey);

  const decrypted = await aes128DecryptBlock(encryptedTitleKey, titleKek);
  return decrypted.slice(0, 16);
}

export async function deriveAreaKey(
  titleKek: Uint8Array,
  keyGeneration: number
): Promise<Uint8Array> {
  assertAes128Key(titleKek);
  if (keyGeneration < 0 || keyGeneration > 0xFF) {
    throw new Error(`Invalid NCA key generation: ${keyGeneration}`);
  }

  const message = new Uint8Array(16);
  message[0] = keyGeneration & 0xff;
  return aesCmac(titleKek, message);
}

export async function aesCmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  assertAes128Key(key);

  const l = await aes128EncryptBlock(new Uint8Array(16), key);
  const k1 = gfMul2BigEndian(l);
  const k2 = gfMul2BigEndian(k1);

  const blockCount = Math.max(1, Math.ceil(message.length / 16));
  const finalBlock = new Uint8Array(16);
  const finalStart = (blockCount - 1) * 16;
  const remaining = message.length - finalStart;

  if (remaining === 16) {
    finalBlock.set(message.slice(finalStart), 0);
    xorInPlace(finalBlock, k1);
  } else {
    finalBlock.set(message.slice(finalStart), 0);
    finalBlock[remaining] = 0x80;
    xorInPlace(finalBlock, k2);
  }

  let y = new Uint8Array(16);
  for (let offset = 0; offset < finalStart; offset += 16) {
    y = await aes128EncryptBlock(asPlainBlock(xorBlocks(y, message.slice(offset, offset + 16))), key);
  }
  y = await aes128EncryptBlock(asPlainBlock(xorBlocks(y, finalBlock)), key);
  return y;
}

async function aes128EncryptBlock(block: Uint8Array, key: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  assertBlock(block);
  assertAes128Key(key);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', toBuffer(key), { name: 'AES-CBC' }, false, ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: zeroBlock() },
    cryptoKey,
    toBuffer(pkcs7PadBlock(block))
  );

  return new Uint8Array(encrypted).slice(0, 16) as Uint8Array<ArrayBuffer>;
}

async function aes128DecryptBlock(block: Uint8Array, key: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  assertBlock(block);
  assertAes128Key(key);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', toBuffer(key), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']
  );
  const paddedPlainForSecondBlock = pkcs7PaddingBlock();
  const secondBlockPlain = xorBlocks(paddedPlainForSecondBlock, block);
  const secondBlockCipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: zeroBlock() },
    cryptoKey,
    toBuffer(secondBlockPlain)
  );
  const secondBlockCipherBytes = new Uint8Array<ArrayBuffer>(secondBlockCipher as ArrayBuffer).slice(0, 16);
  const ciphertext = concatBlocks(block, secondBlockCipherBytes);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: zeroBlock() },
    cryptoKey,
    toBuffer(ciphertext)
  );

  return new Uint8Array(decrypted).slice(0, 16) as Uint8Array<ArrayBuffer>;
}

function expandAes128Key(key: Uint8Array): Uint8Array[] {
  const roundKeys: Uint8Array[] = [new Uint8Array(key)];
  let words: number[] = [];
  for (let i = 0; i < 16; i += 4) {
    words.push(key[i], key[i + 1], key[i + 2], key[i + 3]);
  }

  let rconIndex = 1;
  while (words.length < 44) {
    const temp = words.slice(-4);
    const rotated = [temp[1], temp[2], temp[3], temp[0]];
    const substituted = rotated.map((byte) => AES_SBOX[byte]);
    substituted[0] ^= AES_RCON[rconIndex++];

    for (let i = 0; i < 4; i++) {
      words.push(words[words.length - 4 + i] ^ substituted[i]);
    }
  }

  for (let round = 1; round <= 10; round++) {
    roundKeys.push(new Uint8Array(words.slice(round * 4, round * 4 + 16)));
  }

  return roundKeys;
}

function addRoundKey(state: Uint8Array, roundKeys: Uint8Array[], round: number): void {
  const key = roundKeys[round];
  for (let i = 0; i < 16; i++) {
    state[i] ^= key[i];
  }
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < state.length; i++) {
    state[i] = AES_SBOX[state[i]];
  }
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < state.length; i++) {
    state[i] = AES_INV_SBOX[state[i]];
  }
}

function shiftRows(state: Uint8Array): void {
  // State is stored column-major: index = row + 4 * column.
  const s = new Uint8Array(state);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[row + 4 * col] = s[row + 4 * ((col + row) % 4)];
    }
  }
}

function invShiftRows(state: Uint8Array): void {
  const s = new Uint8Array(state);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[row + 4 * col] = s[row + 4 * ((col + 4 - row) % 4)];
    }
  }
}

function mixColumns(state: Uint8Array): void {
  for (let col = 0; col < 4; col++) {
    const i = col * 4;
    const a0 = state[i];
    const a1 = state[i + 1];
    const a2 = state[i + 2];
    const a3 = state[i + 3];

    state[i] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
    state[i + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
    state[i + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
    state[i + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
  }
}

function invMixColumns(state: Uint8Array): void {
  for (let col = 0; col < 4; col++) {
    const i = col * 4;
    const a0 = state[i];
    const a1 = state[i + 1];
    const a2 = state[i + 2];
    const a3 = state[i + 3];

    state[i] = gMul(a0, 0x0e) ^ gMul(a1, 0x0b) ^ gMul(a2, 0x0d) ^ gMul(a3, 0x09);
    state[i + 1] = gMul(a0, 0x09) ^ gMul(a1, 0x0e) ^ gMul(a2, 0x0b) ^ gMul(a3, 0x0d);
    state[i + 2] = gMul(a0, 0x0d) ^ gMul(a1, 0x09) ^ gMul(a2, 0x0e) ^ gMul(a3, 0x0b);
    state[i + 3] = gMul(a0, 0x0b) ^ gMul(a1, 0x0d) ^ gMul(a2, 0x09) ^ gMul(a3, 0x0e);
  }
}

function xtime(value: number): number {
  const shifted = (value << 1) & 0xff;
  return (value & 0x80) !== 0 ? shifted ^ 0x1b : shifted;
}

function gMul(a: number, b: number): number {
  let result = 0;
  let lhs = a;
  let rhs = b;

  while (rhs !== 0) {
    if ((rhs & 1) !== 0) result ^= lhs;
    lhs = xtime(lhs);
    rhs >>= 1;
  }

  return result;
}

function gfMul2(tweak: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(16);
  let carry = 0;
  for (let i = 0; i < 16; i++) {
    const nextCarry = (tweak[i] >> 7) & 1;
    result[i] = ((tweak[i] << 1) | carry) & 0xff;
    carry = nextCarry;
  }
  if (carry) {
    result[0] ^= 0x87;
  }
  return result as Uint8Array<ArrayBuffer>;
}

function gfMul2BigEndian(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    const nextCarry = (value[i] >> 7) & 1;
    result[i] = ((value[i] << 1) | carry) & 0xff;
    carry = nextCarry;
  }
  if (carry) {
    result[15] ^= 0x87;
  }
  return result as Uint8Array<ArrayBuffer>;
}

function xorBlocks(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  assertBlock(a);
  assertBlock(b);
  const result = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result as Uint8Array<ArrayBuffer>;
}

function xorInPlace(target: Uint8Array, value: Uint8Array): void {
  assertBlock(target);
  assertBlock(value);
  for (let i = 0; i < 16; i++) {
    target[i] ^= value[i];
  }
}

function zeroBlock(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(16);
}

function pkcs7PaddingBlock(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10]);
}

function pkcs7PadBlock(block: Uint8Array): Uint8Array<ArrayBuffer> {
  assertBlock(block);
  const padded = new Uint8Array(32);
  padded.set(block, 0);
  padded.set(pkcs7PaddingBlock(), 16);
  return padded;
}

function concatBlocks(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(32);
  result.set(a, 0);
  result.set(b, 16);
  return result;
}

function asPlainBlock(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy as Uint8Array<ArrayBuffer>;
}

function assertBlock(value: Uint8Array): asserts value is Uint8Array<ArrayBuffer> {
  if (value.length !== 16) {
    throw new Error(`Expected 16-byte block, got ${value.length} bytes`);
  }
}

function assertAes128Key(key: Uint8Array): void {
  if (key.length !== 16) {
    throw new Error(`Expected AES-128 key, got ${key.length} bytes`);
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.replace(/\s/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
