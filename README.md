# ⚡ Dropbox Order Opener

[![GitHub Release](https://img.shields.io/github/v/release/bishojit-sarker/Dropbox-Order-Opener?color=blue&logo=github)](https://github.com/bishojit-sarker/Dropbox-Order-Opener/releases)
[![Photoshop UXP](https://img.shields.io/badge/Photoshop-UXP%20v5-31A8FF?logo=adobe-photoshop)](https://developer.adobe.com/photoshop/uxp/)
[![Python](https://img.shields.io/badge/Python-3.8+-yellow?logo=python)](https://python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An automated Quality Control (QC) & Audit production tool for Adobe Photoshop retouchers. It allows users to search single or batch Order IDs, discover completed image files across Dropbox Cloud Team vendor folders on-demand, cache them locally, and instantly open them inside Adobe Photoshop without requiring local Dropbox sync or desktop clients.

---

## 🌟 Key Features

- **⚡ Cloud-First On-Demand Streaming:** Reads directly from Dropbox Cloud API v2 without downloading gigabytes of sync folders to local disks.
- **🏢 Enterprise Team Space Discovery:** Built-in `Dropbox-API-Path-Root` support and cursor pagination loop to discover all completed files across nested subdirectories in < 1 second.
- **📋 Multi-Order Batch Queue:** Paste single or multiple Order IDs (e.g. `#459919, #459920, #459937`) from spreadsheets, with smooth `[◀ Prev]`, `[Next ▶]`, and `Done ✓` queue navigation.
- **📐 Freely Resizable UI Layout:** Dynamic flexbox container scaling supporting both docked splitter dragging and floating window multi-corner resizing from `240x220` up to `3840x2160` (4K ready).
- **🔄 In-Panel GitHub Live Auto-Updater:** Users can check and install the latest updates with 1-click directly inside Photoshop without restarting the application.
- **💻 Dual Runtime Support:**
  1. **Native Photoshop 2025 UXP Plugin** (`Plugins > Dropbox Order Opener`)
  2. **Standalone Desktop Application** (`order_opener_app.py` / `Launch-Order-Opener.bat`)

---

## 🚀 Quick Start Guide

### Option 1: Native Photoshop 2025 Plugin (Recommended)

1. **One-Click Installation:**
   - Double-click **`Install-Or-Update-Plugin.bat`**.
   - All latest plugin files are instantly installed into `%APPDATA%\Adobe\UXP\Plugins\External\com.audit.dropboxorderopener`.
2. **Open in Photoshop 2025:**
   - Launch Adobe Photoshop 2025.
   - Go to menu: **Plugins > Dropbox Order Opener**.
3. **Setup Token (One-Time):**
   - Click **⚙ Settings** in the top-right corner.
   - Enter your Dropbox Access Token and click **Test Connection** > **Save Settings**.
   - *(Optional: Click "Load from config.json" for instant 1-click configuration).*

### Option 2: Standalone Desktop Application

1. Double-click **`Launch-Order-Opener.bat`** (or create a desktop shortcut via `Create-Desktop-Shortcut.bat`).
2. Enter Order IDs and click **Load to Queue**.
3. Click **🚀 Open All in Photoshop** — files download on-demand and open as active document tabs in Photoshop!

---

## 🔄 How Live Updates Work

Whenever new features, bug fixes, or optimizations are published to this GitHub repository:

### For Users / Retouchers:
- **Inside Photoshop:** In the panel header, click the **Reload (🔄)** icon, or open **⚙ Settings > Check Updates** and click **⚡ Install & Apply Update**. The plugin downloads updated files from GitHub and reloads instantly!
- **Via Batch Script:** Double-click **`Install-Or-Update-Plugin.bat`** to pull the latest release. Existing tokens and personal settings in `config.json` are **never overwritten**.

### For Developers / Maintainers:
Publishing a new release takes one single step:
- Run **`publish_update.bat`** (or `python publish_release.py`).
- The script automatically bumps versions in `version.json`, `manifest.json`, and `order_opener_app.py`, packages `Dropbox-Order-Opener.ccx`, tags the Git release, pushes to `origin main`, and creates an official GitHub Release with assets attached!

---

## 📁 Repository Structure

```text
├── manifest.json              # UXP Manifest v5 configuration
├── index.html                 # Main Photoshop panel markup
├── style.css                  # Dark-theme responsive stylesheet
├── main.js                    # Controller, DOM integration & GitHub live updater
├── dropbox-service.js         # Dropbox API v2 Team Space & pagination client
├── order-queue.js             # Batch order parser and queue state machine
├── cache-manager.js           # UXP local cache management
├── order_opener_app.py        # Standalone Tkinter desktop GUI application
├── publish_release.py         # Automated release publisher & GitHub asset uploader
├── publish_update.bat         # 1-Click launcher for publisher
├── push_to_github.bat         # 1-Click Git sync script
├── Install-Or-Update-Plugin.bat # 1-Click plugin installer/updater for users
├── Launch-Order-Opener.bat     # 1-Click desktop app launcher
├── Create-Desktop-Shortcut.bat# Windows desktop shortcut generator
├── config.template.json       # Clean template configuration
├── version.json               # Live version metadata for auto-updater
├── CHANGELOG.md               # Version history and release notes
├── USER_GUIDE.md              # Complete Bengali & English user manual
└── SETUP_DROPBOX_GUIDE.md     # Dropbox Developer Token guide
```

---

## 📄 License

This project is maintained by **Bishojit Sarker** and the **Automation & Development Team**.
Licensed under the [MIT License](LICENSE).
