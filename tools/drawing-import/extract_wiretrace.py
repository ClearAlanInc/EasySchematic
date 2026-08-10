#!/usr/bin/env python3
"""Extract a wire trace from a vector PDF drawing package.

Method (proven on a multi-sheet functional package): consultant drawings
label every wire with a cable number at BOTH endpoints. Instead of visually
tracing lines, extract positioned text with PyMuPDF, find cable-number tokens,
associate each token with its adjacent port label and owning device block, and
join the two tokens per cable id into a connection.

Requires: pip install pymupdf

Usage:
    python3 extract_wiretrace.py package.pdf config.py trace.json

The config module supplies the project-specific patterns and hooks — see
README.md. Output is a JSON map of cable id -> list of endpoint dicts
({sheet, device, port, ...}); ids with two endpoints are complete connections,
single-ended ids carry `via`/`pending` annotations for downstream resolution.
"""
import fitz  # PyMuPDF
import importlib.util
import json
import re
import sys
from collections import defaultdict


def load_config(path):
    spec = importlib.util.spec_from_file_location("project_config", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def lines_from_words(words):
    """Group PyMuPDF word tuples into text lines with bounding boxes."""
    lines = {}
    for x0, y0, x1, y1, w, b, l, wn in words:
        lines.setdefault((b, l), []).append((x0, y0, x1, y1, w))
    out = []
    for ws in lines.values():
        ws.sort(key=lambda t: t[0])
        out.append({
            "text": " ".join(t[4] for t in ws),
            "x0": min(t[0] for t in ws), "y0": min(t[1] for t in ws),
            "x1": max(t[2] for t in ws), "y1": max(t[3] for t in ws),
        })
    return out


def extract(pdf_path, cfg):
    doc = fitz.open(pdf_path)
    cable_re = re.compile(cfg.CABLE_PATTERN)
    dev_re = re.compile(cfg.DEVICE_PATTERN)
    tag_re = re.compile(getattr(cfg, "PATCH_TAG_PATTERN", r"^$"))
    patch_dev_re = re.compile(getattr(cfg, "PATCH_DEVICE_PATTERN", r"^$"))
    row_tol = getattr(cfg, "ROW_TOLERANCE", 4)
    max_dx = getattr(cfg, "MAX_LABEL_DISTANCE", 150)

    result = defaultdict(list)
    for page_index, sheet_name in cfg.SHEETS.items():
        lines = lines_from_words(doc[page_index].get_text("words"))
        cables = [l for l in lines if cable_re.match(l["text"])]
        others = [l for l in lines if not cable_re.match(l["text"])]
        titles = [l for l in others if dev_re.match(l["text"])]

        def owner(p):
            """Nearest device title; horizontal distance is discounted because
            titles sit mid-block while ports hug the block edges."""
            px, py = (p["x0"] + p["x1"]) / 2, (p["y0"] + p["y1"]) / 2
            best, bd = None, 1e9
            for t in titles:
                tx, ty = (t["x0"] + t["x1"]) / 2, (t["y0"] + t["y1"]) / 2
                d = abs(tx - px) * 0.6 + abs(ty - py)
                if abs(tx - px) < 160 and d < bd:
                    best, bd = t, d
            return best

        def nearest_port(c):
            """Closest same-row label that belongs to a device. Bare patch-row
            tags (e.g. "A35") only count on patch devices — on anything else
            they are jackfield designations sitting between the cable number
            and the real port name."""
            cy = (c["y0"] + c["y1"]) / 2
            cand = []
            for p in others:
                py = (p["y0"] + p["y1"]) / 2
                if abs(py - cy) > row_tol:
                    continue
                dx = min(abs(p["x0"] - c["x1"]), abs(c["x0"] - p["x1"]))
                if dx < max_dx:
                    cand.append((dx, p))
            cand.sort(key=lambda t: t[0])
            for dx, p in cand:
                d = owner(p)
                if not d:
                    continue
                if tag_re.match(p["text"]) and not patch_dev_re.match(d["text"]):
                    continue
                return p, d
            return None, None

        for c in cables:
            p, d = nearest_port(c)
            if p and d:
                result[c["text"]].append(
                    {"sheet": sheet_name, "device": d["text"], "port": p["text"]})

    # Project hook: resolve single-ended cables via alias chevrons, reference
    # arrows, or any other package-specific notation.
    if hasattr(cfg, "resolve_singles"):
        cfg.resolve_singles(doc, result, lines_from_words)
    return result


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    pdf_path, config_path, out_path = sys.argv[1:4]
    cfg = load_config(config_path)
    result = extract(pdf_path, cfg)
    json.dump(result, open(out_path, "w"), indent=1)
    paired = sum(1 for v in result.values() if len(v) == 2)
    singles = sum(1 for v in result.values() if len(v) == 1)
    print(f"cable ids: {len(result)} | both ends: {paired} | one end: {singles}")


if __name__ == "__main__":
    main()
