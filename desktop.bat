@echo off
setlocal
cd /d "%~dp0"
title Memo Center Desktop

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "node_modules" goto do_install
goto after_install

:do_install
echo [1/3] 首次运行，正在安装依赖，请稍候...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

:after_install
if not exist "dist\index.html" goto do_build
goto after_build

:do_build
echo [2/3] 正在构建前端，请稍候...
call npm run build
if errorlevel 1 goto fail

:after_build
echo [3/3] 正在启动桌面端...
node desktop/launch.mjs
if errorlevel 1 goto fail

echo.
echo 已启动。托盘图标在任务栏右下角。
echo 本窗口 3 秒后自动关闭，关闭不影响程序运行。
echo 退出程序请使用托盘菜单「退出」。
echo.
timeout /t 3 >nul
exit /b 0

:no_node
echo.
echo 未检测到 Node.js，请先安装 Node.js 18 以上版本。
pause
exit /b 1

:fail
echo.
echo 启动失败，请检查上方的错误信息。
echo 详细日志见 data\desktop.log，或运行 desktop-debug.bat 查看实时输出。
pause
exit /b 1
