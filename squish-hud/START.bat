@echo off
title Squish HUD
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS from https://nodejs.org & pause & exit /b 1)
start "" http://localhost:7777/
node server.js
pause
