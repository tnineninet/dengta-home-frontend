param(
  [string]$Device = "192.168.124.2:34227",
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
    Passed = $summary.JankPercent -le $MaxJankPercent -and $summary.P95Ms -le $MaxP95Ms
  }
}

$deviceState = (& $Adb -s $Device get-state 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $deviceState.Trim() -ne "device") {
  throw "Android device $Device is not connected."
}

Invoke-Adb -AdbArguments @("shell", "input", "keyevent", "KEYCODE_WAKEUP") | Out-Null
Invoke-Adb -AdbArguments @("shell", "wm", "dismiss-keyguard") | Out-Null
Invoke-Adb -AdbArguments @("shell", "am", "start", "-W", "-n", "$Package/$Activity") | Out-Null
Start-Sleep -Seconds 5

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
  Measure-Scenario -Name "navigation-motion" -Exercise {
    Invoke-Adb -AdbArguments @("shell", "input", "tap", "110", "2200") | Out-Null
    Invoke-Adb -AdbArguments @("shell", "input", "tap", "520", "390") | Out-Null
    Start-Sleep -Milliseconds 350
    foreach ($x in @("320", "540", "760", "970", "110")) {
      Invoke-Adb -AdbArguments @("shell", "input", "tap", $x, "2200") | Out-Null
      Start-Sleep -Milliseconds 250
    }
  }
)

$results | Format-Table -AutoSize

$failures = @($results | Where-Object { -not $_.Passed })
if ($failures.Count -gt 0) {
  Write-Error "Performance regression: expected jank <= $MaxJankPercent% and P95 <= ${MaxP95Ms}ms."
  exit 1
}

Write-Host "Performance check passed."
