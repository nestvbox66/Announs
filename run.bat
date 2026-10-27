@echo off
setlocal
echo ============================================
echo   Announs Desktop - Launcher
echo ============================================
echo.
echo   [1] Modo desarrollo (hot reload, compila Rust)
echo   [2] Modo produccion (compila todo, ejecutable final)
echo   [3] Solo compilar backend (sin ejecutar)
echo   [4] Salir
echo.
set /p choice="Selecciona una opcion (1/2/3/4): "

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto build
if "%choice%"=="3" goto compile_only
if "%choice%"=="4" goto end
goto invalid

:dev
echo.
echo [Announs] Iniciando modo desarrollo...
cargo tauri dev --features simconnect
goto end

:build
echo.
echo [Announs] Incrementando version (minor) antes de compilar...
node scripts/bump-version.js
if errorlevel 1 (
  echo [ERROR] No se pudo incrementar la version. Abortando compilacion.
  pause
  goto end
)
echo.
echo [Announs] Compilando modo produccion con firma...

:: Definir la ruta de la clave privada usando %USERPROFILE% (evita el uso de ~)
set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\announs.key

:: La contraseña se toma de la variable de entorno TAURI_SIGNING_PRIVATE_KEY_PASSWORD
if not defined TAURI_SIGNING_PRIVATE_KEY_PASSWORD (
  echo [ERROR] Falta la variable de entorno TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  pause
  goto end
)


cargo tauri build --features simconnect

echo.
echo [Announs] Ejecutable y artefactos generados en:
echo   src-tauri\target\release\bundle\msi\
pause
goto end

:compile_only
echo.
echo [Announs] Compilando backend sin ejecutar...
cargo build --features simconnect
echo.
echo [Announs] Compilacion completada.
pause
goto end

:invalid
echo.
echo Opcion no valida.
pause
goto end

:end
endlocal