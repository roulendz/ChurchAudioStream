# uninstall-cleanup.ps1 - uninstall-time host cleanup for ChurchAudioStream.
# Run by NSIS PREUNINSTALL hook AND callable manually by MSI users / IT pros.
#
# Idempotent: safe to run multiple times.
#
# Default mode (used by NSIS hook): removes firewall rule + GStreamer PATH entry.
# Does NOT touch GStreamer install (other apps may use it) or WebView2.
#
# -RemoveAppData : also delete %APPDATA%\com.churchaudiostream.app
#                                 %LOCALAPPDATA%\com.churchaudiostream.app
#                  (deletes Root CA, server cert, configs, sidecar logs)
#
# Exit codes:
#   0 = success
#   1 = not running as admin
#   3 = unexpected error
#
# Usage:
#   .\uninstall-cleanup.ps1                 # safe minimal cleanup
#   .\uninstall-cleanup.ps1 -RemoveAppData  # also nuke app data (for full reset)
#   .\uninstall-cleanup.ps1 -Quiet          # no output (for installer hooks)

[CmdletBinding()]
param(
  [switch]$RemoveAppData,
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$libPath = Join-Path $PSScriptRoot "lib\cas-host-config.ps1"
if (-not (Test-Path $libPath)) {
  Write-Host "[X] Missing library: $libPath" -ForegroundColor Red
  exit 3
}
. $libPath

function Log {
  param([string]$Message, [string]$Color = "Gray")
  if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

Log ""
Log "ChurchAudioStream - uninstall cleanup" Cyan

if (-not (Test-IsAdmin)) {
  Write-Host "[X] Administrator privileges required." -ForegroundColor Red
  exit 1
}

# Step 1: Firewall rule
Log ""
Log "[1/3] Firewall rule" Cyan
try {
  $removed = Remove-CasFirewallRule
  if ($removed) {
    Log "    Removed firewall rule 'ChurchAudioStream'." Green
  } else {
    Log "    No firewall rule to remove." Yellow
  }
} catch {
  Write-Host "[!] Could not remove firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 2: PATH entry
Log ""
Log "[2/3] GStreamer PATH entry" Cyan
$gstBin = Find-GStreamerBin
if ($gstBin) {
  try {
    $removed = Remove-MachinePathEntry -Entry $gstBin
    if ($removed) {
      Log "    Removed PATH entry: $gstBin" Green
    } else {
      Log "    PATH entry not present." Yellow
    }
  } catch {
    Write-Host "[!] Could not update machine PATH: $($_.Exception.Message)" -ForegroundColor Yellow
  }
} else {
  Log "    GStreamer not found - nothing to remove from PATH." Yellow
}

# Step 3: App data (optional)
Log ""
Log "[3/3] App data (Root CA, server cert, configs, logs)" Cyan
if ($RemoveAppData) {
  $appDataDirs = @(
    Join-Path $env:APPDATA "com.churchaudiostream.app",
    Join-Path $env:LOCALAPPDATA "com.churchaudiostream.app"
  )
  foreach ($dir in $appDataDirs) {
    if (Test-Path $dir) {
      try {
        Remove-Item -Path $dir -Recurse -Force -ErrorAction Stop
        Log "    Removed: $dir" Green
      } catch {
        Write-Host "[!] Could not remove $dir : $($_.Exception.Message)" -ForegroundColor Yellow
      }
    }
  }
} else {
  Log "    Skipped (use -RemoveAppData to also clear configs + Root CA + logs)." Yellow
  Log "    Path: $(Join-Path $env:APPDATA 'com.churchaudiostream.app')" DarkGray
}

Log ""
Log "Cleanup complete." Green
exit 0
