@echo off
cd /d "%~dp0"
title 小窝局域网

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
echo   正在把网站开到局域网上，同一个 Wi-Fi 下的手机就能打开了...
echo.
echo   如果弹出「是否允许 Node.js 访问网络」，勾上「专用网络」再点允许。
echo.

:loop
node server.js --lan
echo.
echo   ！服务停了，3 秒后自动重开（想彻底关掉就直接关这个窗口）。
echo.
ping -n 4 127.0.0.1 >nul
goto loop
