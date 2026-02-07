---
phase: quick-001
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - sidecar/src/config/schema.ts
  - sidecar/src/network/hosts.ts
  - sidecar/src/network/certificate.ts
  - sidecar/src/server.ts
  - sidecar/src/index.ts
  - sidecar/src/ws/handler.ts
autonomous: true

must_haves:
  truths:
    - "Default config uses 'church.audio' domain for both hostsFile and mDNS"
    - "Hosts file entry '{LAN_IP} church.audio # ChurchAudioStream' is created on startup when hostsFile.enabled is true"
    - "OS-native elevation prompt appears when hosts file write is needed (UAC on Windows, osascript on macOS, pkexec on Linux)"
    - "Self-signed TLS certificate includes the hostsFile domain as a SAN alongside the mDNS domain, localhost, and LAN IPs"
    - "Changing hostsFile.domain in config removes old entry and adds new entry"
    - "Graceful shutdown removes the hosts file entry (best-effort, non-blocking)"
  artifacts:
    - path: "sidecar/src/network/hosts.ts"
      provides: "Cross-platform hosts file management with elevated write"
      exports: ["ensureHostsEntry", "removeHostsEntry"]
    - path: "sidecar/src/network/certificate.ts"
      provides: "Certificate generation with hostsFile domain as additional SAN"
    - path: "sidecar/src/config/schema.ts"
      provides: "Updated default domain from churchaudio.local to church.audio"
  key_links:
    - from: "sidecar/src/server.ts"
      to: "sidecar/src/network/hosts.ts"
      via: "ensureHostsEntry called during startServer"
      pattern: "ensureHostsEntry"
    - from: "sidecar/src/index.ts"
      to: "sidecar/src/network/hosts.ts"
      via: "removeHostsEntry called during graceful shutdown"
      pattern: "removeHostsEntry"
    - from: "sidecar/src/network/certificate.ts"
      to: "config.network.hostsFile.domain"
      via: "Added as type-2 DNS SAN in generateCertificate"
      pattern: "hostsFile\\.domain"
    - from: "sidecar/src/ws/handler.ts"
      to: "restart-needed event"
      via: "hostsFile.domain and hostsFile.enabled added to RESTART_TRIGGERING_FIELDS"
      pattern: "network\\.hostsFile"
---

<objective>
Add local domain support (church.audio) with self-signed TLS certificate SAN inclusion and cross-platform hosts file auto-management using OS-native elevation prompts.

Purpose: Lets phones connect via `https://church.audio:7777` instead of a raw IP address -- easier to remember, easier to type, and the TLS cert matches the domain so browsers show fewer warnings.

Output: New `hosts.ts` module + updates to certificate, schema defaults, server startup, shutdown, and config change detection.
</objective>

<execution_context>
@C:\Users\rolan\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\rolan\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@sidecar/src/config/schema.ts
@sidecar/src/config/store.ts
@sidecar/src/config/defaults.ts
@sidecar/src/network/certificate.ts
@sidecar/src/network/mdns.ts
@sidecar/src/network/firewall.ts
@sidecar/src/network/interfaces.ts
@sidecar/src/server.ts
@sidecar/src/index.ts
@sidecar/src/ws/handler.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update default domain and create hosts file module</name>
  <files>
    sidecar/src/config/schema.ts
    sidecar/src/network/hosts.ts
  </files>
  <action>
**schema.ts changes:**
Change both `MdnsSchema.domain` and `HostsFileSchema.domain` defaults from `"churchaudio.local"` to `"church.audio"`. Also change `HostsFileSchema.enabled` default from `false` to `true` (the feature should be on by default now that we're implementing it).

**Create `sidecar/src/network/hosts.ts`:**

This module has two public functions: `ensureHostsEntry` and `removeHostsEntry`. Follow SRP -- each internal helper does one thing.

Constants:
- `HOSTS_FILE_TAG = "# ChurchAudioStream"` -- comment suffix for grep/removal
- `HOSTS_PATH_WINDOWS = "C:\\Windows\\System32\\drivers\\etc\\hosts"`
- `HOSTS_PATH_UNIX = "/etc/hosts"`

Helper: `getHostsFilePath(): string` -- returns the correct path based on `process.platform`.

Helper: `readHostsFile(): string` -- reads the hosts file content. Wrap in try/catch; if unreadable, log warning and return empty string.

Helper: `findExistingEntry(hostsContent: string): { line: string; ip: string; domain: string } | null` -- scans lines for ones ending with `HOSTS_FILE_TAG`. Parses the IP and domain from the matched line. Returns null if no tagged entry found.

Helper: `buildHostsLine(ipAddress: string, domain: string): string` -- returns `"{ipAddress} {domain} {HOSTS_FILE_TAG}"`.

Helper: `buildUpdatedHostsContent(currentContent: string, newLine: string): string` -- removes any existing tagged lines, appends `newLine` at the end (with a trailing newline). Preserves the rest of the file exactly.

Helper: `buildRemovedHostsContent(currentContent: string): string` -- removes any tagged lines. Returns the cleaned content.

Helper: `writeHostsFileElevated(newContent: string): Promise<void>` -- the cross-platform elevated write. Strategy:
1. Write `newContent` to a temp file (using `fs.mkdtempSync` + `fs.writeFileSync`).
2. Build a platform-specific command that copies the temp file over the hosts file:
   - **Windows (`win32`)**: `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "Copy-Item -Path ''TEMP'' -Destination ''HOSTS'' -Force"'`
     Execute via `child_process.execSync('powershell -NoProfile -Command "..."')`. The inner `Start-Process -Verb RunAs` triggers UAC.
   - **macOS (`darwin`)**: `osascript -e 'do shell script "cp TEMP HOSTS" with administrator privileges'`
     Execute via `child_process.execSync(...)`. This triggers the native macOS password dialog.
   - **Linux**: Try `pkexec cp TEMP HOSTS` first. If `pkexec` is not found (check with `which pkexec`), fall back to logging a warning with the manual command the user can run.
     Execute via `child_process.execSync(...)`.
3. Clean up the temp file in a `finally` block (`fs.rmSync(tempDir, { recursive: true, force: true })`).
4. If the elevated command throws (user cancelled UAC, wrong password, etc.), log the error as a warning (not fatal) and re-throw so caller can handle gracefully.

Use `child_process.execSync` with `{ stdio: 'pipe', timeout: 30_000 }` for all platform commands.

**`ensureHostsEntry(ipAddress: string, domain: string): Promise<void>`:**
1. Read hosts file.
2. Find existing tagged entry.
3. If existing entry matches both IP and domain, log "Hosts entry already current" and return (no-op).
4. Otherwise, build updated content (handles both add and update cases) and call `writeHostsFileElevated`.
5. Log success: "Hosts file updated: {ip} {domain}".

**`removeHostsEntry(): Promise<void>`:**
1. Read hosts file.
2. Find existing tagged entry.
3. If no tagged entry, return (no-op).
4. Build removed content and call `writeHostsFileElevated`.
5. Log success: "Hosts file entry removed".

Import `logger` from `../utils/logger`. Import `fs`, `os`, `path` from node builtins. Import `child_process` for `execSync`.

Do NOT make this module async-heavy -- `execSync` is intentional because the elevation dialog is blocking by nature and we want to wait for it.
  </action>
  <verify>
    - `npx tsc --noEmit` passes with no type errors
    - Manually review that `hosts.ts` exports `ensureHostsEntry` and `removeHostsEntry`
    - Verify schema.ts defaults are `"church.audio"` and `enabled: true`
  </verify>
  <done>
    - `sidecar/src/network/hosts.ts` exists with `ensureHostsEntry` and `removeHostsEntry` exports
    - `schema.ts` defaults: `hostsFile.domain = "church.audio"`, `hostsFile.enabled = true`, `mdns.domain = "church.audio"`
  </done>
</task>

<task type="auto">
  <name>Task 2: Add hostsFile domain as certificate SAN</name>
  <files>
    sidecar/src/network/certificate.ts
  </files>
  <action>
In `generateCertificate()`, the current code builds SANs from `config.network.mdns.domain`. Add the `config.network.hostsFile.domain` as an additional DNS SAN (type 2) -- but only if it differs from the mDNS domain (avoid duplicate SANs).

Current SAN building (lines 54-59):
```ts
const subjectAltNames = [
  { type: 2 as const, value: domain },        // mDNS domain
  { type: 2 as const, value: "localhost" },
  { type: 7 as const, ip: "127.0.0.1" },
  ...localIpAddresses.map((ip) => ({ type: 7 as const, ip })),
];
```

Updated logic:
1. Keep `domain` as `config.network.mdns.domain` (existing behavior).
2. Add `const hostsFileDomain = config.network.hostsFile.domain;`
3. Build `subjectAltNames` array starting with the mDNS domain and localhost as before.
4. After building the initial array, conditionally push the hostsFile domain:
   ```ts
   if (hostsFileDomain !== domain && hostsFileDomain !== "localhost") {
     subjectAltNames.push({ type: 2 as const, value: hostsFileDomain });
   }
   ```
5. Then add the IP SANs (127.0.0.1 + LAN IPs) as before.

Also update the log message to include the hostsFile domain in the logged info:
```ts
logger.info("Self-signed certificate generated", {
  commonName: domain,
  hostsFileDomain,
  sanCount: subjectAltNames.length,
  validDays: validityDays,
});
```

**Important:** When the hostsFile domain or mDNS domain changes, the existing cert on disk will NOT include the new domain as a SAN. The cert is only regenerated if cert.pem/key.pem don't exist. For a domain change to take effect in the cert, the user must delete the old cert files (or we need cert regeneration logic). For now, add a `TODO` comment in `loadOrGenerateCert` noting this:
```ts
// TODO: Detect SAN mismatch and regenerate cert when domain config changes
```
This is acceptable for v1 -- the cert is generated once on first run and the user can delete cert.pem/key.pem to force regeneration.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - Read certificate.ts and confirm hostsFile domain is added as SAN (type 2) when it differs from mDNS domain
  </verify>
  <done>
    - Certificate SANs include: mDNS domain, hostsFile domain (if different), localhost, 127.0.0.1, all LAN IPs
    - TODO comment exists for future cert regeneration on domain change
  </done>
</task>

<task type="auto">
  <name>Task 3: Integrate hosts file into server lifecycle and config change detection</name>
  <files>
    sidecar/src/server.ts
    sidecar/src/index.ts
    sidecar/src/ws/handler.ts
  </files>
  <action>
**server.ts -- call ensureHostsEntry during startup:**

In `startServer()`, after the HTTPS server is listening and after the mDNS publish block (after line ~106), add hosts file setup:

```ts
if (config.network.hostsFile.enabled) {
  try {
    await ensureHostsEntry(config.server.host, config.network.hostsFile.domain);
  } catch (hostsError) {
    const errorMessage = hostsError instanceof Error ? hostsError.message : String(hostsError);
    logger.warn("Failed to update hosts file (user may have cancelled elevation prompt)", {
      domain: config.network.hostsFile.domain,
      ip: config.server.host,
      error: errorMessage,
    });
  }
}
```

Import `ensureHostsEntry` from `./network/hosts` at the top.

The try/catch ensures a failed/cancelled UAC dialog does NOT crash the server. The app works fine without the hosts entry -- users just use the IP directly.

**index.ts -- call removeHostsEntry during shutdown:**

Import `removeHostsEntry` from `./network/hosts`.

In `setupGracefulShutdown`, after `stopServer()` and before `process.exit(0)`, add:

```ts
try {
  await removeHostsEntry();
} catch {
  // Best-effort: don't block shutdown if hosts cleanup fails
}
```

This goes inside the existing signal handler (the `async () => { ... }` callback for SIGTERM/SIGINT).

**ws/handler.ts -- add hostsFile fields to restart triggers:**

Add `"network.hostsFile.domain"` and `"network.hostsFile.enabled"` to the `RESTART_TRIGGERING_FIELDS` set (line 24-28). This ensures that when the admin changes the domain or toggles hosts file support, the server restarts, which re-runs `startServer()` which calls `ensureHostsEntry` with the new values.

Updated set:
```ts
const RESTART_TRIGGERING_FIELDS = new Set([
  "server.port",
  "server.host",
  "server.interface",
  "network.hostsFile.domain",
  "network.hostsFile.enabled",
]);
```

Note: The existing `stopServer()` in `server.ts` does NOT call `removeHostsEntry` -- that's intentional. On restart, we want the new `startServer()` to overwrite the entry with new values. Only on full shutdown (SIGTERM/SIGINT in index.ts) do we remove the entry.
  </action>
  <verify>
    - `npx tsc --noEmit` passes with no type errors
    - Grep `server.ts` for `ensureHostsEntry` -- should appear in `startServer()`
    - Grep `index.ts` for `removeHostsEntry` -- should appear in shutdown handler
    - Grep `handler.ts` for `network.hostsFile` -- should appear in RESTART_TRIGGERING_FIELDS
    - Full build: `cd sidecar && npm run build` (if build script exists) or `npx tsc --noEmit`
  </verify>
  <done>
    - Server startup calls `ensureHostsEntry` when `hostsFile.enabled` is true (non-fatal on failure)
    - Graceful shutdown calls `removeHostsEntry` (best-effort, non-blocking)
    - Config changes to `network.hostsFile.domain` or `network.hostsFile.enabled` trigger server restart
    - All TypeScript compiles cleanly
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` in `sidecar/` -- zero type errors
2. Read `sidecar/src/config/schema.ts` -- both domain defaults are `"church.audio"`, hostsFile.enabled defaults to `true`
3. Read `sidecar/src/network/hosts.ts` -- exports `ensureHostsEntry` and `removeHostsEntry`, handles win32/darwin/linux
4. Read `sidecar/src/network/certificate.ts` -- hostsFile domain added as SAN when different from mDNS domain
5. Read `sidecar/src/server.ts` -- `ensureHostsEntry` called in `startServer()` inside try/catch
6. Read `sidecar/src/index.ts` -- `removeHostsEntry` called in shutdown handler
7. Read `sidecar/src/ws/handler.ts` -- `network.hostsFile.domain` and `network.hostsFile.enabled` in RESTART_TRIGGERING_FIELDS
</verification>

<success_criteria>
- Default domain is "church.audio" everywhere
- New `hosts.ts` module provides cross-platform hosts file management with OS-native elevation
- Certificate includes hostsFile domain as SAN
- Hosts entry is created on startup, updated on config change, removed on shutdown
- All changes are non-fatal: if elevation fails, the app continues working with IP-only access
- TypeScript compiles with zero errors
</success_criteria>

<output>
After completion, create `.planning/quick/001-local-domain-hosts-cert/001-SUMMARY.md`
</output>
