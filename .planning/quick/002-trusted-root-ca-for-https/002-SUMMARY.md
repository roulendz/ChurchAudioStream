---
phase: quick
plan: 002
subsystem: network
tags: [tls, certificate, root-ca, windows-trust-store, uac-elevation]
dependency-graph:
  requires: [quick-001]
  provides: [trusted-https, root-ca-infrastructure, browser-trust]
  affects: [phase-02, phase-06]
tech-stack:
  added: []
  patterns: [root-ca-signing, vbs-uac-elevation, certutil-store-detection]
key-files:
  created:
    - sidecar/src/network/trustedCa.ts
  modified:
    - sidecar/src/network/certificate.ts
    - sidecar/src/config/schema.ts
decisions:
  - id: quick-002-ca-validity
    summary: "20-year CA validity (local-only CA, avoids re-installation UAC prompts)"
  - id: quick-002-server-cert-validity
    summary: "825-day server cert validity (Apple max for trusted TLS certs)"
  - id: quick-002-srp-elevation
    summary: "Duplicate VBS+UAC elevation pattern from hosts.ts per SRP (different PS1 content, independent evolution)"
  - id: quick-002-fingerprint-verify
    summary: "certutil CN search + SHA1 fingerprint cross-check to avoid false positives from same-CN certs"
  - id: quick-002-persistent-ca
    summary: "CA not removed on shutdown, persists across restarts; removeCaFromStore exported for future uninstall"
metrics:
  duration: 3m 19s
  completed: 2026-02-07
---

# Quick Task 002: Trusted Root CA for HTTPS Summary

**Local Root CA generation, Windows trust store installation, and CA-signed server certificates -- eliminating browser security warnings on LAN devices.**

## What Was Done

### Task 1: Root CA module (trustedCa.ts) with generation, installation, and detection
**Commit:** `f81533c`

Created `sidecar/src/network/trustedCa.ts` with five exported functions:

- **`ensureCaReady(basePath, config)`** -- Orchestrator: loads or generates CA keypair, checks Windows trust store, installs if missing (one UAC prompt)
- **`generateRootCa()`** -- Creates 2048-bit RSA CA cert with `CN=ChurchAudioStream Local CA`, basicConstraints(cA=true), keyUsage(keyCertSign, cRLSign), 20-year validity
- **`isCaInstalledInStore(caCertPem)`** -- Uses `certutil -store Root` to search by CN, then cross-checks SHA1 fingerprint to avoid false positives
- **`installCaInStore(caCertFilePath)`** -- Elevated PS1 via VBS+UAC pattern: `Import-Certificate -CertStoreLocation Cert:\LocalMachine\Root`
- **`removeCaFromStore()`** -- Best-effort removal for uninstall scenarios (not called during normal shutdown)

Updated `CertificateSchema` in `schema.ts` with `caCertPath` (default: "ca-cert.pem") and `caKeyPath` (default: "ca-key.pem").

### Task 2: Refactor certificate.ts to use CA-signed certs
**Commit:** `f057dfc`

Replaced self-signed certificate generation with CA-signed approach:

- **`loadOrGenerateCert`** now calls `ensureCaReady()` first, then validates existing server cert with `serverCertIsValid()` before deciding to regenerate
- **`serverCertIsValid()`** checks both domain SAN match AND issuer match against current CA -- old self-signed certs auto-regenerate on first run
- **`generateCaSignedCert()`** replaces `generateCertificate()` -- uses `selfsigned` package's `ca` option to sign with the Root CA
- Server cert validity reduced from 3650 to 825 days (Apple's maximum for trusted certificates)
- `loadOrGenerateCert` function signature unchanged -- `server.ts` call site requires zero modifications

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 20-year CA validity | Local-only CA; long life avoids repeated UAC installation prompts |
| 825-day server cert validity | Apple's enforced maximum for trusted TLS certificates |
| Duplicate VBS+UAC pattern (not shared) | SRP: hosts.ts and trustedCa.ts have completely different PS1 content and evolve independently |
| certutil CN + SHA1 fingerprint verify | Prevents false positive from a different cert with the same CN |
| CA persists across restarts | Intentional: removing CA on shutdown would require UAC on every restart |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Checklist

- [x] `npx tsc --noEmit` passes with zero errors
- [x] `npm run build` succeeds (69 MB binary)
- [x] trustedCa.ts exports: ensureCaReady, isCaInstalledInStore, installCaInStore, removeCaFromStore
- [x] CertificateSchema includes caCertPath and caKeyPath with defaults
- [x] loadOrGenerateCert signature unchanged (server.ts untouched)
- [x] Old self-signed certs detected via issuer mismatch, auto-regenerated
- [ ] Manual: Fresh start (delete .pem files) -- one UAC prompt, green lock in browser
- [ ] Manual: Restart -- no UAC prompt, existing certs reused
- [ ] Manual: Domain change -- no UAC prompt, server cert regenerated
- [ ] Manual: `openssl verify -CAfile ca-cert.pem cert.pem` returns OK

## Architecture

```
First run (no .pem files):
  loadOrGenerateCert()
    -> ensureCaReady()
        -> generateRootCa()          [creates ca-cert.pem + ca-key.pem]
        -> isCaInstalledInStore()     [certutil check: not found]
        -> installCaInStore()         [VBS+UAC -> Import-Certificate]
    -> generateCaSignedCert()         [creates cert.pem + key.pem, signed by CA]

Subsequent runs (all .pem files exist, CA installed):
  loadOrGenerateCert()
    -> ensureCaReady()
        -> [loads CA from disk]
        -> isCaInstalledInStore()     [certutil check: found, fingerprint matches]
        -> [skip install, no UAC]
    -> serverCertIsValid()            [domain + issuer match: true]
    -> [return existing cert, no regen]

Domain change:
  loadOrGenerateCert()
    -> ensureCaReady()                [CA unchanged, no UAC]
    -> serverCertIsValid()            [domain mismatch: false]
    -> generateCaSignedCert()         [new cert.pem with new domain SAN]
```

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `sidecar/src/network/trustedCa.ts` | Created | Root CA module: generation, store detection, elevated installation |
| `sidecar/src/network/certificate.ts` | Modified | Refactored to CA-signed certs, added issuer validation |
| `sidecar/src/config/schema.ts` | Modified | Added caCertPath and caKeyPath to CertificateSchema |
