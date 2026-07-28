/**
 * Virtual wires stack on a physical ethernet port: the port carries one cable, and
 * every TCP/UDP stream rides that same run. Exercises the real store so the
 * connection validator and onConnect assignment are covered, not a re-implementation.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { SchematicNode } from "../types";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

let useSchematicStore: typeof import("../store")["useSchematicStore"];

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  ({ useSchematicStore } = await import("../store"));
});

/** Two ports: an ethernet NIC and an SDI port (to check the guard still bites). */
function device(id: string, x: number): SchematicNode {
  return {
    id,
    type: "device",
    position: { x, y: 0 },
    data: {
      label: id,
      deviceType: "dsp",
      ports: [
        { id: "eth", label: "Ethernet 1", signalType: "ethernet", direction: "bidirectional" },
        { id: "sdi", label: "SDI Out", signalType: "sdi", direction: "output" },
        { id: "sdiIn", label: "SDI In", signalType: "sdi", direction: "input" },
      ],
    },
  } as SchematicNode;
}

const ethConn = {
  source: "a", sourceHandle: "eth-out",
  target: "b", targetHandle: "eth-in",
};

beforeEach(() => {
  useSchematicStore.setState({ nodes: [device("a", 0), device("b", 600)], edges: [] });
});

describe("stacking virtual wires on an ethernet port", () => {
  it("accepts the first connection — the physical run", () => {
    const s = useSchematicStore.getState();
    expect(s.isValidConnection(ethConn)).toBe(true);
    s.onConnect(ethConn);
    const edges = useSchematicStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.signalType).toBe("ethernet");
  });

  it("accepts further connections on the same ports, as virtual wires", () => {
    const s = useSchematicStore.getState();
    s.onConnect(ethConn);
    // The port is now occupied — previously this was refused outright.
    expect(useSchematicStore.getState().isValidConnection(ethConn)).toBe(true);
    useSchematicStore.getState().onConnect(ethConn);
    useSchematicStore.getState().onConnect(ethConn);

    const edges = useSchematicStore.getState().edges;
    expect(edges).toHaveLength(3);
    expect(edges.map((e) => e.data?.signalType)).toEqual(["ethernet", "tcp", "tcp"]);
  });

  it("leaves the port's own signal type alone — only the wire type differs", () => {
    const s = useSchematicStore.getState();
    s.onConnect(ethConn);
    useSchematicStore.getState().onConnect(ethConn);
    const port = (useSchematicStore.getState().nodes[0].data as {
      ports: { id: string; signalType: string }[];
    }).ports.find((p) => p.id === "eth");
    expect(port?.signalType).toBe("ethernet");
  });

  it("still refuses a second cable on a non-network port", () => {
    const sdiConn = { source: "a", sourceHandle: "sdi-out", target: "b", targetHandle: "sdiIn-in" };
    const s = useSchematicStore.getState();
    s.onConnect(sdiConn);
    expect(useSchematicStore.getState().edges).toHaveLength(1);
    // One SDI cable per port — the physical guard is unchanged.
    expect(useSchematicStore.getState().isValidConnection(sdiConn)).toBe(false);
  });
});
