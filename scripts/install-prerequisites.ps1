<#
.SYNOPSIS
  Install ChurchAudioStream prerequisites on Windows 10/11.

.DESCRIPTION
  Installs GStreamer 1.26 (MSVC 64-bit, Complete) and Edge WebView2 Runtime,
  then verifies installation. Reboot may be required after GStreamer install
  to refresh system PATH for child processes.

  Compatible with Windows PowerShell 5.1 (default on Win10) and PowerShell 7+.

.PARAMETER GstVersion
  GStreamer version to install. Default: 1.26.0.

.PARAMETER SkipWebView2
  Skip WebView2 install (already present on Win10 22H2+ and Win11).

.EXAMPLE
  iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/master/scripts/install-prerequisites.ps1 | iex

.EXAMPLE
  # Local run with explicit version
  .\install-prerequisites.ps1 -GstVersion 1.26.0
#>

[CmdletBinding()]
param(
  [string]$GstVersion = "1.26.0",
  [switch]$SkipWebView2
)

# ----- PowerShell 5.1+ compatibility ------------------------------------------------
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # speeds up Invoke-WebRequest

# Detect PowerShell version
$psMajor = $PSVersionTable.PSVersion.Major
if ($psMajor -lt 5) {
  Write-Host "[X] PowerShell 5.1 or newer required. Detected: $($PSVersionTable.PSVersion)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "ChurchAudioStream prerequisites installer" -ForegroundColor Cyan
Write-Host "PowerShell: $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))" -ForegroundColor Gray
Write-Host ""

# ----- Elevation check --------------------------------------------------------------
function Test-IsAdmin {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  Write-Host "[X] Administrator privileges required to install MSIs." -ForegroundColor Red
  Write-Host ""
  Write-Host "Re-run from an elevated PowerShell window:" -ForegroundColor Yellow
  Write-Host "  Right-click 'Windows PowerShell' -> 'Run as administrator'" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Then either:" -ForegroundColor Yellow
  Write-Host "  iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/master/scripts/install-prerequisites.ps1 | iex" -ForegroundColor White
  Write-Host "or:" -ForegroundColor Yellow
  Write-Host "  Set-ExecutionPolicy -Scope Process Bypass -Force; .\install-prerequisites.ps1" -ForegroundColor White
  exit 1
}

# ----- TLS 1.2 (PS 5.1 defaults to 1.0 on older Win10) ------------------------------
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  Write-Host "[!] Could not enable TLS 1.2: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ----- Helper: check command on PATH -----------------------------------------------
function Test-CommandExists {
  param([string]$Name)
  $cmd = Get-Command -Name $Name -ErrorAction SilentlyContinue
  return [bool]$cmd
}

# ----- Helper: refresh PATH from registry without reboot ----------------------------
function Update-SessionPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

# ----- Step 1: GStreamer 1.26 -------------------------------------------------------
Write-Host "[1/3] GStreamer $GstVersion (MSVC 64-bit, Complete install)" -ForegroundColor Cyan

$gstInstalled = Test-CommandExists "gst-launch-1.0.exe"
if (-not $gstInstalled) {
  # Try common install dirs even if not on PATH yet (installer just ran in same session)
  $gstCandidates = @(
    "C:\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe",
    "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe"
  )
  foreach ($c in $gstCandidates) {
    if (Test-Path $c) { $gstInstalled = $true; break }
  }
}

if ($gstInstalled) {
  Write-Host "    Already installed, skipping download." -ForegroundColor Green
} else {
  $gstUrl = "https://gstreamer.freedesktop.org/data/pkg/windows/$GstVersion/msvc/gstreamer-1.0-msvc-x86_64-$GstVersion.msi"
  $gstMsi = Join-Path $env:TEMP "gstreamer-1.0-msvc-x86_64-$GstVersion.msi"

  Write-Host "    Downloading from gstreamer.freedesktop.org..." -ForegroundColor Gray
  Write-Host "    URL: $gstUrl" -ForegroundColor DarkGray
  try {
    Invoke-WebRequest -Uri $gstUrl -OutFile $gstMsi -UseBasicParsing
  } catch {
    Write-Host "[X] Download failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Verify version $GstVersion exists at:" -ForegroundColor Yellow
    Write-Host "    https://gstreamer.freedesktop.org/data/pkg/windows/" -ForegroundColor Yellow
    Write-Host "    Re-run with -GstVersion <newer>" -ForegroundColor Yellow
    exit 1
  }

  $sizeMB = [math]::Round((Get-Item $gstMsi).Length / 1MB, 1)
  Write-Host "    Downloaded $sizeMB MB. Installing (Complete = ADDLOCAL=ALL)..." -ForegroundColor Gray
  Write-Host "    This may take 1-2 minutes; no progress bar." -ForegroundColor DarkGray

  $msiArgs = @(
    "/i", "`"$gstMsi`"",
    "/quiet",
    "/norestart",
    "ADDLOCAL=ALL"
  )
  $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    Write-Host "[X] msiexec exit code $($proc.ExitCode)" -ForegroundColor Red
    exit 1
  }
  if ($proc.ExitCode -eq 3010) {
    Write-Host "    GStreamer installed; reboot pending (exit 3010)." -ForegroundColor Yellow
  } else {
    Write-Host "    GStreamer installed." -ForegroundColor Green
  }

  Remove-Item $gstMsi -Force -ErrorAction SilentlyContinue
  Update-SessionPath
}

# ----- Step 2: WebView2 Runtime -----------------------------------------------------
Write-Host ""
Write-Host "[2/3] Edge WebView2 Runtime" -ForegroundColor Cyan

if ($SkipWebView2) {
  Write-Host "    Skipped (-SkipWebView2)." -ForegroundColor Yellow
} else {
  # Detect existing install via registry (covers per-user + per-machine x86/x64)
  $wv2Keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  )
  $wv2Version = $null
  foreach ($k in $wv2Keys) {
    if (Test-Path $k) {
      try {
        $v = (Get-ItemProperty -Path $k -Name "pv" -ErrorAction SilentlyContinue).pv
        if ($v) { $wv2Version = $v; break }
      } catch {}
    }
  }

  if ($wv2Version) {
    Write-Host "    Already installed: $wv2Version" -ForegroundColor Green
  } else {
    $wv2Url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"  # MS Evergreen Bootstrapper
    $wv2Exe = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup.exe"
    Write-Host "    Downloading Evergreen Bootstrapper..." -ForegroundColor Gray
    try {
      Invoke-WebRequest -Uri $wv2Url -OutFile $wv2Exe -UseBasicParsing
    } catch {
      Write-Host "[X] WebView2 download failed: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "    Continuing — most Win10 22H2+ and Win11 already have it." -ForegroundColor Yellow
    }
    if (Test-Path $wv2Exe) {
      Write-Host "    Installing silently..." -ForegroundColor Gray
      $proc = Start-Process -FilePath $wv2Exe -ArgumentList "/silent", "/install" -Wait -PassThru
      if ($proc.ExitCode -ne 0) {
        Write-Host "[!] WebView2 installer exit $($proc.ExitCode); may already be present." -ForegroundColor Yellow
      } else {
        Write-Host "    WebView2 installed." -ForegroundColor Green
      }
      Remove-Item $wv2Exe -Force -ErrorAction SilentlyContinue
    }
  }
}

# ----- Step 3: Verify ---------------------------------------------------------------
Write-Host ""
Write-Host "[3/3] Verifying GStreamer on PATH" -ForegroundColor Cyan

Update-SessionPath
$gstExe = Get-Command "gst-launch-1.0.exe" -ErrorAction SilentlyContinue
if ($gstExe) {
  $gstPath = $gstExe.Source
  Write-Host "    Found: $gstPath" -ForegroundColor Green
  try {
    $verOut = & $gstPath --version 2>&1 | Select-Object -First 1
    Write-Host "    $verOut" -ForegroundColor Green
  } catch {
    Write-Host "[!] gst-launch-1.0.exe ran but errored: $($_.Exception.Message)" -ForegroundColor Yellow
  }
} else {
  # Look in standard install dirs even if PATH didn't refresh
  $found = $null
  foreach ($c in @("C:\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe", "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe")) {
    if (Test-Path $c) { $found = $c; break }
  }
  if ($found) {
    Write-Host "[!] Found at $found but PATH not yet refreshed in this session." -ForegroundColor Yellow
    Write-Host "    REBOOT required for new processes (including ChurchAudioStream) to see GStreamer." -ForegroundColor Yellow
  } else {
    Write-Host "[X] gst-launch-1.0.exe not found anywhere. Installation may have failed." -ForegroundColor Red
    exit 1
  }
}

# ----- Done -------------------------------------------------------------------------
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  Prerequisites installed." -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. REBOOT this PC (refreshes PATH for all processes)." -ForegroundColor White
Write-Host "  2. Download ChurchAudioStream installer:" -ForegroundColor White
Write-Host "     https://github.com/roulendz/ChurchAudioStream/releases/latest" -ForegroundColor Cyan
Write-Host "  3. Run the .msi or -setup.exe installer." -ForegroundColor White
Write-Host "  4. Allow firewall on Private network (port 7777, mDNS)." -ForegroundColor White
Write-Host "  5. Phones on same WiFi: open https://<host-ip>:7777" -ForegroundColor White
Write-Host ""
