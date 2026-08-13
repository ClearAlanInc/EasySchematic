/**
 * Wire tags (#wire-tags): auto-assigned pair codes on stub splits, rename
 * propagation to both ends, and sequential allocation that never collides.
 *
 * The store reads editor preferences from localStorage at import time, so we
 * install a minimal in-memory localStorage and import dynamically.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { SchematicNode, ConnectionEdge, StubLabelData } from "../types";

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

function device(id: string): SchematicNode {
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

function stubTags(): Map<string, string | undefined> {
  return new Map(
    store.getState().nodes
      .filter((n) => n.type === "stub-label")
      .map((n) => [n.id, (n.data as StubLabelData).tag] as const),
  );
}

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  ({ useSchematicStore: store } = await import("../store"));
});

beforeEach(() => {
  store.setState({
    nodes: [device("a"), device("b"), device("c"), device("d")],
    edges: [wire("e1", "a", "b"), wire("e2", "c", "d")],
    schematicSheets: [{ id: "sheet-1", label: "Page 1" }],
    activeSheetId: "sheet-1",
  });
});

describe("wire tag assignment", () => {
  it("both ends of a split get the same auto tag", () => {
    store.getState().convertEdgeToStubs("e1");
    const tags = stubTags();
    expect(tags.get("stub-e1-src")).toBe("T1");
    expect(tags.get("stub-e1-tgt")).toBe("T1");
  });

  it("tags allocate sequentially across pairs", () => {
    store.getState().convertEdgeToStubs("e1");
    store.getState().convertEdgeToStubs("e2");
    const tags = stubTags();
    expect(tags.get("stub-e1-src")).toBe("T1");
    expect(tags.get("stub-e2-src")).toBe("T2");
    expect(tags.get("stub-e2-tgt")).toBe("T2");
  });

  it("allocation skips past renamed tags to avoid collisions", () => {
    store.getState().convertEdgeToStubs("e1");
    const link = (store.getState().nodes.find((n) => n.id === "stub-e1-src")!.data as StubLabelData).linkedConnectionId;
    store.getState().renameWireTag(link, "T9");
    store.getState().convertEdgeToStubs("e2");
    expect(stubTags().get("stub-e2-src")).toBe("T10");
  });
});

describe("renameWireTag", () => {
  it("updates both partners", () => {
    store.getState().convertEdgeToStubs("e1");
    const link = (store.getState().nodes.find((n) => n.id === "stub-e1-src")!.data as StubLabelData).linkedConnectionId;
    store.getState().renameWireTag(link, "AUX-FEED");
    const tags = stubTags();
    expect(tags.get("stub-e1-src")).toBe("AUX-FEED");
    expect(tags.get("stub-e1-tgt")).toBe("AUX-FEED");
  });

  it("empty string clears the tag from both ends", () => {
    store.getState().convertEdgeToStubs("e1");
    const link = (store.getState().nodes.find((n) => n.id === "stub-e1-src")!.data as StubLabelData).linkedConnectionId;
    store.getState().renameWireTag(link, "  ");
    const tags = stubTags();
    expect(tags.get("stub-e1-src")).toBeUndefined();
    expect(tags.get("stub-e1-tgt")).toBeUndefined();
  });

  it("does not touch other pairs", () => {
    store.getState().convertEdgeToStubs("e1");
    store.getState().convertEdgeToStubs("e2");
    const link = (store.getState().nodes.find((n) => n.id === "stub-e1-src")!.data as StubLabelData).linkedConnectionId;
    store.getState().renameWireTag(link, "X1");
    expect(stubTags().get("stub-e2-src")).toBe("T2");
  });
});

describe("cross-page moves keep tagging", () => {
  it("a wire split by moveNodesToSheet carries a tag on both pages", () => {
    const id = store.getState().addSchematicSheet("Page 2");
    store.getState().setActiveSheet("sheet-1");
    store.getState().moveNodesToSheet(["b"], id);
    const tags = stubTags();
    expect(tags.get("stub-e1-src")).toBe("T1");
    expect(tags.get("stub-e1-tgt")).toBe("T1");
  });
});
