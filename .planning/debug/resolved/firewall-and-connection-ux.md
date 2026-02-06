---
status: resolved
trigger: "firewall-and-connection-ux: sidecar requires manual firewall, IPv4/IPv6 localhost issue, CSP blocks ws://"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:02:00Z
---

## Current Focus

hypothesis: RESOLVED - All three fixes applied and verified
test: TypeScript compilation (both sidecar and frontend), sidecar full build
expecting: Clean compilation
next_action: Archive and commit

## Symptoms

expected: App should handle firewall/network access automatically. Admin GUI should always connect reliably. Production builds should work.
actual: (1) Firewall warning logged, phones can't connect. (2) Admin GUI sometimes stuck on "Loading configuration..." after restart. (3) CSP only allows wss://, not ws://.
errors: "Firewall rule requires administrator privileges. Phone connections may be blocked."
reproduction: (1) Run without admin - phones blocked. (2) Restart app - sometimes GUI stuck. (3) CSP will break production.
started: Design flaws since initial implementation.

## Eliminated

- hypothesis: Windows auto-dialog never fires for the sidecar
  evidence: Firewall rules DO exist for both server.exe and server-x86_64-pc-windows-gnu.exe with "Node.js JavaScript Runtime" name. The auto-dialog DID fire and user clicked Allow. Rules are per-executable-path. The netsh approach was redundant.
  timestamp: 2026-02-06T00:01:00Z

## Evidence

- timestamp: 2026-02-06T00:00:30Z
  checked: Windows firewall rules via `netsh advfirewall firewall show rule`
  found: Multiple "Node.js JavaScript Runtime" allow rules exist for BOTH sidecar paths (target/debug/server.exe AND binaries/server-x86_64-pc-windows-gnu.exe). Also a ChurchAudioStream rule for port 7777. Created by Windows auto-dialog.
  implication: Windows DOES show the auto-dialog for the sidecar. The netsh code was unnecessary and harmful.

- timestamp: 2026-02-06T00:00:35Z
  checked: server.ts HTTP server binding
  found: HTTP loopback server binds to "127.0.0.1" (IPv4 only) on line 87
  implication: Correct -- server is IPv4 only on loopback

- timestamp: 2026-02-06T00:00:35Z
  checked: useServerStatus.ts resolveWebSocketUrl()
  found: Uses `ws://localhost:7778` in 3 places. localhost can resolve to ::1 (IPv6) on Windows.
  implication: Mismatch with server binding on 127.0.0.1 causes intermittent failures.

- timestamp: 2026-02-06T00:00:40Z
  checked: tauri.conf.json CSP connect-src
  found: Only allows wss:// schemes. Admin GUI uses ws:// for loopback.
  implication: CSP would block admin WebSocket in production builds.

- timestamp: 2026-02-06T00:02:00Z
  checked: TypeScript compilation and sidecar build after all fixes
  found: Both `npx tsc --noEmit` (sidecar + frontend) pass. Sidecar `npm run build` produces binary. Frontend `npm run build` has pre-existing @types/node error unrelated to changes.
  implication: All fixes compile cleanly.

## Resolution

root_cause: Three design flaws: (1) firewall.ts used netsh/execSync requiring admin elevation and logging scary warnings, but Windows Firewall already auto-prompts on first listen -- the entire netsh approach was solving a non-problem, (2) WebSocket URL used ws://localhost which can resolve to IPv6 ::1 on Windows but server binds only 127.0.0.1 (IPv4), (3) CSP in tauri.conf.json only allowed wss:// but admin GUI uses ws:// for loopback HTTP server
fix: (1) Replaced firewall.ts with logFirewallReminder() -- removed all netsh/execSync/elevation code, replaced with a simple info log, (2) Changed all 3 instances of ws://localhost to ws://127.0.0.1 in useServerStatus.ts, (3) Added ws://127.0.0.1:* and http://127.0.0.1:* to CSP connect-src in tauri.conf.json
verification: TypeScript compiles cleanly for both sidecar and frontend. Sidecar builds to binary successfully.
files_changed:
  - sidecar/src/network/firewall.ts
  - sidecar/src/index.ts
  - src/hooks/useServerStatus.ts
  - src-tauri/tauri.conf.json
