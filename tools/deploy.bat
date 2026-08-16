@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo ============================================
echo   KPL 2K 一键更新部署（Cloudflare Pages）
echo ============================================

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo 本机没有 Python。请先安装：https://www.python.org/downloads/
  echo 安装时勾选 "Add python.exe to PATH"，装完再双击本脚本。
  pause
  exit /b 1
)

set TOKFILE=%USERPROFILE%\.kpl2k_cf_token
if exist "%TOKFILE%" (
  set /p CF_TOKEN=<"%TOKFILE%"
) else (
  echo.
  echo 首次使用：请输入你的 Cloudflare API Token（不会上传，只保存在本机）
  set /p CF_TOKEN=Token:
  echo %CF_TOKEN%> "%TOKFILE%"
)

echo.
echo [1/2] 重建数据分片...
python tools/build_web.py
if errorlevel 1 ( echo 数据重建失败 & pause & exit /b 1 )

echo.
echo [2/2] 上传并部署...
set CF_TOKEN=%CF_TOKEN%
python tools/deploy_pages.py

echo.
pause
