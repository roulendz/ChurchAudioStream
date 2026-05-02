# cas-host-config.ps1 - shared pure host-config helpers for ChurchAudioStream
#
# Dot-source this file. Provides idempotent, side-effect-isolated functions for:
#   - PATH manipulation (Add-PathEntry / Remove-PathEntry / Test-PathEntry)
#   - Windows Firewall rule management (Add-CasFirewallRule / Remove-CasFirewallRule)
#   - GStreamer install-dir discovery (Find-GStreamerBin)
#
# Pure string functions (Update-PathString / Remove-FromPathString) take and return
# strings only -> trivially testable without admin or system mutation.

Set-StrictMode -Version Latest

$Script:CAS_FIREWALL_RULE_NAME = "ChurchAudioStream"
$Script:CAS_PWA_PORT = 7777
$Script:CAS_GSTREAMER_BIN_CANDIDATES = @(
  "C:\gstreamer\1.0\msvc_x86_64\bin",
  "${env:ProgramFiles}\gstreamer\1.0\msvc_x86_64\bin",
  "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin"
)

# ----- pure string functions (testable without elevation) ---------------------

function Split-PathString {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$PathString)
  if ([string]::IsNullOrWhiteSpace($PathString)) { return @() }
  return @($PathString -split ';' | Where-Object { $_.Trim().Length -gt 0 })
}

function Test-PathEntryEquals {
  param(
    [Parameter(Mandatory = $true)][string]$Entry,
    [Parameter(Mandatory = $true)][string]$Target
  )
  return $Entry.TrimEnd('\').Trim() -ieq $Target.TrimEnd('\').Trim()
}

function Test-PathStringContains {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$PathString,
    [Parameter(Mandatory = $true)][string]$Entry
  )
  $parts = Split-PathString -PathString $PathString
  foreach ($p in $parts) {
    if (Test-PathEntryEquals -Entry $p -Target $Entry) { return $true }
  }
  return $false
}

function Update-PathString {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$PathString,
    [Parameter(Mandatory = $true)][string]$EntryToAdd
  )
  if (Test-PathStringContains -PathString $PathString -Entry $EntryToAdd) {
    return $PathString
  }
  $clean = $PathString.TrimEnd(';')
  if ([string]::IsNullOrWhiteSpace($clean)) { return $EntryToAdd }
  return "$clean;$EntryToAdd"
}

function Remove-FromPathString {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$PathString,
    [Parameter(Mandatory = $true)][string]$EntryToRemove
  )
  $parts = Split-PathString -PathString $PathString
  $kept = $parts | Where-Object { -not (Test-PathEntryEquals -Entry $_ -Target $EntryToRemove) }
  return ($kept -join ';')
}

# ----- side-effect functions (require elevation) ------------------------------

function Find-GStreamerBin {
  foreach ($candidate in $Script:CAS_GSTREAMER_BIN_CANDIDATES) {
    if (Test-Path (Join-Path $candidate "gst-launch-1.0.exe")) {
      return $candidate
    }
  }
  return $null
}

function Add-MachinePathEntry {
  param([Parameter(Mandatory = $true)][string]$Entry)
  $current = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $updated = Update-PathString -PathString $current -EntryToAdd $Entry
  if ($updated -eq $current) { return $false }
  [Environment]::SetEnvironmentVariable("Path", $updated, "Machine")
  return $true
}

function Remove-MachinePathEntry {
  param([Parameter(Mandatory = $true)][string]$Entry)
  $current = [Environment]::GetEnvironmentVariable("Path", "Machine")
  if (-not (Test-PathStringContains -PathString $current -Entry $Entry)) { return $false }
  $updated = Remove-FromPathString -PathString $current -EntryToRemove $Entry
  [Environment]::SetEnvironmentVariable("Path", $updated, "Machine")
  return $true
}

function Update-SessionPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Add-CasFirewallRule {
  param(
    [Parameter(Mandatory = $true)][string]$ServerExePath
  )
  if (-not (Test-Path $ServerExePath)) {
    throw "server.exe not found at $ServerExePath — firewall rule cannot be pre-registered"
  }
  $existing = Get-NetFirewallRule -DisplayName $Script:CAS_FIREWALL_RULE_NAME -ErrorAction SilentlyContinue
  if ($existing) { return $false }
  # Program-based rule (NOT port-based): pre-registers the exe identity with
  # Windows Firewall so the "first-time listener" popup never fires. Port-based
  # rules allow inbound traffic but don't suppress the program-identification
  # prompt that Defender shows when an unrecognized exe first binds to a port.
  New-NetFirewallRule `
    -DisplayName $Script:CAS_FIREWALL_RULE_NAME `
    -Description "Allow phones on LAN to reach the listener PWA + WebRTC signaling" `
    -Direction Inbound `
    -Program $ServerExePath `
    -LocalPort $Script:CAS_PWA_PORT `
    -Protocol TCP `
    -Action Allow `
    -Profile Private `
    -ErrorAction Stop | Out-Null
  return $true
}

function Remove-CasFirewallRule {
  $existing = Get-NetFirewallRule -DisplayName $Script:CAS_FIREWALL_RULE_NAME -ErrorAction SilentlyContinue
  if (-not $existing) { return $false }
  Remove-NetFirewallRule -DisplayName $Script:CAS_FIREWALL_RULE_NAME -ErrorAction Stop
  return $true
}

function Test-IsAdmin {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}
