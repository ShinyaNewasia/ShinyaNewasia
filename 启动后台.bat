@echo off
cd /d "%~dp0"
title 小窝后台

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 Node.js。
  echo   去 https://nodejs.org 装一个（选 LTS 版本），装完重新双击这个文件。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动小窝后台服务，浏览器马上会自己打开...
echo.

start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://127.0.0.1:8787/admin.html"

node server.js

echo.
echo   服务已经停了。
pause
