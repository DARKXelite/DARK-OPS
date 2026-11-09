# DARK OPS Reception Printing Setup
# Creates dedicated Chrome/Edge shortcuts and profiles. Does not change the Windows default printer.
$ErrorActionPreference = "Stop"
$AppUrl = "https://clovergreens.vercel.app/?receptionPrint=1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ProfileRoot = Join-Path $env:LOCALAPPDATA "DARKOPS\ReceptionProfiles"
New-Item -ItemType Directory -Force -Path $ProfileRoot | Out-Null
function Find-Browser($Name, $InstallFolder, $Exe) {
  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
  $candidates = @((Join-Path $env:ProgramFiles "$InstallFolder\Application\$Exe"),(Join-Path $programFilesX86 "$InstallFolder\Application\$Exe"),(Join-Path $env:LOCALAPPDATA "$InstallFolder\Application\$Exe")) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -gt 0) { return $candidates[0] }
  return $null
}
$Shell = New-Object -ComObject WScript.Shell
$created = 0
foreach ($browser in @(@{Name="Chrome";InstallFolder="Google\Chrome";Exe="chrome.exe";Profile="Chrome"},@{Name="Edge";InstallFolder="Microsoft\Edge";Exe="msedge.exe";Profile="Edge"})) {
  $exe = Find-Browser $browser.Name $browser.InstallFolder $browser.Exe
  if (-not $exe) { Write-Host "$($browser.Name) not found. Skipping."; continue }
  $profile = Join-Path $ProfileRoot $browser.Profile
  New-Item -ItemType Directory -Force -Path $profile | Out-Null
  $shortcutPath = Join-Path $Desktop ("DARK OPS Reception - " + $browser.Name + ".lnk")
  $shortcut = $Shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $exe
  $shortcut.Arguments = '--user-data-dir="' + $profile + '" --kiosk-printing "' + $AppUrl + '"'
  $shortcut.WorkingDirectory = Split-Path $exe
  $shortcut.Description = "DARK OPS reception passes with isolated $($browser.Name) profile and kiosk printing"
  $shortcut.Save()
  Write-Host "Created: $shortcutPath"
  $created++
}
if ($created -eq 0) { Write-Warning "No supported browser was found. Install Chrome or Edge and run this script again." }
else { Write-Host "Created $created reception shortcut(s). Normal browser profiles and Windows default printer were not changed."; Write-Host "Test the saved print destination before live use." }
Read-Host "Press Enter to close"
