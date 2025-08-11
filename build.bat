@echo off
setlocal EnableExtensions
echo ======================================
echo Firestarter GUI - Build
echo ======================================

echo.
echo [0/4] Checking required tools...

echo Checking Node.js version...
node -v || (echo ERROR: Node.js is not installed or not in PATH! & pause & exit /b 1)

echo Checking npm version...
call npm -v || (echo ERROR: npm is not installed or not in PATH! & pause & exit /b 1)

echo Checking Rust (cargo) version...
cargo --version || (echo ERROR: Rust (cargo) is not installed or not in PATH! & pause & exit /b 1)

echo Checking Tauri CLI version...
call tauri -V >nul 2>&1 || (
  echo ERROR: Tauri CLI is not installed! Run: npm install -g @tauri-apps/cli
  pause & exit /b 1
)

echo Checking MSVC (cl.exe)...
cl 2>&1 | findstr /I "Microsoft" >nul || (
  echo ERROR: MSVC (cl.exe) not found! Please install Visual Studio Build Tools (Desktop C++).
  pause & exit /b 1
)

echo All dependencies found. Proceeding...

echo Checking WebView2 Runtime...
set "WEBVIEW2_FOUND=0"
reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients" /s | findstr /I "WebView2" >nul 2>nul && set "WEBVIEW2_FOUND=1"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients" /s | findstr /I "WebView2" >nul 2>nul && set "WEBVIEW2_FOUND=1"
reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients" /s | findstr /I "WebView2" >nul 2>nul && set "WEBVIEW2_FOUND=1"
if "%WEBVIEW2_FOUND%"=="0" (
  echo WARNING: WebView2 Runtime not detected in registry!
  echo The app may not run on systems without WebView2.
  echo Download: https://go.microsoft.com/fwlink/p/?LinkId=2124703
) else (
  echo WebView2 Runtime detected.
)

echo.
echo [1/4] Cleaning old builds...
if exist node_modules rmdir /s /q node_modules
if exist dist rmdir /s /q dist
if exist src-tauri\target rmdir /s /q src-tauri\target
if exist package-lock.json del package-lock.json

echo.
echo [2/4] Installing dependencies...
call npm install || (echo ERROR: npm install failed! & pause & exit /b 1)

echo.
echo [3/4] Building production app...
call npx tauri build || (echo ERROR: Tauri build failed! & pause & exit /b 1)

echo.
echo [4/4] Done!
echo ======================================
echo SUCCESS! App ready at:
echo src-tauri\target\release\firestarter.exe
echo ======================================
endlocal
