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
  useSchematicStore.setState({
    nodes: [device("a", 0), device("b", 600), device("c", 1200)],
    edges: [],
  });
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

  it("keeps exactly one physical cable no matter how many wires are added", () => {
    const s = useSchematicStore.getState();
    for (let i = 0; i < 5; i++) useSchematicStore.getState().onConnect(ethConn);
    void s;
    const edges = useSchematicStore.getState().edges;
    const physical = edges.filter((e) => !["tcp", "udp"].includes(e.data?.signalType ?? ""));
    const virtual = edges.filter((e) => ["tcp", "udp"].includes(e.data?.signalType ?? ""));
    expect(edges).toHaveLength(5);
    expect(physical).toHaveLength(1);
    expect(virtual).toHaveLength(4);
  });

  it("still lets the physical cable be drawn after virtual wires exist", () => {
    // Seed a virtual-only port, as if the logical layer was documented first.
    useSchematicStore.setState({
      edges: [{
        id: "v1", source: "a", target: "b",
        sourceHandle: "eth-out", targetHandle: "eth-in",
        data: { signalType: "udp", networkPort: 5353 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any],
    });
    useSchematicStore.getState().onConnect(ethConn);
    const edges = useSchematicStore.getState().edges;
    expect(edges).toHaveLength(2);
    // No physical cable was present, so this one is the real run.
    expect(edges[1].data?.signalType).toBe("ethernet");
  });

  it("treats -in and -out as one jack — a fed port takes no second cable", () => {
    // A bidirectional port is a single physical socket; feeding it on -in must not
    // leave -out free for another cable. The onward wire is a logical stream instead.
    const s = useSchematicStore.getState();
    s.onConnect({ source: "a", sourceHandle: "eth-out", target: "b", targetHandle: "eth-in" });
    useSchematicStore.getState().onConnect({
      source: "b", sourceHandle: "eth-out", target: "c", targetHandle: "eth-in",
    });
    const edges = useSchematicStore.getState().edges;
    expect(edges.map((e) => e.data?.signalType)).toEqual(["ethernet", "tcp"]);
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
