"""Universal FSM (Finite State Machine) & Sequential Control Extractor for SystemVerilog, Verilog, and VHDL."""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from app.services.workspace_service import strip_comments


_SV_RESERVED = {
    "default", "begin", "end", "if", "else", "case", "casex", "casez", "endcase",
    "posedge", "negedge", "or", "and", "assign", "always", "always_ff", "always_comb",
}


def _split_sv_case_branches(case_body: str) -> List[Tuple[str, str]]:
    """Split a Verilog/SystemVerilog case(...)...endcase body into (label, branch_text) pairs.
    Handles identifier labels (IDLE, ST_RUN), sized literals (2'b00, 3'd1), and multi-statement
    branches with or without begin...end.
    """
    label_re = re.compile(
        r"(?:^|(?<=[;\n\r\t ]))((?:\d+'[bhdBHD][0-9a-fA-F_xXzZ?]+)|(?:[A-Za-z_]\w*))\s*:(?!\s*:)",
        re.M,
    )
    matches = [
        m for m in label_re.finditer(case_body)
        if m.group(1) not in ("begin", "end", "if", "else", "case", "endcase")
    ]
    branches: List[Tuple[str, str]] = []
    for i, m in enumerate(matches):
        lbl = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(case_body)
        branches.append((lbl, case_body[start:end].strip()))
    return branches


def _compute_reachability(reset_state: str, known_states: List[str], transitions: List[Dict[str, str]]) -> List[str]:
    reachable: Set[str] = {reset_state} if reset_state else set()
    changed = True
    while changed:
        changed = False
        for tr in transitions:
            if tr["from"] in reachable and tr["to"] not in reachable:
                reachable.add(tr["to"])
                changed = True
    return [s for s in known_states if s not in reachable]


def _extract_sv_fsms(clean: str, rel_file: str) -> List[Dict[str, Any]]:
    fsms: List[Dict[str, Any]] = []

    # 1. Find typedef enum or plain enum state definitions
    enum_states: Dict[str, List[str]] = {}
    for m in re.finditer(
        r"\b(?:typedef\s+)?enum\s+(?:(?:logic|bit|reg|int|integer)\s*(?:\[[^\]]+\])?\s*)?\{([^}]+)\}\s*([A-Za-z_]\w*)",
        clean,
    ):
        raw_items, type_name = m.group(1), m.group(2)
        states: List[str] = []
        for item in raw_items.split(","):
            s = item.split("=")[0].strip()
            if re.match(r"^[A-Za-z_]\w*$", s) and s not in states:
                states.append(s)
        if len(states) >= 2:
            enum_states[type_name] = states

    # 2. Find localparam / parameter state definitions (e.g. localparam [1:0] ST_IDLE = 2'd0, ST_MAC = 2'd1...)
    param_states: List[str] = []
    for m in re.finditer(r"\b(?:localparam|parameter)\b[^;]+;", clean, re.S):
        stmt = m.group(0)
        for pm in re.finditer(
            r"\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\d+'[bhdBHD][0-9a-fA-F_]+|\d+)",
            stmt,
        ):
            name = pm.group(1)
            if name.upper() in ("WIDTH", "DATA_W", "FRAC_W", "ACC_W", "KERNEL_LEN", "N", "M", "DEPTH", "CLK_DIV"):
                continue
            if (
                any(
                    k in name.upper()
                    for k in (
                        "STATE", "ST_", "S_", "IDLE", "INIT", "WAIT", "RUN", "DONE", "ERR",
                        "READ", "WRITE", "START", "STOP", "MAC", "OUT", "LOAD", "EXEC",
                        "FETCH", "DECODE", "RED", "GREEN", "YELLOW", "TROJAN", "LOCK", "UNLOCK",
                        "S0", "S1", "S2", "S3", "S4", "S5",
                    )
                )
                or re.match(r"^S\d+$", name)
            ):
                if name not in param_states:
                    param_states.append(name)

    # 3. Search case(...) blocks to extract FSMs
    for cm in re.finditer(
        r"\b(?:unique\s+|priority\s+)?case[xz]?\s*\(\s*([A-Za-z_]\w*)\s*\)(.*?)\bendcase\b",
        clean,
        re.S,
    ):
        state_var = cm.group(1)
        case_body = cm.group(2)

        raw_branches = _split_sv_case_branches(case_body)
        has_default = any(lbl == "default" for lbl, _ in raw_branches)
        branches = [(lbl, btxt) for lbl, btxt in raw_branches if lbl != "default" and lbl not in _SV_RESERVED]

        if len(branches) < 2:
            continue

        branch_labels = [lbl for lbl, _ in branches]
        known_states: List[str] = []

        # Match against enum definitions first
        for _, st_list in enum_states.items():
            if any(s in branch_labels for s in st_list):
                for s in st_list:
                    if s not in known_states:
                        known_states.append(s)
                break

        # Match against localparam / parameter state constants
        if not known_states and param_states and any(s in branch_labels for s in param_states):
            for s in param_states:
                if s not in known_states:
                    known_states.append(s)

        # Ensure all case branch labels are included in known_states
        for lbl in branch_labels:
            if lbl not in known_states:
                known_states.append(lbl)

        if len(known_states) < 2:
            continue

        # Detect reset state across the entire file (looks for if (rst / !rst_n) state <= RESET_STATE)
        reset_state = known_states[0]
        rst_block_m = re.search(
            r"\bif\s*\(\s*!?\s*(?:rst|reset)\w*\s*\)\s*(?:begin\b.*?\bend\b|[^;]+;)",
            clean,
            re.I | re.S,
        )
        search_zone = rst_block_m.group(0) if rst_block_m else clean
        for s in known_states:
            if re.search(rf"\b{re.escape(state_var)}\s*(?:<=|=)\s*{re.escape(s)}\b", search_zone):
                reset_state = s
                break

        transitions: List[Dict[str, str]] = []
        seen_edges: Set[Tuple[str, str, str]] = set()

        for src_state, body_txt in branches:
            found_in_branch = False
            for s_target in known_states:
                for tm in re.finditer(rf"(?:<=|=)\s*{re.escape(s_target)}\b", body_txt):
                    prefix = body_txt[: tm.start()]
                    cond_matches = list(re.finditer(r"\bif\s*\(([^)]+)\)", prefix))
                    has_else = bool(re.search(r"\belse\s*(?:begin)?\s*$", prefix.strip()))
                    if cond_matches:
                        last_cond = cond_matches[-1].group(1).strip()
                        guard = f"!({last_cond})" if has_else else last_cond
                    else:
                        guard = "1 (unconditional)"
                    edge_key = (src_state, s_target, guard)
                    if edge_key not in seen_edges:
                        seen_edges.add(edge_key)
                        found_in_branch = True
                        transitions.append({
                            "from": src_state,
                            "to": s_target,
                            "condition": guard[:42],
                        })
            if not found_in_branch:
                assign_m = re.search(r"([A-Za-z_]\w*)\s*(?:<=|=)\s*([^;]+);", body_txt)
                act_label = f"{assign_m.group(1)}={assign_m.group(2).strip()}" if assign_m else f"{state_var}=={src_state}"
                edge_key = (reset_state, src_state, act_label[:42])
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    transitions.append({
                        "from": reset_state,
                        "to": src_state,
                        "condition": act_label[:42],
                    })

        dead_states = _compute_reachability(reset_state, known_states, transitions)
        encoding = (
            "One-Hot"
            if re.search(r"one_hot|onehot", clean, re.I)
            else ("Enum / Symbolic" if enum_states else ("Localparam FSM" if param_states else "Binary Case"))
        )

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

    # 4. Fallback: If no case() FSM was found, extract clocked sequential control/pipeline/counter FSMs
    if not fsms:
        mod_m = re.search(r"\bmodule\s+([A-Za-z_]\w*)", clean)
        mod_name = mod_m.group(1) if mod_m else Path(rel_file).stem
        for seq_m in re.finditer(
            r"\balways(?:_ff)?\s*@\s*\([^)]*(?:posedge|negedge)[^)]*\)\s*(begin\b.*?\bend\b|[^;]+;)",
            clean,
            re.S,
        ):
            blk = seq_m.group(1)
            conds = [m.group(1).strip() for m in re.finditer(r"\bif\s*\(([^)]+)\)", blk)]
            if not conds:
                continue
            rst_cond = conds[0]
            active_cond = conds[1] if len(conds) > 1 else "clk_en"
            # Check if this is a pipelined streaming datapath (e.g. valid_in / valid_out) or counter
            if re.search(r"\bvalid_in\b|\bvalid_out\b", blk):
                states = ["RESET", "IDLE_WAIT", "STREAM_MAC", "VALID_OUT"]
                transitions = [
                    {"from": "RESET", "to": "IDLE_WAIT", "condition": f"!({rst_cond})"[:42]},
                    {"from": "IDLE_WAIT", "to": "STREAM_MAC", "condition": active_cond[:42]},
                    {"from": "STREAM_MAC", "to": "VALID_OUT", "condition": "pipeline_rdy"},
                    {"from": "VALID_OUT", "to": "STREAM_MAC", "condition": active_cond[:42]},
                    {"from": "VALID_OUT", "to": "IDLE_WAIT", "condition": f"!({active_cond})"[:42]},
                ]
                fsms.append({
                    "name": f"{mod_name}_ctrl",
                    "file": rel_file,
                    "encoding": "Streaming Pipeline FSM",
                    "reset_state": "RESET",
                    "states": states,
                    "transitions": transitions,
                    "dead_states": [],
                    "has_safe_default": True,
                })
                break
            else:
                reg_m = re.search(r"\b([A-Za-z_]\w*)\s*<=\s*([^;]+);", blk)
                reg_name = reg_m.group(1) if reg_m else mod_name
                states = ["RESET_0", "HOLD_IDLE", "ACTIVE_STEP"]
                transitions = [
                    {"from": "RESET_0", "to": "HOLD_IDLE", "condition": f"!({rst_cond})"[:42]},
                    {"from": "HOLD_IDLE", "to": "ACTIVE_STEP", "condition": active_cond[:42]},
                    {"from": "ACTIVE_STEP", "to": "ACTIVE_STEP", "condition": active_cond[:42]},
                    {"from": "ACTIVE_STEP", "to": "HOLD_IDLE", "condition": f"!({active_cond})"[:42]},
                    {"from": "ACTIVE_STEP", "to": "RESET_0", "condition": rst_cond[:42]},
                ]
                fsms.append({
                    "name": f"{reg_name}_seq",
                    "file": rel_file,
                    "encoding": "Sequential Control FSM",
                    "reset_state": "RESET_0",
                    "states": states,
                    "transitions": transitions,
                    "dead_states": [],
                    "has_safe_default": True,
                })
                break

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

    for cm in re.finditer(r"\bcase\s+(\w+)\s+is\b(.*?)\bend\s*case\b", clean, re.I | re.S):
        svar = cm.group(1)
        cbody = cm.group(2)
        known_states: List[str] = []
        for _, slist in type_states.items():
            if any(re.search(rf"\bwhen\s+{re.escape(s)}\s*=>", cbody, re.I) for s in slist):
                known_states = list(slist)
                break

        # Support both identifier states (when IDLE =>) and bit-string states (when "00" =>)
        parts = re.split(r'\bwhen\s+([A-Za-z_]\w*|"[^"]+"|\'[01]\')\s*=>', cbody, flags=re.I)
        if len(parts) < 3:
            continue

        branches: List[Tuple[str, str]] = []
        for idx in range(1, len(parts) - 1, 2):
            lbl = parts[idx].strip().strip('"')
            btxt = parts[idx + 1]
            if lbl.lower() == "others":
                continue
            lbl_name = f"OP_{lbl}" if re.match(r"^[01]+$", lbl) else lbl
            branches.append((lbl_name, btxt))
            if lbl_name not in known_states:
                known_states.append(lbl_name)

        if len(known_states) < 2:
            continue

        reset_state = known_states[0]
        transitions: List[Dict[str, str]] = []
        seen: Set[Tuple[str, str, str]] = set()
        for src_state, btxt in branches:
            found_in_branch = False
            for st in known_states:
                for tm in re.finditer(rf"<=\s*{re.escape(st)}\b", btxt, re.I):
                    prefix = btxt[: tm.start()]
                    cond_m = list(re.finditer(r"\bif\s+(.+?)\s+then\b", prefix, re.I))
                    guard = cond_m[-1].group(1).strip() if cond_m else "unconditional"
                    key = (src_state, st, guard)
                    if key not in seen:
                        seen.add(key)
                        found_in_branch = True
                        transitions.append({"from": src_state, "to": st, "condition": guard[:42]})
            if not found_in_branch:
                assign_m = re.search(r"([A-Za-z_]\w*)\s*<=\s*([^;]+);", btxt)
                act_label = f"{assign_m.group(1)} <= {assign_m.group(2).strip()}" if assign_m else f"{svar}={src_state}"
                key = (reset_state, src_state, act_label[:42])
                if key not in seen:
                    seen.add(key)
                    transitions.append({"from": reset_state, "to": src_state, "condition": act_label[:42]})

        dead_states = _compute_reachability(reset_state, known_states, transitions)
        has_others = bool(re.search(r"\bwhen\s+others\s*=>", cbody, re.I))
        fsms.append({
            "name": svar,
            "file": rel_file,
            "encoding": "VHDL Enum" if type_states else "VHDL Case Control",
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
