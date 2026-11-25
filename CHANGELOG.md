# Changelog

All notable changes to the **Dropbox Order Opener** system are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] - 2026-11-25

### Added
- **GitHub Live Auto-Updater:** In-panel version checking against GitHub repository (`bishojit-sarker/Dropbox-Order-Opener`). Users can update the plugin with 1-click directly inside Photoshop without restarting.
- **Freely Resizable & Adjustable Panel Layout:** Dynamic flexbox container scaling supporting both docked splitter dragging and floating panel multi-corner resizing from `240x220` up to `3840x2160` (4K ready).
- **1-Click Release Publisher (`publish_release.py` / `publish_update.bat`):** Automated version bumping, `.ccx` packaging, git tagging, and GitHub Release asset uploading via GitHub REST API.
- **Smart Credential Protection:** Added `.gitignore` and `config.template.json` to prevent accidental credential leakage while preserving local user tokens across updates.

### Improved
- **Team Space Discovery:** Dropbox API v2 with `Dropbox-API-Path-Root` namespace header to search the entire enterprise Dropbox space in <1 second.
- **Subfolder Pagination:** Cursor pagination loop (`list_folder/continue`) to ensure 100% of vendor files are discovered across nested subdirectories.
- **Zero-Flicker Reload:** Added top-level instant reload icon (`🔄`) in the panel header.

---

## [2.1.0] - 2026-11-25

### Added
- Multi-Order Batch Queue with navigation controls (`[◀ Prev]`, `[Next ▶]`, `Done ✓`, `✕ Close Active`).
- Adobe Photoshop 2025 compatibility with zero Windows Firewall outbound connection issues.
- One-click token loader from `config.json` with Show/Hide toggle.

---

## [2.0.0] - 2026-11-25

### Added
- Standalone Python Desktop GUI application (`order_opener_app.py`) with zero external pip dependencies (native Tkinter).
- 1-Click desktop launcher (`Launch-Order-Opener.bat`) and desktop shortcut generator (`Create-Desktop-Shortcut.bat`).

---

## [1.0.0] - 2026-11-25

### Added
- Initial release of Dropbox Order Opener native Photoshop UXP Plugin.
- Direct Dropbox API v2 integration and on-demand local temporary caching.
- Native Photoshop DOM integration (`app.open`, `executeAsModal`).
