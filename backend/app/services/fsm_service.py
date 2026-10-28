"""FSM (Finite State Machine) Extractor & Dead-State Security Analyzer for SV, Verilog, and VHDL."""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from app.services.workspace_service import strip_comments


def _extract_sv_fsms(clean: str, rel_file: str) -> List[Dict[str, Any]]:
    fsms: List[Dict[str, Any]] = []

    # 1. Find typedef enum state definitions: typedef enum logic [..] {S0, S1, ...} state_t;
    enum_states: Dict[str, List[str]] = {}
    for m in re.finditer(r"\btypedef\s+enum\s+(?:logic\s*(?:\[[^\]]+\])?\s*)?\{([^}]+)\}\s*(\w+)", clean):
        raw_items, type_name = m.group(1), m.group(2)
        states = []
        for item in raw_items.split(","):
            s = item.split("=")[0].strip()
            if re.match(r"^[A-Za-z_]\w*$", s):
                states.append(s)
        if len(states) >= 2:
            enum_states[type_name] = states

    # 2. Also check localparam / parameter state definitions (e.g. localparam IDLE = 0, RUN = 1...)
    param_states: List[str] = []
    for m in re.finditer(r"\b(?:localparam|parameter)\b[^;]+;", clean, re.S):
        stmt = m.group(0)
        for pm in re.finditer(r"\b([A-Z][A-Z0-9_]{1,})\s*=\s*(?:\d+'[bhd][0-9a-fA-F_]+|\d+)", stmt):
            name = pm.group(1)
            if any(k in name for k in ("STATE", "ST_", "IDLE", "INIT", "WAIT", "RUN", "DONE", "ERR", "READ", "WRITE", "START", "STOP", "S0", "S1", "S2", "S3")):
                if name not in param_states:
                    param_states.append(name)

    # 3. Search case(state) blocks to extract transitions
    for cm in re.finditer(r"\b(?:unique\s+|priority\s+)?case\s*\(\s*([A-Za-z_]\w*)\s*\)(.*?)\bendcase\b", clean, re.S):
        state_var = cm.group(1)
        case_body = cm.group(2)

        # Match candidate state list
        known_states: List[str] = []
        for _, st_list in enum_states.items():
            if any(re.search(rf"\b{re.escape(s)}\s*:", case_body) for s in st_list):
                known_states = list(st_list)
                break

        # Extract case items: STATE_NAME: begin ... end or single statement
        branch_re = re.compile(r"\b([A-Za-z_]\w*)\s*:\s*(begin\b.*?\bend\b|[^;]+;)", re.S)
        branches: List[Tuple[str, str]] = []
        for bm in branch_re.finditer(case_body):
            lbl = bm.group(1)
            if lbl in ("default", "begin", "end", "if", "else"):
                continue
            branches.append((lbl, bm.group(2)))
            if lbl not in known_states:
                known_states.append(lbl)

        if len(known_states) < 2 or len(branches) < 2:
            continue

        # Detect reset state
        reset_state = known_states[0]
        for s in known_states:
            if re.search(rf"(?:<=|=)\s*{re.escape(s)}\b", clean[:cm.start()]):
                reset_state = s
                break

        transitions: List[Dict[str, str]] = []
        seen_edges: Set[Tuple[str, str, str]] = set()

        for src_state, body_txt in branches:
            # Find assignments to state_var or next_state inside this branch
            for s_target in known_states:
                for tm in re.finditer(rf"(?:<=|=)\s*{re.escape(s_target)}\b", body_txt):
                    # Try to find enclosing if (...) condition before this assignment
                    prefix = body_txt[:tm.start()]
                    cond_matches = list(re.finditer(r"\bif\s*\(([^)]+)\)", prefix))
                    has_else = bool(re.search(r"\belse\s*$", prefix.strip()))
                    if cond_matches:
                        last_cond = cond_matches[-1].group(1).strip()
                        guard = f"!({last_cond})" if has_else else last_cond
                    else:
                        guard = "1 (unconditional)"
                    edge_key = (src_state, s_target, guard)
                    if edge_key not in seen_edges:
                        seen_edges.add(edge_key)
                        transitions.append({
                            "from": src_state,
                            "to": s_target,
                            "condition": guard[:42],
                        })

        # Compute reachability from reset_state
        reachable: Set[str] = {reset_state}
        changed = True
        while changed:
            changed = False
            for tr in transitions:
                if tr["from"] in reachable and tr["to"] not in reachable:
                    reachable.add(tr["to"])
                    changed = True

        dead_states = [s for s in known_states if s not in reachable]
        has_default = bool(re.search(r"\bdefault\s*:", case_body))
        encoding = "One-Hot" if re.search(r"one_hot|onehot", clean, re.I) else ("Binary" if len(known_states) <= 8 else "Binary / Gray")

        fsms.append({
            "name": state_var,
            "file": rel_file,
            "encoding": encoding,
            "reset_state": reset_state,
            "states": known_states,
            "transitions": transitions,
            "dead_states": dead_states,
            "has_safe_default": has_default,
        })

    return fsms


def _extract_vhdl_fsms(clean: str, rel_file: str) -> List[Dict[str, Any]]:
    fsms: List[Dict[str, Any]] = []
    # Match: type state_type is (S0, S1, S2);
    type_states: Dict[str, List[str]] = {}
    for m in re.finditer(r"\btype\s+(\w+)\s+is\s*\(([^)]+)\)\s*;", clean, re.I):
        tname = m.group(1)
        states = [x.strip() for x in m.group(2).split(",") if re.match(r"^[A-Za-z_]\w*$", x.strip())]
        if len(states) >= 2:
            type_states[tname] = states

    for cm in re.finditer(r"\bcase\s+(\w+)\s+is\b(.*?)\bend\s+case\b", clean, re.I | re.S):
        svar = cm.group(1)
        cbody = cm.group(2)
        known_states: List[str] = []
        for _, slist in type_states.items():
            if any(re.search(rf"\bwhen\s+{re.escape(s)}\s*=>", cbody, re.I) for s in slist):
                known_states = list(slist)
                break

        parts = re.split(r"\bwhen\s+([A-Za-z_]\w*)\s*=>", cbody, flags=re.I)
        if len(parts) < 3:
            continue

        branches: List[Tuple[str, str]] = []
        for idx in range(1, len(parts) - 1, 2):
            lbl = parts[idx]
            btxt = parts[idx + 1]
            if lbl.lower() == "others":
                continue
            branches.append((lbl, btxt))
            if lbl not in known_states:
                known_states.append(lbl)

        if len(known_states) < 2:
            continue

        reset_state = known_states[0]
        transitions: List[Dict[str, str]] = []
        seen: Set[Tuple[str, str, str]] = set()
        for src_state, btxt in branches:
            for st in known_states:
                for tm in re.finditer(rf"<=\s*{re.escape(st)}\b", btxt, re.I):
                    prefix = btxt[:tm.start()]
                    cond_m = list(re.finditer(r"\bif\s+(.+?)\s+then\b", prefix, re.I))
                    guard = cond_m[-1].group(1).strip() if cond_m else "unconditional"
                    key = (src_state, st, guard)
                    if key not in seen:
                        seen.add(key)
                        transitions.append({"from": src_state, "to": st, "condition": guard[:42]})

        reachable: Set[str] = {reset_state}
        changed = True
        while changed:
            changed = False
            for tr in transitions:
                if tr["from"] in reachable and tr["to"] not in reachable:
                    reachable.add(tr["to"])
                    changed = True

        dead_states = [s for s in known_states if s not in reachable]
        has_others = bool(re.search(r"\bwhen\s+others\s*=>", cbody, re.I))
        fsms.append({
            "name": svar,
            "file": rel_file,
            "encoding": "VHDL Enum",
            "reset_state": reset_state,
            "states": known_states,
            "transitions": transitions,
            "dead_states": dead_states,
            "has_safe_default": has_others,
        })

    return fsms


def extract_workspace_fsms(root: Path, files: List[str], top: Optional[str] = None) -> Dict[str, Any]:
    all_fsms: List[Dict[str, Any]] = []
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
        if rel.lower().startswith("tb/") or p.stem.lower().startswith("tb_"):
            continue
        is_vhdl = p.suffix.lower() in (".vhd", ".vhdl")
        clean = strip_comments(raw, is_vhdl=is_vhdl)
        if is_vhdl:
            all_fsms.extend(_extract_vhdl_fsms(clean, rel))
        else:
            all_fsms.extend(_extract_sv_fsms(clean, rel))

    return {
        "total_fsms": len(all_fsms),
        "fsms": all_fsms,
    }
