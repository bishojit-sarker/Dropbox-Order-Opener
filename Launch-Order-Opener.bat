@echo off
title Dropbox Order Opener Launcher
cd /d "%~dp0"

:: Check Python availability
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.10+ from https://www.python.org/
    pause
    exit /b 1
)

:: Run GUI silently via pythonw if available, else python
start "" pythonw.exe "%~dp0order_opener_app.py" 2>nul
if %ERRORLEVEL% NEQ 0 (
    start "" python.exe "%~dp0order_opener_app.py"
)
