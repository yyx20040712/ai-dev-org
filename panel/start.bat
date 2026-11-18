@echo off
rem DevTroupe panel launcher for Windows (native counterpart of panel/start.sh):
rem starts the panel minimized if not running, waits until ready, then opens
rem the default browser; reuses an already-running service.
rem CLI resolution order:
rem   1. the copy shipped next to this script: <repo>\bin\troupe.mjs
rem   2. the highest installed version under
rem      %USERPROFILE%\.zcode\cli\plugins\cache\<marketplace>\dev-troupe\
rem      (works whether the marketplace was named dev-troupe or dev-troupe-marketplace)
rem Optional arg 1: port (default 8787).
rem Set DT_PANEL_NOBROWSER=1 to start the server without opening a browser.
setlocal
set "PORT=8787"
if not "%~1"=="" set "PORT=%~1"
set "BASE=http://127.0.0.1:%PORT%"
set "LOG=%TEMP%\dev-troupe-panel.log"

where node >nul 2>nul || (
  echo Node.js not found in PATH.
  pause
  exit /b 1
)
where curl >nul 2>nul || (
  echo curl not found - it is bundled with Windows 10+.
  pause
  exit /b 1
)

rem Prefer the repo-local CLI so the launcher works straight from an extracted copy
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "CLI=%ROOT%\bin\troupe.mjs"
if not exist "%CLI%" (
  set "CLI="
  for /f "delims=" %%m in ('dir /b /ad "%USERPROFILE%\.zcode\cli\plugins\cache" 2^>nul') do (
    for /f "delims=" %%v in ('dir /b /ad /on "%USERPROFILE%\.zcode\cli\plugins\cache\%%m\dev-troupe" 2^>nul') do (
      if exist "%USERPROFILE%\.zcode\cli\plugins\cache\%%m\dev-troupe\%%v\bin\troupe.mjs" set "CLI=%USERPROFILE%\.zcode\cli\plugins\cache\%%m\dev-troupe\%%v\bin\troupe.mjs"
    )
  )
)
if not exist "%CLI%" (
  echo DevTroupe CLI not found - neither next to this script nor installed under:
  echo %%USERPROFILE%%\.zcode\cli\plugins\cache
  pause
  exit /b 1
)

call :ready
if not errorlevel 1 goto open

start "DevTroupe Panel" /min cmd /c "node "%CLI%" panel --port %PORT% > "%LOG%" 2>&1"
set /a TRIES=0
:wait
set /a TRIES+=1
if %TRIES% GEQ 15 goto fail
%SystemRoot%\System32\ping.exe -n 2 127.0.0.1 >nul
call :ready
if errorlevel 1 goto wait

:open
if /i "%DT_PANEL_NOBROWSER%"=="1" exit /b 0
start "" "%BASE%/"
exit /b 0

:fail
echo DevTroupe panel failed to start. See log: %LOG%
pause
exit /b 1

:ready
curl -fsS -m 1 "%BASE%/" 2>nul | findstr /C:"data-zcode-design" >nul
exit /b %errorlevel%
