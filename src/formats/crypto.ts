// AES Cryptography for NCA decryption
// Implements AES-128-CTR and AES-128-XTS using Web Crypto API.
// Also handles prod.keys parsing and key derivation.

// Helper: Web Crypto requires Uint8Array backed by plain ArrayBuffer, not SharedArrayBuffer.
// TypeScript 6+ is strict about this distinction.
function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer instanceof ArrayBuffer
    ? data.buffer
    : data.slice().buffer as ArrayBuffer;
}

export interface KeySet {
  headerKey: Uint8Array | null;         // 32 bytes (XTS key pair)
  titleKeks: Map<number, Uint8Array>;   // key_area_key_application_XX
  areaKeys: Map<number, Uint8Array>;    // Per key-generation
  titleKeys: Map<string, Uint8Array>;   // Rights ID → title key
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
      keys.areaKeys.set(gen, value);
    } else if (name.startsWith('titlekek_')) {
      const gen = parseInt(name.replace('titlekek_', ''), 16);
      keys.titleKeks.set(gen, value);
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
    if (key && key.length === 16) {
      titleKeys.set(rightsId, key);
    }
  }

  return titleKeys;
}

export async function decryptAesCtr(
  data: Uint8Array,
  key: Uint8Array,
  counter: Uint8Array
): Promise<Uint8Array> {
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

// AES-128-XTS decryption (used for NCA headers and some section data)
// XTS uses two keys: key1 for encryption, key2 for tweak
export async function decryptAesXts(
  data: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  sectorIndex: number,
  sectorSize: number = 0x200
): Promise<Uint8Array> {
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

async function decryptXtsSector(
  sector: Uint8Array,
  key1: Uint8Array,
  key2: Uint8Array,
  tweak: Uint8Array
): Promise<Uint8Array> {
  const tweakKey = await crypto.subtle.importKey(
    'raw', toBuffer(key2), { name: 'AES-CBC' }, false, ['encrypt']
  );
  const iv = new ArrayBuffer(16);
  const encryptedTweak = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, tweakKey, toBuffer(tweak))
  ).slice(0, 16);

  const dataKey = await crypto.subtle.importKey(
    'raw', toBuffer(key1), { name: 'AES-CBC' }, false, ['decrypt']
  );

  const result = new Uint8Array(sector.length);
  let currentTweak: Uint8Array = encryptedTweak;

  for (let i = 0; i < sector.length; i += 16) {
    const block = sector.slice(i, i + 16);

    const xored = new Uint8Array(16);
    for (let j = 0; j < 16; j++) {
      xored[j] = block[j] ^ currentTweak[j];
    }

    const zeroIv = new ArrayBuffer(16);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv: zeroIv }, dataKey, toBuffer(padTo32(xored)))
    ).slice(0, 16);

    for (let j = 0; j < 16; j++) {
      result[i + j] = decrypted[j] ^ currentTweak[j];
    }

    currentTweak = gfMul2(currentTweak);
  }

  return result;
}

function padTo32(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(32);
  padded.set(data);
  for (let i = 16; i < 32; i++) padded[i] = 16;
  return padded;
}

function computeXtsTweak(sectorIndex: number): Uint8Array {
  const tweak = new Uint8Array(16);
  const view = new DataView(tweak.buffer as ArrayBuffer);
  view.setUint32(0, sectorIndex & 0xFFFFFFFF, true);
  view.setUint32(4, Math.floor(sectorIndex / 0x100000000) & 0xFFFFFFFF, true);
  return tweak;
}

function gfMul2(tweak: Uint8Array): Uint8Array {
  const result = new Uint8Array(16);
  let carry = 0;
  for (let i = 0; i < 16; i++) {
    const nextCarry = (tweak[i] >> 7) & 1;
    result[i] = ((tweak[i] << 1) | carry) & 0xFF;
    carry = nextCarry;
  }
  if (carry) {
    result[0] ^= 0x87;
  }
  return result;
}

export async function decryptTitleKey(
  encryptedTitleKey: Uint8Array,
  titleKek: Uint8Array
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', toBuffer(titleKek), { name: 'AES-CBC' }, false, ['decrypt']
  );
  const iv = new ArrayBuffer(16);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    key,
    toBuffer(padTo32(encryptedTitleKey))
  );
  return new Uint8Array(decrypted).slice(0, 16);
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
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
