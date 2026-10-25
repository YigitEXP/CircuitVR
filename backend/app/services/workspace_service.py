"""Workspace model: a project folder with rtl/ and tb/ sub-folders, read in place."""
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

HDL_EXT = {".sv", ".v", ".vhd", ".vhdl"}
HEADER_EXT = {".svh", ".vh"}
SKIP_DIRS = {".circuitvr", ".git", "node_modules", "__pycache__", "obj_dir", "sim_build", ".Xil"}
RTL_DIRS = {"rtl", "src", "design", "hdl", "source", "sources", "vhdl"}
TB_DIRS = {"tb", "test", "tests", "testbench", "testbenches", "sim", "verif", "bench"}
CVR_DIR = ".circuitvr"

MODULE_RE = re.compile(r"\b(?:module|macromodule)\s+(?:automatic\s+|static\s+)?(\w+)")
ENDMODULE_RE = re.compile(r"\bendmodule\b")
VHDL_ENTITY_RE = re.compile(r"\bentity\s+(\w+)\s+is\b", re.I)
VHDL_ARCH_RE = re.compile(r"\barchitecture\s+\w+\s+of\s+(\w+)\s+is\b(.*?)\bend\s+(?:architecture\b|\w+)?\s*;", re.I | re.S)
VHDL_PORTMAP_RE = re.compile(r"\b\w+\s*:\s*(?:entity\s+(?:\w+\.)?(\w+)|(\w+))\s*(?:generic\s+map\s*\(.*?\)\s*)?port\s+map\s*\(", re.I | re.S)
PACKAGE_RE = re.compile(r"\bpackage\s+(?:automatic\s+|static\s+)?(\w+)\s*(?:;|is\b)", re.I)
INTERFACE_RE = re.compile(r"\binterface\s+(?:automatic\s+)?(\w+)")
INSTANCE_RE = re.compile(
    r"(?<![.$\w])([A-Za-z_]\w*)\s+(?:#\s*\((?:[^()]|\([^()]*\))*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?\("
)
_COMMENT_RE = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
_VHDL_COMMENT_RE = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)

RECENT_FILE = Path.home() / CVR_DIR / "recent.json"


def strip_comments(text: str, is_vhdl: bool = False) -> str:
    """Remove comments but keep line numbering intact."""
    rx = _VHDL_COMMENT_RE if is_vhdl else _COMMENT_RE
    return rx.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def resolve_root(path: str) -> Path:
    root = Path(path).expanduser()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Klasör bulunamadı: {path}")
    return root.resolve()


def resolve_in(root: Path, rel: str) -> Path:
    """Resolve a project-relative path, refusing to escape the workspace."""
    p = (root / rel).resolve()
    if root != p and root not in p.parents:
        raise PermissionError("Path is outside the workspace")
    return p


def _classify(rel: Path) -> str:
    parts = [x.lower() for x in rel.parts[:-1]]
    for part in parts:
        if part in TB_DIRS:
            return "tb"
        if part in RTL_DIRS:
            return "rtl"
    stem = rel.stem.lower()
    if stem.startswith("tb_") or stem.endswith("_tb") or stem.startswith("tb") and stem[2:3] in ("", "_") or "testbench" in stem:
        return "tb"
    return "rtl"


def _iter_files(root: Path):
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if p.suffix.lower() in HDL_EXT | HEADER_EXT:
            yield p, rel


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def scan_workspace(path: str) -> Dict[str, Any]:
    root = resolve_root(path)
    files: List[Dict[str, Any]] = []
    sources: Dict[str, str] = {}

    for p, rel in _iter_files(root):
        text = _read(p)
        ext = p.suffix.lower()
        vhdl = ext in {".vhd", ".vhdl"}
        clean = strip_comments(text, is_vhdl=vhdl)
        sources[rel.as_posix()] = clean
        st = p.stat()
        lang = "vhdl" if vhdl else ("v" if ext in {".v", ".vh"} else "sv")
        files.append({
            "path": rel.as_posix(),
            "name": p.name,
            "lang": lang,
            "group": _classify(rel),
            "is_header": ext in HEADER_EXT,
            "size": st.st_size,
            "mtime": st.st_mtime_ns,
            "lines": text.count("\n") + 1,
            "modules": [],
            "packages": [m.group(1) for m in PACKAGE_RE.finditer(clean)],
            "interfaces": [m.group(1) for m in INTERFACE_RE.finditer(clean)] if not vhdl else [],
        })

    # Pass 1: module / VHDL entity definitions
    modules: Dict[str, Dict[str, Any]] = {}
    spans: Dict[str, tuple] = {}  # module -> (file, body, is_vhdl)
    for f in files:
        clean = sources[f["path"]]
        if f.get("lang") == "vhdl":
            arch_bodies = {am.group(1).lower(): am.group(2) for am in VHDL_ARCH_RE.finditer(clean)}
            for m in VHDL_ENTITY_RE.finditer(clean):
                name = m.group(1)
                line = clean.count("\n", 0, m.start()) + 1
                f["modules"].append({"name": name, "line": line})
                modules[name] = {
                    "name": name, "file": f["path"], "line": line, "group": f["group"],
                    "instances": [], "instantiated_by": [],
                }
                spans[name] = (f["path"], arch_bodies.get(name.lower(), ""), True)
        else:
            ends = [m.start() for m in ENDMODULE_RE.finditer(clean)]
            for m in MODULE_RE.finditer(clean):
                name = m.group(1)
                line = clean.count("\n", 0, m.start()) + 1
                end = next((e for e in ends if e > m.start()), len(clean))
                f["modules"].append({"name": name, "line": line})
                modules[name] = {
                    "name": name, "file": f["path"], "line": line, "group": f["group"],
                    "instances": [], "instantiated_by": [],
                }
                spans[name] = (f["path"], clean[m.end():end], False)

    # Pass 2: instantiations
    mod_lookup = {k.lower(): k for k in modules}
    for name, (_, body, vhdl) in spans.items():
        seen = []
        if vhdl:
            for im in VHDL_PORTMAP_RE.finditer(body):
                raw_t = (im.group(1) or im.group(2) or "").lower()
                target = mod_lookup.get(raw_t)
                if target and target != name and target not in seen:
                    seen.append(target)
        else:
            for im in INSTANCE_RE.finditer(body):
                target = im.group(1)
                if target in modules and target != name and target not in seen:
                    seen.append(target)
        modules[name]["instances"] = seen
        for t in seen:
            modules[t]["instantiated_by"].append(name)

    def descendants(n: str, acc: Optional[set] = None) -> set:
        acc = acc if acc is not None else set()
        for c in modules[n]["instances"]:
            if c not in acc:
                acc.add(c)
                descendants(c, acc)
        return acc

    rtl_tops = [
        n for n, m in modules.items()
        if m["group"] == "rtl" and not any(modules[p]["group"] == "rtl" for p in m["instantiated_by"])
    ]
    rtl_tops.sort(key=lambda n: -len(descendants(n)))
    tb_tops = [n for n, m in modules.items() if m["group"] == "tb" and not m["instantiated_by"]]

    default_top = rtl_tops[0] if rtl_tops else None
    default_tb = None
    for tb in tb_tops:
        if default_top and (default_top in modules[tb]["instances"] or default_top in descendants(tb)):
            default_tb = tb
            break
    if default_tb is None and tb_tops:
        default_tb = tb_tops[0]
    # Testbench wins when it instantiates a different rtl module than the guessed top
    if default_tb:
        direct = [c for c in modules[default_tb]["instances"] if modules[c]["group"] == "rtl"]
        if direct and default_top not in direct:
            default_top = max(direct, key=lambda n: len(descendants(n)))

    for m in modules.values():
        m["children"] = len(descendants(m["name"]))

    warnings = []
    names = [m["name"] for f in files for m in f["modules"]]
    for dup in {n for n in names if names.count(n) > 1}:
        warnings.append(f"Modül birden fazla dosyada tanımlı: {dup}")
    if not any(f["group"] == "rtl" and not f["is_header"] for f in files):
        warnings.append("rtl/ klasöründe SystemVerilog dosyası bulunamadı")
    if not tb_tops:
        warnings.append("Testbench bulunamadı (tb/ klasörü veya tb_*.sv)")

    return {
        "root": str(root),
        "name": root.name,
        "files": files,
        "modules": modules,
        "rtl_tops": rtl_tops,
        "tb_tops": tb_tops,
        "default_top": default_top,
        "default_tb": default_tb,
        "has_rtl_dir": any((root / d).is_dir() for d in RTL_DIRS),
        "has_tb_dir": any((root / d).is_dir() for d in TB_DIRS),
        "fingerprint": fingerprint(root),
        "warnings": warnings,
    }


def fingerprint(root: Path) -> str:
    h = hashlib.sha1()
    for p, rel in _iter_files(root):
        st = p.stat()
        h.update(f"{rel.as_posix()}|{st.st_mtime_ns}|{st.st_size}\n".encode())
    return h.hexdigest()


def compile_files(root: Path, groups=("rtl",), include_headers=False) -> List[str]:
    """Absolute paths in compile order: packages first, then everything else."""
    pkgs, rest = [], []
    for p, rel in _iter_files(root):
        if p.suffix.lower() in HEADER_EXT and not include_headers:
            continue
        if p.suffix.lower() in HEADER_EXT:
            continue  # headers are reached through -I include dirs
        if _classify(rel) not in groups:
            continue
        (pkgs if PACKAGE_RE.search(strip_comments(_read(p))) else rest).append(str(p))
    return pkgs + rest


def include_dirs(root: Path) -> List[str]:
    dirs = {str(p.parent) for p, _ in _iter_files(root) if p.suffix.lower() in HEADER_EXT}
    return sorted(dirs | {str(root)})


# ---- recent projects ----
def load_recent() -> List[str]:
    items: List[str] = []
    try:
        items = [p for p in json.loads(RECENT_FILE.read_text(encoding="utf-8")) if Path(p).is_dir()]
    except (OSError, ValueError):
        pass
    if not items:
        ex_root = Path(__file__).resolve().parent.parent.parent.parent / "examples"
        if ex_root.is_dir():
            items = [str(d) for d in sorted(ex_root.iterdir()) if d.is_dir()]
    return items


def add_recent(path: str) -> None:
    items = [p for p in load_recent() if p != path]
    items.insert(0, path)
    try:
        RECENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        RECENT_FILE.write_text(json.dumps(items[:10]), encoding="utf-8")
    except OSError:
        pass


# ---- scaffold ----
_EXAMPLE_RTL = """// Example design - replace with your own
module counter #(parameter WIDTH = 4) (
    input  logic             clk,
    input  logic             rst_n,
    input  logic             en,
    output logic [WIDTH-1:0] count
);
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)      count <= '0;
        else if (en)     count <= count + 1'b1;
    end
endmodule
"""

_EXAMPLE_TB = """`timescale 1ns/1ps
module tb_counter;
    logic       clk = 0, rst_n = 0, en = 0;
    logic [3:0] count;

    counter #(.WIDTH(4)) dut (.clk(clk), .rst_n(rst_n), .en(en), .count(count));

    always #5 clk = ~clk;

    initial begin
        #22 rst_n = 1;
        #10 en = 1;
        #200 en = 0;
        #40 $finish;
    end
endmodule
"""


def create_project(path: str) -> Dict[str, Any]:
    root = Path(path).expanduser()
    (root / "rtl").mkdir(parents=True, exist_ok=True)
    (root / "tb").mkdir(parents=True, exist_ok=True)
    if not any((root / "rtl").iterdir()) and not any((root / "tb").iterdir()):
        (root / "rtl" / "counter.sv").write_text(_EXAMPLE_RTL, encoding="utf-8")
        (root / "tb" / "tb_counter.sv").write_text(_EXAMPLE_TB, encoding="utf-8")
    return scan_workspace(str(root))
