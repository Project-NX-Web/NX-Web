// NSP (Nintendo Submission Package) parser
// NSP is a PFS0 container holding NCA files, tickets, and certificates.

import { parsePfs0, extractPfs0File, type Pfs0, type Pfs0Entry } from './pfs0';

export interface NspFile {
  pfs0: Pfs0;
  ncaEntries: Pfs0Entry[];
  ticketEntries: Pfs0Entry[];
  certEntries: Pfs0Entry[];
}

export function parseNsp(data: Uint8Array): NspFile {
  const pfs0 = parsePfs0(data);

  const ncaEntries: Pfs0Entry[] = [];
  const ticketEntries: Pfs0Entry[] = [];
  const certEntries: Pfs0Entry[] = [];

  for (const file of pfs0.files) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'nca':
        ncaEntries.push(file);
        break;
      case 'tik':
        ticketEntries.push(file);
        break;
      case 'cert':
        certEntries.push(file);
        break;
    }
  }

  return { pfs0, ncaEntries, ticketEntries, certEntries };
}

export function extractNca(nsp: NspFile, entry: Pfs0Entry): Uint8Array {
  return extractPfs0File(nsp.pfs0, entry);
}

export function extractTicket(nsp: NspFile, entry: Pfs0Entry): Uint8Array {
  return extractPfs0File(nsp.pfs0, entry);
}
