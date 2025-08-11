@echo off
setlocal EnableExtensions

rem ======================================
echo ======================================
echo Firestarter GUI - Build
echo ======================================

set "STEP=0"

echo.
echo [%STEP%/4] Checking required tools...

rem ---- Node.js ----
echo Checking Node.js version...
node -v >nul 2>&1 || (echo ERROR: Node.js not in PATH! & pause & exit /b 1)
for /f "delims=" %%A in ('node -v') do echo %%A

rem ---- npm ----
echo Checking npm version...
where npm >nul 2>&1 || (echo ERROR: npm not in PATH! & pause & exit /b 1)
for /f "delims=" %%A in ('npm -v') do echo %%A

rem ---- Rust / cargo ----
echo Checking Rust (cargo) version...
where cargo >nul 2>&1 || (echo ERROR: cargo not in PATH! Install Rust from https://rustup.rs & pause & exit /b 1)
for /f "delims=" %%A in ('cargo --version') do echo %%A

rem ---- Tauri CLI (prefer npx, fallback to global) ----
echo Checking Tauri CLI version...
set "TAURI_CMD="
call npx tauri -V >nul 2>&1 && set "TAURI_CMD=npx tauri"
if not defined TAURI_CMD (
  where tauri >nul 2>&1 && set "TAURI_CMD=tauri"
)
if not defined TAURI_CMD (
  echo ERROR: Tauri CLI not found. Install with: npm i -g @tauri-apps/cli
  pause & exit /b 1
)
for /f "delims=" %%A in ('call %TAURI_CMD% -V 2^>nul') do echo %%A

rem ---- MSVC cl.exe ----
echo Checking MSVC (cl.exe)...
where cl >nul 2>&1 || (echo ERROR: cl.exe not found. Install "Visual Studio Build Tools" (Desktop C++). & pause & exit /b 1)
rem print one line to confirm toolchain vendor
for /f "usebackq delims=" %%A in (`cl 2^>^&1 ^| findstr /I /C:"Microsoft"`) do (
  echo %%A
  goto :cl_checked
)
:cl_checked

echo All dependencies found. Proceeding...

rem ---- WebView2 runtime (optional but recommended) ----
echo Checking WebView2 Runtime...
set "WEBVIEW2_FOUND=0"
reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients" /s | findstr /I "WebView2" >nul 2>nul && set "WEBVIEW2_FOUND=1"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients" /s | findstr /I "WebView2" >nul 2>nul && set "WEBVIEW2_FOUND=1"
reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients" /s | findstr /I "WebView2" >nul 2>nul && set "WEBVIEW2_FOUND=1"
if "%WEBVIEW2_FOUND%"=="0" (
  echo WARNING: WebView2 Runtime not detected. Download: https://go.microsoft.com/fwlink/p/?LinkId=2124703
) else (
  echo WebView2 Runtime detected.
)

set "STEP=1"
echo.
echo [%STEP%/4] Cleaning old builds...
if exist dist rmdir /s /q dist
if exist src-tauri\target rmdir /s /q src-tauri\target
rem NOTE: sengaja tidak menghapus node_modules dan package-lock.json agar install lebih cepat/stabil

set "STEP=2"
echo.
echo [%STEP%/4] Installing dependencies...
rem gunakan npm ci jika ada package-lock.json, fallback ke npm install
if exist package-lock.json (
  call npm ci || (echo ERROR: npm ci failed! & pause & exit /b 1)
) else (
  call npm install || (echo ERROR: npm install failed! & pause & exit /b 1)
)

set "STEP=3"
echo.
echo [%STEP%/4] Building production app...
call %TAURI_CMD% build || (echo ERROR: Tauri build failed! & pause & exit /b 1)

set "STEP=4"
echo.
echo [%STEP%/4] Done!
echo ======================================
echo SUCCESS! If build succeeded, your app binary is under:
echo   src-tauri\target\release\
echo ======================================

endlocal
exit /b 0
