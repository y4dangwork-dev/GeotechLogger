@echo off
title GeoTechLogger Web
cd /d C:\GeoTechLoggerApp

echo ==========================================
echo  GeoTechLogger - Expo Web
echo ==========================================
echo.
echo Starting Expo web...
echo Will open browser at: http://localhost:8081
echo Press Ctrl+C to stop.
echo.
npx expo start --web --clear
pause
