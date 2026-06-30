@echo off
echo Clearing Metro cache...
cd /d C:\GeoTechLoggerApp
rmdir /s /q .expo 2>nul
rmdir /s /q node_modules\.cache 2>nul
echo Starting Expo Web (clean)...
npx expo start --web --clear
