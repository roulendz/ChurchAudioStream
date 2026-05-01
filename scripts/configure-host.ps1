# configure-host.ps1 - install-time host configuration for ChurchAudioStream.
# Run by NSIS POSTINSTALL hook AND callable manually.
#
# Idempotent: safe to run multiple times.
#
# Does:
#   1. Find GStreamer install dir, add bin to MACHINE PATH (if not already)
#   2. Create Windows Firewall inbound rule for port 7777 Private (if not already)
#
# Does NOT:
#   - Install GStreamer (that's install-prerequisites.ps1)
#   - Install WebView2
#
# Exit codes:
#   0 = success
#   1 = not running as admin
#   2 = GStreamer not found (must run install-prerequisites.ps1 first)
#   3 = unexpected error

[CmdletBinding()]
param(
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
Log "ChurchAudioStream - host configuration" Cyan

if (-not (Test-IsAdmin)) {
  Write-Host "[X] Administrator privileges required." -ForegroundColor Red
  exit 1
}

# Step 1: GStreamer PATH
Log ""
Log "[1/2] Ensuring GStreamer bin is on machine PATH" Cyan
$gstBin = Find-GStreamerBin
if (-not $gstBin) {
  Write-Host "[X] GStreamer not found. Run install-prerequisites.ps1 first." -ForegroundColor Red
  exit 2
}
Log "    Found: $gstBin" Green
$added = Add-MachinePathEntry -Entry $gstBin
if ($added) {
  Log "    Added to MACHINE PATH (reboot needed for app to inherit)." Green
} else {
  Log "    Already in machine PATH." Green
}
Update-SessionPath

# Step 2: Firewall rule
Log ""
Log "[2/2] Firewall rule for port 7777 (Private network)" Cyan
try {
  $created = Add-CasFirewallRule
  if ($created) {
    Log "    Created inbound rule: TCP 7777, Private profile." Green
  } else {
    Log "    Rule 'ChurchAudioStream' already exists." Green
  }
} catch {
  Write-Host "[!] Could not create firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
}

Log ""
Log "Host configured. Reboot recommended so all processes see the new PATH." Green
exit 0
