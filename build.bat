@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 echo ERROR: no se pudo inicializar vcvars64 & exit /b 1
set LIBCLANG_PATH=C:\Program Files\LLVM\bin
cargo tauri dev --features simconnect

