# Creates a "Track Vision Overlay" shortcut on your Desktop.
# Run this script once — then double-click the shortcut any time to launch the overlay.

$AppDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExePath  = "$AppDir\node_modules\electron\dist\electron.exe"
$IconPath = "$AppDir\assets\tv-icon3.ico"
$Desktop  = [Environment]::GetFolderPath("Desktop")
$LinkPath = "$Desktop\Track Vision Overlay.lnk"

if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: Could not find electron.exe at: $ExePath"
    Write-Host "Make sure you have run 'npm install' in the overlay folder."
    Read-Host "Press Enter to close"
    exit 1
}

$Shell    = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($LinkPath)
$Shortcut.TargetPath       = $ExePath
$Shortcut.Arguments        = "`"$AppDir`""
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.IconLocation     = $IconPath
$Shortcut.Description      = "Track Vision Sim Racing Overlay"
$Shortcut.Save()

Write-Host "Shortcut created: $LinkPath"
Write-Host "You can now double-click 'Track Vision Overlay' on your Desktop to launch."
Start-Sleep -Seconds 2
