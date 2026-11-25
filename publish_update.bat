@echo off
title Publish Dropbox Order Opener Update to GitHub
echo ========================================================
echo   Dropbox Order Opener - One-Click Update Publisher
echo ========================================================
echo.
python "%~dp0publish_release.py"
echo.
pause
