# Drawing Import Tooling

Recreate a consultant's PDF schematic package as an EasySchematic file. Proven
end-to-end on a 5-sheet functional package (111 devices, 380 wires): every
device resolved, zero unresolved port mappings, audited against the source.

## Why this works

Professional AV drawing packages label every wire with a **cable number at both
endpoints** (e.g. `A2005020`, prefix = discipline). On a vector PDF those
labels are extractable *text with coordinates* — so instead of visually tracing
lines through dense sheets, join the two occurrences of each cable id:

1. `extract_wiretrace.py` — PyMuPDF positioned-text pass. Finds cable tokens,
   associates each with its same-row port label and owning device block, and
   emits `{cableId: [end, end]}`. Single-ended ids are cross-drawing references
   or patch-loom halves for downstream resolution.
2. `build_schematic.py` — assembles the app schematic: device instances from
   the built-in library (`src/deviceLibrary.fallback.json`) or drawing-local
   customs, fuzzy drawing→template port-name matching, edges carrying the
   original cable numbers as stored cable IDs, and room regions with layout
   positions taken from the source sheets.

Both scripts take a **per-project config** (a Python module). Project configs
contain client data (device schedules, cable numbering, designators) and must
NOT be committed — keep them alongside the client PDF.

## Per-project config surface

```python
CABLE_PATTERN   = r"^[ANCVM]\d{7}$"          # cable-number token shape
DEVICE_PATTERN  = r"^(DSP CORE \d\d|...)$"    # device title blocks
PATCH_TAG_PATTERN    = r"^[A-E]?\d{1,2}$"     # jackfield/punch row tags
PATCH_DEVICE_PATTERN = r"^(TPB|FB|AJF)"       # devices where tags ARE ports
SHEETS      = {1: "SHEET-1", ...}              # 0-based page -> sheet name
LIB_MAP     = [(r"^DSP CORE 01$", "Server Core X10"), ...]
CUSTOMS     = {...}      # drawing-local devices (never library entries)
POSITIONS   = {...}      # title coords per sheet (extract with PyMuPDF)
ROOM_OFFSET / ROOMS / SCALE / SIG_BY_PREFIX / TOKEN_SYNONYMS / NOISE / FIX
def canon(designator): ...      # designator normalization
def rewrite(designator, port): ...  # drawing->template port-name fixes
def resolve_singles(doc, result, lines_fn): ...  # alias chevrons, ref arrows
def synthesize(trace, ensure_node, match_port, add_edge, syn): ...  # looms
```

## Usage

```bash
pip install pymupdf
python3 tools/drawing-import/extract_wiretrace.py package.pdf project_config.py trace.json
python3 tools/drawing-import/build_schematic.py trace.json project_config.py out.json
```

Open `out.json` via File → Open. For iterative work you can inject it into the
running dev app: write the JSON string into the `easyschematic-autosave`
localStorage key and reload (back up the existing value first).

## Field notes (learned the hard way)

- **Row tags vs port names**: bare tags like `A35` between a cable number and a
  device edge are jackfield designations, not ports — only accept them on
  patch devices.
- **Stacked look-alike blocks** (e.g. three identical interface boxes):
  proximity association can pick the wrong block; the cable-number grouping
  itself usually disambiguates (sequential ids per unit). Verify those.
- **Jackfield normalling**: sources land on A-rows that normal through to
  B-rows; each signal path is TWO cables through the patch point. Decide per
  job whether to model both halves or collapse to direct wires — collapsing is
  signal-flow-equivalent but understates the patch infrastructure.
- **Reference arrows** (`CTRL SW 01, PORT 10, SHEET-4`) resolve cross-sheet
  hops inside the package; arrows to drawings outside the package are external
  terminations (stub labels or boundary devices).
- Audit before delivery: recheck every built edge against the trace, and
  visually verify a random cable sample against high-zoom crops of the PDF.
