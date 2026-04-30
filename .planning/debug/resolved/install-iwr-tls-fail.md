---
slug: install-iwr-tls-fail
status: root_cause_found
trigger: "iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/690e024/scripts/install-prerequisites.ps1 | iex fails with: 'The underlying connection was closed: An unexpected error occurred on a send.'"
created: 2026-04-30
updated: 2026-04-30
---

# Debug: install script iwr connection closed

## Symptoms

<!-- DATA_START -->
- expected: install-prerequisites.ps1 downloads from GitHub raw and pipes to iex; script then installs GStreamer + WebView2 via winget
- actual: `iwr` errors immediately before the script body executes — `WebCmdletWebResponseException` / `The underlying connection was closed: An unexpected error occurred on a send.`
- error: `iwr : The underlying connection was closed: An unexpected error occurred on a send.` at `Invoke-WebRequest` line 1 char 51, FullyQualifiedErrorId `WebCmdletWebResponseException,Microsoft.PowerShell.Commands.InvokeWebRequestCommand`
- timeline: first attempt on target Windows machine (`PS C:\Users\lives>` prompt — default Windows PowerShell, NOT pwsh)
- repro: open Windows PowerShell 5.1, run the README one-liner: `Set-ExecutionPolicy -Scope Process Bypass -Force; iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/690e024/scripts/install-prerequisites.ps1 | iex`
- env: Windows host, default `powershell.exe` (Windows PowerShell 5.1, .NET Framework), no proxy mentioned
- script reference: scripts/install-prerequisites.ps1 (commit 690e024)
<!-- DATA_END -->

## Current Focus

- hypothesis: Windows PowerShell 5.1 defaults `[Net.ServicePointManager]::SecurityProtocol` to SSL3/Tls (1.0). GitHub raw deprecated TLS 1.0/1.1 and only accepts TLS 1.2+. iwr fails during the TLS handshake -> "underlying connection closed: send error". Script body never executes — failure is in bootstrap iwr, before script's own preferences run.
- test: confirmed by source inspection — script's TLS 1.2 enable line lives at L56-61 of install-prerequisites.ps1, INSIDE the script body. iex parses script body only AFTER iwr returns the bytes. Chicken-and-egg: iwr needs TLS 1.2 to fetch the script that enables TLS 1.2.
- expecting: with `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` set in the user's session BEFORE the iwr call, handshake completes and iex runs.
- next_action: ROOT CAUSE LOCKED — propose fix to README + script-error-message bootstrap one-liner.

## Evidence

- timestamp: 2026-04-30 (session-manager investigation)
  - confirmed: `scripts/install-prerequisites.ps1` enables TLS 1.2 at L56-61 INSIDE script body (after `Set-StrictMode`, after elevation check). Bootstrap `iwr` is upstream of this code path. Cannot help.
  - confirmed: `README.md` install one-liner (L12) is `Set-ExecutionPolicy -Scope Process Bypass -Force; iwr -useb https://.../install-prerequisites.ps1 | iex` — NO TLS 1.2 prefix.
  - confirmed: README L27 (PS 7.5 fallback hint) also lacks TLS 1.2 prefix.
  - confirmed: install-prerequisites.ps1 itself echoes the same TLS-less one-liner at L50, L175 (in error/help text shown when retry needed). Same flaw — propagates problem to next attempt.
  - confirmed: `curl -sS -I https://raw.githubusercontent.com/roulendz/ChurchAudioStream/690e024/scripts/install-prerequisites.ps1` returns HTTP 200. URL reachable, commit exists, server side fine.
  - confirmed: `curl -sS -I https://raw.githubusercontent.com/roulendz/ChurchAudioStream/master/scripts/install-prerequisites.ps1` returns HTTP 200. master also reachable.
  - signature: ".NET Framework HttpWebRequest -> raw.githubusercontent.com -> connection closed during send" is the canonical fingerprint of TLS 1.0/1.1 client refused by GitHub edge (2018+ deprecation; tightened in 2022).

## Eliminated

- not a missing/typo'd commit SHA — HTTP 200 returned for both `/690e024/...` and `/master/...` URLs.
- not a 404/path issue — server returns 200 to TLS-1.2 clients.
- not a winget/MSI failure — failure is at iwr download step, before any winget invocation.
- not a script-internal bug — script body never runs (iwr errors first; iex never sees content).
- not a `Set-StrictMode` / `$ErrorActionPreference` interaction — runs only after iex parses script.
- proxy MITM / corporate AV TLS interception is *possible* but lower priority than canonical TLS 1.0 default (no proxy mentioned in user env; symptom is the textbook PS 5.1 + GitHub fingerprint). If TLS 1.2 prefix fix doesn't resolve, escalate to proxy/AV diagnosis.
- .NET 4.5 missing — possible on very old Win10 builds but PS 5.1 ships with newer .NET; .NET 4.5+ supports Tls12 enum. Lower priority — fix-first, escalate if it fails.

## Resolution

- root_cause: Windows PowerShell 5.1 on the target machine ships with `[Net.ServicePointManager]::SecurityProtocol = Ssl3, Tls` (TLS 1.0). GitHub's `raw.githubusercontent.com` edge requires TLS 1.2+. The README's install one-liner invokes `iwr` BEFORE the install script body has a chance to call `[Net.ServicePointManager]::SecurityProtocol = ... -bor Tls12`. Result: TLS handshake fails during ClientHello/send → .NET surfaces it as `WebCmdletWebResponseException: The underlying connection was closed: An unexpected error occurred on a send.` Script's own TLS 1.2 enable line at L56-61 is unreachable because iex never receives the script bytes.
- fix: prepend `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;` to the install one-liner in README.md (both occurrences) AND in the help-text echo lines inside install-prerequisites.ps1 (L50, L175) and the script header comment (L7). Provides forward-compatible bootstrap on PS 5.1 default Win10 image.
- verification: pending user approval to apply patch.
- files_changed: README.md, scripts/install-prerequisites.ps1
