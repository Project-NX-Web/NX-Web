# NX-Web Game Compatibility

## Status Legend
- **Boot**: Game reaches past initial loading screen
- **Menu**: Game reaches the main menu and is navigable
- **Gameplay**: Game is playable in some capacity
- **FPS**: Average frames per second during gameplay
- **Parse**: ROM/container parser successfully reads the file without executing it

## Tested Titles

| Title | Boot | Menu | Gameplay | FPS | Notes |
|-------|------|------|----------|-----|-------|
| (none tested yet) | — | — | — | — | Phase 1: scaffold only |

## Homebrew

| Title | Parse | Boot | Menu | Gameplay | Notes |
|-------|-------|------|------|----------|-------|
| nx-hbmenu (`hbmenu.nro`, official switchbrew release fixture when present) | ✅ | — | — | — | Phase 2 parser fixture: NRO header, ASET icon/NACP/RomFS, RomFS `assets.zip`, and VFS mount verified. |
| Atmosphere `1.11.1-master-d04c20a04+hbl-2.4.5+hbmenu-3.6.1` | ✅ | — | — | — | Phase 2 parser fixture: `hbl.nsp` PFS0, `stratosphere.romfs`, nested exefs PFS0/NSO0, and bundled NROs verified. |

## Phase 2 Parser Coverage

Phase 2 ROM/filesystem parsing is structurally complete for non-retail fixtures and synthetic vectors:

- PFS0/HFS0, NSP, XCI, RomFS, VFS, StorageManager, AES-CTR, AES-XTS, AES-CMAC, and NCA header/section helpers have unit coverage.
- Verification: `npm test -- --reporter=verbose` passed 12 files / 55 tests; `npm run build` passed TypeScript and Vite production build.
- Retail encrypted NCA end-to-end parsing remains intentionally untested until non-retail fixtures or user-provided keys are available.
