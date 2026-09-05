@echo off
setlocal enabledelayedexpansion
title SAPA BPS - Stop Services

echo ======================================================================
echo             SAPA BPS KAB. BANGKA - STOP SERVICE ^& NGROK
echo ======================================================================
echo.

cd /d "%~dp0"

:: 1. Hentikan proses Ngrok
echo [1/3] Menghentikan proses ngrok.exe...
taskkill /F /IM ngrok.exe >nul 2>nul
if %errorlevel% equ 0 (
    echo       Ngrok berhasil dihentikan.
) else (
    echo       Ngrok tidak sedang berjalan.
)

:: 2. Ambil PORT dari .env
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

:: 3. Hentikan proses Node yang mendengarkan PORT backend
echo [2/3] Memeriksa proses yang berjalan pada port %PORT%...
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo       Menghentikan proses PID %%P pada port %PORT%...
    taskkill /F /PID %%P >nul 2>nul
)

:: 4. Tutup jendela terminal SAPA
echo [3/3] Menutup jendela konsol SAPA...
powershell -NoProfile -Command "Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*SAPA*' } | Stop-Process -Force" >nul 2>nul

echo.
echo ======================================================================
echo [BERHASIL] Seluruh service SAPA dan Ngrok telah dihentikan.
echo ======================================================================
echo.
pause
