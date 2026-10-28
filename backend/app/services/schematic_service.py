"""Convert a Yosys JSON netlist into a schematic graph (nodes, pins, nets) + Critical Path / Timing Estimator."""
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

# Friendly names for Yosys internal cells
_CELL_LABELS = {
    "$and": "AND", "$or": "OR", "$xor": "XOR", "$xnor": "XNOR", "$not": "NOT",
    "$logic_and": "AND", "$logic_or": "OR", "$logic_not": "NOT",
    "$reduce_and": "RED&", "$reduce_or": "RED|", "$reduce_xor": "RED^",
    "$add": "ADD", "$sub": "SUB", "$mul": "MUL", "$div": "DIV", "$mod": "MOD",
    "$eq": "EQ", "$ne": "NE", "$lt": "LT", "$le": "LE", "$gt": "GT", "$ge": "GE",
    "$shl": "SHL", "$shr": "SHR", "$sshl": "SHL", "$sshr": "SHR",
    "$mux": "MUX", "$pmux": "PMUX", "$dff": "DFF", "$adff": "DFF+R",
    "$sdff": "DFF+SR", "$dffe": "DFF+EN", "$adffe": "DFF+R+EN", "$sdffe": "DFF+SR+EN",
    "$dlatch": "LATCH", "$mem": "MEM", "$mem_v2": "MEM", "$neg": "NEG", "$pos": "BUF",
}

_SEQUENTIAL_PREFIXES = ("$dff", "$adff", "$sdff", "$dlatch", "$mem", "$aldff", "$dffsr")


def _is_const(bit: Any) -> bool:
    return isinstance(bit, str)


def _cell_kind(ctype: str) -> str:
    if ctype.startswith(_SEQUENTIAL_PREFIXES):
        return "sequential"
    if ctype in ("$mux", "$pmux"):
        return "mux"
    if ctype.startswith("$"):
        return "comb"
    return "instance"


def _cell_delay_ns(node: Dict[str, Any]) -> float:
    kind = node.get("kind", "")
    if kind in ("port_in", "port_out", "sequential"):
        return 0.0
    ctype = node.get("type", "")
    if ctype in ("$mul", "$div", "$mod"):
        return 2.2
    if ctype in ("$add", "$sub", "$lt", "$le", "$gt", "$ge"):
        return 0.9
    if ctype in ("$mux", "$pmux"):
        return 0.55
    if kind == "instance":
        return 1.2
    return 0.45


def _compute_critical_path(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
    node_map = {n["id"]: n for n in nodes}
    adj: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    for e in edges:
        src, dst, eid = e["source"], e["target"], e["id"]
        # Do not traverse through sequential flip-flop boundaries (they break combinational paths)
        if node_map.get(src, {}).get("kind") == "sequential" and dst == src:
            continue
        adj[src].append((dst, eid))

    memo: Dict[str, Tuple[float, List[str], List[str]]] = {}
    visiting: Set[str] = set()

    def dfs(u: str, is_start: bool = False) -> Tuple[float, List[str], List[str]]:
        u_node = node_map.get(u, {})
        u_kind = u_node.get("kind", "")
        if not is_start and u_kind in ("sequential", "port_out"):
            return (0.0, [u], [])
        if u in memo and not is_start:
            return memo[u]
        if u in visiting:
            return (0.0, [u], [])

        visiting.add(u)
        self_d = _cell_delay_ns(u_node)
        best_d = 0.0
        best_nodes: List[str] = []
        best_edges: List[str] = []

        for v, eid in adj.get(u, []):
            sub_d, sub_n, sub_e = dfs(v, False)
            cand_d = sub_d + 0.12  # interconnect routing delay
            if cand_d > best_d or (cand_d == best_d and len(sub_n) > len(best_nodes)):
                best_d = cand_d
                best_nodes = sub_n
                best_edges = [eid] + sub_e

        visiting.remove(u)
        res = (self_d + best_d, [u] + best_nodes, best_edges)
        if not is_start:
            memo[u] = res
        return res

    best_total = 0.0
    crit_nodes: List[str] = []
    crit_edges: List[str] = []

    start_candidates = [n["id"] for n in nodes if n["kind"] in ("port_in", "sequential")]
    if not start_candidates:
        start_candidates = [n["id"] for n in nodes]

    for s in start_candidates:
        d, ns, es = dfs(s, True)
        if d > best_total or (d == best_total and len(ns) > len(crit_nodes)):
            best_total = d
            crit_nodes = ns
            crit_edges = es

    comb_depth = sum(1 for nid in crit_nodes if node_map.get(nid, {}).get("kind") in ("comb", "mux", "instance"))
    total_delay_ns = round(max(0.65, best_total + 0.35), 2)  # +0.35ns FF clk-to-q + setup
    fmax_mhz = round(min(650.0, 1000.0 / total_delay_ns), 1)

    return {
        "depth": comb_depth,
        "delay_ns": total_delay_ns,
        "fmax_mhz": fmax_mhz,
        "nodes": crit_nodes,
        "edges": crit_edges,
    }


def list_modules(netlist: Dict[str, Any]) -> List[str]:
    return list(netlist.get("modules", {}).keys())


def pick_top(netlist: Dict[str, Any], top: Optional[str] = None) -> str:
    modules = netlist.get("modules", {})
    if not modules:
        raise ValueError("Netlist contains no modules")
    if top and top in modules:
        return top
    for name, mod in modules.items():
        if mod.get("attributes", {}).get("top") in (1, "1", "00000000000000000000000000000001"):
            return name
    instantiated = {c["type"] for m in modules.values() for c in m.get("cells", {}).values()}
    for name in modules:
        if name not in instantiated:
            return name
    return next(iter(modules))


def build_schematic(netlist: Dict[str, Any], top: Optional[str] = None) -> Dict[str, Any]:
    top_name = pick_top(netlist, top)
    mod = netlist["modules"][top_name]

    bit_name: Dict[int, str] = {}
    for nname, ninfo in sorted(mod.get("netnames", {}).items(),
                               key=lambda kv: kv[1].get("hide_name", 0), reverse=True):
        for i, b in enumerate(ninfo.get("bits", [])):
            if _is_const(b):
                continue
            width = len(ninfo["bits"])
            bit_name[b] = nname if width == 1 else f"{nname}[{i}]"

    nodes: List[Dict[str, Any]] = []
    drivers: Dict[int, List[Tuple[str, str]]] = defaultdict(list)
    sinks: Dict[int, List[Tuple[str, str]]] = defaultdict(list)
    port_bits: Dict[Tuple[str, str], List[Any]] = {}
    by_type: Dict[str, int] = defaultdict(int)

    for pname, pinfo in mod.get("ports", {}).items():
        direction = pinfo.get("direction", "input")
        bits = pinfo.get("bits", [])
        nid = f"port:{pname}"
        kind = "port_in" if direction == "input" else "port_out"
        nodes.append({
            "id": nid, "kind": kind, "type": "port", "label": pname, "params": {},
            "ports": [{"id": f"{nid}.{pname}", "name": pname,
                       "dir": "output" if direction == "input" else "input",
                       "width": len(bits)}],
        })
        port_bits[(nid, pname)] = bits
        for b in bits:
            if _is_const(b):
                continue
            if direction == "input":
                drivers[b].append((nid, pname))
            else:
                sinks[b].append((nid, pname))
            if direction == "inout":
                drivers[b].append((nid, pname))

    for cname, cell in mod.get("cells", {}).items():
        ctype = cell.get("type", "?")
        nid = f"cell:{cname}"
        pdirs = cell.get("port_directions", {})
        ports = []
        for pname, bits in cell.get("connections", {}).items():
            d = pdirs.get(pname)
            if d is None:
                d = "output" if pname in ("Y", "Q", "O", "OUT") else "input"
            ports.append({"id": f"{nid}.{pname}", "name": pname, "dir": d, "width": len(bits)})
            port_bits[(nid, pname)] = bits
            for b in bits:
                if _is_const(b):
                    continue
                (drivers if d == "output" else sinks)[b].append((nid, pname))
        ports.sort(key=lambda p: (p["dir"] == "output", p["name"]))
        label = _CELL_LABELS.get(ctype, ctype.lstrip("$"))
        by_type[label] += 1
        display = cname if not cname.startswith("$") else label
        nodes.append({
            "id": nid, "kind": _cell_kind(ctype), "type": ctype, "label": display,
            "typeLabel": label, "params": cell.get("parameters", {}), "ports": ports,
        })

    groups: Dict[Tuple[str, str, str, str], List[int]] = defaultdict(list)
    for bit, drv_list in drivers.items():
        for (dn, dp) in drv_list:
            for (sn, sp) in sinks.get(bit, []):
                if dn == sn and dp == sp:
                    continue
                groups[(dn, dp, sn, sp)].append(bit)

    edges = []
    for i, ((dn, dp, sn, sp), bits) in enumerate(groups.items()):
        names = [bit_name.get(b) for b in bits if bit_name.get(b)]
        base = names[0].split("[")[0] if names else f"n{i}"
        edges.append({
            "id": f"e{i}", "net": base, "width": len(bits),
            "source": dn, "sourcePort": f"{dn}.{dp}",
            "target": sn, "targetPort": f"{sn}.{sp}",
        })

    critical_path = _compute_critical_path(nodes, edges)

    return {
        "module": top_name,
        "modules": list_modules(netlist),
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "cells": len(mod.get("cells", {})),
            "nets": len(mod.get("netnames", {})),
            "ports": len(mod.get("ports", {})),
            "by_type": dict(by_type),
        },
        "critical_path": critical_path,
    }
