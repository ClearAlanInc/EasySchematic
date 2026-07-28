/**
 * Virtual sub-handles: TCP/UDP children of a network port. Each has its own handle,
 * so React Flow sees distinct handle pairs and several streams can be drawn between
 * the same two devices — which a single shared ethernet handle cannot do.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Port, SchematicNode } from "../types";
import { isVirtualSignal } from "../connectorTypes";
import { groupSubHandles } from "../subHandles";

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

const eth = (id: string, label: string): Port =>
  ({ id, label, signalType: "ethernet", direction: "bidirectional", connectorType: "rj45" });
const sub = (id: string, label: string, kind: "tcp" | "udp", parent: string): Port =>
  ({ id, label, signalType: kind, direction: "bidirectional", connectorType: "none", parentPortId: parent });

function device(id: string, prefix: string, x: number): SchematicNode {
  return {
    id, type: "device", position: { x, y: 0 },
    data: {
      label: id, deviceType: "dsp",
      ports: [
        eth(`${prefix}0`, "LAN"),
        sub(`${prefix}0t1`, "TCP 1", "tcp", `${prefix}0`),
        sub(`${prefix}0t2`, "TCP 2", "tcp", `${prefix}0`),
        sub(`${prefix}0u1`, "UDP 1", "udp", `${prefix}0`),
      ],
    },
  } as SchematicNode;
}

beforeEach(() => {
  useSchematicStore.setState({ nodes: [device("a", "a", 0), device("b", "b", 700)], edges: [] });
});

describe("virtual sub-handles", () => {
  it("carry a virtual signal type and point at their parent port", () => {
    const ports = (useSchematicStore.getState().nodes[0].data as { ports: Port[] }).ports;
    const subs = ports.filter((p) => p.parentPortId);
    expect(subs).toHaveLength(3);
    expect(subs.every((p) => isVirtualSignal(p.signalType))).toBe(true);
    expect(subs.every((p) => p.parentPortId === "a0")).toBe(true);
  });

  it("let several streams run between the same two devices", () => {
    const s = useSchematicStore.getState();
    s.onConnect({ source: "a", sourceHandle: "a0-out", target: "b", targetHandle: "b0-in" });
    useSchematicStore.getState().onConnect({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0t1-in" });
    useSchematicStore.getState().onConnect({ source: "a", sourceHandle: "a0t2-out", target: "b", targetHandle: "b0t2-in" });

    const edges = useSchematicStore.getState().edges;
    expect(edges).toHaveLength(3);
    // Every wire is its own handle pair — what React Flow needs to draw them all.
    expect(new Set(edges.map((e) => `${e.sourceHandle}->${e.targetHandle}`)).size).toBe(3);
  });

  it("keeps the physical cable physical and the sub-handle wires virtual", () => {
    const s = useSchematicStore.getState();
    s.onConnect({ source: "a", sourceHandle: "a0-out", target: "b", targetHandle: "b0-in" });
    useSchematicStore.getState().onConnect({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0t1-in" });
    useSchematicStore.getState().onConnect({ source: "a", sourceHandle: "a0u1-out", target: "b", targetHandle: "b0u1-in" });

    const types = useSchematicStore.getState().edges.map((e) => e.data?.signalType);
    expect(types[0]).toBe("ethernet");
    expect(types.slice(1).every((t) => isVirtualSignal(t))).toBe(true);
    // Still exactly one physical cable on the port, however many streams ride it.
    expect(types.filter((t) => !isVirtualSignal(t))).toHaveLength(1);
  });

  it("mates TCP with TCP and UDP with UDP", () => {
    const s = useSchematicStore.getState();
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0t1-in" })).toBe(true);
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0t2-in" })).toBe(true);
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0u1-out", target: "b", targetHandle: "b0u1-in" })).toBe(true);
  });

  it("refuses to mate TCP with UDP, in either direction", () => {
    const s = useSchematicStore.getState();
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0u1-in" })).toBe(false);
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0u1-out", target: "b", targetHandle: "b0t1-in" })).toBe(false);
  });

  it("never creates a TCP-to-UDP wire even if onConnect is called directly", () => {
    const s = useSchematicStore.getState();
    s.onConnect({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0u1-in" });
    expect(useSchematicStore.getState().edges).toHaveLength(0);
  });

  it("still lets a virtual wire land on a plain ethernet port", () => {
    const s = useSchematicStore.getState();
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0t1-out", target: "b", targetHandle: "b0-in" })).toBe(true);
    expect(s.isValidConnection({ source: "a", sourceHandle: "a0u1-out", target: "b", targetHandle: "b0-in" })).toBe(true);
  });
});

const P = (id: string, signalType: string, parentPortId?: string): Port =>
  ({ id, label: id, signalType, direction: "bidirectional", parentPortId } as Port);

describe("grouping sub-handles under their host port", () => {
  it("adopts loose TCP ports onto the ethernet port above them", () => {
    // What you get from adding TCP ports the ordinary way, before this fix.
    const out = groupSubHandles([P("lan", "ethernet"), P("t1", "tcp"), P("t2", "tcp")]);
    expect(out.map((p) => p.id)).toEqual(["lan", "t1", "t2"]);
    expect(out.slice(1).every((p) => p.parentPortId === "lan")).toBe(true);
  });

  it("pulls scattered sub-handles back under their parent", () => {
    const out = groupSubHandles([
      P("lan", "ethernet"), P("t1", "tcp", "lan"), P("com", "serial"), P("t2", "tcp", "lan"),
    ]);
    expect(out.map((p) => p.id)).toEqual(["lan", "t1", "t2", "com"]);
  });

  it("keeps each ethernet port's streams on their own port", () => {
    const out = groupSubHandles([
      P("lan1", "ethernet"), P("a", "tcp", "lan1"), P("lan2", "ethernet"), P("b", "tcp", "lan2"),
    ]);
    expect(out.map((p) => p.id)).toEqual(["lan1", "a", "lan2", "b"]);
    expect(out[1].parentPortId).toBe("lan1");
    expect(out[3].parentPortId).toBe("lan2");
  });

  it("never nests a sub-handle under another sub-handle", () => {
    const out = groupSubHandles([P("lan", "ethernet"), P("t1", "tcp", "lan"), P("t2", "tcp", "t1")]);
    expect(out.every((p) => !p.parentPortId || p.parentPortId === "lan")).toBe(true);
  });

  it("re-parents a sub-handle whose parent was deleted", () => {
    const out = groupSubHandles([P("lan", "ethernet"), P("t1", "tcp", "gone")]);
    expect(out.find((p) => p.id === "t1")?.parentPortId).toBe("lan");
  });

  it("leaves a virtual port alone when there is no network port to host it", () => {
    const out = groupSubHandles([P("hdmi", "hdmi"), P("t1", "tcp")]);
    expect(out.map((p) => p.id)).toEqual(["hdmi", "t1"]);
    expect(out[1].parentPortId).toBeUndefined();
  });
});

describe("v49→v50 migration repairs a whole file on load", () => {
  const port = (id: string, signalType: string, parentPortId?: string) => ({
    id, label: id, signalType, direction: "bidirectional",
    ...(parentPortId ? { parentPortId } : {}),
  });

  it("collapses a multi-level chain built by the first cut of the feature", async () => {
    const { migrateSchematic, CURRENT_SCHEMA_VERSION } = await import("../migrations");
    const out = migrateSchematic({
      version: 49,
      nodes: [{
        id: "d1", type: "device", position: { x: 0, y: 0 },
        data: {
          label: "CP4N", deviceType: "control-processor",
          // LAN → 41794 → 41796 → 443, each parented to the one above.
          ports: [
            port("lan", "ethernet"),
            port("a", "tcp", "lan"),
            port("b", "tcp", "a"),
            port("c", "tcp", "b"),
          ],
        },
      }],
      edges: [],
    });
    expect(out.version).toBe(CURRENT_SCHEMA_VERSION);
    const ports = out.nodes[0].data.ports;
    expect(ports.map((p: { id: string }) => p.id)).toEqual(["lan", "a", "b", "c"]);
    expect(ports.slice(1).every((p: { parentPortId: string }) => p.parentPortId === "lan")).toBe(true);
  });

  it("adopts loose top-level TCP ports onto their ethernet port", async () => {
    const { migrateSchematic } = await import("../migrations");
    const out = migrateSchematic({
      version: 49,
      nodes: [{
        id: "d1", type: "device", position: { x: 0, y: 0 },
        data: { label: "CP4N", deviceType: "dsp", ports: [port("lan", "ethernet"), port("x", "tcp"), port("y", "udp")] },
      }],
      edges: [],
    });
    const ports = out.nodes[0].data.ports;
    expect(ports.map((p: { parentPortId?: string }) => p.parentPortId)).toEqual([undefined, "lan", "lan"]);
  });

  it("repairs custom templates stored in the file too", async () => {
    const { migrateSchematic } = await import("../migrations");
    const out = migrateSchematic({
      version: 49,
      nodes: [],
      edges: [],
      customTemplates: [{ id: "t1", deviceType: "custom", label: "T", ports: [port("lan", "ethernet"), port("s", "tcp", "nope")] }],
    });
    expect(out.customTemplates[0].ports[1].parentPortId).toBe("lan");
  });

  it("leaves a healthy file untouched", async () => {
    const { migrateSchematic } = await import("../migrations");
    const before = [port("lan", "ethernet"), port("a", "tcp", "lan")];
    const out = migrateSchematic({
      version: 49,
      nodes: [{ id: "d1", type: "device", position: { x: 0, y: 0 }, data: { label: "D", deviceType: "dsp", ports: before } }],
      edges: [],
    });
    expect(out.nodes[0].data.ports).toEqual(before);
  });

  it("tolerates devices with no ports and non-device nodes", async () => {
    const { migrateSchematic } = await import("../migrations");
    expect(() => migrateSchematic({
      version: 49,
      nodes: [
        { id: "r1", type: "room", position: { x: 0, y: 0 }, data: { label: "Room" } },
        { id: "d1", type: "device", position: { x: 0, y: 0 }, data: { label: "D", deviceType: "dsp" } },
      ],
      edges: [],
    })).not.toThrow();
  });
});
