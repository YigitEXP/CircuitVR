"""RTL Optimization Advisor: combines static SV pattern analysis with Yosys synthesis inspection."""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.workspace_service import MODULE_RE, ENDMODULE_RE, strip_comments


def _line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _snippet(lines: List[str], line_no: int, radius: int = 1) -> str:
    lo = max(0, line_no - 1 - radius)
    hi = min(len(lines), line_no + radius)
    return "\n".join(lines[lo:hi]).strip()


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
        # Skip testbenches for hardware synthesis optimization advice
        if rel.lower().startswith("tb/") or p.stem.lower().startswith("tb_") or p.stem.lower().endswith("_tb"):
            continue

        raw_lines = raw.splitlines()
        if p.suffix.lower() in (".vhd", ".vhdl"):
            clean_v = strip_comments(raw, is_vhdl=True)
            # VHDL Rule 1: Non-standard synopsys std_logic_arith / std_logic_unsigned
            for m in re.finditer(r"\buse\s+ieee\.std_logic_(?:arith|unsigned|signed)\.all\s*;", clean_v, re.I):
                ln = _line_of(clean_v, m.start())
                suggestions.append({
                    "category": "IEEE Standart & Taşınabilirlik",
                    "impact": "orta",
                    "title": "Standart dışı 'std_logic_arith / std_logic_unsigned' yerine 'numeric_std' kullanın",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "Synopsys kökenli 'std_logic_arith' ve 'std_logic_unsigned' IEEE 1076.3 standardı değildir "
                        "ve aynı ifadede signed/unsigned karışıklığına yol açar. 'ieee.numeric_std.all' kullanın."
                    ),
                    "before": _snippet(raw_lines, ln, 0),
                    "after": "use ieee.numeric_std.all;",
                })
            # VHDL Rule 2: Legacy clk'event and clk = '1' instead of rising_edge(clk)
            for m in re.finditer(r"(\w+)'event\s+and\s+\1\s*=\s*'1'", clean_v, re.I):
                clk_s = m.group(1)
                ln = _line_of(clean_v, m.start())
                suggestions.append({
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
                })
            # VHDL Rule 3: Unconstrained integer signal (32-bit FF waste)
            for m in re.finditer(r"\bsignal\s+(\w+)\s*:\s*integer\b(?!\s+range\b)", clean_v, re.I):
                sig_s = m.group(1)
                ln = _line_of(clean_v, m.start())
                suggestions.append({
                    "category": "Alan (LUT/FF)",
                    "impact": "yüksek",
                    "title": f"Sınırsız 'integer' sinyali ('{sig_s}') 32-bit Flip-Flop sentezler!",
                    "file": rel,
                    "line": ln,
                    "why": (
                        "VHDL'de 'range' belirtilmeyen 'integer' sinyaller varsayılan olarak 32-bit işaretli "
                        "yazmaç (register) üretir. 'range 0 to MAX' veya 'unsigned(N-1 downto 0)' kullanarak alanı küçültün."
                    ),
                    "before": _snippet(raw_lines, ln, 0),
                    "after": f"signal {sig_s} : integer range 0 to 15 := 0;",
                })
            # VHDL Rule 4: Case without 'when others =>'
            for m in re.finditer(r"\bcase\s+([^\s]+)\s+is\b(.*?)\bend\s+case\b", clean_v, re.I | re.S):
                csig, cbody = m.group(1), m.group(2)
                ln = _line_of(clean_v, m.start())
                if not re.search(r"\bwhen\s+others\s*=>", cbody, re.I):
                    suggestions.append({
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
                        "after": f"case {csig} is\n  ...\n  when others => ...\nend case;",
                    })
            continue

        clean = strip_comments(raw)

        # 1. Legacy always @(...) instead of always_ff / always_comb
        for m in re.finditer(r"\balways\s*@\s*\(([^)]*)\)", clean):
            sens = m.group(1)
            ln = _line_of(clean, m.start())
            is_seq = bool(re.search(r"\b(posedge|negedge)\b", sens))
            replacement = f"always_ff @({sens.strip()})" if is_seq else "always_comb"
            suggestions.append({
                "category": "Güvenilirlik & Sentez",
                "impact": "orta",
                "title": f"Klasik 'always @' yerine '{replacement.split()[0]}' kullanın",
                "file": rel,
                "line": ln,
                "why": (
                    "SystemVerilog 'always_ff' ve 'always_comb' blokları, sentezleyicinin istemeden latch "
                    "veya çoklu sürücü (multiple driver) üretmesini derleme aşamasında engeller."
                ),
                "before": _snippet(raw_lines, ln, 0),
                "after": replacement + " begin\n    ...\nend",
            })

        # 2. Blocking assignment (=) inside sequential always_ff / always @(posedge...)
        for m in re.finditer(r"\b(always_ff|always\s*@\s*\([^)]*(?:posedge|negedge)[^)]*\))\s*begin(.*?)\bend\b", clean, re.S):
            body = m.group(2)
            base_pos = m.start(2)
            for bm in re.finditer(r"(?<![<>=!])=(?!=)", body):
                # Ignore for-loop initializers
                line_start = body.rfind("\n", 0, bm.start()) + 1
                line_txt = body[line_start:body.find("\n", bm.start())]
                if re.search(r"\bfor\s*\(", line_txt):
                    continue
                ln = _line_of(clean, base_pos + bm.start())
                src_line = _snippet(raw_lines, ln, 0)
                suggestions.append({
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
                })

        # 3. Case statement without 'unique case' (parallel mux optimization)
        for m in re.finditer(r"(?<!\bunique\s)(?<!\bpriority\s)\bcase\s*\(([^)]+)\)(.*?)\bendcase\b", clean, re.S):
            sig = m.group(1).strip()
            body = m.group(2)
            ln = _line_of(clean, m.start())
            has_default = bool(re.search(r"\bdefault\s*:", body))
            if not has_default:
                suggestions.append({
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
                })
            else:
                # Check if default branch duplicates an existing branch assignment (redundant logic)
                branches = re.findall(r"(\w+)\s*:\s*([^;\n]+);", body)
                by_label = dict(branches)
                def_rhs = by_label.get("default", "").strip()
                non_def = [k for k, v in branches if k != "default"]
                suggestions.append({
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
                    "before": f"case ({sig})",
                    "after": f"unique case ({sig})",
                })

        # 4. Long if-else-if chain (>= 3 else if) -> priority encoder warning
        for m in re.finditer(r"\bif\s*\([^)]+\).*?(?:\belse\s+if\s*\([^)]+\).*?){3,}", clean, re.S):
            ln = _line_of(clean, m.start())
            suggestions.append({
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
                    "category": "Alan (LUT/DSP)",
                    "impact": "orta",
                    "title": f"2'nin kuvvetiyle ({val}) '{op}' işlemi yerine bit kaydırma ('{shift_op} {shift}')",
                    "file": rel,
                    "line": ln,
                    "why": "Bit kaydırma donanımda sıfır kapı (sadece kablo yönlendirmesi) maliyetlidir.",
                    "before": f"{var} {op} {val}",
                    "after": f"{var} {shift_op} {shift}",
                })

        # 6. Unsized integer literals in signal arithmetic (ignore [WIDTH-1:0] bit slices and ALL_CAPS params)
        for m in re.finditer(r"(?<!\[)\b([a-z_][a-z0-9_]*)\s*([+\-])\s*1\b(?!\s*'[bhdBHD])(?!\s*:)", clean):
            var, op = m.group(1), m.group(2)
            if var in ("i", "j", "k", "genvar"):
                continue
            ln = _line_of(clean, m.start())
            suggestions.append({
                "category": "Kod Kalitesi & Genişlik",
                "impact": "düşük",
                "title": f"Boyutsuz sabit ('{var} {op} 1') 32-bit genişletmeye yol açar",
                "file": rel,
                "line": ln,
                "why": (
                    "SystemVerilog'da boyutsuz '1' sabiti 32-bit signed int kabul edilir ve lint araçlarında "
                    "WIDTHEXPAND/WIDTHTRUNC uyarısı üretir. Genişlik uyumu için 1'b1 kullanın."
                ),
                "before": f"{var} {op} 1",
                "after": f"{var} {op} 1'b1",
            })

        # 7. Enum FSM encoding advice
        for m in re.finditer(r"\btypedef\s+enum\s+(logic\s*\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*\{([^}]+)\}\s*(\w+)", clean):
            width_decl, msb, lsb, items_s, ename = m.groups()
            items = [x.strip() for x in items_s.split(",") if x.strip()]
            ln = _line_of(clean, m.start())
            if not width_decl:
                bits = max(1, (len(items) - 1).bit_length())
                suggestions.append({
                    "category": "Alan (LUT/FF)",
                    "impact": "orta",
                    "title": f"'{ename}' enum tanımında bit genişliği belirtilmemiş (varsayılan 32-bit int!)",
                    "file": rel,
                    "line": ln,
                    "why": (
                        f"Bit genişliği verilmeyen enum'lar 32-bit register tüketir. {len(items)} durum için "
                        f"'logic [{bits-1}:0]' yeterlidir ({32 - bits} flip-flop tasarruf sağlar)."
                    ),
                    "before": f"typedef enum {{{items_s.strip()}}} {ename};",
                    "after": f"typedef enum logic [{bits-1}:0] {{{items_s.strip()}}} {ename};",
                })
            elif len(items) >= 4:
                suggestions.append({
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
                    "before": _snippet(raw_lines, ln, 0),
                    "after": (
                        f"(* fsm_encoding = \"one_hot\" *)\n" + _snippet(raw_lines, ln, 0)
                    ),
                })

    # Synthesis-driven insights (from Yosys stat + ltp)
    if synth_stats and synth_stats.get("success"):
        cells = synth_stats.get("cells") or {}
        depth = synth_stats.get("logic_depth") or 0
        latches = sum(v for k, v in cells.items() if "DLATCH" in k.upper())
        if latches > 0:
            suggestions.insert(0, {
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
            })
        if depth and depth >= 6:
            suggestions.append({
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
            })

    # Compute optimization score (0..100)
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
