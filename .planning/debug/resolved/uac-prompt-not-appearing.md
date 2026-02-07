---
status: resolved
trigger: "UAC prompt not appearing when hostsFile is enabled - writeHostsFileElevated() never shows UAC dialog"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: VBScript-based elevation from CREATE_NO_WINDOW process
expecting: UAC prompt appears and hosts file is updated
next_action: archive session

## Symptoms

expected: When Node.js sidecar starts with hostsFile.enabled=true, a Windows UAC prompt appears to modify hosts file
actual: No UAC prompt appears. Hosts file not updated. Error caught and logged as warning silently.
errors: "Start-Process : This command cannot be run due to the error: The operation was canceled by the user."
reproduction: Start app with hostsFile.enabled=true in config
started: Never worked - EncodedCommand fix addressed quoting but UAC prompt never confirmed working

## Eliminated

- hypothesis: EncodedCommand base64 encoding is incorrect
  evidence: Buffer.from(command, 'utf16le').toString('base64') round-trips perfectly. PowerShell decodes it correctly.
  timestamp: 2026-02-06T00:00:30Z

- hypothesis: PowerShell -Wait and -Verb RunAs are incompatible (Issue #3220)
  evidence: Issue #3220 was PS v3 on specific Windows version. On PS 5.1, -Wait + -Verb RunAs works fine from a normal console process.
  timestamp: 2026-02-06T00:00:40Z

- hypothesis: Path backslash escaping is wrong in the command
  evidence: Using actual runtime path values (from os.tmpdir() and the constant), the encoded command correctly preserves all backslashes.
  timestamp: 2026-02-06T00:00:35Z

## Evidence

- timestamp: 2026-02-06T00:00:20Z
  checked: PowerShell command execution from normal Node.js process (terminal)
  found: The exact hosts.ts command works perfectly - UAC prompt appears, copy succeeds
  implication: The command itself is correct; issue is environmental

- timestamp: 2026-02-06T00:00:25Z
  checked: Tauri shell plugin process creation
  found: Tauri spawns sidecars with CREATE_NO_WINDOW flag (confirmed via GitHub issue #2135)
  implication: The sidecar Node.js process runs without a console window

- timestamp: 2026-02-06T00:00:50Z
  checked: UAC elevation from CREATE_NO_WINDOW process (windowsHide:true in Node.js spawn)
  found: Start-Process -Verb RunAs FAILS with "The operation was canceled by the user" - UAC prompt never appears
  implication: This is the root cause. ShellExecuteEx requires a valid window/console context for UAC consent.

- timestamp: 2026-02-06T00:00:55Z
  checked: Error handling in server.ts
  found: The error from writeHostsFileElevated is caught at server.ts:112-117 and logged as a warning
  implication: The error IS thrown but silently logged as a warning, explaining why user sees no UAC and no crash

- timestamp: 2026-02-06T00:03:00Z
  checked: VBScript Shell.Application.ShellExecute with runas verb from CREATE_NO_WINDOW process
  found: VBScript's COM-based ShellExecute CAN display UAC prompt even from windowless process
  implication: VBScript intermediary is a viable fix

- timestamp: 2026-02-06T00:04:00Z
  checked: Full add/remove cycle from CREATE_NO_WINDOW process using VBScript approach
  found: Both ensureHostsEntry (add) and removeHostsEntry (remove) work correctly
  implication: Fix is complete and verified

## Resolution

root_cause: The Tauri shell plugin spawns the Node.js sidecar with the CREATE_NO_WINDOW process creation flag. When the sidecar attempts UAC elevation via PowerShell's `Start-Process -Verb RunAs`, the underlying `ShellExecuteEx` API call cannot display the UAC consent dialog because the process has no window context. Windows silently cancels the elevation, producing the error "The operation was canceled by the user." This error is caught in server.ts and logged as a warning.

fix: Replaced the PowerShell `Start-Process -Verb RunAs` approach with a VBScript intermediary. The new approach writes a temporary VBScript that uses `Shell.Application.ShellExecute` with the `runas` verb - this COM-based method creates its own execution context and CAN display the UAC prompt from a windowless process. A sentinel file pattern provides synchronous wait capability (the elevated process writes a sentinel file on completion, and the VBScript polls for it).

verification: Tested both add and remove operations from a `CREATE_NO_WINDOW` child process (replicating the exact Tauri sidecar context). UAC prompt appeared in both cases, hosts file was correctly updated/cleaned, and the sentinel-based synchronization worked reliably. TypeScript compiles clean.

files_changed:
- sidecar/src/network/hosts.ts
