"""VHDL parser, structural linter, and synthesizable VHDL-to-SystemVerilog bridge.

Allows CircuitVR to scan, lint, synthesize (via Yosys), draw schematics, and simulate (via Icarus)
pure VHDL (.vhd/.vhdl) or mixed VHDL + Verilog + SystemVerilog projects even when external GHDL is not installed.
"""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

VHDL_EXT = {".vhd", ".vhdl"}

_VHDL_COMMENT_RE = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)
ENTITY_RE = re.compile(r"\bentity\s+(\w+)\s+is\b(.*?)\bend\s+(?:entity\s+)?(?:\1\s*)?;", re.I | re.S)
ARCH_RE = re.compile(r"\barchitecture\s+(\w+)\s+of\s+(\w+)\s+is\b(.*?)\bbegin\b(.*?)\bend\s+(?:architecture\s+)?(?:\1\s*)?;", re.I | re.S)
VHDL_INST_RE = re.compile(
    r"\b(\w+)\s*:\s*(?:entity\s+(?:\w+\.)?(\w+)|(\w+))\s*(?:generic\s+map\s*\((.*?)\)\s*)?port\s+map\s*\((.*?)\)\s*;",
    re.I | re.S,
)


def is_vhdl(path: str) -> bool:
    return Path(path).suffix.lower() in VHDL_EXT


def strip_vhdl_comments(text: str) -> str:
    return _VHDL_COMMENT_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def _parse_range(type_str: str) -> str:
    m = re.search(r"\(\s*(.+?)\s+(?:downto|to)\s+(.+?)\s*\)", type_str, re.I)
    if m:
        msb = re.sub(r"\b(\w+)\s*-\s*1\b", r"\1-1", m.group(1).strip())
        lsb = m.group(2).strip()
        return f"[{msb}:{lsb}]"
    if re.search(r"\binteger\b", type_str, re.I):
        rm = re.search(r"\brange\s+\d+\s+to\s+(\d+)", type_str, re.I)
        if rm:
            max_v = int(rm.group(1))
            bits = max(1, max_v.bit_length())
            return f"[{bits - 1}:0]"
        return "[31:0]"
    return ""


def _convert_expr(expr: str) -> str:
    s = expr.strip()
    # Character literals '0', '1' -> 1'b0, 1'b1
    s = re.sub(r"'([01xzXZ])'", r"1'b\1", s)
    # Bit-string literals "0101" -> 4'b0101
    s = re.sub(r'"([01xzXZ]+)"', lambda m: f"{len(m.group(1))}'b{m.group(1)}", s)
    # Hex literals X"FF" -> 8'hFF
    s = re.sub(r'[xX]"([0-9a-fA-F_]+)"', lambda m: f"{len(m.group(1).replace('_', '')) * 4}'h{m.group(1)}", s)
    # (others => '0') or (others => '1')
    s = re.sub(r"\(\s*others\s*=>\s*1'b([01])\s*\)", r"'\1", s, flags=re.I)
    # Type conversions: unsigned(x), signed(x), std_logic_vector(x), to_unsigned(val, w)
    s = re.sub(r"\bto_(?:un)?signed\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)", r"\1", s, flags=re.I)
    s = re.sub(r"\b(?:std_logic_vector|unsigned|signed|to_integer)\s*\(\s*([^()]+)\s*\)", r"\1", s, flags=re.I)
    # Operators
    s = re.sub(r"\bnot\s+", "~", s, flags=re.I)
    s = re.sub(r"\band\b", "&", s, flags=re.I)
    s = re.sub(r"\bnand\b", "~&", s, flags=re.I)
    s = re.sub(r"\bor\b", "|", s, flags=re.I)
    s = re.sub(r"\bnor\b", "~|", s, flags=re.I)
    s = re.sub(r"\bxor\b", "^", s, flags=re.I)
    s = re.sub(r"\bxnor\b", "~^", s, flags=re.I)
    s = re.sub(r"/=", "!=", s)
    # Concatenation & inside expressions where not bitwise
    return s


def _convert_cond(cond: str) -> str:
    s = _convert_expr(cond)
    s = re.sub(r"(?<![=!<>])=(?!=)", "==", s)
    s = re.sub(r"\s*&\s*(?=.*==)", " && ", s)
    s = re.sub(r"\s*\|\s*(?=.*==)", " || ", s)
    return s


def _convert_Sequential_block(lines: List[str], is_clocked: bool) -> List[str]:
    out: List[str] = []
    assign_op = "<=" if is_clocked else "="
    in_when_block = False
    i = 0
    while i < len(lines):
        raw = lines[i].strip()
        i += 1
        if not raw or raw.lower() in ("begin",):
            continue
        # rising_edge / falling_edge / clk'event wrapper inside process is already in always_ff header
        if re.match(r"if\s+\(?\s*(?:rising_edge|falling_edge)\s*\(\s*\w+\s*\)\s*\)?\s+then\b", raw, re.I):
            continue
        if re.match(r"if\s+\(?\s*\w+'event\s+and\s+\w+\s*=\s*(?:'[01]'|1'b[01])\s*\)?\s+then\b", raw, re.I):
            continue
        if re.match(r"elsif\s+\(?\s*(?:rising_edge|falling_edge)\s*\(\s*\w+\s*\)\s*\)?\s+then\b", raw, re.I):
            out.append("end else begin")
            continue
        if re.match(r"elsif\s+\(?\s*\w+'event\s+and\s+\w+\s*=\s*(?:'[01]'|1'b[01])\s*\)?\s+then\b", raw, re.I):
            out.append("end else begin")
            continue

        m_if = re.match(r"^if\s+(.+?)\s+then$", raw, re.I)
        if m_if:
            out.append(f"if ({_convert_cond(m_if.group(1))}) begin")
            continue
        m_elsif = re.match(r"^elsif\s+(.+?)\s+then$", raw, re.I)
        if m_elsif:
            out.append(f"end else if ({_convert_cond(m_elsif.group(1))}) begin")
            continue
        if re.match(r"^else$", raw, re.I):
            out.append("end else begin")
            continue
        if re.match(r"^end\s+if\s*;$", raw, re.I):
            out.append("end")
            continue

        m_case = re.match(r"^case\s+(.+?)\s+is$", raw, re.I)
        if m_case:
            out.append(f"case ({_convert_expr(m_case.group(1))})")
            continue
        m_when = re.match(r"^when\s+(.+?)\s*=>(.*)$", raw, re.I)
        if m_when:
            if in_when_block:
                out.append("  end")
                in_when_block = False
            choice = m_when.group(1).strip()
            rest = m_when.group(2).strip()
            lbl = "default" if choice.lower() == "others" else _convert_expr(choice).replace("|", ",")
            if rest:
                sub = _convert_Sequential_block([rest], is_clocked)
                out.append(f"  {lbl}: {' '.join(sub)}")
            else:
                out.append(f"  {lbl}: begin")
                in_when_block = True
            continue
        if re.match(r"^end\s+case\s*;$", raw, re.I):
            if in_when_block:
                out.append("  end")
                in_when_block = False
            out.append("endcase")
            continue

        # Wait statement in testbench
        m_wait = re.match(r"^wait\s+for\s+(\d+)\s*ns\s*;$", raw, re.I)
        if m_wait:
            out.append(f"#{m_wait.group(1)};")
            continue
        if re.match(r"^wait\s*;$", raw, re.I):
            out.append("$finish;")
            continue

        # Signal or variable assignment
        m_asgn = re.match(r"^(\w+(?:\([^)]+\))?)\s*(?:<=|:=)\s*(.+?)\s*;$", raw)
        if m_asgn:
            lhs = re.sub(r"\(\s*(\d+)\s+downto\s+(\d+)\s*\)", r"[\1:\2]", m_asgn.group(1), flags=re.I)
            rhs = _convert_expr(m_asgn.group(2))
            out.append(f"{lhs} {assign_op} {rhs};")
            continue

    # Balance begin/end blocks if needed
    opens = sum(len(re.findall(r"\bbegin\b", l)) for l in out)
    closes = sum(len(re.findall(r"\bend\b", l)) for l in out)
    while closes > opens:
        for idx in range(len(out) - 1, -1, -1):
            if out[idx].strip() == "end":
                out.pop(idx)
                closes -= 1
                break
        else:
            break
    while opens > closes:
        out.append("end")
        closes += 1
    return out


def transpile_vhdl_to_sv(text: str) -> str:
    """Convert synthesizable VHDL (and basic testbenches) into SystemVerilog."""
    clean = strip_vhdl_comments(text)
    entities: Dict[str, Dict[str, Any]] = {}

    for em in ENTITY_RE.finditer(clean):
        ename = em.group(1)
        ebody = em.group(2)
        generics: List[str] = []
        ports: List[str] = []

        gm = re.search(r"\bgeneric\s*\((.*?)\)\s*;", ebody, re.I | re.S)
        if gm:
            for item in gm.group(1).split(";"):
                pm = re.match(r"\s*([\w,\s]+)\s*:\s*(\w+)(?:\s*:=\s*(.+))?", item.strip(), re.I)
                if pm:
                    names = [n.strip() for n in pm.group(1).split(",") if n.strip()]
                    dflt = _convert_expr(pm.group(3)) if pm.group(3) else "4"
                    for n in names:
                        generics.append(f"parameter {n} = {dflt}")

        pm_block = re.search(r"\bport\s*\((.*)\)\s*;", ebody, re.I | re.S)
        if pm_block:
            for item in pm_block.group(1).split(";"):
                pm = re.match(r"\s*([\w,\s]+)\s*:\s*(in|out|inout|buffer)\s+(.+)", item.strip(), re.I)
                if pm:
                    names = [n.strip() for n in pm.group(1).split(",") if n.strip()]
                    direction = "output" if pm.group(2).lower() in ("out", "buffer") else pm.group(2).lower()
                    if direction == "in":
                        direction = "input"
                    rng = _parse_range(pm.group(3))
                    for n in names:
                        ports.append(f"{direction} logic {rng} {n}".replace("  ", " "))

        entities[ename.lower()] = {"name": ename, "generics": generics, "ports": ports}

    sv_modules: List[str] = ["`timescale 1ns/1ps"]
    for am in ARCH_RE.finditer(clean):
        arch_name, ent_name, decl_part, body_part = am.groups()
        ent = entities.get(ent_name.lower(), {"name": ent_name, "generics": [], "ports": []})
        g_str = f" #({', '.join(ent['generics'])})" if ent["generics"] else ""
        p_str = f" (\n  " + ",\n  ".join(ent["ports"]) + "\n)" if ent["ports"] else ""
        mod_lines = [f"module {ent['name']}{g_str}{p_str};"]

        # Parse declarations (types, signals, constants)
        for stmt in decl_part.split(";"):
            s = stmt.strip()
            if not s:
                continue
            tm = re.match(r"type\s+(\w+)\s+is\s*\(([^)]+)\)", s, re.I)
            if tm:
                tname, vals = tm.group(1), [v.strip() for v in tm.group(2).split(",") if v.strip()]
                bits = max(1, (len(vals) - 1).bit_length())
                mod_lines.append(f"  typedef enum logic [{bits - 1}:0] {{{', '.join(vals)}}} {tname};")
                continue
            sm = re.match(r"(?:signal|variable)\s+([\w,\s]+)\s*:\s*([^:=]+?)(?:\s*:=\s*(.+))?$", s, re.I)
            if sm:
                names = [n.strip() for n in sm.group(1).split(",") if n.strip()]
                t_raw = sm.group(2).strip()
                init = f" = {_convert_expr(sm.group(3))}" if sm.group(3) else ""
                rng = _parse_range(t_raw)
                if re.match(r"^(?:std_logic|std_ulogic|bit|unsigned|signed|integer)", t_raw, re.I):
                    for n in names:
                        mod_lines.append(f"  logic {rng} {n}{init};".replace("  ", " "))
                else:
                    for n in names:
                        mod_lines.append(f"  {t_raw} {n}{init};")
                continue
            cm = re.match(r"constant\s+(\w+)\s*:\s*([^:=]+?)\s*:=\s*(.+)$", s, re.I)
            if cm:
                mod_lines.append(f"  localparam {cm.group(1)} = {_convert_expr(cm.group(3))};")

        # Extract processes from body_part
        proc_spans: List[Tuple[int, int]] = []
        proc_re = re.compile(
            r"(?:(\w+)\s*:\s*)?\bprocess\s*(?:\(([^)]*)\))?\s*(?:is\b)?(.*?)\bbegin\b(.*?)\bend\s+process(?:\s+\1)?\s*;",
            re.I | re.S,
        )
        for pm in proc_re.finditer(body_part):
            proc_spans.append((pm.start(), pm.end()))
            sens = (pm.group(2) or "").strip()
            pdecl = pm.group(3) or ""
            pbody = pm.group(4) or ""

            # Local variables inside process
            for stmt in pdecl.split(";"):
                vm = re.match(r"\s*variable\s+([\w,\s]+)\s*:\s*([^:=]+?)(?:\s*:=\s*(.+))?$", stmt.strip(), re.I)
                if vm:
                    rng = _parse_range(vm.group(2))
                    for n in [x.strip() for x in vm.group(1).split(",") if x.strip()]:
                        mod_lines.append(f"  logic {rng} {n};".replace("  ", " "))

            # Detect clock/reset
            re_clk = re.search(r"\b(rising_edge|falling_edge)\s*\(\s*(\w+)\s*\)", pbody, re.I)
            ev_clk = re.search(r"(\w+)'event\s+and\s+\1\s*=\s*'([01])'", pbody, re.I)
            raw_lines = [l.strip() for l in pbody.splitlines() if l.strip()]

            if not sens and any("wait" in l.lower() for l in raw_lines):
                # Testbench stimulus process
                mod_lines.append("  initial begin")
                for l in _convert_Sequential_block(raw_lines, is_clocked=False):
                    mod_lines.append("    " + l)
                mod_lines.append("  end")
            elif re_clk or ev_clk:
                if re_clk:
                    edge = "posedge" if re_clk.group(1).lower() == "rising_edge" else "negedge"
                    clk_sig = re_clk.group(2)
                else:
                    edge = "posedge" if ev_clk.group(2) == "1" else "negedge"
                    clk_sig = ev_clk.group(1)
                mod_lines.append(f"  always_ff @({edge} {clk_sig}) begin")
                for l in _convert_Sequential_block(raw_lines, is_clocked=True):
                    mod_lines.append("    " + l)
                mod_lines.append("  end")
            else:
                mod_lines.append("  always_comb begin")
                for l in _convert_Sequential_block(raw_lines, is_clocked=False):
                    mod_lines.append("    " + l)
                mod_lines.append("  end")

        # Remaining concurrent statements outside processes
        cleaned_body = []
        last_idx = 0
        for s, e in proc_spans:
            cleaned_body.append(body_part[last_idx:s])
            last_idx = e
        cleaned_body.append(body_part[last_idx:])
        concurrent_src = "\n".join(cleaned_body)

        # Component / Entity instantiations
        for im in VHDL_INST_RE.finditer(concurrent_src):
            inst_lbl = im.group(1)
            comp_name = im.group(2) or im.group(3)
            gmap = im.group(4)
            pmap = im.group(5)
            p_conns = []
            for item in pmap.split(","):
                if "=>" in item:
                    k, v = item.split("=>", 1)
                    p_conns.append(f".{k.strip()}({_convert_expr(v.strip())})")
                elif item.strip():
                    p_conns.append(_convert_expr(item.strip()))
            g_conns = []
            if gmap:
                for item in gmap.split(","):
                    if "=>" in item:
                        k, v = item.split("=>", 1)
                        g_conns.append(f".{k.strip()}({_convert_expr(v.strip())})")
            g_part = f" #({', '.join(g_conns)})" if g_conns else ""
            mod_lines.append(f"  {comp_name}{g_part} {inst_lbl} ({', '.join(p_conns)});")

        concurrent_src = VHDL_INST_RE.sub("", concurrent_src)
        for stmt in concurrent_src.split(";"):
            s = " ".join(stmt.strip().split())
            if not s:
                continue
            # Clock generator: clk <= not clk after 5 ns
            m_clk = re.match(r"^(\w+)\s*<=\s*not\s+\1\s+after\s+(\d+)\s*ns$", s, re.I)
            if m_clk:
                mod_lines.append(f"  always #{m_clk.group(2)} {m_clk.group(1)} = ~{m_clk.group(1)};")
                continue
            # Conditional concurrent assignment: y <= a when c1 else b when c2 else d
            if "<=" in s and re.search(r"\bwhen\b", s, re.I):
                lhs, rhs = s.split("<=", 1)
                parts = re.split(r"\belse\b", rhs, flags=re.I)
                expr_acc = _convert_expr(parts[-1].strip())
                for part in reversed(parts[:-1]):
                    wm = re.match(r"\s*(.+?)\s+when\s+(.+)", part, re.I)
                    if wm:
                        val_s = _convert_expr(wm.group(1))
                        cond_s = _convert_cond(wm.group(2))
                        expr_acc = f"({cond_s}) ? ({val_s}) : ({expr_acc})"
                mod_lines.append(f"  assign {lhs.strip()} = {expr_acc};")
                continue
            m_con = re.match(r"^(\w+(?:\([^)]+\))?)\s*<=\s*(.+)$", s)
            if m_con:
                lhs = re.sub(r"\(\s*(\d+)\s+downto\s+(\d+)\s*\)", r"[\1:\2]", m_con.group(1), flags=re.I)
                mod_lines.append(f"  assign {lhs} = {_convert_expr(m_con.group(2))};")

        mod_lines.append("endmodule\n")
        sv_modules.append("\n".join(mod_lines))

    return "\n".join(sv_modules)


def structural_checks_vhdl(root: Path, files: List[str]) -> List[Dict[str, Any]]:
    """Run structural checks on VHDL files."""
    diags: List[Dict[str, Any]] = []
    for f in files:
        if not is_vhdl(f):
            continue
        p = Path(f)
        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        try:
            rel = p.resolve().relative_to(root).as_posix()
        except ValueError:
            rel = p.name
        clean = strip_vhdl_comments(raw)
        ent_starts = re.findall(r"\bentity\s+(\w+)\s+is\b", clean, re.I)
        ent_ends = re.findall(r"\bend\s+(?:entity\b|\w+)?\s*;", clean, re.I)
        if ent_starts and not ENTITY_RE.search(clean):
            diags.append({
                "severity": "error",
                "code": "VHDL_ENTITY_END",
                "file": rel,
                "line": raw.count("\n") + 1,
                "column": None,
                "message": f"VHDL 'entity {ent_starts[0]}' bloğu düzgün kapatılmamış ('end {ent_starts[0]};' eksik).",
            })
        if re.search(r"\bstd_logic\b", clean, re.I) and not re.search(r"\bstd_logic_1164\b", clean, re.I):
            diags.append({
                "severity": "warning",
                "code": "VHDL_IEEE",
                "file": rel,
                "line": 1,
                "column": None,
                "message": "'std_logic' kullanılmış ancak 'use ieee.std_logic_1164.all;' bildirimi eksik.",
            })
    return diags


def stage_vhdl_files(build_dir: Path, files: List[str]) -> List[str]:
    """Convert any .vhd/.vhdl files in `files` into staged .sv files inside `build_dir`."""
    build_dir.mkdir(parents=True, exist_ok=True)
    out: List[str] = []
    for f in files:
        if is_vhdl(f):
            p = Path(f)
            raw = p.read_text(encoding="utf-8", errors="replace")
            sv_code = transpile_vhdl_to_sv(raw)
            staged = build_dir / f"__vhdl_{p.stem}.sv"
            staged.write_text(sv_code, encoding="utf-8")
            out.append(str(staged))
        else:
            out.append(f)
    return out
