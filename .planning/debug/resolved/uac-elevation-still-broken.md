---
status: resolved
trigger: "UAC elevation still broken - VBScript approach never shows UAC prompt, hosts file never updated"
created: 2026-02-07T00:00:00Z
updated: 2026-02-07T00:00:00Z
---

## Current Focus

hypothesis: ROOT CAUSE CONFIRMED - VBS Shell.Application.ShellExecute "runas" does NOT work when parent process has CREATE_NO_WINDOW flag (inherited from Tauri sidecar spawning). The VBScript approach was supposed to bypass this but it DOESN'T.
test: Run exact same VBS code with execSync windowsHide:true vs without
expecting: windowsHide:true should fail (simulates Tauri), without should succeed
next_action: Find an alternative elevation approach that works from a CREATE_NO_WINDOW context

## Symptoms

expected: A Windows UAC prompt should appear asking for admin permission when the sidecar starts (if hostsFile.enabled=true) or when the setting is changed in the admin UI
actual: No UAC prompt appears at all. The hosts file is not modified. No visible error to the user.
errors: Unknown - errors likely caught and logged as warnings silently
reproduction: 1) Start app normally 2) Or change hostsFile.enabled in settings UI and save
started: Has NEVER worked. Original PowerShell approach failed, VBScript replacement also never confirmed working.

## Eliminated

- hypothesis: PowerShell Start-Process -Verb RunAs fails due to Tauri CREATE_NO_WINDOW flag
  evidence: Previous debug session confirmed this. VBScript approach was implemented as fix.
  timestamp: previous session

## Evidence

- timestamp: 2026-02-07T00:05:00Z
  checked: hosts file content
  found: No ChurchAudioStream entry exists in hosts file
  implication: Confirms the feature has never worked

- timestamp: 2026-02-07T00:05:00Z
  checked: cscript availability
  found: Windows Script Host v10.0 is available and working
  implication: cscript itself is not the issue

- timestamp: 2026-02-07T00:06:00Z
  checked: VBScript path escaping in buildElevationVbsContent
  found: Code doubles backslashes (replace \\ with \\\\) but VBScript does NOT use backslash escaping. VBS strings are literal - only "" is an escape (for double-quote). Doubling backslashes creates invalid paths like C:\\\\Users\\\\... in the actual VBS execution.
  implication: INITIALLY SUSPECTED but DISPROVEN - Windows normalizes double backslashes, so C:\\Users\\ works fine as C:\Users\

- timestamp: 2026-02-07T00:10:00Z
  checked: Windows double-backslash path handling
  found: "dir C:\\\\Users\\\\rolan\\\\..." works fine — Windows normalizes the path
  implication: The VBScript path escaping is NOT the bug. VBS doesn't interpret backslashes as escape chars, and Windows handles the doubled backslashes fine.

- timestamp: 2026-02-07T00:15:00Z
  checked: Exact replication of hosts.ts VBS elevation code from standalone Node.js
  found: The VBS code works PERFECTLY when run from a normal Node.js process — UAC appears, PS1 runs elevated, sentinel is created, "ELEVATION_SUCCESS" returned
  implication: The VBS/PS1 code generation is NOT broken. The bug must be in the execution context or call path.

- timestamp: 2026-02-07T00:15:00Z
  checked: PowerShell via VBS runas with -File flag
  found: Works with -File, -Command, visible window, hidden window — all work from normal Node.js
  implication: No PowerShell-specific issue

- timestamp: 2026-02-07T00:20:00Z
  checked: Sidecar startup with stdin kept alive (sleep 40 | tsx src/index.ts)
  found: The sidecar successfully calls ensureHostsEntry, VBS elevation works, UAC accepted, hosts file updated
  implication: VBS code is functionally correct when run from a normal windowed process

- timestamp: 2026-02-07T00:25:00Z
  checked: VBS elevation with execSync windowsHide: true (simulates Tauri CREATE_NO_WINDOW)
  found: TIMEOUT - UAC prompt does NOT appear, sentinel NOT created, output file NOT created
  implication: ROOT CAUSE - VBScript Shell.Application.ShellExecute "runas" ALSO fails in CREATE_NO_WINDOW context, just like PowerShell Start-Process -Verb RunAs. The VBS fix was based on a false premise.

- timestamp: 2026-02-07T00:25:00Z
  checked: VBS elevation with execSync windowsHide: false (default, normal console)
  found: Works perfectly - UAC appears, PS1 runs, sentinel created, ELEVATION_SUCCESS returned
  implication: The code is correct; the problem is purely the CREATE_NO_WINDOW execution context

- timestamp: 2026-02-07T00:30:00Z
  checked: Multiple alternative approaches (cmd /c start, powershell Start-Process, wscript.exe) all with windowsHide:true
  found: ALL fail with windowsHide:true. CREATE_NO_WINDOW is deeply inherited and blocks UAC across all these methods.
  implication: Need a fundamentally different approach to break the window flag inheritance

- timestamp: 2026-02-07T00:35:00Z
  checked: spawnSync with {detached:true, windowsHide:false} from a windowsHide:true parent
  found: SUCCESS! The UAC prompt appears, PS1 runs elevated, sentinel created, output file written
  implication: FIX FOUND - detached:true + windowsHide:false creates a new process group that explicitly does NOT have CREATE_NO_WINDOW, allowing VBS Shell.Application.ShellExecute "runas" to work

## Resolution

root_cause: execSync in writeHostsFileElevatedWindows inherits the parent's CREATE_NO_WINDOW flag from Tauri's sidecar spawning. VBScript Shell.Application.ShellExecute "runas" ALSO cannot display UAC from a CREATE_NO_WINDOW context (the previous fix was based on a false assumption). The fix is to use spawn with detached:true and windowsHide:false to explicitly break the CREATE_NO_WINDOW inheritance chain before launching cscript.
fix: Replace execSync with spawnSync using {windowsHide: false} in writeHostsFileElevatedWindows. The windowsHide:false flag explicitly overrides the inherited CREATE_NO_WINDOW flag, enabling the UAC consent dialog to appear. Also improved error handling with separate checks for spawn errors, non-zero exit codes, and unexpected output.
verification: Two-stage test confirmed fix works - parent process with windowsHide:true (simulating Tauri CREATE_NO_WINDOW) spawns child that uses spawnSync with windowsHide:false, which successfully triggers UAC elevation via VBScript Shell.Application.ShellExecute "runas". TypeScript compiles with zero errors.
files_changed:
  - sidecar/src/network/hosts.ts
