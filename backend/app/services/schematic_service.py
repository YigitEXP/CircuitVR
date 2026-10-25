"""Convert a Yosys JSON netlist into a schematic graph (nodes, pins, nets).

Output format (consumed by the frontend schematic viewer):
{
  "module": str,
  "modules": [str],                 # all modules in the netlist
  "nodes": [{id, kind, type, label, params, ports: [{id, name, dir, width}]}],
  "edges": [{id, net, width, source, sourcePort, target, targetPort}],
  "stats": {cells, nets, ports, by_type: {type: count}}
}
"""
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

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
    return isinstance(bit, str)  # "0", "1", "x", "z"


def _cell_kind(ctype: str) -> str:
    if ctype.startswith(_SEQUENTIAL_PREFIXES):
        return "sequential"
    if ctype in ("$mux", "$pmux"):
        return "mux"
    if ctype.startswith("$"):
        return "comb"
    return "instance"  # user module instantiation


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
    # fall back: module never instantiated by another module
    instantiated = {c["type"] for m in modules.values() for c in m.get("cells", {}).values()}
    for name in modules:
        if name not in instantiated:
            return name
    return next(iter(modules))


def build_schematic(netlist: Dict[str, Any], top: Optional[str] = None) -> Dict[str, Any]:
    top_name = pick_top(netlist, top)
    mod = netlist["modules"][top_name]

    # Readable net names (prefer non-hidden)
    bit_name: Dict[int, str] = {}
    for nname, ninfo in sorted(mod.get("netnames", {}).items(),
                               key=lambda kv: kv[1].get("hide_name", 0), reverse=True):
        for i, b in enumerate(ninfo.get("bits", [])):
            if _is_const(b):
                continue
            width = len(ninfo["bits"])
            bit_name[b] = nname if width == 1 else f"{nname}[{i}]"

    nodes: List[Dict[str, Any]] = []
    # bit -> list of (node_id, port_name) for drivers / sinks
    drivers: Dict[int, List[Tuple[str, str]]] = defaultdict(list)
    sinks: Dict[int, List[Tuple[str, str]]] = defaultdict(list)
    port_bits: Dict[Tuple[str, str], List[Any]] = {}
    by_type: Dict[str, int] = defaultdict(int)

    # Top-level ports become terminal nodes
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

    # Cells
    for cname, cell in mod.get("cells", {}).items():
        ctype = cell.get("type", "?")
        nid = f"cell:{cname}"
        pdirs = cell.get("port_directions", {})
        ports = []
        for pname, bits in cell.get("connections", {}).items():
            d = pdirs.get(pname)
            if d is None:  # heuristic when directions are missing
                d = "output" if pname in ("Y", "Q", "O", "OUT") else "input"
            ports.append({"id": f"{nid}.{pname}", "name": pname, "dir": d, "width": len(bits)})
            port_bits[(nid, pname)] = bits
            for b in bits:
                if _is_const(b):
                    continue
                (drivers if d == "output" else sinks)[b].append((nid, pname))
        # Inputs first, outputs last for nicer layout
        ports.sort(key=lambda p: (p["dir"] == "output", p["name"]))
        label = _CELL_LABELS.get(ctype, ctype.lstrip("$"))
        by_type[label] += 1
        display = cname if not cname.startswith("$") else label
        nodes.append({
            "id": nid, "kind": _cell_kind(ctype), "type": ctype, "label": display,
            "typeLabel": label, "params": cell.get("parameters", {}), "ports": ports,
        })

    # Edges: group bits by (driver pin, sink pin) so buses render as one wire
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
    }
