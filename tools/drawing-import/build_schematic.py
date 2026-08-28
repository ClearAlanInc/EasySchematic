#!/usr/bin/env python3
"""Build an Maestro Connect .json file from a wire trace + project config.

Consumes the trace produced by extract_wiretrace.py, a customs spec (drawing-
local devices that should not enter the library), and the built-in library
fallback JSON. Emits a schematic the app opens directly (File -> Open).

Usage:
    python3 build_schematic.py trace.json config.py out.json

Project config supplies (see README.md):
    LIB_MAP        [(designator_regex, library modelNumber or None), ...]
    LABEL_MAP      [(designator_regex, library label), ...]  # when model is None
    CUSTOMS        {designator: {deviceType, model, ports:[...]}, ...}
    POSITIONS      {sheet: {designator: [x, y]}}   # from the source drawing
    ROOM_OFFSET    {sheet: (x, y)}; ROOMS [(label, x, y), ...]
    SIG_BY_PREFIX  {cable-prefix: signalType}
    rewrite(designator, port) -> port   # drawing->template port-name fixes
    canon(designator) -> designator     # designator normalization
    FIX            {(cableId, device): (new_device|None, new_port)}
    NOISE          set of port labels that are annotations, not ports
"""
import importlib.util
import json
import re
import sys

FALLBACK = "src/deviceLibrary.fallback.json"

LETTER = {c: str(i + 1) for i, c in enumerate("abcdefgh")}


def load_config(path):
    spec = importlib.util.spec_from_file_location("project_config", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def norm(s):
    s = s.lower().replace("i/p", "in").replace("o/p", "out").replace("\\", "/")
    s = re.sub(r"[()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def toks(s, syn):
    out = []
    for t in s.split():
        t = t.strip("()")
        if t in ("the", "port"):
            continue
        t = syn.get(t, t)
        out.append(LETTER.get(t, t) if len(t) == 1 else t)
    return out


def match_port(ports, want, syn):
    """Drawing label -> template port id. Exact, then token-set equality, then
    subset scoring (letter/number equivalence, synonym folding), then
    containment, then trailing-number agreement."""
    w = norm(want)
    cand = {p["id"]: norm(p["label"]) for p in ports}
    for pid, pl in cand.items():
        if pl == w:
            return pid
    wt = set(toks(w, syn))
    scored = []
    for pid, pl in cand.items():
        pt = set(toks(pl, syn))
        if wt and wt == pt:
            return pid
        if wt and wt <= pt:
            scored.append((len(pt - wt), pid))
        elif pt and pt <= wt:
            scored.append((len(wt - pt), pid))
    if scored:
        scored.sort()
        return scored[0][1]
    for pid, pl in cand.items():
        if w and (w in pl or pl in w):
            return pid
    m = re.search(r"(\d+[ab]?)$", w)
    if m:
        for pid, pl in cand.items():
            m2 = re.search(r"(\d+[ab]?)$", pl)
            if m2 and m2.group(1) == m.group(1):
                hw = w[: m.start()].strip()
                hp = pl[: m2.start()].strip()
                if not hw or hw.split()[-1:] == hp.split()[-1:] or hw in hp or hp in hw:
                    return pid
    return None


def build(trace, cfg):
    lib = json.load(open(FALLBACK))
    by_model = {t.get("modelNumber"): t for t in lib if t.get("modelNumber")}
    by_label = {t["label"]: t for t in lib}
    syn = getattr(cfg, "TOKEN_SYNONYMS", {})

    nodes, edges = [], []
    by_designator = {}
    counters = {"node": 0, "edge": 0}
    report = {"edges": 0, "port_miss": [], "skipped": []}

    def find_template(designator):
        for pat, model in cfg.LIB_MAP:
            if re.match(pat, designator):
                if model:
                    return by_model.get(model)
                for lp, lbl in getattr(cfg, "LABEL_MAP", []):
                    if re.match(lp, designator):
                        return by_label.get(lbl)
        return None

    def place(designator, sheet):
        ox, oy = cfg.ROOM_OFFSET.get(sheet, (0, 0))
        p = cfg.POSITIONS.get(sheet, {}).get(designator)
        scale = getattr(cfg, "SCALE", 1.45)
        if p:
            return {"x": round(ox + p[0] * scale, 1), "y": round(oy + p[1] * scale, 1)}
        return {"x": ox + 100, "y": oy + 2000}

    def ensure_node(designator, sheet):
        if designator in by_designator:
            return by_designator[designator]
        counters["node"] += 1
        key = f"device-{counters['node']}"
        tpl = find_template(designator)
        if tpl:
            ports = []
            for i, p in enumerate(tpl["ports"]):
                q = dict(p)
                q["templatePortId"] = p.get("id")
                q["id"] = f"{key}-p{i}"
                ports.append(q)
            data = {"label": designator, "baseLabel": tpl["label"], "model": tpl["label"],
                    "deviceType": tpl["deviceType"], "ports": ports, "hostname": designator}
            for k in ("manufacturer", "modelNumber", "powerDrawW", "heightMm",
                      "widthMm", "depthMm", "weightKg"):
                if tpl.get(k) is not None:
                    data[k] = tpl[k]
            if tpl.get("id"):
                data["templateId"] = tpl["id"]
        elif designator in cfg.CUSTOMS:
            c = cfg.CUSTOMS[designator]
            ports = []
            for i, p in enumerate(c["ports"]):
                if p.get("kind") == "passthrough":
                    ports.append({"id": f"{key}-p{i}", "label": p["label"],
                                  "signalType": "custom", "direction": "passthrough",
                                  "inheritsSignal": True,
                                  "rearConnectorType": p["rearConnectorType"],
                                  "frontConnectorType": p["frontConnectorType"]})
                else:
                    q = {"id": f"{key}-p{i}", "label": p["label"],
                         "signalType": p["signalType"], "direction": p["direction"]}
                    if p.get("connectorType"):
                        q["connectorType"] = p["connectorType"]
                    ports.append(q)
            data = {"label": designator, "deviceType": c["deviceType"],
                    "modelNumber": c["model"], "ports": ports, "hostname": designator}
        else:
            data = {"label": designator, "deviceType": "custom", "ports": [],
                    "hostname": designator, "_unmapped": True}
        node = {"id": key, "type": "device", "position": place(designator, sheet), "data": data}
        nodes.append(node)
        by_designator[designator] = node
        return node

    def handle_for(node, pid):
        port = next(q for q in node["data"]["ports"] if q["id"] == pid)
        return f"{pid}-front" if port["direction"] == "passthrough" else pid

    def add_edge(cid, n1, p1, n2, p2):
        port1 = next(p for p in n1["data"]["ports"] if p["id"] == p1)
        sig = port1["signalType"]
        if sig == "custom":
            sig = cfg.SIG_BY_PREFIX.get(cid[0], "custom")
        counters["edge"] += 1
        edges.append({"id": f"edge-{counters['edge']}", "source": n1["id"], "target": n2["id"],
                      "sourceHandle": handle_for(n1, p1), "targetHandle": handle_for(n2, p2),
                      "data": {"signalType": sig, "cableId": cid}})
        report["edges"] += 1

    noise = getattr(cfg, "NOISE", set())
    fixes = getattr(cfg, "FIX", {})
    for cid, ends in sorted(trace.items()):
        for e in ends:
            k = (cid, e["device"])
            if k in fixes:
                dev2, port2 = fixes[k]
                if dev2:
                    e["device"] = dev2
                e["port"] = port2
        if len(ends) != 2:
            report["skipped"].append(cid)
            continue
        if any(e["port"] in noise for e in ends):
            report["skipped"].append(cid)
            continue
        resolved, ok = [], True
        for e in ends:
            desig = cfg.canon(e["device"])
            n = ensure_node(desig, e["sheet"])
            pid = match_port(n["data"]["ports"], cfg.rewrite(desig, e["port"]), syn)
            if pid is None:
                report["port_miss"].append((cid, desig, e["port"]))
                ok = False
            resolved.append((n, pid))
        if ok:
            add_edge(cid, resolved[0][0], resolved[0][1], resolved[1][0], resolved[1][1])

    # Project hook: synthesize edges for patch looms, cross-sheet hops, etc.
    if hasattr(cfg, "synthesize"):
        cfg.synthesize(trace, ensure_node, match_port, add_edge, syn)

    for i, (label, ox, oy) in enumerate(getattr(cfg, "ROOMS", [])):
        w, h = getattr(cfg, "ROOM_SIZE", (3400, 2400))
        nodes.append({"id": f"room-{i+1}", "type": "room",
                      "position": {"x": ox - 60, "y": oy - 60},
                      "style": {"width": w, "height": h}, "width": w, "height": h,
                      "zIndex": -1, "data": {"label": label}})

    doc = {"version": 50, "name": getattr(cfg, "NAME", "Drawing Recreation"),
           "nodes": nodes, "edges": edges}
    return doc, report


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    trace_path, config_path, out_path = sys.argv[1:4]
    cfg = load_config(config_path)
    doc, report = build(json.load(open(trace_path)), cfg)
    json.dump(doc, open(out_path, "w"), indent=1)
    print(f"nodes: {len(doc['nodes'])} | edges: {report['edges']} | "
          f"port misses: {len(report['port_miss'])} | skipped: {len(report['skipped'])}")
    for m in report["port_miss"][:20]:
        print("  MISS", m)


if __name__ == "__main__":
    main()
