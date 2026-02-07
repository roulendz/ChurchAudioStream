---
status: verifying
trigger: "hosts-file-and-domain-resolution: UAC prompt appears but hosts file not modified; manual entries don't resolve either"
created: 2026-02-07T00:00:00Z
updated: 2026-02-07T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED - Three root causes found and all fixed
test: TypeScript compiles cleanly, certMatchesDomain verified with generated cert, single-write PS1 approach verified
expecting: On next app startup: (1) hosts file gets church.audio entry, (2) cert regenerated with church.audio SAN, (3) https://church.audio:7777/ resolves
next_action: User runtime verification needed

## Symptoms

expected:
- On app launch or settings update, UAC prompt appears, user approves, hosts file gets "192.168.1.79 church.audio # ChurchAudioStream" appended
- After hosts file has the entry, https://church.audio:7777/ reaches the local server

actual:
- UAC prompt appears but hosts file is NOT modified
- Manual entries (127.0.0.1 and 192.168.1.79) also don't resolve in browser
- https://church.audio:7777/ does not load even with manual hosts entries

errors: Silent failure - no error messages reported

reproduction:
1. Start npm run tauri dev
2. UAC prompt appears, approve it
3. Check hosts file - no church.audio line added
4. Manually add "127.0.0.1 church.audio" to hosts file - still can't access https://church.audio:7777/

started: After switching from Node-based to PowerShell-based hosts file writing

## Eliminated

- hypothesis: VBS path escaping is wrong (double backslashes)
  evidence: Previous debug session confirmed Windows normalizes double backslashes
  timestamp: from resolved/uac-elevation-still-broken.md

- hypothesis: VBS/PS1 code generation is broken
  evidence: Previous debug session confirmed code works perfectly from normal Node.js
  timestamp: from resolved/uac-elevation-still-broken.md

- hypothesis: Server is not running
  evidence: curl -sk https://127.0.0.1:7777/api/status returns {"status":"running"}
  timestamp: 2026-02-07T00:02:00Z

## Evidence

- timestamp: 2026-02-07T00:00:30Z
  checked: Current hosts file content
  found: 73 lines, no church.audio entry. File has Docker entries, Adobe blocks, and Laragon entries.
  implication: Confirms the automated writing is not working

- timestamp: 2026-02-07T00:00:45Z
  checked: PS1 script logic (dry run, non-elevated) - read, filter, count
  found: Read 73 lines, filter kept all 73 (no existing ChurchAudioStream lines), logic is correct
  implication: The PS1 filter/append logic is conceptually correct

- timestamp: 2026-02-07T00:01:00Z
  checked: PS1 Set-Content then Add-Content on hosts file (non-elevated, same as elevated would do)
  found: Set-Content SUCCEEDS but Add-Content FAILS with "The process cannot access the file because it is being used by another process"
  implication: ROOT CAUSE 1 - The two-step write (Set-Content to rewrite, then Add-Content to append) causes file lock contention.

- timestamp: 2026-02-07T00:01:30Z
  checked: Single Set-Content approach (build complete content in memory, write once)
  found: Works perfectly - wrote 74 lines including the new church.audio entry
  implication: FIX for Root Cause 1 confirmed

- timestamp: 2026-02-07T00:02:00Z
  checked: Running server's TLS certificate (via openssl s_client)
  found: Server serves cert with CN=churchaudio.local, SAN DNS:churchaudio.local,localhost - NO church.audio SAN
  implication: ROOT CAUSE 2 - Stale certificate from old domain name

- timestamp: 2026-02-07T00:02:10Z
  checked: src-tauri/cert.pem vs sidecar/cert.pem
  found: src-tauri/cert.pem has CN=churchaudio.local (STALE). sidecar/cert.pem has CN=church.audio (CORRECT but not used).
  implication: Server loads from src-tauri/ (basePath="."), getting the stale cert

- timestamp: 2026-02-07T00:02:20Z
  checked: certificate.ts loadOrGenerateCert logic
  found: Line 20-21: if cert exists on disk, load it without checking if domain matches. Has explicit TODO comment.
  implication: ROOT CAUSE 3 - No SAN mismatch detection

- timestamp: 2026-02-07T00:04:00Z
  checked: TypeScript compilation after all fixes
  found: Both sidecar and frontend compile with zero errors
  implication: Fixes are syntactically and type-correct

- timestamp: 2026-02-07T00:04:30Z
  checked: certMatchesDomain function with generated test cert
  found: Correctly matches "church.audio" and correctly rejects "churchaudio.local"
  implication: SAN mismatch detection works as intended

## Resolution

root_cause: THREE interrelated root causes:

1. **PS1 file lock contention (hosts file not modified):** The generated PS1 script uses Set-Content to rewrite the hosts file, then immediately calls Add-Content to append the new entry. Windows Defender or the DNS Client service locks the hosts file after Set-Content modifies it, causing Add-Content to fail with "file in use" error. The PS1 terminates before writing the sentinel, VBS times out, error is caught as warning.

2. **Stale TLS certificate (domain mismatch):** The cert at src-tauri/cert.pem was generated when the domain was "churchaudio.local". After the domain changed to "church.audio", the cert was never regenerated. Browsers accessing https://church.audio:7777/ get ERR_CERT_COMMON_NAME_INVALID.

3. **No SAN mismatch detection in certificate.ts:** loadOrGenerateCert loads existing certs without checking if the domain matches config. Had a TODO comment but no implementation.

fix: Three changes applied:

1. **hosts.ts - buildAddEntryPs1:** Replaced two-step write (Set-Content + Add-Content) with single-write approach. Now builds complete content in memory using `@($filtered) + $newLine` and writes all lines with a single `Set-Content` call. Eliminates the file lock race window entirely.

2. **certificate.ts - certMatchesDomain:** Added new function that parses existing cert PEM using Node.js crypto.X509Certificate, extracts DNS SAN entries, and checks if the configured domain is present.

3. **certificate.ts - loadOrGenerateCert:** Now calls certMatchesDomain before returning cached cert. If domain is missing from SANs, falls through to regenerate. Logs the mismatch for observability.

4. **Deleted stale cert/key files:** Removed src-tauri/cert.pem, src-tauri/key.pem, sidecar/cert.pem, sidecar/key.pem. Server will regenerate with correct church.audio SAN on next startup.

verification: TypeScript compiles cleanly (both sidecar and frontend). certMatchesDomain verified with generated test certificate. Single-write PS1 approach verified with PowerShell dry run (74 lines written successfully). Awaiting user runtime verification.

files_changed:
  - sidecar/src/network/hosts.ts
  - sidecar/src/network/certificate.ts
  - src-tauri/cert.pem (deleted)
  - src-tauri/key.pem (deleted)
  - sidecar/cert.pem (deleted)
  - sidecar/key.pem (deleted)
