"""CLI bootstrapper to check and auto-install all required EDA tools (Yosys, Icarus Verilog, Verilator)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.installer_service import install_all_missing_tools


def main() -> int:
    print("=" * 60)
    print(" CircuitVR - Otomatik EDA Arac Zinciri Kurulumu (Toolchain)")
    print("=" * 60)
    res = install_all_missing_tools()
    print(res["logs"])
    print("-" * 60)
    for name, info in res["tools"].items():
        mark = "[OK]" if info["found"] else "[MISSING]"
        print(f"  {mark:9s} {name:10s} -> {info['path'] or 'Not found'}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
