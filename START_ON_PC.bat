@echo off
setlocal
title Schema Studio Pro
set "studioFile=%~dp0STUDIO.html"
if not exist "%studioFile%" goto missing
if /i "%~1"=="--check" goto checked
start "" "%studioFile%"
if errorlevel 1 goto failed
exit /b 0
:checked
echo OK: "%studioFile%"
exit /b 0
:missing
echo Cannot find STUDIO.html beside START_ON_PC.bat.
echo Restore STUDIO.html and try again.
pause
exit /b 1
:failed
echo Windows could not open the studio in your default browser.
echo Open STUDIO.html manually using your browser.
pause
exit /b 1
