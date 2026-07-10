@echo off
cd /d "%~dp0"
echo Starting admin console...
echo.
echo Open this URL in your browser:
echo http://127.0.0.1:8787
echo.
echo In connection settings, use:
echo HTTP address: /api/admin
echo.
where node >nul 2>nul
if %errorlevel%==0 (
  node local-server.js
) else if exist "D:\node\node.exe" (
  "D:\node\node.exe" local-server.js
) else (
  echo Node.js not found. Please install Node.js or update this script.
)
pause
