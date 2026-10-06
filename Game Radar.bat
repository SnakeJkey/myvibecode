@echo off
setlocal
chcp 65001 >nul
title Game Radar
cd /d "%~dp0"

if exist "node_modules\electron\dist\electron.exe" goto run

where node >nul 2>nul
if errorlevel 1 goto nonode

echo Первый запуск: устанавливаю компоненты.
echo Это займёт 1-3 минуты, нужен интернет. Окно не закрывайте.
echo.
call npm install
if errorlevel 1 goto installfail
if not exist "node_modules\electron\dist\electron.exe" goto installfail

:run
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:nonode
echo Не найден Node.js, он нужен для первого запуска.
echo Сейчас откроется страница загрузки: скачайте версию LTS, установите её
echo и запустите этот файл ещё раз.
start "" "https://nodejs.org"
echo.
pause
exit /b 1

:installfail
echo.
echo Не удалось установить компоненты. Проверьте интернет и запустите файл ещё раз.
echo.
pause
exit /b 1
