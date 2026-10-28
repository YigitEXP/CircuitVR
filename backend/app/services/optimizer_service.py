"""RTL Optimization Advisor 2.0: static SV/Verilog/VHDL pattern analysis + CDC + Yosys inspection + Auto-Fix."""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from app.services.workspace_service import strip_comments


def _line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _snippet(lines: List[str], line_no: int, radius: int = 0) -> str:
    lo = max(0, line_no - 1 - radius)
    hi = min(len(lines), line_no + radius)
    return "\n".join(lines[lo:hi]).strip()


def _is_ignored(raw_lines: List[str], line_no: int, rule_id: str) -> bool:
    """Check if `// circuitvr-ignore <RULE_ID>` or `-- circuitvr-ignore <RULE_ID>` is present on line_no or line_no-1."""
    if not rule_id:
        return False
    pat = re.compile(rf"circuitvr-ignore\s+(?:ALL|{re.escape(rule_id)})\b", re.I)
    for idx in (line_no - 2, line_no - 1):
        if 0 <= idx < len(raw_lines) and pat.search(raw_lines[idx]):
            return True
    # Also check first 5 lines for file-wide ignore
    for idx in range(min(5, len(raw_lines))):
        if re.search(rf"circuitvr-ignore-file\s+(?:ALL|{re.escape(rule_id)})\b", raw_lines[idx], re.I):
            return True
    return False


def insert_ignore_pragma(raw_code: str, line_no: int, rule_id: str, is_vhdl: bool = False) -> Dict[str, Any]:
    """Insert a `// circuitvr-ignore <RULE_ID>` comment right above `line_no`."""
    lines = raw_code.splitlines()
    idx = max(0, min(len(lines), line_no - 1))
    target_line = lines[idx] if idx < len(lines) else ""
    indent = re.match(r"^\s*", target_line).group(0) if target_line else ""
    comment_prefix = "--" if is_vhdl else "//"
    pragma = f"{indent}{comment_prefix} circuitvr-ignore {rule_id}"
    if idx > 0 and pragma.strip() in lines[idx - 1]:
        return {"applied": False, "content": raw_code}
    lines.insert(idx, pragma)
    return {"applied": True, "content": "\n".join(lines) + ("\n" if raw_code.endswith("\n") else "")}


def analyze_optimizations(
    root: Path,
    files: List[str],
    top: Optional[str] = None,
    synth_stats: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    suggestions: List[Dict[str, Any]] = []

    for fpath in files:
        p = Path(fpath)
        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        try:
            rel = p.resolve().relative_to(root).as_posix()
        except ValueError:
            rel = p.name
        if rel.lower().startswith("tb/") or p.stem.lower().startswith("tb_") or p.stem.lower().endswith("_tb"):
            continue

        raw_lines = raw.splitlines()
        if p.suffix.lower() in (".vhd", ".vhdl"):
            clean_v = strip_comments(raw, is_vhdl=True)
            for m in re.finditer(r"\buse\s+ieee\.std_logic_(?:arith|unsigned|signed)\.all\s*;", clean_v, re.I):
                ln = _line_of(clean_v, m.start())
                src_ln = _snippet(raw_lines, ln, 0)
                suggestions.append({
                    "rule_id": "OPT-VHDL-STD",
                    "category": "IEEE Standart & Taşınabilirlik",
                    "impact": "orta",
                    "title": "Standart dışı 'std_logic_arith / std_logic_unsigned' yerine 'numeric_std' kullanın",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "Synopsys kökenli 'std_logic_arith' ve 'std_logic_unsigned' IEEE 1076.3 standardı değildir "
                        "ve aynı ifadede signed/unsigned karışıklığına yol açar. 'ieee.numeric_std.all' kullanın."
                    ),
                    "before": src_ln,
                    "after": "use ieee.numeric_std.all;",
                    "can_autofix": True,
                })
            for m in re.finditer(r"(\w+)'event\s+and\s+\1\s*=\s*'1'", clean_v, re.I):
                clk_s = m.group(1)
                ln = _line_of(clean_v, m.start())
                suggestions.append({
                    "rule_id": "OPT-VHDL-EDGE",
                    "category": "Güvenilirlik & Sentez",
                    "impact": "düşük",
                    "title": f"Klasik \"{clk_s}'event and {clk_s}='1'\" yerine 'rising_edge({clk_s})' kullanın",
                    "file": rel,
                    "line": ln,
                    "why": (
                        f"'rising_edge({clk_s})' fonksiyonu yalnızca '0'/'L' -> '1'/'H' geçişlerini kabul eder "
                        "ve simülasyonda 'X'/'U' başlangıç durumlarından kaynaklanan sahte saat tetiklemelerini önler."
                    ),
                    "before": m.group(0),
                    "after": f"rising_edge({clk_s})",
                    "can_autofix": True,
                })
            for m in re.finditer(r"\bsignal\s+(\w+)\s*:\s*integer\b(?!\s+range\b)", clean_v, re.I):
                sig_s = m.group(1)
                ln = _line_of(clean_v, m.start())
                src_ln = _snippet(raw_lines, ln, 0)
                suggestions.append({
                    "rule_id": "OPT-VHDL-INT",
                    "category": "Alan (LUT/FF)",
                    "impact": "yüksek",
                    "title": f"Sınırsız 'integer' sinyali ('{sig_s}') 32-bit Flip-Flop sentezler!",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "VHDL'de 'range' belirtilmeyen 'integer' sinyaller varsayılan olarak 32-bit işaretli "
                        "yazmaç (register) üretir. 'range 0 to MAX' veya 'unsigned(N-1 downto 0)' kullanarak alanı küçültün."
                    ),
                    "before": src_ln,
                    "after": f"signal {sig_s} : integer range 0 to 15 := 0;",
                    "can_autofix": True,
                })
            for m in re.finditer(r"\bcase\s+([^\s]+)\s+is\b(.*?)\bend\s+case\b", clean_v, re.I | re.S):
                csig, cbody = m.group(1), m.group(2)
                ln = _line_of(clean_v, m.start())
                if not re.search(r"\bwhen\s+others\s*=>", cbody, re.I):
                    suggestions.append({
                        "rule_id": "OPT-VHDL-CASE",
                        "category": "Güvenilirlik & Sentez",
                        "impact": "yüksek",
                        "title": f"VHDL 'case {csig} is' bloğunda 'when others =>' eksik (Latch / kilitlenme riski)",
                        "file": rel,
                        "line": ln,
                        "why": (
                            "Std_logic 'U', 'X', 'Z' gibi 9 değerli mantık içerdiğinden 'when others =>' "
                            "yazılmaması sentezde istenmeyen latch veya güvenli olmayan FSM durumlarına yol açar."
                        ),
                        "before": f"case {csig} is\n  ...",
                        "after": f"case {csig} is\n  ...\n  when others => null;\nend case;",
                        "can_autofix": False,
                    })
            suggestions = [
                s for s in suggestions
                if s.get("file") != rel or not _is_ignored(raw_lines, int(s.get("line", 1)), str(s.get("rule_id", "")))
            ]
            continue

        clean = strip_comments(raw)

        # 1. Legacy always @(...) instead of always_ff / always_comb
        for m in re.finditer(r"\balways\s*@\s*\(([^)]*)\)", clean):
            sens = m.group(1)
            ln = _line_of(clean, m.start())
            is_seq = bool(re.search(r"\b(posedge|negedge)\b", sens))
            replacement = f"always_ff @({sens.strip()})" if is_seq else "always_comb"
            orig_token = m.group(0)
            suggestions.append({
                "rule_id": "OPT-SV-ALWAYS",
                "category": "Güvenilirlik & Sentez",
                "impact": "orta",
                "title": f"Klasik 'always @' yerine '{replacement.split()[0]}' kullanın",
                "file": rel,
                "line": ln,
                "why": (
                    "SystemVerilog 'always_ff' ve 'always_comb' blokları, sentezleyicinin istemeden latch "
                    "veya çoklu sürücü (multiple driver) üretmesini derleme aşamasında engeller."
                ),
                "before": orig_token,
                "after": replacement,
                "can_autofix": p.suffix.lower() == ".sv",
            })

        # 2. Blocking assignment (=) inside sequential always_ff / always @(posedge...)
        clk_domains: Dict[str, Set[str]] = {}
        clk_blocks: List[Dict[str, Any]] = []
        for m in re.finditer(r"\b(always_ff\s*@\s*\(([^)]*)\)|always\s*@\s*\(([^)]*(?:posedge|negedge)[^)]*)\))\s*begin(.*?)\bend\b", clean, re.S):
            sens_str = m.group(2) or m.group(3) or ""
            body = m.group(4)
            base_pos = m.start(4)
            block_ln = _line_of(clean, m.start())

            # Extract clock signal name
            clk_m = re.search(r"\b(?:posedge|negedge)\s+([a-zA-Z_]\w*)", sens_str)
            clk_name = clk_m.group(1) if clk_m else "clk"
            has_rst = bool(re.search(r"\b(?:rst|reset|areset|clr)", sens_str, re.I) or re.search(r"\bif\s*\(\s*!?\s*(?:rst|reset)", body, re.I))
            if not has_rst:
                suggestions.append({
                    "rule_id": "OPT-RST",
                    "category": "Güvenilirlik & Test",
                    "impact": "orta",
                    "title": f"Saatli blokta ('{clk_name}') sıfırlama (reset) koşulu bulunamadı",
                    "file": rel,
                    "line": block_ln,
                    "why": (
                        "Reset koşulu olmayan yazmaçlar (Flip-Flop) simülasyon başlangıcında 'X' (belirsiz) "
                        "üretir ve donanımda deterministik başlangıç durumunu garanti etmez."
                    ),
                    "before": _snippet(raw_lines, block_ln, 0),
                    "after": f"always_ff @(posedge {clk_name} or negedge rst_n) begin\n    if (!rst_n) ...",
                    "can_autofix": False,
                })

            driven = set(re.findall(r"\b([a-zA-Z_]\w*)\s*(?:\[[^\]]+\])?\s*<=", body))
            clk_domains.setdefault(clk_name, set()).update(driven)
            clk_blocks.append({"clk": clk_name, "body": body, "line": block_ln})

            for bm in re.finditer(r"(?<![<>=!])=(?!=)", body):
                line_start = body.rfind("\n", 0, bm.start()) + 1
                line_txt = body[line_start:body.find("\n", bm.start())]
                if re.search(r"\bfor\s*\(", line_txt):
                    continue
                ln = _line_of(clean, base_pos + bm.start())
                src_line = _snippet(raw_lines, ln, 0)
                suggestions.append({
                    "rule_id": "OPT-BLOCKING",
                    "category": "Güvenilirlik & Sentez",
                    "impact": "yüksek",
                    "title": "Saatli (sequential) blok içinde bloklayan atama ('=') kullanılmış",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "Saat kenarıyla tetiklenen bloklarda '=' kullanmak simülasyon-sentez uyumsuzluğuna "
                        "(race condition) yol açar. Flip-flop çıkışı için '<=' (non-blocking) kullanılmalıdır."
                    ),
                    "before": src_line,
                    "after": re.sub(r"(?<![<>=!])=(?!=)", "<=", src_line),
                    "can_autofix": True,
                })

        # 2b. Clock Domain Crossing (CDC) Unsynchronized Signal Check
        if len(clk_domains) >= 2:
            for blk in clk_blocks:
                dst_clk = blk["clk"]
                body = blk["body"]
                for src_clk, src_sigs in clk_domains.items():
                    if src_clk == dst_clk:
                        continue
                    for sig in src_sigs:
                        if re.search(rf"\b{re.escape(sig)}\b", body) and not re.search(r"sync|meta|cdc", sig, re.I):
                            suggestions.append({
                                "rule_id": "OPT-CDC-UNSYNC",
                                "category": "CDC (Saat Alanı Geçişi)",
                                "impact": "yüksek",
                                "title": f"CDC Riski: '{src_clk}' alanındaki '{sig}' sinyali '{dst_clk}' alanında doğrudan örnekleniyor!",
                                "file": rel,
                                "line": blk["line"],
                                "why": (
                                    f"'{sig}' sinyali '{src_clk}' saat alanında üretilip '{dst_clk}' saat alanında "
                                    "2-kademeli senkronizör (2-FF Synchronizer) olmadan kullanılıyor. Bu durum "
                                    "silikonda metastabilite (metastability) çökmesine yol açar."
                                ),
                                "before": f"// {dst_clk} bloğu içinde doğrudan kullanım:\nout <= {sig};",
                                "after": (
                                    f"(* ASYNC_REG = \"TRUE\" *) logic {sig}_meta, {sig}_sync;\n"
                                    f"always_ff @(posedge {dst_clk}) begin\n"
                                    f"    {sig}_meta <= {sig};\n"
                                    f"    {sig}_sync <= {sig}_meta;\n"
                                    f"end"
                                ),
                                "can_autofix": False,
                            })

        # 3. Case statement without 'unique case' (parallel mux optimization)
        for m in re.finditer(r"(?<!\bunique\s)(?<!\bpriority\s)\bcase\s*\(([^)]+)\)(.*?)\bendcase\b", clean, re.S):
            sig = m.group(1).strip()
            body = m.group(2)
            ln = _line_of(clean, m.start())
            src_ln = _snippet(raw_lines, ln, 0)
            has_default = bool(re.search(r"\bdefault\s*:", body))
            if not has_default:
                suggestions.append({
                    "rule_id": "OPT-LATCH-CASE",
                    "category": "Güvenilirlik & Sentez",
                    "impact": "yüksek",
                    "title": f"'case ({sig})' bloğunda 'default' durumu eksik (Latch riski)",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "Tüm olasılıkların kapsanmadığı case blokları kombinasyonel devrede istenmeyen "
                        "latch çıkarımına, FSM'lerde ise geçersiz durumda kilitlenmeye (deadlock) neden olur."
                    ),
                    "before": f"case ({sig})\n    ...",
                    "after": f"unique case ({sig})\n    ...\n    default: ...\nendcase",
                    "can_autofix": False,
                })
            else:
                branches = re.findall(r"(\w+)\s*:\s*([^;\n]+);", body)
                by_label = dict(branches)
                def_rhs = by_label.get("default", "").strip()
                non_def = [k for k, v in branches if k != "default"]
                suggestions.append({
                    "rule_id": "OPT-MUX-CASE",
                    "category": "Alan (LUT) & Hız",
                    "impact": "düşük",
                    "title": f"'case ({sig})' yerine 'unique case ({sig})' ile paralel MUX sentezi",
                    "file": rel,
                    "line": ln,
                    "why": (
                        f"Durumların birbirini dışladığı ({len(non_def)} durum) biliniyorsa 'unique case' "
                        "kullanmak sentezleyiciye öncelik zinciri (priority encoder) yerine daha hızlı ve "
                        "daha az LUT tüketen paralel MUX kurma izni verir."
                        + (f" Ayrıca 'default: {def_rhs};' tüm bit kombinasyonları zaten doluysa sentezde sadeleşir." if len(non_def) in (2, 4, 8, 16) and def_rhs else "")
                    ),
                    "before": src_ln,
                    "after": re.sub(r"\bcase\s*\(", "unique case (", src_ln, count=1),
                    "can_autofix": p.suffix.lower() == ".sv",
                })

        # 4. Long if-else-if chain (>= 3 else if) -> priority encoder warning
        for m in re.finditer(r"\bif\s*\([^)]+\).*?(?:\belse\s+if\s*\([^)]+\).*?){3,}", clean, re.S):
            ln = _line_of(clean, m.start())
            suggestions.append({
                "rule_id": "OPT-PRIO-TREE",
                "category": "Zamanlama (Fmax)",
                "impact": "orta",
                "title": "Derin 'if / else if' zinciri öncelik kodlayıcı (Priority Tree) oluşturuyor",
                "file": rel,
                "line": ln,
                "why": (
                    "Ardışık 'else if' dalları her koşulu bir öncekine bağlı kademeli kapılar olarak sentezler "
                    "ve kritik yolu uzatır. Koşullar birbirini dışlıyorsa 'unique case' veya 'unique if' kullanın."
                ),
                "before": "if (c1) ...\nelse if (c2) ...\nelse if (c3) ...\nelse if (c4) ...",
                "after": "unique case (1'b1)\n    c1: ...;\n    c2: ...;\n    c3: ...;\n    c4: ...;\nendcase",
                "can_autofix": False,
            })

        # 5. Multiplication/division by power of two
        for m in re.finditer(r"(\b\w+\b)\s*([*/])\s*(\d+)\b", clean):
            var, op, num_s = m.group(1), m.group(2), m.group(3)
            val = int(num_s)
            if val > 1 and (val & (val - 1)) == 0:
                shift = val.bit_length() - 1
                ln = _line_of(clean, m.start())
                shift_op = "<<" if op == "*" else ">>"
                suggestions.append({
                    "rule_id": "OPT-SHIFT-MUL",
                    "category": "Alan (LUT/DSP)",
                    "impact": "orta",
                    "title": f"2'nin kuvvetiyle ({val}) '{op}' işlemi yerine bit kaydırma ('{shift_op} {shift}')",
                    "file": rel,
                    "line": ln,
                    "why": "Bit kaydırma donanımda sıfır kapı (sadece kablo yönlendirmesi) maliyetlidir.",
                    "before": m.group(0),
                    "after": f"({var} {shift_op} {shift})",
                    "can_autofix": True,
                })

        # 6. Unsized integer literals in signal arithmetic
        for m in re.finditer(r"(?<!\[)\b([a-z_][a-z0-9_]*)\s*([+\-])\s*1\b(?!\s*'[bhdBHD])(?!\s*:)", clean):
            var, op = m.group(1), m.group(2)
            if var in ("i", "j", "k", "genvar"):
                continue
            ln = _line_of(clean, m.start())
            suggestions.append({
                "rule_id": "OPT-WIDTH-LIT",
                "category": "Kod Kalitesi & Genişlik",
                "impact": "düşük",
                "title": f"Boyutsuz sabit ('{var} {op} 1') 32-bit genişletmeye yol açar",
                "file": rel,
                "line": ln,
                "why": (
                    "SystemVerilog'da boyutsuz '1' sabiti 32-bit signed int kabul edilir ve lint araçlarında "
                    "WIDTHEXPAND/WIDTHTRUNC uyarısı üretir. Genişlik uyumu için 1'b1 kullanın."
                ),
                "before": m.group(0),
                "after": f"{var} {op} 1'b1",
                "can_autofix": True,
            })

        # 7. Enum FSM encoding advice
        for m in re.finditer(r"\btypedef\s+enum\s+(logic\s*\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*\{([^}]+)\}\s*(\w+)", clean):
            width_decl, msb, lsb, items_s, ename = m.groups()
            items = [x.strip() for x in items_s.split(",") if x.strip()]
            ln = _line_of(clean, m.start())
            src_ln = _snippet(raw_lines, ln, 0)
            if not width_decl:
                bits = max(1, (len(items) - 1).bit_length())
                suggestions.append({
                    "rule_id": "OPT-FSM-ENUM",
                    "category": "Alan (LUT/FF)",
                    "impact": "orta",
                    "title": f"'{ename}' enum tanımında bit genişliği belirtilmemiş (varsayılan 32-bit int!)",
                    "file": rel,
                    "line": ln,
                    "why": (
                        f"Bit genişliği verilmeyen enum'lar 32-bit register tüketir. {len(items)} durum için "
                        f"'logic [{bits-1}:0]' yeterlidir ({32 - bits} flip-flop tasarruf sağlar)."
                    ),
                    "before": m.group(0),
                    "after": f"typedef enum logic [{bits-1}:0] {{{items_s.strip()}}} {ename}",
                    "can_autofix": True,
                })
            elif len(items) >= 4:
                suggestions.append({
                    "rule_id": "OPT-FSM-ONEHOT",
                    "category": "Zamanlama (Fmax) vs Alan",
                    "impact": "bilgi",
                    "title": f"FSM Kodlama Tercihi ('{ename}': {len(items)} durum — Binary vs One-Hot)",
                    "file": rel,
                    "line": ln,
                    "why": (
                        f"Mevcut tasarım {len(items)} durumu ikili (binary) kodluyor (en az FF, biraz daha fazla "
                        "durum çözme LUT'u). Yüksek saat frekansı (FPGA Fmax) hedefliyorsanız One-Hot kodlama "
                        f"({len(items)} FF, ancak durum geçiş mantığında daha az LUT derinliği) tercih edilebilir."
                    ),
                    "before": src_ln,
                    "after": f"(* fsm_encoding = \"one_hot\" *)\n{src_ln}",
                    "can_autofix": True,
                })

        # 8. Hardware Security (SecLinter): Combinational Self-Loops (Ring Oscillator / Side-Channel Leak)
        for m in re.finditer(r"\bassign\s+([A-Za-z_]\w*)\s*=\s*([^;]+);", clean):
            lhs, rhs = m.group(1), m.group(2)
            if re.search(rf"\b{re.escape(lhs)}\b", rhs):
                ln = _line_of(clean, m.start())
                suggestions.append({
                    "rule_id": "OPT-SEC-COMBLOOP",
                    "category": "Donanım Güvenliği (SecLinter)",
                    "impact": "yüksek",
                    "title": f"Güvenlik Riski: '{lhs}' sinyalinde kombinasyonel öz-döngü (Ring Oscillator / DPA riski)!",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "Bir kombinasyonel sinyalin doğrudan kendisine geri beslenmesi FPGA üzerinde kontrolsüz "
                        "halka osilatör (ring oscillator), aşırı dinamik güç çekimi ve yan-kanal (Side-Channel) "
                        "sızıntısına yol açar. Geri beslemeyi saatli bir Flip-Flop ('always_ff') üzerinden geçirin."
                    ),
                    "before": _snippet(raw_lines, ln, 0),
                    "after": f"always_ff @(posedge clk) {lhs}_q <= {rhs.strip()};",
                    "can_autofix": False,
                })

        # 9. Hardware Security (SecLinter): Suspicious Magic-Constant / Rare Counter Trigger (Time-bomb / Trojan check)
        for m in re.finditer(r"\bif\s*\(\s*([A-Za-z_]\w*)\s*==\s*(\d+'h[0-9a-fA-F_]{6,}|\d{7,})\s*\)", clean):
            sig_n, magic_lit = m.group(1), m.group(2)
            ln = _line_of(clean, m.start())
            suggestions.append({
                "rule_id": "OPT-SEC-TRIGGER",
                "category": "Donanım Güvenliği (SecLinter)",
                "impact": "orta",
                "title": f"SecLinter Denetimi: '{sig_n} == {magic_lit}' nadir tetiklenen sabit karşılaştırması",
                "file": rel,
                "line": ln,
                "why": (
                    "Standart simülasyon pencerelerinde nadiren ulaşılan yüksek bitli sabit eşitlik karşılaştırmaları "
                    "(Time-Bomb / Cheat-Code paternleri) doğrulama kapsamından kaçabilir. Eşik değerini parametrik "
                    "('parameter') tanımlayın ve eşitlik ('==') yerine '>=' sınır kontrolü tercih edin."
                ),
                "before": m.group(0),
                "after": f"if ({sig_n} >= {magic_lit})",
                "can_autofix": True,
            })

        # Filter out rules suppressed via `// circuitvr-ignore <RULE_ID>`
        suggestions = [
            s for s in suggestions
            if s.get("file") != rel or not _is_ignored(raw_lines, int(s.get("line", 1)), str(s.get("rule_id", "")))
        ]

    # Synthesis-driven insights (from Yosys stat + ltp)
    if synth_stats and synth_stats.get("success"):
        cells = synth_stats.get("cells") or {}
        depth = synth_stats.get("logic_depth") or 0
        latches = sum(v for k, v in cells.items() if "DLATCH" in k.upper())
        if latches > 0:
            suggestions.insert(0, {
                "rule_id": "OPT-LATCH-SYNTH",
                "category": "Güvenilirlik & Sentez",
                "impact": "yüksek",
                "title": f"Sentez çıktısında {latches} adet istenmeyen Latch tespit edildi!",
                "file": "",
                "line": 1,
                "why": (
                    "Yosys netlist'inde kombinasyonel geri beslemeli latch hücreleri oluştu. "
                    "Tüm kombinasyonel bloklarda her çıkışın her dalda (else / default) atandığından emin olun."
                ),
                "before": "if (en) y = a; // else eksik -> latch",
                "after": "if (en) y = a;\nelse    y = '0;",
                "can_autofix": False,
            })
        if depth and depth >= 6:
            suggestions.append({
                "rule_id": "OPT-PIPE-DEPTH",
                "category": "Zamanlama (Fmax)",
                "impact": "yüksek",
                "title": f"Yüksek kombinasyonel mantık derinliği ({depth} LUT seviyesi)",
                "file": "",
                "line": 1,
                "why": (
                    f"En uzun kombinasyonel yol {depth} kademe içeriyor. Bu durum maksimum çalışma frekansını "
                    "(Fmax) düşürür. Ara kademeye bir pipeline register (always_ff) eklemeyi düşünün."
                ),
                "before": "assign out = f3(f2(f1(in)));",
                "after": "always_ff @(posedge clk) stage1 <= f1(in);\nassign out = f3(f2(stage1));",
                "can_autofix": False,
            })

    weights = {"yüksek": 18, "orta": 9, "düşük": 4, "bilgi": 0}
    penalty = sum(weights.get(s["impact"], 4) for s in suggestions)
    score = max(25, 100 - penalty)

    summary = (
        "Tasarımınız sentez ve RTL kuralları açısından oldukça temiz durumda."
        if score >= 90 else
        "Tasarımınız çalışıyor ancak donanım maliyeti (LUT/FF) veya maksimum frekans (Fmax) için iyileştirme fırsatları var."
        if score >= 70 else
        "Tasarımınızda sentez kalitesini ve güvenilirliğini doğrudan etkileyen kritik optimizasyon eksikleri bulundu."
    )

    return {
        "score": score,
        "summary": summary,
        "total": len(suggestions),
        "suggestions": suggestions,
    }


def apply_optimization_autofix(
    raw_code: str,
    line_no: int,
    before: str,
    after: str,
) -> Dict[str, Any]:
    """Apply a targeted Before->After fix near `line_no` in `raw_code`."""
    lines = raw_code.splitlines()
    idx = max(0, min(len(lines) - 1, line_no - 1))
    before_str = (before or "").strip()
    after_str = (after or "").strip()

    if not before_str or not after_str:
        return {"applied": False, "content": raw_code}

    # 1. Try exact match on the target line first
    if before_str in lines[idx]:
        lines[idx] = lines[idx].replace(before_str, after_str, 1)
        return {"applied": True, "content": "\n".join(lines) + ("\n" if raw_code.endswith("\n") else "")}

    # 2. Try +/- 3 lines around line_no
    for offset in (-1, 1, -2, 2, -3, 3):
        cand = idx + offset
        if 0 <= cand < len(lines) and before_str in lines[cand]:
            lines[cand] = lines[cand].replace(before_str, after_str, 1)
            return {"applied": True, "content": "\n".join(lines) + ("\n" if raw_code.endswith("\n") else "")}

    # 3. Fallback: whole-text single replacement
    if before_str in raw_code:
        patched = raw_code.replace(before_str, after_str, 1)
        return {"applied": True, "content": patched}

    return {"applied": False, "content": raw_code}
