"""Compact VCD parser producing per-signal change lists."""
from typing import Any, Dict, List


def parse_vcd(path: str, max_changes_per_signal: int = 100000) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        tokens = fh.read().split()

    scope: List[str] = []
    timescale = ""
    variables: List[Dict[str, Any]] = []
    changes: Dict[str, List[List[Any]]] = {}
    truncated = False
    in_data = False
    time = 0
    end_time = 0
    n = len(tokens)
    i = 0

    def until_end(start: int) -> int:
        j = start
        while j < n and tokens[j] != "$end":
            j += 1
        return j

    def record(ident: str, val: str) -> None:
        nonlocal truncated
        lst = changes.get(ident)
        if lst is None:
            return
        if lst and lst[-1][1] == val:
            return
        if len(lst) >= max_changes_per_signal:
            truncated = True
            return
        lst.append([time, val])

    while i < n:
        t = tokens[i]
        if not in_data:
            if t == "$scope":
                j = until_end(i + 1)
                scope.append(tokens[i + 2] if i + 2 < j else "?")
                i = j
            elif t == "$upscope":
                if scope:
                    scope.pop()
                i = until_end(i + 1)
            elif t == "$timescale":
                j = until_end(i + 1)
                timescale = " ".join(tokens[i + 1:j])
                i = j
            elif t == "$var":
                j = until_end(i + 1)
                parts = tokens[i + 1:j]
                if len(parts) >= 4:
                    vtype, size, ident, ref = parts[0], parts[1], parts[2], parts[3]
                    if len(parts) > 4 and parts[4].startswith("["):
                        ref += parts[4]
                    variables.append({
                        "id": ident, "type": vtype, "width": int(size) if size.isdigit() else 1,
                        "name": ".".join(scope + [ref]), "short": ref, "scope": ".".join(scope),
                    })
                    changes.setdefault(ident, [])
                i = j
            elif t == "$enddefinitions":
                in_data = True
                i = until_end(i + 1)
            elif t.startswith("$"):
                i = until_end(i + 1)
        else:
            c = t[0]
            if c == "#":
                try:
                    time = int(t[1:])
                    end_time = max(end_time, time)
                except ValueError:
                    pass
            elif c in "bBrR":
                if i + 1 < n:
                    record(tokens[i + 1], t[1:].lower())
                    i += 1
            elif c in "01xXzZ" and len(t) > 1:
                record(t[1:], c.lower())
            # $dumpvars / $end / $comment markers are ignored
        i += 1

    return {
        "timescale": timescale,
        "end_time": end_time,
        "signals": variables,
        "changes": {k: v for k, v in changes.items() if v},
        "truncated": truncated,
    }
