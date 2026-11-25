@echo off
echo Packaging Dropbox Order Opener as .ccx for Photoshop...
powershell -NoProfile -Command "Compress-Archive -Path 'manifest.json', 'index.html', 'style.css', 'dropbox-service.js', 'order-queue.js', 'cache-manager.js', 'main.js', 'config.json' -DestinationPath 'Dropbox-Order-Opener.zip' -Force; Copy-Item 'Dropbox-Order-Opener.zip' 'Dropbox-Order-Opener.ccx' -Force; Remove-Item 'Dropbox-Order-Opener.zip' -Force"
echo.
echo =====================================================
echo Success! "Dropbox-Order-Opener.ccx" has been generated.
echo =====================================================
pause
