@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================
echo   KPL 2K 本地服务器启动中...
echo ================================
set "BIND=127.0.0.1"
if /I "%~1"=="--lan" set "BIND=0.0.0.0"
start "" /b python -m http.server 8766 --bind %BIND%
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8766/app/index.html"
echo 电脑访问:  http://127.0.0.1:8766/app/index.html
if /I "%~1"=="--lan" echo 局域网模式已开启，请用本机局域网 IP 访问 8766 端口
echo 关闭本窗口即停止服务器
pause >nul
