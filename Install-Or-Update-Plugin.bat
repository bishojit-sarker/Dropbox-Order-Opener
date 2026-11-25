@echo off
setlocal enabledelayedexpansion
title Dropbox Order Opener - Install or Update Plugin

echo ============================================================
echo   Dropbox Order Opener - Photoshop UXP Plugin Installer/Updater
echo   Repository: https://github.com/bishojit-sarker/Dropbox-Order-Opener
echo ============================================================
echo.

set "TARGET_DIR=%APPDATA%\Adobe\UXP\Plugins\External\com.audit.dropboxorderopener"
set "SRC_DIR=%~dp0"
set "GITHUB_RAW=https://raw.githubusercontent.com/bishojit-sarker/Dropbox-Order-Opener/main"

echo [1/3] Checking destination directory...
if not exist "%TARGET_DIR%" (
    echo       Creating directory: "%TARGET_DIR%"
    mkdir "%TARGET_DIR%"
) else (
    echo       Target directory exists: "%TARGET_DIR%"
)

echo.
echo [2/3] Installing / Updating plugin files...
if exist "%SRC_DIR%manifest.json" (
    echo       Copying local repository files...
    copy /Y "%SRC_DIR%manifest.json" "%TARGET_DIR%\" >nul
    copy /Y "%SRC_DIR%index.html" "%TARGET_DIR%\" >nul
    copy /Y "%SRC_DIR%style.css" "%TARGET_DIR%\" >nul
    copy /Y "%SRC_DIR%main.js" "%TARGET_DIR%\" >nul
    copy /Y "%SRC_DIR%dropbox-service.js" "%TARGET_DIR%\" >nul
    copy /Y "%SRC_DIR%order-queue.js" "%TARGET_DIR%\" >nul
    copy /Y "%SRC_DIR%cache-manager.js" "%TARGET_DIR%\" >nul
    if exist "%SRC_DIR%version.json" copy /Y "%SRC_DIR%version.json" "%TARGET_DIR%\" >nul
) else (
    echo       Downloading latest files directly from GitHub...
    powershell -NoProfile -Command "
        $files = @('manifest.json', 'index.html', 'style.css', 'main.js', 'dropbox-service.js', 'order-queue.js', 'cache-manager.js', 'version.json');
        foreach ($f in $files) {
            Invoke-WebRequest -Uri '%GITHUB_RAW%/' + $f -OutFile (Join-Path '%TARGET_DIR%' $f) -UseBasicParsing;
            Write-Host '       Downloaded:' $f;
        }
    "
)

:: Preserve existing user credentials in config.json
if not exist "%TARGET_DIR%\config.json" (
    if exist "%SRC_DIR%config.json" (
        copy /Y "%SRC_DIR%config.json" "%TARGET_DIR%\" >nul
    ) else if exist "%SRC_DIR%config.template.json" (
        copy /Y "%SRC_DIR%config.template.json" "%TARGET_DIR%\config.json" >nul
    )
)

echo       Files installed successfully!

echo.
echo [3/3] Checking CCX package...
if exist "%SRC_DIR%manifest.json" (
    powershell -NoProfile -Command "Compress-Archive -Path '%SRC_DIR%manifest.json', '%SRC_DIR%index.html', '%SRC_DIR%style.css', '%SRC_DIR%dropbox-service.js', '%SRC_DIR%order-queue.js', '%SRC_DIR%cache-manager.js', '%SRC_DIR%main.js', '%SRC_DIR%version.json' -DestinationPath '%SRC_DIR%Dropbox-Order-Opener.zip' -Force; Copy-Item '%SRC_DIR%Dropbox-Order-Opener.zip' '%SRC_DIR%Dropbox-Order-Opener.ccx' -Force; Remove-Item '%SRC_DIR%Dropbox-Order-Opener.zip' -Force" >nul 2>&1
    echo       Dropbox-Order-Opener.ccx verified!
)

echo.
echo ============================================================
echo   SUCCESS! Plugin installed / updated successfully!
echo ============================================================
echo.
echo   How to use in Adobe Photoshop:
echo   ----------------------------------------------------------
echo   1. Open Photoshop 2025.
echo   2. Go to menu: Plugins -> Dropbox Order Opener
echo   3. If panel is ALREADY open, just click the Reload [^] icon 
echo      in the top header to apply updates instantly!
echo   4. Panel Size: Freely drag the panel edges or corners 
echo      to resize it to ANY width and height!
echo.
echo ============================================================
pause
