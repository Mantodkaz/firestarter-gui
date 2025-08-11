@echo off
setlocal EnableExtensions
echo ======================================
echo Firestarter GUI - Build
echo ======================================

echo.
echo [0/4] Checking required tools...

echo Checking Node.js version...
node -v >nul 2>&1 || (echo ERROR: Node.js not in PATH! & pause & exit /b 1)
for /f "delims=" %%A in ('node -v') do echo %%A

echo Checking npm version...
where npm >nul 2>&1 || (echo ERROR: npm not in PATH! & pause & exit /b 1)
for /f "delims=" %%A in ('npm -v') do echo %%A

echo Checking Rust (cargo) version...
where cargo >nul 2>&1 || (echo ERROR: cargo not in PATH! Install Rust. & pause & exit /b 1)
for /f "delims=" %%A in ('cargo --version') do echo %%A

echo Checking Tauri CLI version...
where tauri >nul 2>&1 || (echo ERROR: Tauri CLI not found! npm i -g @tauri-apps/cli & pause & exit /b 1)
tauri -V >nul 2>&1 || (echo ERROR: tauri -V failed. & pause & exit /b 1)

echo Checking MSVC (cl.exe)...
where cl >nul 2>&1 || (echo ERROR: cl.exe not found (VS Build Tools). & pause & exit /b 1)
cl 2>&1 | findstr /I "Microsoft" >nul || (echo ERROR: cl.exe not usable. & pause & exit /b 1)

echo All dependencies found. Proceeding...

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
