@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================
echo   KPL 2K 本地服务器启动中...
echo ================================
start "" /b "C:\Users\22974\AppData\Local\Programs\Python\Python313\python.exe" -m http.server 8766 --bind 0.0.0.0
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8766/app/index.html"
echo 电脑访问:  http://127.0.0.1:8766/app/index.html
echo 手机同WiFi: http://10.17.134.82:8766/app/index.html
echo 关闭本窗口即停止服务器
pause >nul
