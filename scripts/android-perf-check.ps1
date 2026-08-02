param(
  [string]$Device = "",
  [string]$Adb = "E:\chatgpt\DengTa-production-tools\android-sdk\platform-tools\adb.exe",
  [string]$Package = "home.dengta.app",
  [string]$Activity = ".MainActivity",
  [double]$MaxJankPercent = 20,
  [int]$MaxP95Ms = 32
)

$ErrorActionPreference = "Stop"

function Invoke-Adb {
  param([string[]]$AdbArguments)

  $output = & $Adb -s $Device @AdbArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "adb failed: $($AdbArguments -join ' ')`n$output"
  }
  return $output
}

function Read-GfxSummary {
  $report = (Invoke-Adb -AdbArguments @("shell", "dumpsys", "gfxinfo", $Package)) -join "`n"
  $framesMatch = [regex]::Match($report, "Total frames rendered:\s+(\d+)")
  $jankMatch = [regex]::Match($report, "Janky frames:\s+(\d+)\s+\(([0-9.]+)%\)")
  $p95Match = [regex]::Match($report, "95th percentile:\s+(\d+)ms")

  if (-not ($framesMatch.Success -and $jankMatch.Success -and $p95Match.Success)) {
    throw "Could not parse gfxinfo summary.`n$report"
  }

  [pscustomobject]@{
    Frames = [int]$framesMatch.Groups[1].Value
    JankyFrames = [int]$jankMatch.Groups[1].Value
    JankPercent = [double]$jankMatch.Groups[2].Value
    P95Ms = [int]$p95Match.Groups[1].Value
  }
}

function Measure-Scenario {
  param(
    [string]$Name,
    [scriptblock]$Exercise
  )

  Invoke-Adb -AdbArguments @("shell", "dumpsys", "gfxinfo", $Package, "reset") | Out-Null
  & $Exercise
  $summary = Read-GfxSummary

  [pscustomobject]@{
    Scenario = $Name
    Frames = $summary.Frames
    JankyFrames = $summary.JankyFrames
    JankPercent = $summary.JankPercent
    P95Ms = $summary.P95Ms
    Passed = (
      $summary.Frames -lt 30 -or
      $summary.JankPercent -le $MaxJankPercent
    ) -and $summary.P95Ms -le $MaxP95Ms
  }
}

if (-not $Device) {
  $connectedDevices = @(
    & $Adb devices |
      Select-String '^([^\s]+)\s+device$' |
      ForEach-Object { $_.Matches[0].Groups[1].Value }
  )
  if ($connectedDevices.Count -ne 1) {
    throw "Expected exactly one connected Android device; pass -Device when more than one is available."
  }
  $Device = $connectedDevices[0]
}

$deviceState = (& $Adb -s $Device get-state 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $deviceState.Trim() -ne "device") {
  throw "Android device $Device is not connected."
}

Invoke-Adb -AdbArguments @("shell", "input", "keyevent", "KEYCODE_WAKEUP") | Out-Null
Invoke-Adb -AdbArguments @("shell", "wm", "dismiss-keyguard") | Out-Null
Invoke-Adb -AdbArguments @("shell", "am", "start", "-W", "-n", "$Package/$Activity") | Out-Null
Start-Sleep -Seconds 5

$sizeReport = (Invoke-Adb -AdbArguments @("shell", "wm", "size")) -join "`n"
$sizeMatch = [regex]::Match($sizeReport, "(?:Override|Physical) size:\s*(\d+)x(\d+)")
if (-not $sizeMatch.Success) {
  throw "Could not read the Android display size.`n$sizeReport"
}
$screenWidth = [int]$sizeMatch.Groups[1].Value
$screenHeight = [int]$sizeMatch.Groups[2].Value
$menuX = [math]::Round($screenWidth * 0.08)
$menuY = [math]::Round($screenHeight * 0.065)
$sidebarX = [math]::Round($screenWidth * 0.15)
$firstNavY = [math]::Round($screenHeight * 0.206)
$navStepY = [math]::Round($screenHeight * 0.051)

function Invoke-SidebarNavigationLoop {
  foreach ($navIndex in @(1, 2, 3, 4, 0)) {
    Invoke-Adb -AdbArguments @("shell", "input", "tap", $menuX, $menuY) | Out-Null
    Start-Sleep -Milliseconds 180
    $targetY = $firstNavY + ($navStepY * $navIndex)
    Invoke-Adb -AdbArguments @("shell", "input", "tap", $sidebarX, $targetY) | Out-Null
    Start-Sleep -Milliseconds 250
  }
}

# Load deferred feature chunks before measuring steady-state navigation frames.
Invoke-SidebarNavigationLoop
Start-Sleep -Seconds 1

$results = @(
  Measure-Scenario -Name "idle-animation" -Exercise {
    Start-Sleep -Seconds 3
  }
  Measure-Scenario -Name "chat-scroll" -Exercise {
    1..3 | ForEach-Object {
      Invoke-Adb -AdbArguments @("shell", "input", "swipe", "540", "1750", "540", "750", "250") | Out-Null
      Invoke-Adb -AdbArguments @("shell", "input", "swipe", "540", "750", "540", "1750", "250") | Out-Null
    }
  }
  Measure-Scenario -Name "sidebar-navigation-motion" -Exercise {
    Invoke-Adb -AdbArguments @("shell", "input", "tap", "520", "390") | Out-Null
    Start-Sleep -Milliseconds 350
    Invoke-SidebarNavigationLoop
  }
)

$results | Format-Table -AutoSize

$failures = @($results | Where-Object { -not $_.Passed })
if ($failures.Count -gt 0) {
  Write-Error "Performance regression: expected P95 <= ${MaxP95Ms}ms and, for samples of at least 30 frames, jank <= $MaxJankPercent%."
  exit 1
}

Write-Host "Performance check passed."
