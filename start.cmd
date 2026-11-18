@echo off
chcp 65001 >nul
title Space Manager
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   需要 Node.js ^(^>= 18.15^)。
  echo   下载： https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo   正在启动 Space Manager...
echo   关闭这个窗口即停止服务。
echo.

start "" http://127.0.0.1:5178
node "%~dp0server.mjs"

echo.
echo   服务已停止。
pause
