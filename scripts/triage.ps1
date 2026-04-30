# ChurchAudioStream - on-target triage script
#
# Run on the Windows 10/11 PC where you installed ChurchAudioStream.
# Paste the FULL output back to the developer.
#
# Run from elevated PowerShell:
#   Set-ExecutionPolicy -Scope Process Bypass -Force; iwr -useb https://raw.githubusercontent.com/roulendz/ChurchAudioStream/master/scripts/triage.ps1 | iex
#
# Or download and run locally:
#   .\triage.ps1 *> triage-output.txt

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function Section { param([string]$Title) Write-Host ""; Write-Host ("=" * 70) -ForegroundColor Cyan; Write-Host " $Title" -ForegroundColor Cyan; Write-Host ("=" * 70) -ForegroundColor Cyan }
function SubSection { param([string]$Title) Write-Host ""; Write-Host ">> $Title" -ForegroundColor Yellow }

Section "ChurchAudioStream Triage Report"
Write-Host "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
Write-Host "Host: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"
Write-Host "OS:   $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).Version)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"

# 1. Process check
Section "1. Running processes (Tauri + sidecar + workers)"
$procNames = @(
  "churchaudiostream",
  "server",
  "server-x86_64-pc-windows-msvc",
  "server-x86_64-pc-windows-gnu",
  "mediasoup-worker",
  "gst-launch-1.0",
  "gst-device-monitor-1.0",
  "msedgewebview2"
)
$procs = Get-Process -Name $procNames -ErrorAction SilentlyContinue
if ($procs) {
  $procs | Select-Object Name, Id, StartTime, @{N='WS_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize
} else {
  Write-Host "[!] No matching processes found. App is NOT running." -ForegroundColor Red
}

# 2. Listening ports
Section "2. Listening ports (1420 dev, 7777 PWA, 7778 admin loopback)"
$ports = Get-NetTCPConnection -LocalPort 1420,7777,7778 -State Listen -ErrorAction SilentlyContinue
if ($ports) {
  $ports | Select-Object LocalAddress, LocalPort, OwningProcess,
    @{N='Process';E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name}} |
    Format-Table -AutoSize
} else {
  Write-Host "[!] No ports listening on 1420/7777/7778." -ForegroundColor Red
}

# 3. Install layout
Section "3. Install directory layout"
$installDirs = @(
  "C:\Program Files\ChurchAudioStream",
  "$env:LOCALAPPDATA\Programs\ChurchAudioStream"
)
foreach ($d in $installDirs) {
  if (Test-Path $d) {
    Write-Host "Found install at: $d"
    Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '\.(exe|dll)$|index\.html|manifest\.webmanifest' } |
      Select-Object @{N='Path';E={$_.FullName.Replace($d,'.')}}, @{N='SizeKB';E={[math]::Round($_.Length/1KB,1)}}, LastWriteTime |
      Format-Table -AutoSize
  }
}

# 4. App data + logs
Section "4. App data + logs"
$dataDirs = @(
  "$env:APPDATA\com.churchaudiostream.app",
  "$env:LOCALAPPDATA\com.churchaudiostream.app"
)
foreach ($d in $dataDirs) {
  if (Test-Path $d) {
    SubSection "Contents of $d"
    Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue |
      Select-Object @{N='Path';E={$_.FullName.Replace($d,'.')}}, Length, LastWriteTime |
      Format-Table -AutoSize
    SubSection "Last 50 lines of newest log file in $d"
    $newestLog = Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '\.(log|txt)$' } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newestLog) {
      Write-Host "Reading: $($newestLog.FullName)" -ForegroundColor Gray
      Get-Content $newestLog.FullName -Tail 50 -ErrorAction SilentlyContinue
    } else {
      Write-Host "(no log files)" -ForegroundColor Yellow
    }
  }
}

# 5. Local PWA reachability (host -> sidecar)
Section "5. Can the host reach the sidecar HTTPS itself?"
$localUrls = @("https://127.0.0.1:7777", "https://localhost:7777")
foreach ($url in $localUrls) {
  SubSection "GET $url"
  try {
    # Skip cert validation (self-signed CA)
    if ($PSVersionTable.PSVersion.Major -ge 7) {
      $r = Invoke-WebRequest -Uri $url -SkipCertificateCheck -UseBasicParsing -TimeoutSec 5
    } else {
      # PS 5.1: bypass cert validation via callback
      [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    }
    Write-Host "  StatusCode: $($r.StatusCode)" -ForegroundColor Green
    Write-Host "  Content-Type: $($r.Headers.'Content-Type')"
    Write-Host "  ContentLength: $($r.RawContentLength)"
  } catch {
    Write-Host "  ERR: $($_.Exception.Message)" -ForegroundColor Red
  }
}

# 6. Host LAN IP (for phone)
Section "6. LAN IP addresses (use one of these from phone)"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127|169\.254|255)' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object IPAddress, InterfaceAlias, PrefixOrigin, AddressState |
  Format-Table -AutoSize

# 7. Firewall rules for ChurchAudioStream / port 7777
Section "7. Firewall rules"
SubSection "Rules mentioning ChurchAudioStream / server.exe / port 7777"
$fwRules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
  $_.DisplayName -match "ChurchAudio|server\.exe|7777"
}
if ($fwRules) {
  $fwRules | Select-Object DisplayName, Direction, Action, Profile, Enabled | Format-Table -AutoSize
} else {
  Write-Host "[!] No firewall rules found mentioning the app or port 7777." -ForegroundColor Yellow
  Write-Host "    Phones on LAN will be blocked. Run as admin to allow:" -ForegroundColor Yellow
  Write-Host "    New-NetFirewallRule -DisplayName 'ChurchAudioStream' -Direction Inbound -LocalPort 7777 -Protocol TCP -Action Allow -Profile Private" -ForegroundColor White
}

# 8. GStreamer
Section "8. GStreamer install + plugins"
SubSection "gst-launch-1.0 --version (must work)"
$gstLaunch = Get-Command gst-launch-1.0.exe -ErrorAction SilentlyContinue
if ($gstLaunch) {
  Write-Host "Found at: $($gstLaunch.Source)" -ForegroundColor Green
  & $gstLaunch.Source --version 2>&1 | Select-Object -First 4
} else {
  Write-Host "[X] gst-launch-1.0.exe NOT on PATH." -ForegroundColor Red
  Write-Host "    Likely: GStreamer not installed, or PATH not refreshed (reboot)." -ForegroundColor Yellow
}

SubSection "gst-device-monitor-1.0 (audio sources - what sidecar sees)"
$gstMon = Get-Command gst-device-monitor-1.0.exe -ErrorAction SilentlyContinue
if ($gstMon) {
  & $gstMon.Source Audio/Source 2>&1 | Select-Object -First 60
} else {
  Write-Host "[X] gst-device-monitor-1.0.exe NOT on PATH." -ForegroundColor Red
}

SubSection "Critical plugins"
$plugins = @("level", "audioconvert", "opusenc", "rtpopuspay", "wasapi2src", "wasapisrc", "directsoundsrc")
$gstInspect = Get-Command gst-inspect-1.0.exe -ErrorAction SilentlyContinue
if ($gstInspect) {
  foreach ($p in $plugins) {
    $out = & $gstInspect.Source $p 2>&1 | Select-Object -First 1
    if ($out -match "No such element|not found") {
      Write-Host "  $p : MISSING" -ForegroundColor Red
    } else {
      Write-Host "  $p : OK" -ForegroundColor Green
    }
  }
} else {
  Write-Host "[X] gst-inspect-1.0.exe not on PATH." -ForegroundColor Red
}

# 9. Audio devices visible to Windows
Section "9. Audio input devices visible to Windows"
SubSection "Win32_SoundDevice"
Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue |
  Select-Object Name, Status, StatusInfo, Manufacturer | Format-Table -AutoSize

SubSection "Recording devices via PnP (matches Sound Settings -> Input)"
Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match "Microphone|Line|Input|Capture" -or $_.Status -eq "OK" } |
  Select-Object FriendlyName, Status, Class | Format-Table -AutoSize

# 10. Environment PATH (for sidecar process inheritance check)
Section "10. PATH environment"
SubSection "Machine PATH (entries containing 'gstreamer')"
([Environment]::GetEnvironmentVariable("Path","Machine") -split ';') | Where-Object { $_ -match "gstreamer" }
SubSection "User PATH (entries containing 'gstreamer')"
([Environment]::GetEnvironmentVariable("Path","User") -split ';') | Where-Object { $_ -match "gstreamer" }
SubSection "Current session PATH count"
Write-Host "Total PATH entries this session: $((($env:Path -split ';') | Measure-Object).Count)"

# 11. WebView2
Section "11. WebView2 Runtime"
$wv2Keys = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$wv2Found = $false
foreach ($k in $wv2Keys) {
  if (Test-Path $k) {
    $v = (Get-ItemProperty -Path $k -Name "pv" -ErrorAction SilentlyContinue).pv
    if ($v) { Write-Host "  WebView2 version: $v" -ForegroundColor Green; $wv2Found = $true; break }
  }
}
if (-not $wv2Found) { Write-Host "[!] WebView2 Runtime not detected." -ForegroundColor Yellow }

Section "Triage complete"
Write-Host "Copy ALL output above and paste back to the developer." -ForegroundColor Cyan
Write-Host "Or save with:" -ForegroundColor Gray
Write-Host "  .\triage.ps1 *> triage-output.txt" -ForegroundColor White
