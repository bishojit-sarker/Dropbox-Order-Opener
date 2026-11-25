@echo off
title Push Changes to GitHub
echo ========================================================
echo   Syncing & Pushing Changes to GitHub (origin main)
echo ========================================================
echo.
git status
echo.
set /p commit_msg="Enter commit message (or press Enter for default): "
if "%commit_msg%"=="" set commit_msg="Update plugin features and assets"

git add -A
git commit -m "%commit_msg%"
git push origin main
echo.
echo ========================================================
echo   Pushed to GitHub successfully!
echo ========================================================
pause
