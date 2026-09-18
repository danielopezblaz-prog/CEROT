@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Foro Vecinal - Vereda de los Estudiantes
if exist "%~dp0tools\node\node.exe" set "PATH=%~dp0tools\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js.
  echo Instala Node.js LTS desde https://nodejs.org o copia la version portatil en la carpeta tools\node
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Instalando dependencias, solo la primera vez. Puede tardar un par de minutos...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Error al instalar las dependencias. Revisa la conexion a internet.
    pause
    exit /b 1
  )
)
echo.
echo  Arrancando el foro vecinal en http://localhost:3000
echo  Deja esta ventana abierta mientras uses el foro. Cierrala para apagarlo.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node --disable-warning=ExperimentalWarning src\server.js
echo.
echo El servidor se ha detenido.
pause
