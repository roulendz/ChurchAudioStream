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
# NOTE: keep progress visible for big downloads (winget bundle ~200 MB, GStreamer ~150 MB).
# Set per-call to "SilentlyContinue" only for fast HEAD probes.
$ProgressPreference = "Continue"

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

# ----- Helper: locate winget.exe by checking PATH AND known WindowsApps install dir.
# Add-AppxPackage registers winget but doesn't always update $env:Path in the
# current PS session, so PATH lookup can fail right after install.
function Resolve-WingetPath {
  $cmd = Get-Command -Name "winget" -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $direct = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\winget.exe"
  if (Test-Path $direct) { return $direct }
  return $null
}

# ----- Helper: refresh PATH from registry without reboot ----------------------------
function Update-SessionPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

# ----- Helper: download with browser UA (gstreamer.freedesktop.org returns 418 to PS UA) -----
$BrowserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

function Invoke-Download {
  param(
    [Parameter(Mandatory=$true)][string]$Url,
    [Parameter(Mandatory=$true)][string]$OutFile
  )
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -UserAgent $BrowserUA -MaximumRedirection 10
}

function Test-UrlExists {
  param([Parameter(Mandatory=$true)][string]$Url)
  try {
    $resp = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -UserAgent $BrowserUA -MaximumRedirection 10 -TimeoutSec 15
    return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
  } catch {
    return $false
  }
}

# ----- Step 1: GStreamer (via winget) -----------------------------------------------
# gstreamer.freedesktop.org runs Anubis anti-bot (returns 418 to PowerShell), so
# we use winget to fetch the official MSI from MS-curated mirrors.
# Package: gstreamerproject.gstreamer (currently 1.28.x; ABI-compatible with 1.26).
# We pass /quiet ADDLOCAL=ALL via --override to force the "Complete" feature set.
Write-Host "[1/3] GStreamer (MSVC 64-bit, Complete install) via winget" -ForegroundColor Cyan

$gstInstalled = Test-CommandExists "gst-launch-1.0.exe"
if (-not $gstInstalled) {
  $gstCandidates = @(
    "C:\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe",
    "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe"
  )
  foreach ($c in $gstCandidates) {
    if (Test-Path $c) { $gstInstalled = $true; break }
  }
}

if ($gstInstalled) {
  Write-Host "    Already installed, skipping." -ForegroundColor Green
} else {
  $wingetExe = Resolve-WingetPath
  if (-not $wingetExe) {
    Write-Host "    winget not found - bootstrapping App Installer..." -ForegroundColor Yellow

    # Auto-bootstrap winget via official MS aka.ms/getwinget (msixbundle ~200 MB).
    $wingetBundle = Join-Path $env:TEMP "Microsoft.DesktopAppInstaller.msixbundle"
    $bootstrapped = $false

    try {
      Write-Host "    Downloading App Installer from aka.ms/getwinget (~200 MB)..." -ForegroundColor Gray
      # Prefer BITS for a real progress bar; fall back to Invoke-WebRequest.
      $bitsAvailable = $null -ne (Get-Module -ListAvailable -Name BitsTransfer)
      if ($bitsAvailable) {
        Import-Module BitsTransfer
        Start-BitsTransfer -Source "https://aka.ms/getwinget" -Destination $wingetBundle -DisplayName "App Installer" -Description "Downloading winget bootstrapper"
      } else {
        Invoke-Download -Url "https://aka.ms/getwinget" -OutFile $wingetBundle
      }

      $sizeMB = [math]::Round((Get-Item $wingetBundle).Length / 1MB, 1)
      Write-Host "    Downloaded $sizeMB MB. Installing via Add-AppxPackage..." -ForegroundColor Gray
      Add-AppxPackage -Path $wingetBundle -ErrorAction Stop
      Update-SessionPath
      Start-Sleep -Seconds 3

      # Resolve directly by path (PATH refresh may not include WindowsApps yet)
      $wingetExe = Resolve-WingetPath
      if ($wingetExe) {
        Write-Host "    winget installed at: $wingetExe" -ForegroundColor Green
        $bootstrapped = $true
      } else {
        Write-Host "[!] App Installer registered but winget.exe not yet visible." -ForegroundColor Yellow
        Write-Host "    Close ALL PowerShell windows, open a new one, then re-run this script." -ForegroundColor Yellow
      }
    } catch {
      Write-Host "[!] Auto-install failed: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
      Remove-Item $wingetBundle -Force -ErrorAction SilentlyContinue
    }

    if (-not $bootstrapped) {
      Write-Host ""
      Write-Host "[X] Could not bootstrap winget in this session. Pick one of:" -ForegroundColor Red
      Write-Host ""
      Write-Host "    OPTION A (easiest) - close this PowerShell window, open a NEW elevated one, re-run:" -ForegroundColor Yellow
      Write-Host "    Set-ExecutionPolicy -Scope Process Bypass -Force; iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/master/scripts/install-prerequisites.ps1 | iex" -ForegroundColor White
      Write-Host ""
      Write-Host "    OPTION B - Microsoft Store:" -ForegroundColor Yellow
      Write-Host "    1. Open Microsoft Store, search 'App Installer' (publisher: Microsoft)" -ForegroundColor White
      Write-Host "    2. Click Install or Update" -ForegroundColor White
      Write-Host "    3. Or visit: https://apps.microsoft.com/detail/9NBLGGH4NNS1" -ForegroundColor Cyan
      Write-Host ""
      Write-Host "    OPTION C - manual MSIX (offline / no Store):" -ForegroundColor Yellow
      Write-Host "    1. https://github.com/microsoft/winget-cli/releases/latest" -ForegroundColor Cyan
      Write-Host "    2. Download Microsoft.DesktopAppInstaller_*.msixbundle" -ForegroundColor White
      Write-Host "    3. Right-click the .msixbundle and Install" -ForegroundColor White
      Write-Host ""
      Write-Host "    OPTION D - skip winget, install GStreamer manually:" -ForegroundColor Yellow
      Write-Host "    1. https://gstreamer.freedesktop.org/download/" -ForegroundColor Cyan
      Write-Host "    2. Download GStreamer 1.26 runtime (MSVC 64-bit)" -ForegroundColor White
      Write-Host "    3. Run installer, choose 'Complete' (NOT 'Typical')" -ForegroundColor White
      Write-Host "    4. Reboot, then run the ChurchAudioStream installer (skip this script)" -ForegroundColor White
      Write-Host ""
      exit 1
    }
  }

  Write-Host "    Running: winget install gstreamerproject.gstreamer (Complete profile)..." -ForegroundColor Gray
  Write-Host "    This downloads ~150 MB and may take 2-5 minutes." -ForegroundColor DarkGray

  $wingetArgs = @(
    "install",
    "--id", "gstreamerproject.gstreamer",
    "--exact",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--override", "/quiet ADDLOCAL=ALL"
  )
  $proc = Start-Process -FilePath $wingetExe -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow
  # winget exit codes: 0 = ok, -1978335189 = already installed
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne -1978335189) {
    Write-Host "[!] winget exit code $($proc.ExitCode). Continuing - may have installed regardless." -ForegroundColor Yellow
  } else {
    Write-Host "    GStreamer installed." -ForegroundColor Green
  }

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
      Invoke-Download -Url $wv2Url -OutFile $wv2Exe
    } catch {
      Write-Host "[X] WebView2 download failed: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "    Continuing - most Win10 22H2+ and Win11 already have it." -ForegroundColor Yellow
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
