@echo off
setlocal
cd /d "%~dp0"
title Memo Center Desktop (debug)

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "dist\index.html" goto no_build

echo 调试模式：日志直接输出到本窗口，关闭窗口会结束程序。
echo.
node desktop/launch.mjs --foreground
echo.
echo 程序已退出，按任意键关闭窗口。
pause
exit /b 0

:no_build
echo 前端未构建，请先执行: npm run build
pause
exit /b 1

:no_node
echo 未检测到 Node.js，请先安装 Node.js 18 以上版本。
pause
exit /b 1
