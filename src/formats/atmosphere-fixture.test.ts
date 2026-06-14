import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseNro,
  parseNsp,
  parsePfs0,
  parseRomFs,
  extractPfs0File,
} from './index';

const fixtureRoot = 'atmosphere-1.11.1-master-d04c20a04+hbl-2.4.5+hbmenu-3.6.1';

function requireFixture(relativePath: string): Uint8Array {
  const path = `${fixtureRoot}/${relativePath}`;
  if (!existsSync(path)) {
    throw new Error(`Missing Atmosphere fixture: ${path}`);
  }
  return readFileSync(path);
}

describe('Atmosphere release fixtures', () => {
  it('parses hbl.nsp as a PFS0-backed NSP homebrew loader package', () => {
    const nsp = parseNsp(requireFixture('atmosphere/hbl.nsp'));

    expect(nsp.pfs0.files.map((file) => file.name)).toEqual(['main', 'main.npdm']);
    expect(nsp.ncaEntries).toHaveLength(0);
    expect(nsp.ticketEntries).toHaveLength(0);
    expect(nsp.certEntries).toHaveLength(0);
  });

  it('parses stratosphere.romfs and nested exefs.nsp PFS0 entries', () => {
    const romFs = parseRomFs(requireFixture('atmosphere/stratosphere.romfs'));
    const exefsPath = 'atmosphere/contents/0100000000000008/exefs.nsp';

    expect(romFs.has(exefsPath)).toBe(true);

    const exefs = parsePfs0(romFs.get(exefsPath)!);
    expect(exefs.files.map((file) => file.name)).toEqual(['main', 'main.npdm']);

    const main = extractPfs0File(exefs, exefs.files[0]);
    expect(String.fromCharCode(...main.slice(0, 4))).toBe('NSO0');
  });

  it('parses bundled NRO homebrew from the Atmosphere release', () => {
    const nros = [
      'hbmenu.nro',
      'switch/daybreak.nro',
      'switch/haze.nro',
      'switch/reboot_to_payload.nro',
    ];

    for (const nroPath of nros) {
      const nro = parseNro(requireFixture(nroPath));
      expect(nro.header.magic).toBe('NRO0');
      expect(nro.asset).not.toBeNull();
      expect(nro.icon).not.toBeNull();
      expect(nro.nacp).not.toBeNull();
    }
  });
});
