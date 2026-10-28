from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.services import eda_service, workspace_service as ws
from app.services.fsm_service import extract_workspace_fsms
from app.services.optimizer_service import analyze_optimizations, apply_optimization_autofix, insert_ignore_pragma
from app.services.schematic_service import build_schematic
from app.services.vcd_parser import parse_vcd
from app.services.yosys_service import YosysService

import os

router = APIRouter()
yosys_service = YosysService()
if os.environ.get("VERCEL"):
    UPLOAD_ROOT = Path("/tmp/circuitvr_uploads/workspaces")
else:
    UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "uploads" / "workspaces"


class PathReq(BaseModel):
    path: str


class FileReq(BaseModel):
    path: str
    file: str


class SaveReq(FileReq):
    content: str


class SchematicReq(BaseModel):
    path: str
    top: Optional[str] = None
    flatten: bool = False


class SimReq(BaseModel):
    path: str
    tb_top: str
    max_time_ns: int = 10000


class LintReq(BaseModel):
    path: str
    top: Optional[str] = None


class WaveReq(BaseModel):
    path: str
    vcd: str = ".circuitvr/build/wave.vcd"


def _root(path: str) -> Path:
    try:
        return ws.resolve_root(path)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/tools")
def tools():
    return eda_service.tool_report()


@router.post("/install-yosys-wasm")
def install_yosys_wasm():
    """Küçük (~17MB) alternatif: Yosys'i pip paketi (yowasp-yosys) olarak kur."""
    import subprocess
    import sys
    res = subprocess.run([sys.executable, "-m", "pip", "install", "yowasp-yosys"],
                         capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        raise HTTPException(500, (res.stderr or res.stdout)[-800:])
    return {"installed": True, "tools": eda_service.tool_report()}


@router.post("/install-all-tools")
def install_all_tools():
    """Tüm eksik EDA araçlarını (Yosys, Icarus Verilog, Verilator) otomatik indirir ve kurar."""
    from app.services.installer_service import install_all_missing_tools
    return install_all_missing_tools()


@router.get("/recent")
def recent():
    return {"recent": ws.load_recent()}


@router.get("/listdir")
def listdir(path: str = ""):
    """Uygulama içi klasör gezgini (backend yerel makinede çalışır)."""
    import os
    if not path:
        entries = []
        if os.name == "nt":
            import string
            entries = [{"name": f"{d}:", "path": f"{d}:\\"} for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
        home = Path.home()
        entries.insert(0, {"name": "Ana klasör", "path": str(home)})
        for sub in ("Desktop", "Masaüstü", "Documents", "Belgeler", "Downloads", "İndirilenler"):
            if (home / sub).is_dir():
                entries.append({"name": sub, "path": str(home / sub)})
        return {"path": "", "parent": None, "dirs": entries, "is_project": False}
    p = Path(path).expanduser()
    if not p.is_dir():
        raise HTTPException(404, f"Klasör bulunamadı: {path}")
    dirs = []
    try:
        with os.scandir(p) as it:  # scandir: girdi türünü ekstra stat olmadan verir (OneDrive'da hızlı)
            for c in it:
                try:
                    if c.is_dir(follow_symlinks=False) and not c.name.startswith((".", "$")):
                        dirs.append({"name": c.name, "path": c.path})
                except OSError:
                    continue  # korumalı/bozuk bağlantı noktaları atlanır
    except PermissionError:
        raise HTTPException(403, "Bu klasöre erişim izni yok")
    dirs.sort(key=lambda d: d["name"].lower())
    parent = str(p.parent) if p.parent != p else ""
    is_project = any((p / d).is_dir() for d in ("rtl", "tb"))
    return {"path": str(p), "parent": parent, "dirs": dirs, "is_project": is_project}


@router.post("/upload")
async def upload(
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
    name: str = Form("upload"),
    root: Optional[str] = Form(None),
):
    """Dosya/klasör yükle; rtl/ ve tb/ yapısına otomatik yerleştirir."""
    import re as _re
    if len(files) != len(paths):
        raise HTTPException(400, "files ve paths sayısı eşleşmiyor")
    if root:
        target = _root(root)
    else:
        safe = _re.sub(r"[^\w.\- ]", "_", name).strip() or "upload"
        target = UPLOAD_ROOT / safe
        target.mkdir(parents=True, exist_ok=True)
        target = target.resolve()
    saved = 0
    for f, rel in zip(files, paths):
        parts = [x for x in Path(rel.replace("\\", "/")).parts if x not in ("", ".", "..", "/")]
        if not parts or Path(parts[-1]).suffix.lower() not in ws.HDL_EXT | ws.HEADER_EXT:
            continue
        lowered = {x.lower() for x in parts[:-1]}
        if not (lowered & (ws.RTL_DIRS | ws.TB_DIRS)):
            parts = [ws._classify(Path(*parts))] + parts
        dest = ws.resolve_in(target, "/".join(parts))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(await f.read())
        saved += 1
    if saved == 0:
        raise HTTPException(400, "Geçerli .sv/.v/.svh/.vh dosyası bulunamadı")
    ws.add_recent(str(target))
    return ws.scan_workspace(str(target))


@router.post("/browse")
def browse():
    """Native klasör seçici (Windows: PowerShell; diğer: tkinter)."""
    import os
    import subprocess
    if os.name == "nt":
        script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$f=New-Object System.Windows.Forms.Form;$f.TopMost=$true;$f.ShowInTaskbar=$false;"
            "$f.StartPosition='CenterScreen';$f.Opacity=0;$f.Show();"
            "$d=New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$d.Description='Proje klasörünü seçin';"
            "if($d.ShowDialog($f) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8;Write-Output $d.SelectedPath};$f.Close()"
        )
        try:
            res = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", script],
                                 capture_output=True, text=True, timeout=300, encoding="utf-8", errors="replace")
            return {"path": res.stdout.strip() or None}
        except Exception as e:
            raise HTTPException(501, f"Klasör seçici açılamadı ({e})")
    try:
        import tkinter
        from tkinter import filedialog
        tk = tkinter.Tk()
        tk.withdraw()
        tk.attributes("-topmost", True)
        chosen = filedialog.askdirectory(title="Proje klasörünü seçin")
        tk.destroy()
        return {"path": chosen or None}
    except Exception as e:
        raise HTTPException(501, f"Klasör seçici açılamadı ({e})")


@router.post("/open")
def open_workspace(req: PathReq):
    root = _root(req.path)
    result = ws.scan_workspace(str(root))
    ws.add_recent(str(root))
    return result


@router.post("/create")
def create_workspace(req: PathReq):
    try:
        result = ws.create_project(req.path)
    except OSError as e:
        raise HTTPException(500, f"Proje oluşturulamadı: {e}")
    ws.add_recent(result["root"])
    return result


@router.get("/fingerprint")
def fingerprint(path: str):
    return {"fingerprint": ws.fingerprint(_root(path))}


@router.post("/file")
def read_file(req: FileReq):
    root = _root(req.path)
    try:
        p = ws.resolve_in(root, req.file)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if not p.is_file():
        raise HTTPException(404, "Dosya bulunamadı")
    return {"file": req.file, "content": p.read_text(encoding="utf-8", errors="replace")}


@router.put("/file")
def save_file(req: SaveReq):
    root = _root(req.path)
    try:
        p = ws.resolve_in(root, req.file)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if p.suffix.lower() not in ws.HDL_EXT | ws.HEADER_EXT:
        raise HTTPException(400, "Sadece SystemVerilog/Verilog dosyaları kaydedilebilir")
    p.write_text(req.content, encoding="utf-8", newline="")
    return {"saved": True, "fingerprint": ws.fingerprint(root)}


@router.post("/schematic")
def schematic(req: SchematicReq):
    root = _root(req.path)
    files = ws.compile_files(root, groups=("rtl",))
    if not files:
        raise HTTPException(400, "rtl/ klasöründe derlenecek dosya yok")
    try:
        netlist = yosys_service.generate_netlist(files, req.top, flatten=req.flatten)
        return {"schematic": build_schematic(netlist, req.top), "success": True}
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.post("/simulate")
def simulate(req: SimReq):
    root = _root(req.path)
    files = ws.compile_files(root, groups=("rtl", "tb"))
    return eda_service.simulate(root, files, ws.include_dirs(root), req.tb_top, req.max_time_ns)


@router.post("/lint")
def lint(req: LintReq):
    root = _root(req.path)
    files = ws.compile_files(root, groups=("rtl", "tb"))
    return eda_service.lint(root, files, ws.include_dirs(root), req.top)


@router.post("/synth-stats")
def synth_stats(req: LintReq):
    if not req.top:
        raise HTTPException(400, "Top modül gerekli")
    root = _root(req.path)
    files = ws.compile_files(root, groups=("rtl",))
    stats = eda_service.synth_stats(root, files, req.top)
    stats["optimization"] = analyze_optimizations(root, files, req.top, stats)
    return stats


@router.post("/optimize")
def optimize(req: LintReq):
    root = _root(req.path)
    files = ws.compile_files(root, groups=("rtl",))
    return analyze_optimizations(root, files, req.top)


class AutoFixReq(BaseModel):
    path: str
    file: str
    line: int = 1
    before: str
    after: str


@router.post("/optimize/autofix")
def optimize_autofix(req: AutoFixReq):
    root = _root(req.path)
    try:
        p = ws.resolve_in(root, req.file)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if not p.is_file():
        raise HTTPException(404, f"Dosya bulunamadı: {req.file}")
    raw = p.read_text(encoding="utf-8", errors="replace")
    res = apply_optimization_autofix(raw, req.line, req.before, req.after)
    if res["applied"]:
        p.write_text(res["content"], encoding="utf-8", newline="")
    files = ws.compile_files(root, groups=("rtl",))
    return {
        "applied": res["applied"],
        "file": req.file,
        "content": res["content"],
        "fingerprint": ws.fingerprint(root),
        "optimization": analyze_optimizations(root, files),
    }


class IgnoreRuleReq(BaseModel):
    path: str
    file: str
    line: int = 1
    rule_id: str


@router.post("/optimize/ignore")
def optimize_ignore(req: IgnoreRuleReq):
    root = _root(req.path)
    try:
        p = ws.resolve_in(root, req.file)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if not p.is_file():
        raise HTTPException(404, f"Dosya bulunamadı: {req.file}")
    raw = p.read_text(encoding="utf-8", errors="replace")
    is_vhdl = p.suffix.lower() in (".vhd", ".vhdl")
    res = insert_ignore_pragma(raw, req.line, req.rule_id, is_vhdl=is_vhdl)
    if res["applied"]:
        p.write_text(res["content"], encoding="utf-8", newline="")
    files = ws.compile_files(root, groups=("rtl",))
    return {
        "applied": res["applied"],
        "file": req.file,
        "content": res["content"],
        "fingerprint": ws.fingerprint(root),
        "optimization": analyze_optimizations(root, files),
    }


@router.post("/fsm")
def extract_fsm(req: LintReq):
    root = _root(req.path)
    files = ws.compile_files(root, groups=("rtl",))
    return extract_workspace_fsms(root, files, req.top)


@router.post("/wave")
def wave(req: WaveReq):
    root = _root(req.path)
    try:
        p = ws.resolve_in(root, req.vcd)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if not p.is_file():
        raise HTTPException(404, "VCD yok; önce simülasyon çalıştırın")
    return parse_vcd(str(p))


class EdgeAiReq(BaseModel):
    path: Optional[str] = None
    weights: List[float] = [-0.125, -0.25, 0.375, 0.875, 0.375, -0.25, -0.125]
    bias: float = 0.0
    int_bits: int = 2
    frac_bits: int = 6
    rounding: str = "round"
    stimulus: str = "ecg"
    custom_signal: Optional[List[float]] = None
    activation: str = "relu"
    threshold: float = 0.45
    clock_mhz: float = 100.0
    reuse_factor: int = 1
    target_mode: str = "preset"
    custom_rtl_file: Optional[str] = None
    module_name: Optional[str] = None


@router.post("/edge-ai/inspect-rtl")
def edge_ai_inspect_rtl(req: FileReq):
    from app.services.edge_ai_service import inspect_workspace_rtl
    root = _root(req.path)
    try:
        p = ws.resolve_in(root, req.file)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if not p.is_file():
        raise HTTPException(404, f"RTL dosyası bulunamadı: {req.file}")
    text = p.read_text(encoding="utf-8", errors="replace")
    return inspect_workspace_rtl(text, req.file)


@router.post("/edge-ai/analyze")
def edge_ai_analyze(req: EdgeAiReq):
    from app.services.edge_ai_service import analyze_edge_ai
    payload = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    return analyze_edge_ai(payload)


@router.post("/edge-ai/generate")
def edge_ai_generate(req: EdgeAiReq):
    from app.services.edge_ai_service import generate_edge_ai_rtl, inspect_workspace_rtl
    payload = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    detected_rtl = None
    root = None

    if req.path and not req.path.startswith(("demo://", "cloud://")):
        root = _root(req.path)
        if req.custom_rtl_file:
            try:
                rtl_cand = ws.resolve_in(root, req.custom_rtl_file)
                if rtl_cand.is_file():
                    detected_rtl = inspect_workspace_rtl(
                        rtl_cand.read_text(encoding="utf-8", errors="replace"),
                        req.custom_rtl_file,
                    )
            except Exception:
                detected_rtl = None

    gen = generate_edge_ai_rtl(payload, detected_rtl=detected_rtl)

    if root is not None:
        rtl_dir = root / "rtl" if (root / "rtl").is_dir() or not (root / "RTL").is_dir() else (root / "RTL")
        tb_dir = root / "tb" if (root / "tb").is_dir() or not (root / "TB").is_dir() else (root / "TB")
        rtl_dir.mkdir(parents=True, exist_ok=True)
        tb_dir.mkdir(parents=True, exist_ok=True)

        if gen.get("target_mode") == "custom_tb_only" and detected_rtl:
            tb_p = tb_dir / f"{gen['tb_module']}.sv"
            tb_p.write_text(gen["tb_code"], encoding="utf-8", newline="")
            gen["rtl_file"] = detected_rtl["file"]
            gen["tb_file"] = tb_p.relative_to(root).as_posix()
        else:
            mod_name = gen.get("top_module", "conv1d_biosignal")
            tb_mod = gen.get("tb_module", f"tb_{mod_name}")
            rtl_p = rtl_dir / f"{mod_name}.sv"
            tb_p = tb_dir / f"{tb_mod}.sv"
            rtl_p.write_text(gen["rtl_code"], encoding="utf-8", newline="")
            tb_p.write_text(gen["tb_code"], encoding="utf-8", newline="")
            gen["rtl_file"] = rtl_p.relative_to(root).as_posix()
            gen["tb_file"] = tb_p.relative_to(root).as_posix()

        gen["workspace"] = ws.scan_workspace(str(root))
    return gen
