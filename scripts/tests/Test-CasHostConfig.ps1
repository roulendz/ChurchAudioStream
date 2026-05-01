# Test-CasHostConfig.ps1 - assertion-based tests for cas-host-config.ps1 pure functions.
# Run from elevated OR non-elevated PS - tests no side-effect-free helpers only.
#
# Usage:
#   .\scripts\tests\Test-CasHostConfig.ps1
# Exit code 0 = all pass, 1 = any fail.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$libPath = Join-Path $PSScriptRoot "..\lib\cas-host-config.ps1"
. $libPath

$script:Pass = 0
$script:Fail = 0
$script:Failures = @()

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)][string]$TestName,
    [Parameter(Mandatory = $true)][AllowNull()][AllowEmptyString()]$Expected,
    [Parameter(Mandatory = $true)][AllowNull()][AllowEmptyString()]$Actual
  )
  if ($Expected -ceq $Actual) {
    $script:Pass++
    Write-Host "  [PASS] $TestName" -ForegroundColor Green
  } else {
    $script:Fail++
    $script:Failures += $TestName
    Write-Host "  [FAIL] $TestName" -ForegroundColor Red
    Write-Host "         Expected: $Expected" -ForegroundColor Red
    Write-Host "         Actual:   $Actual" -ForegroundColor Red
  }
}

function Assert-True {
  param([string]$TestName, [bool]$Condition)
  Assert-Equal -TestName $TestName -Expected $true -Actual $Condition
}

function Assert-False {
  param([string]$TestName, [bool]$Condition)
  Assert-Equal -TestName $TestName -Expected $false -Actual $Condition
}

Write-Host ""
Write-Host "=== Test-CasHostConfig ===" -ForegroundColor Cyan

# --- Split-PathString ---
Write-Host ""
Write-Host "Split-PathString" -ForegroundColor Yellow
Assert-Equal "empty string -> empty array" 0 (@(Split-PathString "")).Count
Assert-Equal "single entry" 1 (@(Split-PathString "C:\foo")).Count
Assert-Equal "two entries" 2 (@(Split-PathString "C:\foo;C:\bar")).Count
Assert-Equal "trailing semicolon ignored" 2 (@(Split-PathString "C:\foo;C:\bar;")).Count
Assert-Equal "whitespace-only entry filtered" 2 (@(Split-PathString "C:\foo; ;C:\bar")).Count

# --- Test-PathEntryEquals ---
Write-Host ""
Write-Host "Test-PathEntryEquals" -ForegroundColor Yellow
Assert-True  "exact match" (Test-PathEntryEquals "C:\foo" "C:\foo")
Assert-True  "case-insensitive" (Test-PathEntryEquals "C:\FOO" "c:\foo")
Assert-True  "trailing slash tolerated (left)" (Test-PathEntryEquals "C:\foo\" "C:\foo")
Assert-True  "trailing slash tolerated (right)" (Test-PathEntryEquals "C:\foo" "C:\foo\")
Assert-True  "leading/trailing whitespace tolerated" (Test-PathEntryEquals " C:\foo " "C:\foo")
Assert-False "different paths" (Test-PathEntryEquals "C:\foo" "C:\bar")

# --- Test-PathStringContains ---
Write-Host ""
Write-Host "Test-PathStringContains" -ForegroundColor Yellow
Assert-True  "contains middle entry" (Test-PathStringContains "C:\a;C:\b;C:\c" "C:\b")
Assert-True  "contains first entry" (Test-PathStringContains "C:\a;C:\b" "C:\a")
Assert-True  "contains last entry" (Test-PathStringContains "C:\a;C:\b" "C:\b")
Assert-True  "case-insensitive search" (Test-PathStringContains "C:\GStreamer\bin;C:\b" "c:\gstreamer\bin")
Assert-False "absent" (Test-PathStringContains "C:\a;C:\b" "C:\c")
Assert-False "empty PATH" (Test-PathStringContains "" "C:\a")

# --- Update-PathString ---
Write-Host ""
Write-Host "Update-PathString" -ForegroundColor Yellow
Assert-Equal "append to non-empty" "C:\a;C:\b" (Update-PathString "C:\a" "C:\b")
Assert-Equal "no-op when present" "C:\a;C:\b" (Update-PathString "C:\a;C:\b" "C:\b")
Assert-Equal "no-op when present case-insensitive" "C:\a;C:\B" (Update-PathString "C:\a;C:\B" "C:\b")
Assert-Equal "trailing semicolon trimmed before append" "C:\a;C:\b" (Update-PathString "C:\a;" "C:\b")
Assert-Equal "empty PATH -> just entry" "C:\a" (Update-PathString "" "C:\a")
Assert-Equal "whitespace-only PATH -> just entry" "C:\a" (Update-PathString "   " "C:\a")

# --- Remove-FromPathString ---
Write-Host ""
Write-Host "Remove-FromPathString" -ForegroundColor Yellow
Assert-Equal "remove middle" "C:\a;C:\c" (Remove-FromPathString "C:\a;C:\b;C:\c" "C:\b")
Assert-Equal "remove first" "C:\b;C:\c" (Remove-FromPathString "C:\a;C:\b;C:\c" "C:\a")
Assert-Equal "remove last" "C:\a;C:\b" (Remove-FromPathString "C:\a;C:\b;C:\c" "C:\c")
Assert-Equal "no-op when absent" "C:\a;C:\b" (Remove-FromPathString "C:\a;C:\b" "C:\z")
Assert-Equal "case-insensitive remove" "C:\a" (Remove-FromPathString "C:\a;C:\B" "c:\b")
Assert-Equal "trailing slash tolerated" "C:\a" (Remove-FromPathString "C:\a;C:\b\" "C:\b")
Assert-Equal "remove sole entry -> empty" "" (Remove-FromPathString "C:\a" "C:\a")

# --- idempotence: round-trip add+remove ---
Write-Host ""
Write-Host "Round-trip add+remove" -ForegroundColor Yellow
$start = "C:\Windows;C:\Windows\System32"
$entry = "C:\gstreamer\1.0\msvc_x86_64\bin"
$added = Update-PathString $start $entry
$readded = Update-PathString $added $entry
Assert-Equal "add is idempotent" $added $readded
$removed = Remove-FromPathString $added $entry
Assert-Equal "round-trip restores original" $start $removed
$reremoved = Remove-FromPathString $removed $entry
Assert-Equal "remove is idempotent" $removed $reremoved

# --- summary ---
Write-Host ""
$total = $script:Pass + $script:Fail
Write-Host "==========================================" -ForegroundColor Cyan
if ($script:Fail -eq 0) {
  Write-Host "  ALL $total TESTS PASSED" -ForegroundColor Green
  exit 0
} else {
  Write-Host "  $($script:Pass)/$total passed, $($script:Fail) failed" -ForegroundColor Red
  Write-Host "  Failures:" -ForegroundColor Red
  $script:Failures | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
  exit 1
}
