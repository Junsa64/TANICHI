@echo off
chcp 65001 >nul
title EL TANICHI - Punto de venta
cd /d "%~dp0"

set "PUERTO=8123"
set "DIRECCION=http://localhost:%PUERTO%/index.html"

if not exist "index.html" goto :sinapp
if not exist "servidor-tanichi.ps1" goto :sinapp

rem ---- Buscar Chrome o Edge -------------------------------------------------
set "NAV="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "NAV=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

rem ---- Cerrar cualquier servidor TANICHI que haya quedado colgado -----------
rem Antes se reutilizaba el que ya estuviera escuchando en el puerto. Si ese
rem venia de OTRA carpeta (una version anterior), el navegador seguia abriendo
rem la vieja por mas archivos nuevos que copiaras. Ahora manda esta carpeta.
echo.
echo   EL TANICHI - preparando...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cerrar-servidor.ps1" >nul 2>nul

rem ---- Levantar el servidor DE ESTA CARPETA ---------------------------------
start "TANICHI servidor" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0servidor-tanichi.ps1"

rem Esperar a que responda, hasta 20 segundos
for /l %%i in (1,1,40) do (
    powershell -NoProfile -Command "try{ (New-Object Net.Sockets.TcpClient('127.0.0.1',%PUERTO%)).Close(); exit 0 } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 goto :listo
    timeout /t 1 /nobreak >nul
)

rem ---- Sin servidor: se abre el archivo directo, que tambien vende ----------
echo.
echo   El servidor no arranco. La app abre igual y puedes vender,
echo   pero no se podra instalar ni trabajar sin internet.
echo.
if defined NAV start "" "%NAV%" --app="file:///%CD:\=/%/index.html"
if not defined NAV start "" "index.html"
timeout /t 6 >nul
exit /b 0

:listo
if defined NAV start "" "%NAV%" --app="%DIRECCION%"
if not defined NAV start "" "%DIRECCION%"
exit /b 0

:sinapp
echo.
echo   [X] Faltan archivos en esta carpeta.
echo       TANICHI.bat debe quedar junto a index.html y servidor-tanichi.ps1
echo.
echo       Si acabas de bajar el ZIP, descomprimelo COMPLETO en una carpeta
echo       nueva y ejecuta el TANICHI.bat que quedo adentro.
echo.
pause
exit /b 1
