"""
Dropbox Order Opener - Standalone Desktop Audit Tool for Adobe Photoshop
Enables Audit & QC retouchers to search single/multiple Order IDs, discover vendor files
in Dropbox Cloud on-demand (with full Dropbox Team/Business root namespace support),
cache locally, and open directly in Adobe Photoshop tabs.
Zero external dependencies (uses standard Python library).
"""

import os
import sys
import json
import re
import math
import shutil
import pathlib
import urllib.request
import urllib.error
import subprocess
import threading
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

# Application Constants
APP_TITLE = "Dropbox Order Opener - Photoshop Audit Tool"
APP_VERSION = "2.2.0"
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Temp_Cache")

# Default Photoshop Executable Paths
COMMON_PS_PATHS = [
    r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe",
    r"C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe",
    r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
    r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe",
    r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe",
]

# Non-vendor system folders to ignore in search results
SYSTEM_FOLDERS = {"order", "quote", "free_trial", "r&d team", "example image library", "llm training datasets"}


class ConfigManager:
    """Manages persistent application settings in config.json"""
    def __init__(self, filepath=CONFIG_FILE):
        self.filepath = filepath
        self.data = {
            "dropbox_token": "",
            "cache_dir": DEFAULT_CACHE_DIR,
            "photoshop_path": self._detect_photoshop()
        }
        self.load()

    def _detect_photoshop(self):
        for p in COMMON_PS_PATHS:
            if os.path.isfile(p):
                return p
        return ""

    def load(self):
        if os.path.isfile(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    self.data.update(saved)
            except Exception as e:
                print(f"Error loading config: {e}")

    def save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving config: {e}")

    def get(self, key, default=""):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value
        self.save()


class DropboxClient:
    """Wrapper for Dropbox Cloud API v2 supporting Dropbox Team/Business root namespaces"""
    API_BASE = "https://api.dropboxapi.com/2"
    CONTENT_BASE = "https://content.dropboxapi.com/2"

    def __init__(self):
        self.root_namespace_id = None

    @staticmethod
    def clean_token(token):
        if not token:
            return ""
        t = token.strip()
        t = re.sub(r'^["\']|["\']$', '', t)
        t = re.sub(r'^Bearer\s+', '', t, flags=re.IGNORECASE)
        return t.strip()

    @staticmethod
    def format_bytes(size_bytes):
        if not size_bytes or size_bytes <= 0:
            return "0 B"
        size_name = ("B", "KB", "MB", "GB", "TB")
        i = int(math.floor(math.log(size_bytes, 1024)))
        p = math.pow(1024, i)
        s = round(size_bytes / p, 1)
        return f"{s} {size_name[i]}"

    def _get_headers(self, token, content_type="application/json"):
        cleaned = self.clean_token(token)
        headers = {"Authorization": f"Bearer {cleaned}"}
        if content_type:
            headers["Content-Type"] = content_type
        if self.root_namespace_id:
            headers["Dropbox-API-Path-Root"] = json.dumps({".tag": "root", "root": self.root_namespace_id})
        return headers

    def ensure_root_namespace(self, token):
        """Discovers the root namespace ID for Dropbox Business / Team spaces"""
        if self.root_namespace_id:
            return self.root_namespace_id

        cleaned = self.clean_token(token)
        url = f"{self.API_BASE}/users/get_current_account"
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {cleaned}", "Content-Type": "application/json"},
            data=b"null"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            root_info = data.get("root_info", {})
            self.root_namespace_id = root_info.get("root_namespace_id")
            return self.root_namespace_id

    def test_connection(self, token):
        cleaned = self.clean_token(token)
        if not cleaned:
            raise ValueError("Dropbox Access Token cannot be empty.")

        self.root_namespace_id = None
        self.ensure_root_namespace(cleaned)

        url = f"{self.API_BASE}/users/get_current_account"
        req = urllib.request.Request(url, headers=self._get_headers(cleaned), data=b"null")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                display_name = data.get("name", {}).get("display_name", "Dropbox User")
                email = data.get("email", "N/A")
                return {"display_name": display_name, "email": email}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_body)
                summary = err_json.get("error_summary", err_body)
            except Exception:
                summary = err_body
            raise RuntimeError(f"HTTP {e.code}: {summary}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Network error: {e.reason}")

    def search_order_vendors(self, token, order_id):
        cleaned = self.clean_token(token)
        if not cleaned:
            raise ValueError("Dropbox Token is not configured.")

        # Ensure we have team root access
        try:
            self.ensure_root_namespace(cleaned)
        except Exception as e:
            print(f"Warning resolving root namespace: {e}")

        # Extract numeric base ID (e.g. '459944' from '#459944-E')
        raw_clean = re.sub(r'^#+', '', str(order_id)).strip()
        num_match = re.search(r'\d+', raw_clean)
        search_query = num_match.group(0) if num_match else raw_clean

        vendor_paths = {}  # vendor_name -> folder_path

        # Step 1: Perform fast search_v2 across Dropbox Team Space
        try:
            url = f"{self.API_BASE}/files/search_v2"
            payload = json.dumps({
                "query": search_query,
                "options": {"file_status": "active", "max_results": 100}
            }).encode("utf-8")
            req = urllib.request.Request(url, headers=self._get_headers(cleaned), data=payload)
            with urllib.request.urlopen(req, timeout=20) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                for match in res_data.get("matches", []):
                    meta = match.get("metadata", {}).get("metadata", match.get("metadata", {}))
                    path_display = meta.get("path_display", "")
                    if path_display:
                        parts = [p for p in path_display.split("/") if p]
                        if len(parts) >= 2:
                            vendor_name = parts[0]
                            # Exclude internal non-vendor folders
                            if vendor_name.lower() in SYSTEM_FOLDERS:
                                continue
                            # Verify second segment matches order query
                            order_segment = re.sub(r'^#+', '', parts[1]).strip()
                            if search_query in order_segment or raw_clean.lower() in order_segment.lower():
                                vendor_folder = f"/{vendor_name}/{parts[1]}"
                                if vendor_name not in vendor_paths:
                                    vendor_paths[vendor_name] = vendor_folder
        except Exception as e:
            print(f"search_v2 error: {e}")

        # Step 2: For each vendor folder found, list all files recursively with full cursor pagination
        vendor_results = []
        for v_name, v_path in vendor_paths.items():
            try:
                files, total_size = self.get_order_files(cleaned, v_path)
                if files:  # Only add vendor if files actually exist
                    vendor_results.append({
                        "vendor_name": v_name,
                        "folder_path": v_path,
                        "files": files,
                        "total_size": total_size,
                        "file_count": len(files)
                    })
            except Exception as e:
                print(f"Error fetching files for vendor {v_name}: {e}")

        return vendor_results

    def get_order_files(self, token, folder_path):
        """Recursively lists all files in folder_path with complete cursor pagination"""
        files = []
        total_size = 0
        has_more = True
        cursor = None

        while has_more:
            url = f"{self.API_BASE}/files/list_folder/continue" if cursor else f"{self.API_BASE}/files/list_folder"
            body = {"cursor": cursor} if cursor else {"path": folder_path, "recursive": True}
            payload = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(url, headers=self._get_headers(token), data=payload)

            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for entry in data.get("entries", []):
                    if entry.get(".tag") == "file":
                        name = entry.get("name", "")
                        ext = name.split(".")[-1].lower() if "." in name else ""
                        size = entry.get("size", 0)
                        files.append({
                            "name": name,
                            "path_display": entry.get("path_display", ""),
                            "size": size,
                            "ext": ext
                        })
                        total_size += size
                has_more = data.get("has_more", False)
                cursor = data.get("cursor")

        return files, total_size

    def download_file(self, token, dropbox_path, local_target_path, progress_callback=None):
        cleaned = self.clean_token(token)
        os.makedirs(os.path.dirname(local_target_path), exist_ok=True)

        url = f"{self.CONTENT_BASE}/files/download"
        headers = self._get_headers(cleaned, content_type=None)
        headers["Dropbox-API-Arg"] = json.dumps({"path": dropbox_path})

        req = urllib.request.Request(url, headers=headers)

        with urllib.request.urlopen(req, timeout=120) as resp:
            total_bytes = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 64 * 1024  # 64KB chunks

            with open(local_target_path, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_callback and total_bytes > 0:
                        progress_callback(downloaded, total_bytes)


class OrderOpenerGUI:
    """Main Application GUI built with Tkinter"""
    def __init__(self, root):
        self.root = root
        self.root.title(f"{APP_TITLE} (v{APP_VERSION})")
        self.root.geometry("860x700")
        self.root.minsize(720, 560)

        # Apply dark theme styling
        self.bg_main = "#1e1e1e"
        self.bg_card = "#252526"
        self.bg_input = "#2d2d30"
        self.text_color = "#f1f1f1"
        self.accent_blue = "#0078d4"
        self.accent_green = "#28a745"
        self.accent_red = "#d9534f"

        self.root.configure(bg=self.bg_main)

        self.config = ConfigManager()
        self.client = DropboxClient()

        # State
        self.queue = []  # list of dicts: {"id": "#459785", "clean_id": "459785", "status": "pending", "vendors": None}
        self.current_index = -1
        self.active_vendors = []
        self.selected_vendor = None

        self._build_styles()
        self._build_ui()

    def _build_styles(self):
        style = ttk.Style()
        style.theme_use("clam")

        style.configure(".", background=self.bg_main, foreground=self.text_color, font=("Segoe UI", 9))
        style.configure("TLabel", background=self.bg_main, foreground=self.text_color)
        style.configure("Card.TFrame", background=self.bg_card, relief="solid", borderwidth=1)
        style.configure("CardLabel.TLabel", background=self.bg_card, foreground=self.text_color)
        style.configure("Header.TLabel", background=self.bg_main, foreground="#ffffff", font=("Segoe UI", 12, "bold"))
        style.configure("SubHeader.TLabel", background=self.bg_card, foreground="#aaaaaa", font=("Segoe UI", 9, "bold"))
        style.configure("TProgressbar", thickness=6, troughcolor=self.bg_card, background=self.accent_blue)

        # Treeview styling
        style.configure("Treeview",
                        background=self.bg_input,
                        foreground=self.text_color,
                        fieldbackground=self.bg_input,
                        rowheight=24,
                        font=("Segoe UI", 9))
        style.configure("Treeview.Heading",
                        background=self.bg_card,
                        foreground="#ffffff",
                        font=("Segoe UI", 9, "bold"))
        style.map("Treeview", background=[("selected", self.accent_blue)])

    def _build_ui(self):
        # 1. Top Header Bar
        header_frame = tk.Frame(self.root, bg=self.bg_main, padx=12, pady=10)
        header_frame.pack(fill=tk.X)

        title_lbl = tk.Label(header_frame, text="⚡ Dropbox Order Opener", bg=self.bg_main, fg="#ffffff", font=("Segoe UI", 13, "bold"))
        title_lbl.pack(side=tk.LEFT)

        settings_btn = tk.Button(header_frame, text="⚙ Settings", bg=self.bg_input, fg=self.text_color,
                                 activebackground=self.accent_blue, activeforeground="#fff",
                                 relief="flat", padx=10, pady=3, cursor="hand2", font=("Segoe UI", 9),
                                 command=self.open_settings_dialog)
        settings_btn.pack(side=tk.RIGHT)

        # 2. Main Container
        main_frame = tk.Frame(self.root, bg=self.bg_main, padx=12, pady=4)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Section A: Batch Order Input
        input_card = tk.LabelFrame(main_frame, text=" 📝 Order Input (Single or Batch List) ", bg=self.bg_card, fg="#88c0d0",
                                   font=("Segoe UI", 9, "bold"), padx=10, pady=8)
        input_card.pack(fill=tk.X, pady=(0, 8))

        input_row = tk.Frame(input_card, bg=self.bg_card)
        input_row.pack(fill=tk.X)

        self.order_input_txt = tk.Text(input_row, height=2, bg=self.bg_input, fg=self.text_color,
                                       insertbackground="#fff", relief="flat", font=("Consolas", 10))
        self.order_input_txt.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))
        self.order_input_txt.insert("1.0", "#459919\n#459920\n#459937\n#459944")

        btn_box = tk.Frame(input_row, bg=self.bg_card)
        btn_box.pack(side=tk.RIGHT)

        load_btn = tk.Button(btn_box, text="Load to Queue", bg=self.accent_blue, fg="#ffffff",
                             activebackground="#005ea6", activeforeground="#fff",
                             relief="flat", padx=12, pady=5, font=("Segoe UI", 9, "bold"), cursor="hand2",
                             command=self.load_orders_to_queue)
        load_btn.pack(fill=tk.X, pady=(0, 4))

        clear_in_btn = tk.Button(btn_box, text="Clear", bg=self.bg_input, fg="#aaa",
                                 activebackground="#3e3e42", activeforeground="#fff",
                                 relief="flat", padx=10, pady=2, font=("Segoe UI", 8), cursor="hand2",
                                 command=lambda: self.order_input_txt.delete("1.0", tk.END))
        clear_in_btn.pack(fill=tk.X)

        # Section B: Order Queue & Navigation
        queue_card = tk.LabelFrame(main_frame, text=" 📋 Order Queue & Navigation ", bg=self.bg_card, fg="#88c0d0",
                                   font=("Segoe UI", 9, "bold"), padx=10, pady=6)
        queue_card.pack(fill=tk.X, pady=(0, 8))

        q_top_row = tk.Frame(queue_card, bg=self.bg_card)
        q_top_row.pack(fill=tk.X, pady=(0, 6))

        self.prev_btn = tk.Button(q_top_row, text="◀ Prev", bg=self.bg_input, fg=self.text_color,
                                  relief="flat", padx=10, pady=2, cursor="hand2", command=self.prev_order)
        self.prev_btn.pack(side=tk.LEFT, padx=(0, 6))

        self.next_btn = tk.Button(q_top_row, text="Next ▶", bg=self.bg_input, fg=self.text_color,
                                  relief="flat", padx=10, pady=2, cursor="hand2", command=self.next_order)
        self.next_btn.pack(side=tk.LEFT, padx=(0, 10))

        self.active_order_lbl = tk.Label(q_top_row, text="Active Order: None", bg=self.bg_card, fg="#fff", font=("Segoe UI", 10, "bold"))
        self.active_order_lbl.pack(side=tk.LEFT)

        self.close_order_btn = tk.Button(q_top_row, text="✕ Close Active", bg=self.accent_red, fg="#fff",
                                         relief="flat", padx=8, pady=2, cursor="hand2", font=("Segoe UI", 8),
                                         command=self.close_active_order)
        self.close_order_btn.pack(side=tk.RIGHT, padx=(4, 0))

        self.done_order_btn = tk.Button(q_top_row, text="Done ✓", bg=self.accent_green, fg="#fff",
                                        relief="flat", padx=8, pady=2, cursor="hand2", font=("Segoe UI", 8),
                                        command=self.mark_active_done)
        self.done_order_btn.pack(side=tk.RIGHT)

        # Queue List chips/display
        self.queue_frame = tk.Frame(queue_card, bg=self.bg_card)
        self.queue_frame.pack(fill=tk.X)

        # Section C: Vendors & File List (Expandable)
        self.results_card = tk.LabelFrame(main_frame, text=" 📂 Dropbox Vendors & Files ", bg=self.bg_card, fg="#88c0d0",
                                          font=("Segoe UI", 9, "bold"), padx=10, pady=8)
        self.results_card.pack(fill=tk.BOTH, expand=True)

        # Vendor Selector Buttons
        self.vendor_tabs_frame = tk.Frame(self.results_card, bg=self.bg_card)
        self.vendor_tabs_frame.pack(fill=tk.X, pady=(0, 6))

        # File Treeview
        tree_frame = tk.Frame(self.results_card, bg=self.bg_card)
        tree_frame.pack(fill=tk.BOTH, expand=True)

        columns = ("name", "size", "type")
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="browse")
        self.file_tree.heading("name", text="File Name")
        self.file_tree.heading("size", text="File Size")
        self.file_tree.heading("type", text="Type")

        self.file_tree.column("name", width=420, anchor=tk.W)
        self.file_tree.column("size", width=120, anchor=tk.E)
        self.file_tree.column("type", width=90, anchor=tk.CENTER)

        tree_scroll = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.file_tree.yview)
        self.file_tree.configure(yscrollcommand=tree_scroll.set)

        self.file_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        tree_scroll.pack(side=tk.RIGHT, fill=tk.Y)

        self.file_tree.bind("<Double-1>", lambda e: self.open_selected_file())

        # Action Buttons below File List
        action_bar = tk.Frame(self.results_card, bg=self.bg_card, pady=6)
        action_bar.pack(fill=tk.X)

        self.open_all_btn = tk.Button(action_bar, text="🚀 Open All in Photoshop", bg=self.accent_blue, fg="#ffffff",
                                      activebackground="#005ea6", activeforeground="#fff",
                                      relief="flat", padx=16, pady=6, font=("Segoe UI", 10, "bold"), cursor="hand2",
                                      command=self.open_all_files)
        self.open_all_btn.pack(side=tk.LEFT, padx=(0, 8))

        self.open_single_btn = tk.Button(action_bar, text="Open Selected File", bg=self.bg_input, fg=self.text_color,
                                         relief="flat", padx=12, pady=6, font=("Segoe UI", 9), cursor="hand2",
                                         command=self.open_selected_file)
        self.open_single_btn.pack(side=tk.LEFT)

        self.vendor_stats_lbl = tk.Label(action_bar, text="", bg=self.bg_card, fg="#aaaaaa", font=("Segoe UI", 9))
        self.vendor_stats_lbl.pack(side=tk.RIGHT)

        # 3. Status & Progress Bar Footer
        status_bar = tk.Frame(self.root, bg="#111111", padx=12, pady=6)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)

        self.status_lbl = tk.Label(status_bar, text="Ready. Enter Order ID to begin.", bg="#111111", fg="#aaaaaa", font=("Segoe UI", 9))
        self.status_lbl.pack(side=tk.LEFT)

        self.progress_bar = ttk.Progressbar(status_bar, mode="determinate", length=220)
        self.progress_bar.pack(side=tk.RIGHT)

    def set_status(self, text, pct=None):
        self.status_lbl.config(text=text)
        if pct is not None:
            self.progress_bar["value"] = pct
        self.root.update_idletasks()

    # --- Queue Logic ---
    def load_orders_to_queue(self):
        raw_text = self.order_input_txt.get("1.0", tk.END).strip()
        if not raw_text:
            messagebox.showwarning("Empty Input", "Please enter at least one Order ID.")
            return

        tokens = re.split(r'[\s,;\n\r\t]+', raw_text)
        added_count = 0
        for token in tokens:
            clean = re.sub(r'^#+', '', token).strip()
            if clean:
                display_id = f"#{clean}"
                if not any(item["clean_id"].lower() == clean.lower() for item in self.queue):
                    self.queue.append({
                        "id": display_id,
                        "clean_id": clean,
                        "status": "pending",
                        "vendors": None
                    })
                    added_count += 1

        if added_count > 0:
            if self.current_index == -1 and self.queue:
                self.set_active_order(0)
            else:
                self._render_queue()
            self.set_status(f"Loaded {added_count} order(s) into queue.")
        else:
            self.set_status("No new orders added (already in queue).")

    def _render_queue(self):
        for widget in self.queue_frame.winfo_children():
            widget.destroy()

        for idx, item in enumerate(self.queue):
            is_active = idx == self.current_index
            bg = self.accent_blue if is_active else self.bg_input
            fg = "#ffffff" if is_active else ("#28a745" if item["status"] == "done" else self.text_color)
            prefix = "✓ " if item["status"] == "done" else ""

            chip = tk.Button(self.queue_frame, text=f"{prefix}{item['id']}", bg=bg, fg=fg,
                             relief="flat", padx=8, pady=2, font=("Segoe UI", 8, "bold" if is_active else "normal"),
                             cursor="hand2", command=lambda i=idx: self.set_active_order(i))
            chip.pack(side=tk.LEFT, padx=3, pady=2)

        self.prev_btn.config(state=tk.NORMAL if self.current_index > 0 else tk.DISABLED)
        self.next_btn.config(state=tk.NORMAL if self.current_index < len(self.queue) - 1 else tk.DISABLED)

    def set_active_order(self, index):
        if 0 <= index < len(self.queue):
            self.current_index = index
            item = self.queue[index]
            self.active_order_lbl.config(text=f"Active Order: {item['id']} ({index + 1}/{len(self.queue)})")
            self._render_queue()

            # Search Dropbox for this active order
            self.search_dropbox_for_active_order()

    def next_order(self):
        if self.current_index < len(self.queue) - 1:
            self.set_active_order(self.current_index + 1)

    def prev_order(self):
        if self.current_index > 0:
            self.set_active_order(self.current_index - 1)

    def mark_active_done(self):
        if 0 <= self.current_index < len(self.queue):
            self.queue[self.current_index]["status"] = "done"
            self._render_queue()

    def close_active_order(self):
        if 0 <= self.current_index < len(self.queue):
            self.queue.pop(self.current_index)
            if not self.queue:
                self.current_index = -1
                self.active_order_lbl.config(text="Active Order: None")
                self.file_tree.delete(*self.file_tree.get_children())
                self.vendor_stats_lbl.config(text="")
                for w in self.vendor_tabs_frame.winfo_children():
                    w.destroy()
            else:
                self.current_index = min(self.current_index, len(self.queue) - 1)
                self.set_active_order(self.current_index)
            self._render_queue()

    # --- Dropbox Search ---
    def search_dropbox_for_active_order(self):
        token = self.config.get("dropbox_token", "")
        if not token:
            self.set_status("Dropbox Access Token missing. Click Settings (⚙) to configure.")
            messagebox.showinfo("Setup Required", "Please click 'Settings (⚙)' and enter your Dropbox Access Token.")
            self.open_settings_dialog()
            return

        active_item = self.queue[self.current_index]
        if active_item.get("vendors") is not None:
            # Already searched
            self._display_vendors(active_item["vendors"])
            return

        order_id = active_item["clean_id"]
        self.set_status(f"Scanning Dropbox vendor folders for #{order_id}...", pct=25)
        self.file_tree.delete(*self.file_tree.get_children())
        for w in self.vendor_tabs_frame.winfo_children():
            w.destroy()

        def worker():
            try:
                vendors = self.client.search_order_vendors(token, order_id)
                self.root.after(0, lambda: self._on_search_success(vendors))
            except Exception as e:
                err_msg = str(e)
                self.root.after(0, lambda: self._on_search_error(err_msg))

        threading.Thread(target=worker, daemon=True).start()

    def _on_search_success(self, vendors):
        self.set_status("Ready", pct=0)
        if 0 <= self.current_index < len(self.queue):
            self.queue[self.current_index]["vendors"] = vendors
        self._display_vendors(vendors)

    def _on_search_error(self, err_msg):
        self.set_status(f"Error: {err_msg}", pct=0)
        messagebox.showerror("Search Error", f"Failed to search Dropbox:\n\n{err_msg}")

    def _display_vendors(self, vendors):
        for w in self.vendor_tabs_frame.winfo_children():
            w.destroy()
        self.file_tree.delete(*self.file_tree.get_children())

        if not vendors:
            active_id = self.queue[self.current_index]["id"]
            self.set_status(f"No vendor folders found for {active_id}.")
            self.vendor_stats_lbl.config(text="0 files found")
            return

        self.active_vendors = vendors
        for idx, v in enumerate(vendors):
            total_size_str = self.client.format_bytes(v["total_size"])
            btn_text = f"📁 {v['vendor_name']} ({v['file_count']} files, {total_size_str})"

            btn = tk.Button(self.vendor_tabs_frame, text=btn_text, bg=self.accent_blue if idx == 0 else self.bg_input,
                            fg="#ffffff", relief="flat", padx=10, pady=4, font=("Segoe UI", 9, "bold"),
                            cursor="hand2", command=lambda vi=v: self._select_vendor(vi))
            btn.pack(side=tk.LEFT, padx=3)

        self._select_vendor(vendors[0])

    def _select_vendor(self, vendor):
        self.selected_vendor = vendor
        self.file_tree.delete(*self.file_tree.get_children())

        # Update button highlights
        for btn in self.vendor_tabs_frame.winfo_children():
            if vendor["vendor_name"] in btn.cget("text"):
                btn.config(bg=self.accent_blue)
            else:
                btn.config(bg=self.bg_input)

        # Populate files
        for f in vendor.get("files", []):
            size_str = self.client.format_bytes(f["size"])
            ext_str = f["ext"].upper() if f["ext"] else "FILE"
            self.file_tree.insert("", tk.END, values=(f["name"], size_str, ext_str), tags=(f["path_display"],))

        total_str = self.client.format_bytes(vendor["total_size"])
        self.vendor_stats_lbl.config(text=f"Total: {vendor['file_count']} files | {total_str}")
        self.set_status(f"Loaded {vendor['file_count']} files from vendor '{vendor['vendor_name']}'.")

    # --- File Opening & Download ---
    def open_all_files(self):
        if not self.selected_vendor or not self.selected_vendor.get("files"):
            messagebox.showinfo("No Files", "No files available to open.")
            return

        files = self.selected_vendor["files"]
        token = self.config.get("dropbox_token", "")
        cache_base = self.config.get("cache_dir", DEFAULT_CACHE_DIR)
        order_clean = self.queue[self.current_index]["clean_id"]
        order_cache_dir = os.path.join(cache_base, order_clean)
        os.makedirs(order_cache_dir, exist_ok=True)

        self.open_all_btn.config(state=tk.DISABLED)

        def worker():
            total = len(files)
            for i, f in enumerate(files):
                fname = f["name"]
                local_path = os.path.join(order_cache_dir, fname)

                # Check cache (check if file exists and matches size)
                if not os.path.isfile(local_path) or os.path.getsize(local_path) != f["size"]:
                    def prog(loaded, tot):
                        file_pct = (loaded / tot) if tot > 0 else 0
                        overall = int(((i + file_pct) / total) * 100)
                        self.root.after(0, lambda: self.set_status(f"[{i+1}/{total}] Downloading {fname}...", pct=overall))

                    try:
                        self.client.download_file(token, f["path_display"], local_path, prog)
                    except Exception as e:
                        print(f"Failed to download {fname}: {e}")
                        continue

                # Open in Photoshop
                self.root.after(0, lambda fn=fname, idx=i+1: self.set_status(f"[{idx}/{total}] Opening {fn} in Photoshop...", pct=int((idx/total)*100)))
                self._launch_in_photoshop(local_path)

            self.root.after(0, lambda: self._on_open_all_done(total))

        threading.Thread(target=worker, daemon=True).start()

    def _on_open_all_done(self, count):
        self.open_all_btn.config(state=tk.NORMAL)
        self.set_status(f"All {count} file(s) opened in Photoshop!", pct=100)
        self.root.after(3000, lambda: self.set_status("Ready", pct=0))

    def open_selected_file(self):
        selected = self.file_tree.selection()
        if not selected:
            return

        item = self.file_tree.item(selected[0])
        fname = item["values"][0]

        target_file = next((f for f in self.selected_vendor["files"] if f["name"] == fname), None)
        if not target_file:
            return

        token = self.config.get("dropbox_token", "")
        cache_base = self.config.get("cache_dir", DEFAULT_CACHE_DIR)
        order_clean = self.queue[self.current_index]["clean_id"]
        order_cache_dir = os.path.join(cache_base, order_clean)
        os.makedirs(order_cache_dir, exist_ok=True)
        local_path = os.path.join(order_cache_dir, fname)

        def worker():
            if not os.path.isfile(local_path) or os.path.getsize(local_path) != target_file["size"]:
                def prog(loaded, tot):
                    pct = int((loaded / tot) * 100) if tot > 0 else 50
                    self.root.after(0, lambda: self.set_status(f"Downloading {fname} ({pct}%)...", pct=pct))

                try:
                    self.client.download_file(token, target_file["path_display"], local_path, prog)
                except Exception as e:
                    self.root.after(0, lambda: messagebox.showerror("Download Error", str(e)))
                    return

            self.root.after(0, lambda: self.set_status(f"Opening {fname} in Photoshop...", pct=100))
            self._launch_in_photoshop(local_path)
            self.root.after(2000, lambda: self.set_status("Ready", pct=0))

        threading.Thread(target=worker, daemon=True).start()

    def _launch_in_photoshop(self, filepath):
        ps_path = self.config.get("photoshop_path", "")
        if ps_path and os.path.isfile(ps_path):
            try:
                subprocess.Popen([ps_path, filepath])
                return
            except Exception as e:
                print(f"Direct PS launch failed: {e}")

        # Fallback to Windows default association
        try:
            os.startfile(filepath)
        except Exception as e:
            print(f"os.startfile failed: {e}")

    # --- Settings Dialog ---
    def open_settings_dialog(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("Settings & Credentials")
        dlg.geometry("540x380")
        dlg.configure(bg=self.bg_card)
        dlg.transient(self.root)
        dlg.grab_set()

        pad = {"padx": 14, "pady": 6}

        # 1. Dropbox Token
        tk.Label(dlg, text="Dropbox Access Token *", bg=self.bg_card, fg="#fff", font=("Segoe UI", 9, "bold")).pack(anchor=tk.W, **pad)
        token_entry = tk.Entry(dlg, bg=self.bg_input, fg=self.text_color, insertbackground="#fff", relief="flat", font=("Consolas", 9), show="•")
        token_entry.pack(fill=tk.X, **pad)
        token_entry.insert(0, self.config.get("dropbox_token", ""))

        test_row = tk.Frame(dlg, bg=self.bg_card)
        test_row.pack(fill=tk.X, **pad)

        test_res_lbl = tk.Label(test_row, text="", bg=self.bg_card, fg="#28a745", font=("Segoe UI", 9))

        def test_token():
            tok = token_entry.get().strip()
            test_res_lbl.config(text="Connecting...", fg="#aaa")
            dlg.update_idletasks()
            try:
                info = self.client.test_connection(tok)
                test_res_lbl.config(text=f"✓ Connected: {info['display_name']} ({info['email']})", fg="#28a745")
            except Exception as e:
                test_res_lbl.config(text=f"✕ {e}", fg="#d9534f")

        tk.Button(test_row, text="Test Connection", bg=self.bg_input, fg=self.text_color, relief="flat", padx=10, pady=2, cursor="hand2", command=test_token).pack(side=tk.LEFT)
        test_res_lbl.pack(side=tk.LEFT, padx=10)

        # 2. Local Temp Cache Directory
        tk.Label(dlg, text="Local Temp Cache Directory", bg=self.bg_card, fg="#fff", font=("Segoe UI", 9, "bold")).pack(anchor=tk.W, **pad)
        cache_row = tk.Frame(dlg, bg=self.bg_card)
        cache_row.pack(fill=tk.X, **pad)

        cache_entry = tk.Entry(cache_row, bg=self.bg_input, fg=self.text_color, insertbackground="#fff", relief="flat", font=("Segoe UI", 9))
        cache_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))
        cache_entry.insert(0, self.config.get("cache_dir", DEFAULT_CACHE_DIR))

        def browse_cache():
            f = filedialog.askdirectory(initialdir=cache_entry.get())
            if f:
                cache_entry.delete(0, tk.END)
                cache_entry.insert(0, f)

        tk.Button(cache_row, text="Browse...", bg=self.bg_input, fg=self.text_color, relief="flat", padx=8, pady=2, cursor="hand2", command=browse_cache).pack(side=tk.RIGHT)

        # Cache stats & clear
        cache_stat_row = tk.Frame(dlg, bg=self.bg_card)
        cache_stat_row.pack(fill=tk.X, **pad)

        stat_lbl = tk.Label(cache_stat_row, text="Calculating cache...", bg=self.bg_card, fg="#aaa", font=("Segoe UI", 8))
        stat_lbl.pack(side=tk.LEFT)

        def update_stat():
            cdir = cache_entry.get()
            if os.path.isdir(cdir):
                total_sz = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fns in os.walk(cdir) for f in fns)
                file_cnt = sum(len(fns) for _, _, fns in os.walk(cdir))
                stat_lbl.config(text=f"Used Cache: {self.client.format_bytes(total_sz)} ({file_cnt} files)")
            else:
                stat_lbl.config(text="Used Cache: 0 B")

        update_stat()

        def clear_cache():
            cdir = cache_entry.get()
            if os.path.isdir(cdir):
                shutil.rmtree(cdir, ignore_errors=True)
                os.makedirs(cdir, exist_ok=True)
                update_stat()
                messagebox.showinfo("Cache Cleared", "Local cache has been cleared successfully.")

        tk.Button(cache_stat_row, text="Clear Cache", bg=self.accent_red, fg="#fff", relief="flat", padx=8, pady=2, font=("Segoe UI", 8), cursor="hand2", command=clear_cache).pack(side=tk.RIGHT)

        # 3. Photoshop Executable Path
        tk.Label(dlg, text="Photoshop Executable Path", bg=self.bg_card, fg="#fff", font=("Segoe UI", 9, "bold")).pack(anchor=tk.W, **pad)
        ps_row = tk.Frame(dlg, bg=self.bg_card)
        ps_row.pack(fill=tk.X, **pad)

        ps_entry = tk.Entry(ps_row, bg=self.bg_input, fg=self.text_color, insertbackground="#fff", relief="flat", font=("Segoe UI", 9))
        ps_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))
        ps_entry.insert(0, self.config.get("photoshop_path", ""))

        def browse_ps():
            f = filedialog.askopenfilename(filetypes=[("Photoshop Executable", "Photoshop.exe"), ("All Files", "*.*")])
            if f:
                ps_entry.delete(0, tk.END)
                ps_entry.insert(0, f)

        tk.Button(ps_row, text="Browse...", bg=self.bg_input, fg=self.text_color, relief="flat", padx=8, pady=2, cursor="hand2", command=browse_ps).pack(side=tk.RIGHT)

        # Save Button
        save_btn = tk.Button(dlg, text="Save Settings", bg=self.accent_blue, fg="#ffffff",
                             activebackground="#005ea6", activeforeground="#fff",
                             relief="flat", padx=16, pady=6, font=("Segoe UI", 9, "bold"), cursor="hand2")
        save_btn.pack(pady=14)

        def save_and_close():
            self.config.set("dropbox_token", token_entry.get().strip())
            self.config.set("cache_dir", cache_entry.get().strip())
            self.config.set("photoshop_path", ps_entry.get().strip())
            dlg.destroy()
            self.set_status("Settings saved successfully.")

        save_btn.config(command=save_and_close)


def main():
    root = tk.Tk()
    app = OrderOpenerGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
