@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
start "" "node_modules\electron\dist\electron.exe" "."
