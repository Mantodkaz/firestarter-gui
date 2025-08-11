
# Firestarter GUI

A modern desktop client for Firestarter Storage

---

## Requirements

- **Windows 10/11** (64-bit)
- **Node.js** (v18.x - v22.x)
- **npm** (comes with Node.js)
- **Rust toolchain** (via [rustup](https://rustup.rs/))
- **MSVC (Visual Studio Build Tools)**
  - Download: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - Select: "Desktop development with C++"
- **WebView2 Runtime**
  - Download: [WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703)

> All dependencies are checked automatically during build. If anything is missing, build.bat will notify you.

---

## Install & Build

1. **Clone this repository**
2. **Open Command Prompt** in the project folder
3. **Run:**
   ```
   build.bat
   ```
   All steps (dependency install, build, etc.) will run automatically.

4. **Build output** will be at:
   ```
   src-tauri\target\release\firestarter.exe
   ```

---

## Main Features
- Upload/download files to Pipe Network CDN
- Multi-user account management
- Auto-refresh JWT token
- Upload history, public links, wallet, and more soon

---

## Troubleshooting

- If build fails, check error message in terminal. Make sure all dependencies are installed.
- To see a console window and logs when running the app (for debugging), comment out the following line in `src-tauri/src/main.rs`:
  ```rust
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  ```
  If this line is commented, a console window will appear alongside the GUI. Uncomment it for production to hide the console.

---

## References
- https://docs.pipe.network/cdn-api/pipe-cdn-api-documentation
- https://github.com/PipeNetwork/pipe

---