@echo off
setlocal enabledelayedexpansion
title SAPA BPS - Uninstall Auto-Start

echo ======================================================================
echo    UNINSTALL AUTO-START PADA WINDOWS LOGIN (STARTUP) - SAPA BPS
echo ======================================================================
echo.

set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SAPA-Service.lnk"

if exist "%SHORTCUT_PATH%" (
    del /f /q "%SHORTCUT_PATH%"
    if not exist "%SHORTCUT_PATH%" (
        echo [SUKSES] Auto-Start berhasil dicabut!
        echo Shortcut '%SHORTCUT_PATH%' telah dihapus.
        echo SAPA Service tidak akan berjalan otomatis lagi saat Windows login.
    ) else (
        echo [ERROR] Gagal menghapus shortcut. Coba hapus secara manual di folder:
        echo %SHORTCUT_PATH%
    )
) else (
    echo [INFO] Auto-Start belum terpasang atau shortcut sudah tidak ada.
    echo Tidak ada yang perlu dihapus.
)

echo.
echo ======================================================================
pause
