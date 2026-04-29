param(
  [int]$GstPid = 14224,
  [int]$RtpPort = 50702,
  [int]$BindPort = 51702
)

function Get-GstState {
  param([int]$Pid_)
  $proc = Get-Process -Id $Pid_ -ErrorAction SilentlyContinue
  return $proc -ne $null
}

function Get-PortBindings {
  param([int]$Rtp, [int]$Bind)
  $endpoints = Get-NetUDPEndpoint -LocalPort $Rtp,$Bind -ErrorAction SilentlyContinue
  return ($endpoints | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess)" }) -join "; "
}

function Get-AllGstLaunch {
  Get-CimInstance Win32_Process -Filter "Name='gst-launch-1.0.exe'" | ForEach-Object {
    "pid=$($_.ProcessId) parent=$($_.ParentProcessId) start=$($_.CreationDate)"
  }
}

$startTs = Get-Date
"# Repro start: $($startTs.ToString('HH:mm:ss.fff'))"
"# Initial state:"
"  gst-launch alive: $(Get-GstState -Pid_ $GstPid)"
"  ports: $(Get-PortBindings -Rtp $RtpPort -Bind $BindPort)"
"  all gst-launch: $(Get-AllGstLaunch)"
""
"# Killing PID $GstPid (taskkill /F)..."
$killTs = Get-Date
taskkill /F /PID $GstPid 2>&1 | Out-String | Write-Host
"# Kill issued at: $($killTs.ToString('HH:mm:ss.fff'))"
""

# Poll every 250ms for 15 seconds
$pollIntervalMs = 250
$totalMs = 15000
$elapsed = 0
$lastBindings = ""
while ($elapsed -lt $totalMs) {
  Start-Sleep -Milliseconds $pollIntervalMs
  $elapsed += $pollIntervalMs
  $now = Get-Date
  $bindings = Get-PortBindings -Rtp $RtpPort -Bind $BindPort
  $allGst = Get-AllGstLaunch
  if ($bindings -ne $lastBindings) {
    "# +${elapsed}ms ($($now.ToString('HH:mm:ss.fff'))): ports=$bindings | gst=$($allGst -join ' / ')"
    $lastBindings = $bindings
  }
}

"# Final state at +${totalMs}ms:"
"  ports: $(Get-PortBindings -Rtp $RtpPort -Bind $BindPort)"
"  all gst-launch: $(Get-AllGstLaunch)"
