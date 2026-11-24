@echo off
setlocal
cd /d "%~dp0"
title Memo Center

echo.
echo ==========================================
echo            备忘中心 启动器
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

netstat -ano | findstr /i "LISTENING" | findstr ":5178 " >nul 2>nul
if not errorlevel 1 goto running

if not exist "node_modules" goto do_install
goto after_install

:do_install
echo [1/2] 首次运行，正在安装依赖，请稍候...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail_install

:after_install
if not exist "dist\index.html" goto do_build
goto after_build

:do_build
echo [2/2] 正在构建前端，请稍候...
call npm run build
if errorlevel 1 goto fail_build

:after_build
echo.
echo 服务地址: http://127.0.0.1:5178
echo 请保持此窗口打开，关闭窗口即停止服务。
echo.
start "" http://127.0.0.1:5178
node server/index.mjs
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" goto runtime_error
echo 服务已停止 (退出码 %CODE%)，按任意键关闭窗口...
pause >nul
goto :eof

:runtime_error
echo 服务异常退出 (退出码 %CODE%)。
echo 若提示端口已被占用，说明已有实例在运行:
echo   1. 先关闭那个正在运行的窗口，再重新双击本文件
echo   2. 或设置环境变量 PORT 换成其他端口，例如: set PORT=5200
echo.
pause
goto :eof

:running
echo 服务已在运行，正在打开浏览器...
start "" http://127.0.0.1:5178
ping -n 3 127.0.0.1 >nul 2>nul
goto :eof

:no_node
echo 未检测到 Node.js，请安装 Node.js 18 以上版本后再试。
echo 下载地址: https://nodejs.org/
echo.
pause
goto :eof

:fail_install
echo.
echo 依赖安装失败，请检查网络连接后重试。
echo.
pause
goto :eof

:fail_build
echo.
echo 前端构建失败，请查看上方错误信息。
echo.
pause
goto :eof
