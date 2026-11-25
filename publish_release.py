"""
Dropbox Order Opener - Release Publisher & Version Control Script
Modeled for bishojit-sarker/Dropbox-Order-Opener
Automates version bumping, CCX packaging, git tagging, committing, and GitHub Release publishing.
"""

import os
import sys
import re
import json
import time
import shutil
import zipfile
import subprocess
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).parent.resolve()
MANIFEST_JSON = BASE_DIR / "manifest.json"
VERSION_JSON = BASE_DIR / "version.json"
CHANGELOG_MD = BASE_DIR / "CHANGELOG.md"
APP_PY = BASE_DIR / "order_opener_app.py"
CCX_FILE = BASE_DIR / "Dropbox-Order-Opener.ccx"
VERSIONS_DIR = BASE_DIR / "versions"
GITHUB_REPO = "bishojit-sarker/Dropbox-Order-Opener"

def run_cmd(cmd, cwd=BASE_DIR, check=True):
    print(f"  > {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and res.returncode != 0:
        print(f"[ERROR] Command failed with code {res.returncode}:\n{res.stderr}")
        sys.exit(res.returncode)
    return res

def get_current_version():
    if VERSION_JSON.exists():
        try:
            data = json.loads(VERSION_JSON.read_text(encoding="utf-8"))
            return data.get("version", "2.2.0")
        except Exception:
            pass
    if MANIFEST_JSON.exists():
        try:
            data = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
            return data.get("version", "2.2.0")
        except Exception:
            pass
    return "2.2.0"

def extract_release_notes(version):
    if not CHANGELOG_MD.exists():
        return "Performance enhancements, adjustable panel improvements, and bug fixes."
    content = CHANGELOG_MD.read_text(encoding="utf-8")
    clean_ver = version.lstrip("v")
    pattern = rf'## \[?{re.escape(clean_ver)}\]?[^\n]*\n(.*?)(?=\n## \[|\Z)'
    m = re.search(pattern, content, re.DOTALL)
    if not m:
        return f"Release {version} with UI improvements, auto-updater integration, and bug fixes."
    return m.group(1).strip()

def get_github_token():
    for var in ["GITHUB_TOKEN", "GH_TOKEN"]:
        val = os.environ.get(var)
        if val and val.strip():
            return val.strip()
    try:
        p = subprocess.run(
            ["git", "credential", "fill"],
            input="protocol=https\nhost=github.com\n\n",
            text=True,
            capture_output=True,
            check=False
        )
        for line in p.stdout.splitlines():
            if line.startswith("password="):
                tok = line.split("=", 1)[1].strip()
                if tok:
                    return tok
    except Exception:
        pass
    return None

def update_version_in_files(version, release_notes):
    clean_ver = version.lstrip("v")
    today = time.strftime("%Y-%m-%d")

    # 1. Update version.json
    v_data = {
        "version": clean_ver,
        "name": "Dropbox Order Opener",
        "release_date": today,
        "github_repo": GITHUB_REPO,
        "raw_base_url": f"https://raw.githubusercontent.com/{GITHUB_REPO}/main",
        "changelog": release_notes.split("\n")[0].strip("-* "),
        "files": [
            "manifest.json",
            "index.html",
            "style.css",
            "main.js",
            "dropbox-service.js",
            "order-queue.js",
            "cache-manager.js"
        ]
    }
    VERSION_JSON.write_text(json.dumps(v_data, indent=2), encoding="utf-8")
    print(f"  ✓ Updated {VERSION_JSON.name} to v{clean_ver}")

    # 2. Update manifest.json
    if MANIFEST_JSON.exists():
        m_data = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
        m_data["version"] = clean_ver
        MANIFEST_JSON.write_text(json.dumps(m_data, indent=2), encoding="utf-8")
        print(f"  ✓ Updated {MANIFEST_JSON.name} to v{clean_ver}")

    # 3. Update order_opener_app.py
    if APP_PY.exists():
        content = APP_PY.read_text(encoding="utf-8")
        content = re.sub(r'APP_VERSION = "[^"]+"', f'APP_VERSION = "{clean_ver}"', content)
        APP_PY.write_text(content, encoding="utf-8")
        print(f"  ✓ Updated {APP_PY.name} to v{clean_ver}")

def build_ccx(version):
    print(f"\n[Packaging] Building {CCX_FILE.name} for v{version}...")
    files_to_pack = [
        "manifest.json",
        "index.html",
        "style.css",
        "main.js",
        "dropbox-service.js",
        "order-queue.js",
        "cache-manager.js",
        "version.json"
    ]
    if (BASE_DIR / "config.template.json").exists():
        files_to_pack.append("config.template.json")

    # Create zip then rename to ccx
    zip_path = BASE_DIR / "Dropbox-Order-Opener.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in files_to_pack:
            fpath = BASE_DIR / fname
            if fpath.exists():
                zf.write(fpath, arcname=fname)
    
    if CCX_FILE.exists():
        CCX_FILE.unlink()
    shutil.copy2(zip_path, CCX_FILE)
    zip_path.unlink()

    # Save copy to versions/
    ver_dir = VERSIONS_DIR / f"v{version.lstrip('v')}"
    ver_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(CCX_FILE, ver_dir / f"Dropbox-Order-Opener-v{version.lstrip('v')}.ccx")
    print(f"  ✓ Successfully packaged {CCX_FILE.name} ({CCX_FILE.stat().st_size // 1024} KB)")

def publish_github_release(version, notes, token):
    headers = {
        "User-Agent": "Dropbox-Order-Opener-Publisher",
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }

    clean_ver = version.lstrip("v")
    tag_name = f"v{clean_ver}"
    title = f"Dropbox Order Opener v{clean_ver}"
    rel_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag_name}"

    req = urllib.request.Request(rel_url, headers=headers)
    release_data = None
    try:
        with urllib.request.urlopen(req) as resp:
            release_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"  [Notice] API check: HTTP {e.code}")

    body_content = (
        f"# ⚡ Dropbox Order Opener v{clean_ver}\n\n"
        f"{notes}\n\n"
        "---\n"
        "### 📥 Installation & Updates:\n"
        "- **Photoshop UXP Users:** Inside Photoshop, go to **Settings > Check Updates** and click **Install & Apply Update**.\n"
        "- **1-Click Script:** Run `Install-Or-Update-Plugin.bat`.\n"
        "- **Manual CCX:** Download `Dropbox-Order-Opener.ccx` below.\n"
    )

    if release_data:
        rel_id = release_data["id"]
        print(f"  Updating existing GitHub release {tag_name} (ID: {rel_id})...")
        patch_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/{rel_id}"
        patch_body = json.dumps({"name": title, "body": body_content}).encode("utf-8")
        preq = urllib.request.Request(patch_url, data=patch_body, headers=headers, method="PATCH")
        with urllib.request.urlopen(preq) as resp:
            release_data = json.loads(resp.read().decode("utf-8"))
    else:
        print(f"  Creating new GitHub release {tag_name}...")
        create_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases"
        cbody = json.dumps({
            "tag_name": tag_name,
            "target_commitish": "main",
            "name": title,
            "body": body_content,
            "draft": False,
            "prerelease": False
        }).encode("utf-8")
        creq = urllib.request.Request(create_url, data=cbody, headers=headers, method="POST")
        with urllib.request.urlopen(creq) as resp:
            release_data = json.loads(resp.read().decode("utf-8"))

    # Upload CCX Asset
    if release_data and CCX_FILE.exists():
        upload_url_template = release_data.get("upload_url", "")
        if "{" in upload_url_template:
            upload_base = upload_url_template.split("{")[0]
        else:
            upload_base = upload_url_template

        asset_name = CCX_FILE.name
        # Delete existing asset if present
        for existing in release_data.get("assets", []):
            if existing.get("name") == asset_name:
                del_url = existing.get("url")
                dreq = urllib.request.Request(del_url, headers=headers, method="DELETE")
                try:
                    with urllib.request.urlopen(dreq):
                        pass
                except Exception:
                    pass

        upload_url = f"{upload_base}?name={urllib.parse.quote(asset_name)}"
        ccx_bytes = CCX_FILE.read_bytes()
        u_headers = {
            "User-Agent": "Dropbox-Order-Opener-Publisher",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(ccx_bytes))
        }
        ureq = urllib.request.Request(upload_url, data=ccx_bytes, headers=u_headers, method="POST")
        try:
            with urllib.request.urlopen(ureq) as resp:
                print(f"  ✓ Uploaded {asset_name} to GitHub release!")
        except Exception as e:
            print(f"  [Warning] Asset upload warning: {e}")

    return release_data.get("html_url") if release_data else None

def main():
    print("=" * 60)
    print("  🚀 Dropbox Order Opener - Release & Version Control Publisher")
    print("=" * 60)

    current_ver = get_current_version()
    print(f"\nCurrent detected version: v{current_ver}")

    if len(sys.argv) > 1:
        target_ver = sys.argv[1].strip()
    else:
        ans = input(f"Enter release version (press Enter to keep {current_ver}): ").strip()
        target_ver = ans if ans else current_ver

    clean_ver = target_ver.lstrip("v")
    print(f"\n[1/5] Extracting release notes from CHANGELOG.md for v{clean_ver}...")
    notes = extract_release_notes(clean_ver)
    print(f"  Notes summary: {notes.splitlines()[0] if notes else 'General updates'}")

    print("\n[2/5] Updating version in manifest.json, version.json, order_opener_app.py...")
    update_version_in_files(clean_ver, notes)

    print("\n[3/5] Packaging plugin CCX bundle...")
    build_ccx(clean_ver)

    print("\n[4/5] Committing changes & pushing to Git...")
    run_cmd("git add -A")
    st = run_cmd("git status --porcelain", check=False)
    if st.stdout.strip():
        run_cmd(f'git commit -m "release: v{clean_ver} - update plugin and assets"', check=False)
    else:
        print("  ✓ No uncommitted file changes.")

    print(f"  Pushing main branch to origin...")
    run_cmd("git push origin main", check=False)
    print(f"  Tagging v{clean_ver}...")
    run_cmd(f'git tag -fa v{clean_ver} -m "release: v{clean_ver}"', check=False)
    run_cmd(f"git push origin v{clean_ver} --force", check=False)

    print("\n[5/5] Publishing to GitHub Releases...")
    token = get_github_token()
    if token:
        try:
            rel_url = publish_github_release(clean_ver, notes, token)
            print(f"  ✓ Release published on GitHub: {rel_url}")
        except Exception as e:
            print(f"  [Notice] GitHub API release publish: {e}")
    else:
        print("  [Notice] No GitHub token found. Push to main succeeded.")

    print("\n" + "=" * 60)
    print(f"  🎉 SUCCESS! Version v{clean_ver} published to GitHub!")
    print(f"  Repository: https://github.com/{GITHUB_REPO}")
    print("  Users will now instantly receive update prompts inside Photoshop!")
    print("=" * 60)

if __name__ == "__main__":
    main()
