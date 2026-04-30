# ChurchAudioStream prerequisites installer
#
# Installs GStreamer (MSVC 64-bit, Complete) and Edge WebView2 Runtime via winget,
# then verifies installation. Compatible with Windows PowerShell 5.1 and PowerShell 7+.
#
# RUN (one-liner, requires elevated PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass -Force; iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/master/scripts/install-prerequisites.ps1 | iex
#
# OPTIONS (set as environment variables BEFORE running):
#   $env:CAS_SKIP_WEBVIEW2 = "1"  # skip WebView2 (preinstalled on Win10 22H2+ / Win11)
#
# NOTE: This script intentionally has NO param() / [CmdletBinding()] block because
# those are illegal inside Invoke-Expression input. Configure via env vars instead.

# ----- PowerShell 5.1+ compatibility ------------------------------------------------
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
# NOTE: keep progress visible for big downloads (winget bundle ~200 MB, GStreamer ~150 MB).
$ProgressPreference = "Continue"

# Read options from environment
$SkipWebView2 = ($env:CAS_SKIP_WEBVIEW2 -eq "1")

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

  # Fresh winget bootstrap may not have synced its source index yet.
  # 'winget source update' subcommand has NO --accept-source-agreements flag.
  # The index downloads lazily on first 'search'/'install' that DOES accept the
  # agreements. So we trigger sync via 'search', which IS allowed to auto-accept.
  Write-Host "    Syncing winget source index (may take 30-60s)..." -ForegroundColor Gray
  $searchArgs = @(
    "search",
    "--id", "gstreamerproject.gstreamer",
    "--exact",
    "--source", "winget",
    "--accept-source-agreements",
    "--disable-interactivity"
  )
  $srch = Start-Process -FilePath $wingetExe -ArgumentList $searchArgs -Wait -PassThru -NoNewWindow
  if ($srch.ExitCode -ne 0) {
    Write-Host "[!] Initial search exit $($srch.ExitCode). Trying source reset + retry..." -ForegroundColor Yellow
    Start-Process -FilePath $wingetExe -ArgumentList @("source","reset","--force") -Wait -PassThru -NoNewWindow | Out-Null
    # Force re-add the official source if reset didn't do it
    Start-Process -FilePath $wingetExe -ArgumentList @("source","add","-n","winget","-a","https://cdn.winget.microsoft.com/cache","-t","Microsoft.PreIndexed.Package") -Wait -PassThru -NoNewWindow | Out-Null
    $srch2 = Start-Process -FilePath $wingetExe -ArgumentList $searchArgs -Wait -PassThru -NoNewWindow
    if ($srch2.ExitCode -ne 0) {
      Write-Host "[X] Could not sync winget source index (exit $($srch2.ExitCode))." -ForegroundColor Red
      Write-Host "    Manual GStreamer install required:" -ForegroundColor Yellow
      Write-Host "    1. Open https://gstreamer.freedesktop.org/download/ in browser" -ForegroundColor Cyan
      Write-Host "    2. Download GStreamer 1.26 runtime (MSVC 64-bit)" -ForegroundColor White
      Write-Host "    3. Run installer, choose 'Complete' (NOT 'Typical')" -ForegroundColor White
      Write-Host "    4. Reboot, then run the ChurchAudioStream installer" -ForegroundColor White
      exit 1
    }
  }

  Write-Host "    Source synced. Installing GStreamer (Complete profile)..." -ForegroundColor Gray
  Write-Host "    Downloads ~150 MB; takes 2-5 minutes." -ForegroundColor DarkGray

  $wingetArgs = @(
    "install",
    "--id", "gstreamerproject.gstreamer",
    "--exact",
    "--silent",
    "--source", "winget",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
    "--override", "/quiet ADDLOCAL=ALL"
  )
  $proc = Start-Process -FilePath $wingetExe -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow
  # winget exit codes:
  #   0           = ok
  #  -1978335189  = APPINSTALLER_CLI_ERROR_PACKAGE_ALREADY_INSTALLED
  #  -1978335212  = APPINSTALLER_CLI_ERROR_NO_APPLICATIONS_FOUND
  if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq -1978335189) {
    Write-Host "    GStreamer installed." -ForegroundColor Green
  } elseif ($proc.ExitCode -eq -1978335212) {
    Write-Host "[X] winget could not find package gstreamerproject.gstreamer." -ForegroundColor Red
    Write-Host "    Manual GStreamer install required:" -ForegroundColor Yellow
    Write-Host "    1. Open https://gstreamer.freedesktop.org/download/ in browser" -ForegroundColor Cyan
    Write-Host "    2. Download GStreamer 1.26 runtime (MSVC 64-bit)" -ForegroundColor White
    Write-Host "    3. Run installer, choose 'Complete' (NOT 'Typical')" -ForegroundColor White
    exit 1
  } else {
    Write-Host "[!] winget exit code $($proc.ExitCode). Continuing - may have installed regardless." -ForegroundColor Yellow
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

# ----- Step 3: Ensure GStreamer bin is on the MACHINE PATH --------------------------
# GStreamer's MSI doesn't always append C:\gstreamer\1.0\msvc_x86_64\bin to PATH on
# Win10. Without this, Tauri-spawned sidecar can't find gst-launch / gst-device-monitor
# and audio source enumeration returns empty. We force-add to MACHINE PATH (persists,
# inherited by all future processes after reboot).
Write-Host ""
Write-Host "[3/4] Ensuring GStreamer bin is on the machine PATH" -ForegroundColor Cyan

$gstBin = $null
$gstCandidates = @(
  "C:\gstreamer\1.0\msvc_x86_64\bin",
  "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin",
  "${env:ProgramFiles}\gstreamer\1.0\msvc_x86_64\bin"
) | Select-Object -Unique
foreach ($c in $gstCandidates) {
  if (Test-Path (Join-Path $c "gst-launch-1.0.exe")) { $gstBin = $c; break }
}

if (-not $gstBin) {
  Write-Host "[X] GStreamer bin directory not found in any expected location." -ForegroundColor Red
  Write-Host "    Re-run the GStreamer installer with 'Complete' profile (NOT Typical)." -ForegroundColor Yellow
  exit 1
}
Write-Host "    Found: $gstBin" -ForegroundColor Green

$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$pathParts = $machinePath -split ';' | Where-Object { $_.Trim().Length -gt 0 }
$alreadyInPath = $pathParts | Where-Object { $_.TrimEnd('\') -ieq $gstBin.TrimEnd('\') }
if ($alreadyInPath) {
  Write-Host "    Already in machine PATH." -ForegroundColor Green
} else {
  $newMachinePath = ($machinePath.TrimEnd(';')) + ";$gstBin"
  [Environment]::SetEnvironmentVariable("Path", $newMachinePath, "Machine")
  Write-Host "    Added to MACHINE PATH (reboot needed for sidecar to inherit)." -ForegroundColor Green
}
Update-SessionPath

# Functional verify in current session
$gstExe = Join-Path $gstBin "gst-launch-1.0.exe"
try {
  $verOut = & $gstExe --version 2>&1 | Select-Object -First 1
  Write-Host "    $verOut" -ForegroundColor Green
} catch {
  Write-Host "[!] gst-launch-1.0.exe present but errored: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ----- Step 4: Firewall rule for phones on LAN --------------------------------------
Write-Host ""
Write-Host "[4/4] Firewall rule for port 7777 (Private network)" -ForegroundColor Cyan

$existingRule = Get-NetFirewallRule -DisplayName "ChurchAudioStream" -ErrorAction SilentlyContinue
if ($existingRule) {
  Write-Host "    Rule 'ChurchAudioStream' already exists." -ForegroundColor Green
} else {
  try {
    New-NetFirewallRule `
      -DisplayName "ChurchAudioStream" `
      -Description "Allow phones on LAN to reach the listener PWA + WebRTC signaling" `
      -Direction Inbound `
      -LocalPort 7777 `
      -Protocol TCP `
      -Action Allow `
      -Profile Private `
      -ErrorAction Stop | Out-Null
    Write-Host "    Created inbound rule: TCP 7777, Private profile." -ForegroundColor Green
  } catch {
    Write-Host "[!] Could not create firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    Manual: New-NetFirewallRule -DisplayName 'ChurchAudioStream' -Direction Inbound -LocalPort 7777 -Protocol TCP -Action Allow -Profile Private" -ForegroundColor Yellow
  }
}

# ----- Done -------------------------------------------------------------------------
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127|169\.254|255)' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress)

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  Prerequisites installed." -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. REBOOT this PC (so all processes see the new PATH)." -ForegroundColor White
Write-Host "  2. Download ChurchAudioStream installer:" -ForegroundColor White
Write-Host "     https://github.com/roulendz/ChurchAudioStream/releases/latest" -ForegroundColor Cyan
Write-Host "  3. Run the .msi or -setup.exe installer." -ForegroundColor White
Write-Host "  4. Launch ChurchAudioStream from Start Menu." -ForegroundColor White
if ($lanIps.Count -gt 0) {
  Write-Host "  5. Phones on same WiFi: open https://$($lanIps[0]):7777" -ForegroundColor White
  if ($lanIps.Count -gt 1) {
    Write-Host "     (other LAN IPs: $($lanIps[1..($lanIps.Count-1)] -join ', '))" -ForegroundColor Gray
  }
} else {
  Write-Host "  5. Phones on same WiFi: open https://<this-pc-ip>:7777" -ForegroundColor White
}
Write-Host ""
