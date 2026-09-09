@echo off
title Bulk Detailed SEO Auditor
cd /d "%~dp0"
echo ===================================================
echo   Bulk Detailed SEO Auditor & Debugger Engine
echo ===================================================
echo Starting local server on http://localhost:3300 ...
echo Press Ctrl+C to stop the server at any time.
echo.

if not exist node_modules (
    echo [INFO] Installing required dependencies...
    call npm install
)

start "" "http://localhost:3300"
node server.js
pause
