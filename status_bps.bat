@echo off
setlocal enabledelayedexpansion
title SAPA BPS - Status Monitor

echo ======================================================================
echo              SAPA BPS KAB. BANGKA - STATUS MONITOR
echo ======================================================================
echo.

cd /d "%~dp0"

:: 1. Baca port dari .env
set "PORT=8000"
if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
        set "KEY=%%A"
        set "KEY=!KEY:﻿=!"
        set "KEY=!KEY: =!"
        if /i "!KEY!"=="PORT" (
            set "VAL=%%B"
            set "PORT=!VAL: =!"
        )
    )
)

:: 2. Cek status Backend Node.js
echo [1] STATUS BACKEND SERVICE (PORT %PORT%):
set "BACKEND_RUNNING=0"
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    set "BACKEND_RUNNING=1"
    echo     [AKTIF] Service sedang berjalan [PID: %%P] pada port %PORT%
)
if "!BACKEND_RUNNING!"=="0" (
    echo     [TIDAK AKTIF] Service backend tidak terdeteksi pada port %PORT%.
)
echo.

:: 3. Cek status Ngrok
echo [2] STATUS NGROK TUNNEL:
tasklist /FI "IMAGENAME eq ngrok.exe" 2>nul | findstr /i "ngrok.exe" >nul
if %errorlevel% equ 0 (
    echo     [AKTIF] ngrok.exe sedang berjalan di background.
) else (
    echo     [TIDAK AKTIF] ngrok.exe tidak sedang berjalan.
)
echo.

REM 4. Tampilkan potongan log terakhir jika ada
if exist "logs\service.log" (
    echo ----------------------------------------------------------------------
    echo Log Terakhir Service [logs\service.log]:
    echo ----------------------------------------------------------------------
    powershell -NoProfile -Command "Get-Content logs\service.log -Tail 10 -ErrorAction SilentlyContinue"
    echo.
)

if exist "logs\ngrok.log" (
    echo ----------------------------------------------------------------------
    echo Log Terakhir Ngrok [logs\ngrok.log]:
    echo ----------------------------------------------------------------------
    powershell -NoProfile -Command "Get-Content logs\ngrok.log -Tail 10 -ErrorAction SilentlyContinue"
    echo.
)

echo ======================================================================
echo Tekan tombol apa saja untuk menutup jendela ini.
pause >nul
