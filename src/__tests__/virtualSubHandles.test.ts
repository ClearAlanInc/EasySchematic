/**
 * Virtual sub-handles: TCP/UDP children of a network port. Each has its own handle,
 * so React Flow sees distinct handle pairs and several streams can be drawn between
 * the same two devices — which a single shared ethernet handle cannot do.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Port, SchematicNode } from "../types";
import { isVirtualSignal } from "../connectorTypes";

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
