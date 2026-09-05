@echo off
setlocal enabledelayedexpansion
title SAPA BPS - Install Auto-Start on Windows Login (Silent / Hidden)

echo ======================================================================
echo    INSTALL AUTO-START PADA WINDOWS LOGIN (STARTUP) - SAPA BPS
echo                 MODE: SILENT / HIDDEN (LATAR BELAKANG)
echo ======================================================================
echo.

cd /d "%~dp0"

set "TARGET_VBS=%~dp0start_bps.vbs"
set "WORK_DIR=%~dp0"
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SAPA-Service.lnk"

:: Pastikan file start_bps.vbs ada
if not exist "%TARGET_VBS%" (
    echo [ERROR] File start_bps.vbs tidak ditemukan di direktori ini!
    echo Direktori saat ini: %WORK_DIR%
    pause
    exit /b 1
)

echo [INFO] Mendaftarkan launcher ke folder Windows Startup:
echo        Tujuan shortcut: %SHORTCUT_PATH%
echo        Target file    : %TARGET_VBS%
echo.

:: Buat shortcut .lnk di folder Startup pengguna
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%SHORTCUT_PATH%'); $sc.TargetPath = '%TARGET_VBS%'; $sc.WorkingDirectory = '%WORK_DIR%'; $sc.Description = 'Auto-start SAPA BPS Service dan Ngrok Tunnel (Hidden)'; $sc.Save()"

:: Verifikasi apakah shortcut berhasil dibuat
if exist "%SHORTCUT_PATH%" (
    echo ======================================================================
    echo [SUKSES] Auto-Start Silent / Hidden berhasil dipasang!
    echo.
    echo Setiap kali Anda menyalakan PC dan login ke Windows:
    echo - SAPA Service dan Ngrok akan otomatis berjalan di LATAR BELAKANG [HIDDEN].
    echo - TIDAK AKAN ADA jendela Command Prompt hitam yang muncul di layar.
    echo - Log aktivitas dapat Anda lihat kapan saja di folder 'logs'.
    echo - Anda dapat mengecek status kapan saja dengan klik 'status_bps.bat'.
    echo - Untuk mematikan, cukup klik 'stop_bps.bat'.
    echo ======================================================================
    echo.
    
    set /p RUN_NOW="Apakah Anda ingin langsung menjalankan service di background sekarang? (Y/N): "
    if /i "!RUN_NOW!"=="Y" (
        echo.
        echo Menjalankan service di background...
        wscript.exe "%TARGET_VBS%"
        echo Service telah dimulai di background! Cek 'status_bps.bat' untuk memantau.
    )
) else (
    echo [ERROR] Gagal membuat shortcut di folder Startup.
)

echo.
pause
