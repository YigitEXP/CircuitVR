"""Runs external EDA tools (Icarus, Verilator, Yosys) against a workspace."""
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.vhdl_service import is_vhdl, stage_vhdl_files, structural_checks_vhdl
from app.services.workspace_service import (
    CVR_DIR, ENDMODULE_RE, INSTANCE_RE, MODULE_RE, VHDL_ENTITY_RE, strip_comments,
)

_STRICT_INST_RE = re.compile(
    r"(?<![.$\w])([A-Za-z_]\w*)\s+(?:#\s*\((?:[^()]|\([^()]*\))*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?\("
)

_SV_KEYWORDS = {
    "if", "else", "for", "while", "repeat", "forever", "do", "foreach",
    "case", "casex", "casez", "unique", "priority", "always", "always_ff",
    "always_comb", "always_latch", "initial", "final", "assign", "deassign",
    "force", "release", "assert", "assume", "cover", "expect", "property",
    "sequence", "function", "task", "begin", "fork", "wait", "disable",
    "posedge", "negedge", "edge", "or", "and", "not", "xor", "nand", "nor",
    "xnor", "buf", "bufif0", "bufif1", "notif0", "notif1", "pullup", "pulldown",
    "cmos", "nmos", "pmos", "tran", "rtran", "module", "macromodule",
    "primitive", "interface", "package", "program", "checker", "class",
    "generate", "rand", "randc", "constraint", "covergroup", "clocking",
    "typedef", "struct", "union", "enum", "import", "export", "localparam",
    "parameter", "specparam", "defparam", "genvar", "input", "output", "inout",
    "ref", "wire", "reg", "logic", "bit", "byte", "shortint", "int", "longint",
    "integer", "time", "real", "shortreal", "realtime", "string", "event", "void",
}


def structural_checks(root: Path, files: List[str]) -> List[Dict[str, Any]]:
    """Pre-check SV/Verilog/VHDL files for missing endmodule/entity and undefined module instantiations."""
    diags: List[Dict[str, Any]] = structural_checks_vhdl(root, files)
    defined: set = set()
    parsed: List[tuple] = []

    for f in files:
        p = Path(f)
        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if is_vhdl(f):
            clean_v = strip_comments(raw, is_vhdl=True)
            for vm in VHDL_ENTITY_RE.finditer(clean_v):
                defined.add(vm.group(1))
            continue
        clean = strip_comments(raw)
        rel = _rel(root, f)
        mods = list(MODULE_RE.finditer(clean))
        ends = list(ENDMODULE_RE.finditer(clean))
        for m in mods:
            defined.add(m.group(1))
        if len(mods) > len(ends):
            unclosed = mods[-1].group(1)
            last_line = raw.count("\n") + 1
            diags.append({
                "severity": "error",
                "code": "ENDMODULE",
                "file": rel,
                "line": last_line,
                "column": None,
                "message": f"'module {unclosed}' kapatılmamış: dosya sonunda 'endmodule' eksik.",
            })
        parsed.append((rel, clean, mods, ends))

    for rel, clean, mods, ends in parsed:
        for idx, m in enumerate(mods):
            mod_name = m.group(1)
            end_pos = ends[idx].start() if idx < len(ends) else len(clean)
            body = clean[m.end():end_pos]
            for im in _STRICT_INST_RE.finditer(body):
                target, inst_name = im.group(1), im.group(2)
                if target in _SV_KEYWORDS or inst_name in _SV_KEYWORDS or target == mod_name:
                    continue
                if target not in defined:
                    line_no = clean.count("\n", 0, m.end() + im.start()) + 1
                    avail = sorted(d for d in defined if d != mod_name)
                    hint = f" (Projede tanımlı modüller: {', '.join(avail)})" if avail else ""
                    diags.append({
                        "severity": "error",
                        "code": "MODNOTFOUND",
                        "file": rel,
                        "line": line_no,
                        "column": None,
                        "message": f"'{target}' modülü bulunamadı (örnek adı: '{inst_name}').{hint}",
                    })
    return diags


VERILATOR_RE = re.compile(r"^%(Error|Warning)(?:-(\w+))?:\s+(.*?):(\d+)(?::(\d+))?:\s*(.*)$")
GENERIC_RE = re.compile(r"^(.*?):(\d+):\s*(?:(error|warning|sorry)[:,]?\s*)?(.*)$", re.I)


OSS_URL = "https://github.com/YosysHQ/oss-cad-suite-build/releases"

_ALIASES = {
    "yosys": ["yosys", "yowasp-yosys"],
    "iverilog": ["iverilog"],
    "vvp": ["vvp"],
    "verilator": ["verilator", "verilator_bin"],
}


def _search_dirs() -> List[str]:
    """PATH dışında araçların sık kurulduğu yerler (Windows PATH'i çoğu kez ayarlanmaz)."""
    dirs: List[str] = []
    exe_dir = Path(sys.executable).parent
    dirs += [str(exe_dir), str(exe_dir / "Scripts")]
    dirs += [d for d in os.environ.get("CIRCUITVR_TOOLS", "").split(os.pathsep) if d]
    if os.name == "nt":
        home = Path.home()
        for base in (home / ".circuitvr/tools/verilator", "C:/iverilog", "C:/Program Files/iverilog",
                     "C:/Program Files (x86)/iverilog", "C:/oss-cad-suite", "C:/tools/oss-cad-suite",
                     home / "oss-cad-suite", home / "Downloads/oss-cad-suite",
                     "C:/msys64/mingw64", "C:/msys64/ucrt64"):
            dirs += [str(Path(base) / "bin"), str(Path(base) / "lib")]
        for py_base in (home / "anaconda3", home / "miniconda3", home / "AppData/Local/Programs/Python/Python313",
                        home / "AppData/Local/Programs/Python/Python312", home / "AppData/Local/Programs/Python/Python311"):
            dirs += [str(py_base / "Scripts"), str(py_base)]
    return [d for d in dirs if Path(d).is_dir()]


def find_tool(name: str) -> Optional[str]:
    extra = os.pathsep.join(_search_dirs())
    for exe in _ALIASES.get(name, [name]):
        found = shutil.which(exe) or (shutil.which(exe, path=extra) if extra else None)
        if found:
            return found
    return None


def tool_status() -> Dict[str, Optional[str]]:
    return {t: find_tool(t) for t in ("yosys", "iverilog", "vvp", "verilator")}


def tool_report() -> Dict[str, Dict[str, Any]]:
    purposes = {
        "yosys": "şematik ve sentez analizi",
        "iverilog": "simülasyon",
        "vvp": "simülasyon (Icarus ile gelir)",
        "verilator": "gelişmiş lint (opsiyonel; iverilog yedek olur)",
    }
    out = {}
    for name, path in tool_status().items():
        out[name] = {
            "found": bool(path),
            "path": path,
            "purpose": purposes[name],
            "hint": (f"{name} bulundu: {path}" if path else
                     f"Bu araç PATH'te bulunamadı ({purposes[name]}). Lütfen OSS CAD Suite kurun: {OSS_URL}"),
        }
    return out


def _rel(root: Path, file: str) -> str:
    try:
        return Path(file).resolve().relative_to(root).as_posix()
    except (ValueError, OSError):
        return file.replace("\\", "/")


def parse_diagnostics(root: Path, text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = VERILATOR_RE.match(line)
        if m:
            sev, code, file, ln, col, msg = m.groups()
            out.append({
                "severity": sev.lower(), "code": code, "file": _rel(root, file),
                "line": int(ln), "column": int(col) if col else None, "message": msg,
            })
            continue
        m = GENERIC_RE.match(line)
        if m and (m.group(3) or "syntax" in line or "error" in line.lower()):
            file, ln, sev, msg = m.groups()
            if not Path(file).suffix or "__cvr_dump" in file:
                continue
            out.append({
                "severity": "warning" if sev and sev.lower() == "warning" else "error",
                "code": None, "file": _rel(root, file), "line": int(ln), "column": None,
                "message": msg or line,
            })
    return out


def _run(cmd: List[str], cwd: Path, timeout: int):
    env = os.environ.copy()
    if cmd and "verilator" in Path(cmd[0]).name.lower() and "VERILATOR_ROOT" not in env:
        vroot = Path(cmd[0]).resolve().parent.parent / "share" / "verilator"
        if vroot.is_dir():
            env["VERILATOR_ROOT"] = str(vroot)
    try:
        return subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True,
                              timeout=timeout, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired as e:
        return e


def _stage_enum_name_fix(root: Path, build: Path, files: List[str]) -> List[str]:
    """Icarus Verilog 12 bug workaround: <net>.name() fails when <net> is wired to a submodule output port.
    Rewrites <sig>.name() -> <inst>.<port>.name() in a staged copy inside .circuitvr/build/."""
    staged: List[str] = []
    for f in files:
        p = Path(f)
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            staged.append(_rel(root, f))
            continue
        if ".name()" not in text:
            staged.append(_rel(root, f))
            continue
        clean = strip_comments(text)
        port_map: Dict[str, str] = {}
        for im in _STRICT_INST_RE.finditer(clean):
            mod_t, inst = im.group(1), im.group(2)
            if mod_t in _SV_KEYWORDS or inst in _SV_KEYWORDS:
                continue
            rest = clean[im.end():]
            for pm in re.finditer(r"\.\s*(\w+)\s*\(\s*(\w+)\s*\)", rest.split(";")[0]):
                port_map[pm.group(2)] = f"{inst}.{pm.group(1)}"
        new_text = text
        for sig, hier in port_map.items():
            new_text = re.sub(rf"(?<!\.)\b{re.escape(sig)}\s*\.\s*name\s*\(\s*\)", f"{hier}.name()", new_text)
        if new_text != text:
            out_p = build / f"__staged_{p.name}"
            out_p.write_text(new_text, encoding="utf-8")
            staged.append(_rel(root, str(out_p)))
        else:
            staged.append(_rel(root, f))
    return staged


def simulate(root: Path, files: List[str], inc_dirs: List[str], tb_top: str,
             max_time_ns: int = 10000, timeout: int = 60) -> Dict[str, Any]:
    tools = tool_status()
    if not tools["iverilog"] or not tools["vvp"]:
        return {"success": False, "missing_tool": "iverilog", "log": "",
                "diagnostics": [], "vcd": None,
                "error": "Icarus Verilog (iverilog/vvp) kurulu değil veya PATH'te yok."}

    pre_diags = structural_checks(root, files)
    if any(d["severity"] == "error" for d in pre_diags):
        msg = "\n".join(f"{d['file']}:{d['line']}: {d['message']}" for d in pre_diags)
        return {"success": False, "stage": "compile", "log": msg,
                "diagnostics": pre_diags, "vcd": None,
                "error": pre_diags[0]["message"], "duration": 0.0}

    build = root / CVR_DIR / "build"
    build.mkdir(parents=True, exist_ok=True)
    vvp_out = build / "sim.vvp"
    vcd = build / "wave.vcd"
    for stale in (vvp_out, vcd):
        if stale.exists():
            stale.unlink()

    # Auto-dump wrapper placed FIRST and without `timescale so it never triggers inside-module errors
    wrapper = build / "__cvr_dump.sv"
    wrapper.write_text(
        "module __cvr_dump;\n"
        "  initial begin\n"
        f"    $dumpfile(\"wave.vcd\");\n    $dumpvars(0, {tb_top});\n"
        f"    #{int(max_time_ns)} $finish;\n"
        "  end\nendmodule\n", encoding="utf-8")

    staged_vhdl = stage_vhdl_files(build, files)
    rel_files = _stage_enum_name_fix(root, build, staged_vhdl)
    rel_incs = [_rel(root, d) or "." for d in inc_dirs]
    cmd = [tools["iverilog"], "-g2012", "-Wall", "-Wno-timescale", "-o", _rel(root, str(vvp_out)),
           "-s", tb_top, "-s", "__cvr_dump"]
    for d in rel_incs:
        cmd += ["-I", d]
    cmd += [_rel(root, str(wrapper))] + rel_files

    t0 = time.time()
    comp = _run(cmd, root, 60)
    if isinstance(comp, subprocess.TimeoutExpired) or comp.returncode != 0:
        text = "Derleme zaman aşımı" if isinstance(comp, subprocess.TimeoutExpired) else (comp.stderr + comp.stdout)
        diags = pre_diags + parse_diagnostics(root, text)
        return {"success": False, "stage": "compile", "log": text,
                "diagnostics": diags, "vcd": None,
                "error": diags[0]["message"] if diags else "Derleme başarısız", "duration": time.time() - t0}

    comp_diags = pre_diags + parse_diagnostics(root, comp.stderr)
    run = _run([tools["vvp"], str(vvp_out)], build, timeout)
    timed_out = isinstance(run, subprocess.TimeoutExpired)
    stdout = (run.stdout or b"") if timed_out else run.stdout
    stderr = (run.stderr or b"") if timed_out else run.stderr
    if isinstance(stdout, bytes):
        stdout = stdout.decode("utf-8", "replace")
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", "replace")
    log = stdout + (("\n" + stderr) if stderr else "")
    return {
        "success": (not timed_out) and run.returncode == 0,
        "stage": "run",
        "log": log,
        "diagnostics": comp_diags,
        "vcd": vcd.relative_to(root).as_posix() if vcd.exists() else None,
        "error": f"Simülasyon {timeout}s sonra durduruldu" if timed_out else (stderr.strip() if run.returncode != 0 else None),
        "duration": time.time() - t0,
        "max_time_ns": max_time_ns,
    }


def lint(root: Path, files: List[str], inc_dirs: List[str], top: Optional[str]) -> Dict[str, Any]:
    tools = tool_status()
    pre_diags = structural_checks(root, files)
    build = root / CVR_DIR / "build"
    staged_files = stage_vhdl_files(build, files) if any(is_vhdl(f) for f in files) else files
    rel_files = [_rel(root, f) for f in staged_files]
    rel_incs = [_rel(root, d) or "." for d in inc_dirs]
    if tools["verilator"]:
        cmd = [
            tools["verilator"], "--lint-only", "-Wall", "--timing", "-sv",
            "-Wno-EOFNEWLINE", "-Wno-DECLFILENAME", "-Wno-UNDRIVEN", "-Wno-UNUSED",
        ]
        if top:
            cmd += ["--top-module", top]
        for d in rel_incs:
            cmd.append(f"-I{d}")
        res = _run(cmd + rel_files, root, 60)
        tool = "verilator"
    elif tools["iverilog"]:
        cmd = [tools["iverilog"], "-g2012", "-Wall", "-Wno-timescale", "-t", "null"]
        if top:
            cmd += ["-s", top]
        for d in rel_incs:
            cmd += ["-I", d]
        res = _run(cmd + rel_files, root, 60)
        tool = "iverilog"
    else:
        return {"tool": None, "diagnostics": pre_diags, "success": False,
                "error": "Lint için Verilator veya Icarus Verilog gerekli."}
    if isinstance(res, subprocess.TimeoutExpired):
        return {"tool": tool, "diagnostics": pre_diags, "success": False, "error": "Lint zaman aşımı"}
    text = res.stderr + res.stdout
    diags = list(pre_diags)
    seen = {(d["file"], d["line"], d["message"]) for d in diags}
    for d in parse_diagnostics(root, text):
        key = (d["file"], d["line"], d["message"])
        if key not in seen:
            seen.add(key)
            diags.append(d)
    return {
        "tool": tool, "diagnostics": diags, "success": True, "raw": text,
        "errors": sum(d["severity"] == "error" for d in diags),
        "warnings": sum(d["severity"] == "warning" for d in diags),
    }


_STAT_A = re.compile(r"^\s*(\d+)\s+(\$\S+)\s*$")
_STAT_B = re.compile(r"^\s*(\$\S+)\s+(\d+)\s*$")


def synth_stats(root: Path, files: List[str], top: str, lut_size: int = 6) -> Dict[str, Any]:
    tools = tool_status()
    if not tools["yosys"]:
        return {"success": False, "error": "Yosys kurulu değil veya PATH'te yok."}
    build = root / CVR_DIR / "build"
    build.mkdir(parents=True, exist_ok=True)
    stat_txt = build / "stat.txt"
    ltp_txt = build / "ltp.txt"
    for f in (stat_txt, ltp_txt):
        if f.exists():
            f.unlink()

    staged_files = stage_vhdl_files(build, files) if any(is_vhdl(f) for f in files) else files
    cmds = [f'read_verilog -sv "{Path(f).as_posix()}"' for f in staged_files]
    cmds += [
        f"hierarchy -check -top {top}",
        f"synth -top {top} -flatten -lut {lut_size}",
        f'tee -o "{stat_txt.as_posix()}" stat',
        f'tee -o "{ltp_txt.as_posix()}" ltp -noff',
    ]
    res = _run([tools["yosys"], "-q", "-p", "; ".join(cmds)], root, 180)
    if isinstance(res, subprocess.TimeoutExpired):
        return {"success": False, "error": "Yosys zaman aşımı"}
    if res.returncode != 0:
        return {"success": False, "error": (res.stderr or res.stdout).strip()}

    cells: Dict[str, int] = {}
    for line in (stat_txt.read_text(errors="replace") if stat_txt.exists() else "").splitlines():
        m = _STAT_A.match(line)
        if m:
            cells[m.group(2)] = int(m.group(1))
            continue
        m = _STAT_B.match(line)
        if m:
            cells[m.group(1)] = int(m.group(2))

    luts = sum(v for k, v in cells.items() if k.startswith("$lut"))
    ffs = sum(v for k, v in cells.items() if re.match(r"\$_(S?DFF|DLATCH|ALDFF|DFFSR)", k) or k.startswith("$_DFF"))
    mem = sum(v for k, v in cells.items() if k.startswith("$mem"))
    other_gates = sum(v for k, v in cells.items() if k.startswith("$_") and k not in ())  - ffs
    depth = None
    if ltp_txt.exists():
        m = re.search(r"length=(\d+)", ltp_txt.read_text(errors="replace"))
        depth = int(m.group(1)) if m else None
    return {
        "success": True, "top": top, "lut_size": lut_size,
        "luts": luts, "ffs": ffs, "mem": mem, "other_gates": max(other_gates, 0),
        "logic_depth": depth, "cells": cells,
        "note": f"Yosys generic synth + {lut_size}-LUT mapping. Vendor aracı kadar kesin değildir; DSP/BRAM çıkarımı yapılmaz.",
    }
