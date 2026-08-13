/**
 * Multiple schematic pages (#multi-page): sheet resolution, page CRUD, the
 * move-to-page flow with its auto-stub of crossing wires, and persistence.
 *
 * The store reads editor preferences from localStorage at import time, so we
 * install a minimal in-memory localStorage and import dynamically.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { SchematicNode, ConnectionEdge, DeviceData } from "../types";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

let store: typeof import("../store")["useSchematicStore"];
let sheets: typeof import("../sheets");
let migrate: typeof import("../migrations")["migrateSchematic"];

function device(id: string, sheetId?: string, extra?: Partial<DeviceData>): SchematicNode {
  return {
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      deviceType: "computer",
      ports: [
        { id: `${id}-p1`, label: "OUT", signalType: "analog-audio", direction: "output" },
        { id: `${id}-p2`, label: "IN", signalType: "analog-audio", direction: "input" },
      ],
      ...(sheetId ? { sheetId } : {}),
      ...extra,
    },
  } as SchematicNode;
}

function wire(id: string, source: string, target: string): ConnectionEdge {
  return {
    id,
    source,
    sourceHandle: `${source}-p1`,
    target,
    targetHandle: `${target}-p2`,
    data: { signalType: "analog-audio" },
  } as ConnectionEdge;
}

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  ({ useSchematicStore: store } = await import("../store"));
  sheets = await import("../sheets");
  ({ migrateSchematic: migrate } = await import("../migrations"));
});

beforeEach(() => {
  store.setState({
    nodes: [],
    edges: [],
    schematicSheets: [{ id: "sheet-1", label: "Page 1" }],
    activeSheetId: "sheet-1",
    activePage: "schematic",
  });
});

describe("sheet resolution", () => {
  it("nodes without sheetId are on the first sheet", () => {
    const n = device("d1");
    expect(sheets.resolveNodeSheet(n, new Map([["d1", n]]), [], "sheet-1")).toBe("sheet-1");
  });

  it("children follow their room's sheet, not their own stamp", () => {
    const room = { id: "r1", type: "room", position: { x: 0, y: 0 }, data: { label: "R", sheetId: "sheet-2" } } as SchematicNode;
    const child = { ...device("d1", "sheet-1"), parentId: "r1" } as SchematicNode;
    const map = new Map<string, SchematicNode>([["r1", room], ["d1", child]]);
    expect(sheets.resolveNodeSheet(child, map, [], "sheet-1")).toBe("sheet-2");
  });

  it("waypoints follow their edge's source device", () => {
    const d = device("d1", "sheet-2");
    const wp = { id: "w1", type: "waypoint", position: { x: 0, y: 0 }, data: { edgeId: "e1", index: 0 } } as SchematicNode;
    const map = new Map<string, SchematicNode>([["d1", d], ["w1", wp]]);
    expect(sheets.resolveNodeSheet(wp, map, [wire("e1", "d1", "d1")], "sheet-1")).toBe("sheet-2");
  });
});

describe("sheet CRUD", () => {
  it("adds a sheet and makes it active", () => {
    const id = store.getState().addSchematicSheet("Racks");
    const s = store.getState();
    expect(s.schematicSheets).toHaveLength(2);
    expect(s.schematicSheets[1]).toMatchObject({ id, label: "Racks" });
    expect(s.activeSheetId).toBe(id);
  });

  it("refuses to delete a non-empty sheet", () => {
    const id = store.getState().addSchematicSheet();
    store.setState({ nodes: [device("d1", id)] });
    store.getState().removeSchematicSheet(id);
    expect(store.getState().schematicSheets).toHaveLength(2);
  });

  it("deletes an empty sheet and falls back to the first", () => {
    const id = store.getState().addSchematicSheet();
    store.getState().removeSchematicSheet(id);
    const s = store.getState();
    expect(s.schematicSheets).toHaveLength(1);
    expect(s.activeSheetId).toBe("sheet-1");
  });

  it("never deletes the first sheet", () => {
    store.getState().addSchematicSheet();
    store.getState().removeSchematicSheet("sheet-1");
    expect(store.getState().schematicSheets.some((sh) => sh.id === "sheet-1")).toBe(true);
  });

  it("switching sheets clears any selection", () => {
    const id = store.getState().addSchematicSheet();
    store.setState({ nodes: [{ ...device("d1"), selected: true }] });
    store.getState().setActiveSheet("sheet-1");
    store.getState().setActiveSheet(id);
    expect(store.getState().nodes.every((n) => !n.selected)).toBe(true);
  });
});

describe("moveNodesToSheet", () => {
  it("stamps the node and leaves same-sheet wires alone", () => {
    store.setState({ nodes: [device("a"), device("b")], edges: [wire("e1", "a", "b")] });
    const id = store.getState().addSchematicSheet();
    store.getState().moveNodesToSheet(["a", "b"], id);
    const s = store.getState();
    expect((s.nodes.find((n) => n.id === "a")!.data as { sheetId?: string }).sheetId).toBe(id);
    expect((s.nodes.find((n) => n.id === "b")!.data as { sheetId?: string }).sheetId).toBe(id);
    expect(s.edges).toHaveLength(1); // unchanged — both ends moved together
    expect(s.edges[0].data?.linkedConnectionId).toBeUndefined();
  });

  it("splits a crossing wire into a stub pair, one stub per sheet", () => {
    store.setState({ nodes: [device("a"), device("b")], edges: [wire("e1", "a", "b")] });
    const id = store.getState().addSchematicSheet();
    store.getState().moveNodesToSheet(["b"], id);
    const s = store.getState();

    // Original edge replaced by two legs sharing a linkedConnectionId.
    expect(s.edges).toHaveLength(2);
    const [l1, l2] = s.edges;
    expect(l1.data?.linkedConnectionId).toBeDefined();
    expect(l1.data?.linkedConnectionId).toBe(l2.data?.linkedConnectionId);

    // Each stub node sits on its own device's sheet.
    const map = new Map(s.nodes.map((n) => [n.id, n] as const));
    const srcStub = s.nodes.find((n) => n.id === "stub-e1-src")!;
    const tgtStub = s.nodes.find((n) => n.id === "stub-e1-tgt")!;
    expect(sheets.resolveNodeSheet(srcStub, map, s.edges, "sheet-1")).toBe("sheet-1");
    expect(sheets.resolveNodeSheet(tgtStub, map, s.edges, "sheet-1")).toBe(id);

    // And every edge is intra-sheet again.
    for (const e of s.edges) {
      const src = map.get(e.source)!;
      const tgt = map.get(e.target)!;
      expect(sheets.resolveNodeSheet(src, map, s.edges, "sheet-1"))
        .toBe(sheets.resolveNodeSheet(tgt, map, s.edges, "sheet-1"));
    }
  });

  it("moving a room-child moves the whole room", () => {
    const room = { id: "r1", type: "room", position: { x: 0, y: 0 }, data: { label: "R" } } as SchematicNode;
    const child = { ...device("d1"), parentId: "r1" } as SchematicNode;
    store.setState({ nodes: [room, child], edges: [] });
    const id = store.getState().addSchematicSheet();
    store.getState().moveNodesToSheet(["d1"], id);
    const s = store.getState();
    expect((s.nodes.find((n) => n.id === "r1")!.data as { sheetId?: string }).sheetId).toBe(id);
    const map = new Map(s.nodes.map((n) => [n.id, n] as const));
    expect(sheets.resolveNodeSheet(s.nodes.find((n) => n.id === "d1")!, map, [], "sheet-1")).toBe(id);
  });
});

describe("persistence", () => {
  it("exportToJSON carries sheets only when there are several", () => {
    expect(store.getState().exportToJSON().schematicSheets).toBeUndefined();
    store.getState().addSchematicSheet("Audio");
    const data = store.getState().exportToJSON();
    expect(data.schematicSheets).toHaveLength(2);
    expect(data.activeSheetId).toBeDefined();
  });

  it("importFromJSON restores sheets and validates the active id", () => {
    store.getState().importFromJSON({
      version: 52,
      name: "Multi",
      nodes: [],
      edges: [],
      schematicSheets: [
        { id: "sheet-1", label: "Page 1" },
        { id: "sheet-x", label: "Audio" },
      ],
      activeSheetId: "bogus-id",
    });
    const s = store.getState();
    expect(s.schematicSheets).toHaveLength(2);
    expect(s.activeSheetId).toBe("sheet-1"); // bogus id falls back to first
  });

  it("v51 files migrate to v52 with one default sheet", () => {
    const migrated = migrate({ version: 51, name: "Old", nodes: [], edges: [] });
    expect(migrated.version).toBeGreaterThanOrEqual(52);
    expect(migrated.schematicSheets).toEqual([{ id: "sheet-1", label: "Page 1" }]);
  });
});
