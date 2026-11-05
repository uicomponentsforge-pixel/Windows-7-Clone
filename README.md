# Windows 7 Desktop Simulation

A faithful web-based simulation of the classic Microsoft Windows 7 desktop interface built with pure vanilla HTML5, CSS3, and JavaScript (no external frameworks or runtime dependencies).

---

## 🌟 Overview

This project recreates the authentic look, feel, and functionality of Windows 7 directly within modern web browsers. Featuring Aero Glass translucent styling, draggable/resizable multi-window management, persistent virtual file system, simulated shells, built-in games, and productivity applications including a suite inspired by Microsoft Office.

---

## 🚀 Getting Started

No build tools, compilation, or web servers are strictly required.

### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/UIForge/Windows7.git
   cd Windows7
   ```
2. Open `index.html` directly in your browser:
   - On Windows: double-click `index.html` or run `start index.html`
   - On macOS: `open index.html`
   - On Linux: `xdg-open index.html`

### Running with a Local Web Server (Recommended)

Running through a local web server enables optional features like directory picking (`window.showDirectoryPicker`):

Using Python 3:
```bash
python3 -m http.server 8000
```
Then navigate to `http://localhost:8000` in your web browser.

Using Node.js (`npx`):
```bash
npx serve .
```

---

## ✨ Features

### 🪟 Window Manager & Desktop UX
- **Window Management**: Dragging, edge resizing, minimizing, maximizing, restoring, and z-index window focusing.
- **Taskbar & Start Orb**: Start menu with quick search, pinned links, and power controls (Lock, Restart, Shut down).
- **Aero Glass & Flip 3D**: Translucent glass styling with backdrop blur, customizable themes, and a 3D window switcher carousel (`Windows+Tab` or `Alt+\``).
- **Desktop Icons & Context Menu**: Right-click context menus for desktop customization, creating new files/folders, importing files, and launching applications.
- **Recycle Bin**: Full file recovery, context menu actions, and permanent deletion with emptying.

### 📁 Virtual File System (VFS)
- **Local Storage & IndexedDB Persistence**: Emulates a `C:\` drive (`C:\Documents`, `C:\Pictures`, `C:\Desktop`, `C:\Downloads`).
- **File System Operations**: Create, open, rename, copy, cut, paste, delete, drag-and-drop import from local host, and export copies to your real machine.
- **Physical Directory Bridge**: Open real computer folders using the browser's File System Access API (`showDirectoryPicker`) where supported.

### 💻 Command Prompt & PowerShell
- Simulated interactive CLI shells supporting standard Windows utilities and aliases:
  - File/Directory: `dir` / `ls`, `cd`, `mkdir` / `md`, `type` / `cat`, `del` / `rm`, `ren`, `copy`, `move`, `tree`
  - PowerShell cmdlets: `Get-ChildItem`, `Set-Location`, `New-Item`, `Get-Content`, `Remove-Item`, `Select-String`, `Measure-Object`, `Sort-Object`
  - Scripting: Batch/PowerShell script execution (`.bat`, `.cmd`, `.ps1`), pipes (`|`), redirection (`>` / `>>`), and environment variables (`%NAME%` / `$env:NAME`)
  - Diagnostic & network helpers: `cls`, `ver`, `sysinfo`, `ipconfig`, `ping` (HTTPS reachability check), `tasklist`, `taskkill`

### 🛠️ Built-in Applications
- **Notepad**: Text editor with virtual `C:\` save/load and local text file import.
- **Calculator**: Standard calculator supporting basic arithmetic operations, decimals, and sign toggle.
- **Paint**: Canvas-based drawing tool with brushes, shapes (line, rectangle), color picker, palette presets, and PNG export.
- **Snipping Tool**: Rectangular, free-form, and full-screen screen captures with highlighter, pen, and eraser annotations.
- **Windows Photo Viewer**: Image slideshow, zoom, fit-to-window, rotation, and deletion.
- **Browser**: Sandboxed in-browser browsing interface with web navigation, history controls, and quick search.
- **Task Manager**: Real-time process listing with window state tracking and "End task" functionality.
- **Control Panel & Personalization**: Visual customization with multiple wallpapers, color schemes (Sky, Graphite, Rose, Forest), 24-hour clock toggle, and icon sizing.

### 🎮 Built-in Games
- **Minesweeper**: Classic 9x9 grid with 10 mines, flagging, timer/counter, and win detection.
- **Snake**: Arcade snake with score tracking, high score saved to localStorage, and sound effects.

### 💼 Office Suite
Lightweight browser implementations that persist documents to `C:\Documents`:
- **Word**: Rich-text word processor with formatting, lists, font sizing, word counting, and multi-language spell check configuration.
- **Excel**: Spreadsheet supporting cell references and formulas (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `ABS`, `SQRT`, `ROUND`).
- **PowerPoint**: Presentation editor with slide management, editing, and interactive full-screen slide shows.
- **Access**: Relational database tool with customizable tables, sorting, field definitions, and record entry.
- **OneNote**: Multi-page notebook manager with quick switching and instant text notes.
- **Publisher**: Desktop publishing canvas with movable/resizable text boxes, rectangles, ovals, and color settings.
- **InfoPath**: Form designer and data collector with design, fill, and response viewing modes.
- **Picture Manager**: Batch viewer with brightness adjustments, grayscale, rotation, and flips.
- **Groove**: Discussion channels and workspace file organizer.
- **Clip Organizer**: Searchable categorized emoji & icon library with copy and save tools.
- **Digital Certificate**: Demonstration cryptographic key generator utilizing `crypto.subtle`.
- **Office Diagnostics**: Storage integrity, memory, and browser capability diagnostic tool.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Win` or `Ctrl + Esc` | Toggle Start Menu |
| `Win + Tab` or `Alt + \`` | Open Flip 3D window switcher |
| `Alt + F4` | Close active window |
| `Alt + D` | Minimize / Show Desktop |
| `Esc` | Close context menu / Start menu / cancel snip |

---

## 📂 Project Structure

```
.
├── index.html   # Main application markup & container elements
├── script.js    # Core desktop engine, VFS, window manager, and apps
├── style.css    # Aero styling, glass effects, animations, and layouts
└── README.md    # Documentation
```

---

## 🌐 Browser Compatibility

Tested and optimized for modern evergreen browsers:
- Google Chrome / Chromium (version 86+ recommended for directory picker features)
- Mozilla Firefox
- Microsoft Edge
- Apple Safari
