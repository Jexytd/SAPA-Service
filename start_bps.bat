@echo off
:: ======================================================================
:: SAPA BPS KAB. BANGKA - SERVICE & NGROK BACKGROUND LAUNCHER (HIDDEN)
:: ======================================================================

:: Jika dipanggil langsung tanpa parameter "hidden", jalankan ulang di background tanpa window
if "%~1" neq "hidden" (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c `\"%~f0`\" hidden' -WindowStyle Hidden"
    exit /b
)

:: Pindah ke direktori script
cd /d "%~dp0"

:: Buat direktori logs jika belum ada
if not exist "logs\" mkdir "logs"

:: Catat timestamp start
echo [%date% %time%] Memulai auto-start background SAPA Service... >> "logs\launcher.log"

:: 1. Validasi Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [%date% %time%] [ERROR] Node.js tidak ditemukan di sistem PATH! >> "logs\launcher.log"
    exit /b 1
)

:: 2. Cek dependensi node_modules
if not exist "node_modules\" (
    echo [%date% %time%] [INFO] Folder node_modules belum ada. Menjalankan npm install... >> "logs\launcher.log"
    call npm install >> "logs\launcher.log" 2>&1
    if %errorlevel% neq 0 (
        echo [%date% %time%] [ERROR] npm install gagal! >> "logs\launcher.log"
        exit /b 1
    )
)

:: 3. Baca konfigurasi dari .env
set "PORT=8000"
set "NGROK_DOMAIN="
set "NGROK_AUTHTOKEN="

if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
        set "KEY=%%A"
        set "VAL=%%B"
        set "KEY=!KEY:﻿=!"
        set "KEY=!KEY: =!"
        if /i "!KEY!"=="PORT" set "PORT=!VAL!"
        if /i "!KEY!"=="NGROK_DOMAIN" set "NGROK_DOMAIN=!VAL!"
        if /i "!KEY!"=="NGROK_AUTHTOKEN" set "NGROK_AUTHTOKEN=!VAL!"
        if /i "!KEY!"=="BACKEND_PUBLIC_URL" (
            if "!NGROK_DOMAIN!"=="" (
                set "TEMP_URL=!VAL:https://=!"
                set "TEMP_URL=!TEMP_URL:http://=!"
                set "TEMP_URL=!TEMP_URL:/=!"
                set "NGROK_DOMAIN=!TEMP_URL!"
            )
        )
    )
)

:: Bersihkan spasi
set "PORT=%PORT: =%"
if not "%NGROK_DOMAIN%"=="" set "NGROK_DOMAIN=%NGROK_DOMAIN: =%"

:: Fallback domain
if "%NGROK_DOMAIN%"=="" (
    set "NGROK_DOMAIN=footless-aptitude-caloric.ngrok-free.dev"
)

:: 4. Validasi binary ngrok.exe
set "NGROK_EXE=ngrok.exe"
if exist "%~dp0ngrok.exe" (
    set "NGROK_EXE=%~dp0ngrok.exe"
)

:: Pasang authtoken jika ada di .env
if not "%NGROK_AUTHTOKEN%"=="" (
    set "NGROK_AUTHTOKEN=%NGROK_AUTHTOKEN: =%"
    "%NGROK_EXE%" config add-authtoken %NGROK_AUTHTOKEN% >nul 2>nul
)

echo [%date% %time%] Target Port: %PORT%, Domain: %NGROK_DOMAIN% >> "logs\launcher.log"

:: 5. Jalankan SAPA Service Backend di background (Hidden)
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm start > logs\service.log 2>&1' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

:: Tunggu 3 detik agar server backend mulai listening
timeout /t 3 /nobreak >nul

:: 6. Jalankan Ngrok Tunnel di background (Hidden)
if not "%NGROK_DOMAIN%"=="" (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NGROK_EXE%' -ArgumentList 'http --domain=%NGROK_DOMAIN% %PORT% --log=logs\ngrok.log' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
) else (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NGROK_EXE%' -ArgumentList 'http %PORT% --log=logs\ngrok.log' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
)

echo [%date% %time%] Service dan Ngrok berhasil diluncurkan di background. >> "logs\launcher.log"
exit /b 0
