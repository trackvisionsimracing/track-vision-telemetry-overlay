# Launch Track Vision Overlay
# Run this script to start the overlay, or double-click the installed shortcut.
$env:ELECTRON_RUN_AS_NODE = $null
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$here\node_modules\electron\dist\electron.exe" "$here"
