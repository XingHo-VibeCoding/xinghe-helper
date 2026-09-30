@echo off
title xinghe-helper - 停止服务器

echo ============================================
echo    住宿安排小助手 - 停止服务器
echo ============================================
echo.

netstat -aon | findstr ":5173" >nul 2>nul
if errorlevel 1 goto notfound

echo       正在关闭占用 5173 端口的进程 ...
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":5173"') do taskkill /F /PID %%P >nul 2>nul
echo.
echo       服务器已停止。
goto done

:notfound
echo       没有检测到正在运行的服务器，可能本来就没开。

:done
echo.
echo 提示：如果显示 Starting up 的黑窗口还开着，
echo       直接点它右上角的 X 关掉即可。
echo.
pause
