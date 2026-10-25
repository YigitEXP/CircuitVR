"""Automated cross-platform EDA toolchain installer (Yosys, Icarus Verilog, Verilator).

Allows anyone cloning the repository from GitHub to get a complete, working EDA environment
without manual downloads or PATH configuration.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

from app.services.eda_service import tool_report, tool_status

MSYS2_REPO = "https://repo.msys2.org/mingw/mingw64/"
TOOLS_HOME = Path.home() / ".circuitvr" / "tools" / "verilator"


def _pip_install(pkg: str, logs: List[str]) -> bool:
    logs.append(f"[pip] Installing {pkg}...")
    res = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", pkg],
        capture_output=True, text=True, timeout=600,
    )
    if res.returncode == 0:
        logs.append(f"[pip] {pkg} installed successfully.")
        return True
    logs.append(f"[pip] Failed to install {pkg}: {(res.stderr or res.stdout)[-300:]}")
    return False


def _install_msys2_packages(prefixes: List[str], dest_root: Path, logs: List[str]) -> None:
    """Download and extract latest prebuilt MSYS2 mingw64 .pkg.tar.zst packages into dest_root."""
    try:
        import zstandard as zstd
    except ImportError:
        _pip_install("zstandard", logs)
        import zstandard as zstd  # type: ignore

    logs.append("[msys2] Fetching package index from repo.msys2.org...")
    req = urllib.request.Request(MSYS2_REPO, headers={"User-Agent": "CircuitVR-Installer/2.0"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", errors="ignore")

    dest_root.mkdir(parents=True, exist_ok=True)

    for prefix in prefixes:
        pattern = re.compile(rf'href="(mingw-w64-x86_64-{re.escape(prefix)}-[0-9][^\"]*\.pkg\.tar\.zst)"')
        matches = [m.group(1) for m in pattern.finditer(html) if not m.group(1).endswith(".sig")]
        if not matches:
            logs.append(f"[msys2] Package not found for {prefix}, skipping.")
            continue
        pkg_file = sorted(matches)[-1]
        url = MSYS2_REPO + pkg_file
        logs.append(f"[msys2] Downloading {pkg_file}...")
        pkg_req = urllib.request.Request(url, headers={"User-Agent": "CircuitVR-Installer/2.0"})
        compressed = urllib.request.urlopen(pkg_req, timeout=180).read()

        dctx = zstd.ZstdDecompressor()
        with dctx.stream_reader(io.BytesIO(compressed)) as reader:
            tar_bytes = io.BytesIO(reader.read())
        with tarfile.open(fileobj=tar_bytes, mode="r:") as tf:
            for member in tf.getmembers():
                if not member.name.startswith("mingw64/"):
                    continue
                rel = member.name[len("mingw64/"):]
                if not rel or ".." in Path(rel).parts:
                    continue
                target = dest_root / rel
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    src = tf.extractfile(member)
                    if src:
                        target.write_bytes(src.read())
        logs.append(f"[msys2] Extracted {pkg_file} -> {dest_root}")


def install_all_missing_tools() -> Dict[str, Any]:
    """Check which EDA tools are missing and automatically install them."""
    logs: List[str] = []
    status = tool_status()

    # 1. Yosys (cross-platform via yowasp-yosys pip package)
    if not status.get("yosys"):
        _pip_install("yowasp-yosys", logs)
    else:
        logs.append(f"[ok] yosys already installed: {status['yosys']}")

    # Refresh status
    status = tool_status()

    # 2. Icarus Verilog & Verilator
    need_iverilog = not status.get("iverilog") or not status.get("vvp")
    need_verilator = not status.get("verilator")

    if not need_iverilog and not need_verilator:
        logs.append("[ok] All EDA tools (yosys, iverilog, vvp, verilator) are ready!")
        return {"installed": True, "logs": "\n".join(logs), "tools": tool_report()}

    if os.name == "nt":
        pkgs: List[str] = ["gcc-libs", "libwinpthread-git", "zlib", "bzip2", "gmp", "mpfr", "mpc"]
        if need_iverilog:
            pkgs += ["termcap", "ncurses", "readline", "eda-iverilog"]
        if need_verilator:
            pkgs += ["verilator"]
        try:
            _install_msys2_packages(pkgs, TOOLS_HOME, logs)
        except Exception as e:
            logs.append(f"[warn] Portable MSYS2 download error: {e}")
            if need_iverilog and shutil.which("winget"):
                logs.append("[winget] Trying winget install Icarus.Verilog...")
                subprocess.run(["winget", "install", "--silent", "Icarus.Verilog"], capture_output=True, timeout=300)
    elif sys.platform == "darwin":
        if shutil.which("brew"):
            to_brew = []
            if need_iverilog:
                to_brew.append("icarus-verilog")
            if need_verilator:
                to_brew.append("verilator")
            if to_brew:
                logs.append(f"[brew] Running brew install {' '.join(to_brew)}...")
                subprocess.run(["brew", "install"] + to_brew, capture_output=True, timeout=600)
    elif sys.platform.startswith("linux"):
        if shutil.which("apt-get"):
            to_apt = []
            if need_iverilog:
                to_apt.append("iverilog")
            if need_verilator:
                to_apt.append("verilator")
            if to_apt:
                logs.append(f"[apt] Installing {' '.join(to_apt)}...")
                subprocess.run(["sudo", "-n", "apt-get", "update"], capture_output=True, timeout=120)
                subprocess.run(["sudo", "-n", "apt-get", "install", "-y"] + to_apt, capture_output=True, timeout=600)

    final_report = tool_report()
    all_ok = all(v["found"] for v in final_report.values())
    return {
        "installed": all_ok,
        "logs": "\n".join(logs),
        "tools": final_report,
    }
