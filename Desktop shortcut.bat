@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "GR_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = $ws.CreateShortcut((Join-Path $desktop 'Game Radar.lnk')); $lnk.TargetPath = (Join-Path $env:GR_DIR 'Game Radar.bat'); $lnk.WorkingDirectory = $env:GR_DIR; $lnk.IconLocation = (Join-Path $env:GR_DIR 'build\icon.ico'); $lnk.Description = 'Game Radar'; $lnk.Save()"
if errorlevel 1 goto fail

echo.
echo Готово: ярлык Game Radar создан на рабочем столе.
echo Папку с программой не удаляйте и не переносите: ярлык запускает файлы из неё.
echo Если папку всё же перенесли, запустите этот файл ещё раз.
echo.
pause
exit /b 0

:fail
echo.
echo Не удалось создать ярлык. Можно вручную: правая кнопка на файле Game Radar.bat,
echo Отправить, Рабочий стол (создать ярлык).
echo.
pause
exit /b 1
