import { describe, it, expect } from "vitest";
import { areSignalPairsCompatible, DEFAULT_CONNECTOR, NETWORK_SIGNAL_TYPES } from "../connectorTypes";
import { SIGNAL_LABELS, SIGNAL_COLORS, SIGNAL_GROUPS } from "../types";
import { SIGNAL_TO_CABLE } from "../cableTypes";
import { DEFAULT_SIGNAL_COLORS } from "../signalColors";

describe("tcp/udp virtual signal types", () => {
  it("connect natively to ethernet ports, in both directions", () => {
    for (const st of ["tcp", "udp"] as const) {
      expect(areSignalPairsCompatible(st, "ethernet")).toBe(true);
      expect(areSignalPairsCompatible("ethernet", st)).toBe(true);
    }
  });

  it("does not silently make tcp and udp interchangeable with each other", () => {
    // They ride the same wire but are different transports; keep them distinct.
    expect(areSignalPairsCompatible("tcp", "udp")).toBe(false);
  });

  it("does not become compatible with unrelated signals", () => {
    expect(areSignalPairsCompatible("tcp", "hdmi")).toBe(false);
    expect(areSignalPairsCompatible("udp", "dante")).toBe(false);
  });

  it("defaults to an RJ45 connector like the ethernet it rides on", () => {
    expect(DEFAULT_CONNECTOR.tcp).toBe("rj45");
    expect(DEFAULT_CONNECTOR.udp).toBe("rj45");
  });

  it("counts as a network signal — gets IP config and any-direction connects", () => {
    expect(NETWORK_SIGNAL_TYPES.has("tcp")).toBe(true);
    expect(NETWORK_SIGNAL_TYPES.has("udp")).toBe(true);
  });

  it("is registered everywhere a signal type must appear", () => {
    for (const st of ["tcp", "udp"] as const) {
      expect(SIGNAL_LABELS[st]).toBe(st.toUpperCase());
      expect(SIGNAL_COLORS[st]).toBe(`var(--color-${st})`);
      expect(DEFAULT_SIGNAL_COLORS[st]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(SIGNAL_GROUPS.Network).toContain(st);
    }
  });

  it("bills as an ethernet cable in the pack list — the physical run is still cat cable", () => {
    expect(SIGNAL_TO_CABLE.tcp).toBe("Ethernet");
    expect(SIGNAL_TO_CABLE.udp).toBe("Ethernet");
  });
});

/** Mirrors OffsetEdge's labelText derivation. */
function wireLabel(data: { signalType: string; networkPort?: number }, cableId: string): string {
  const st = data.signalType;
  if (st !== "tcp" && st !== "udp") return cableId;
  return data.networkPort != null ? `${st.toUpperCase()} ${data.networkPort}` : cableId;
}

describe("port number shown in place of the cable ID", () => {
  it("shows the port for a tcp connection", () => {
    expect(wireLabel({ signalType: "tcp", networkPort: 1710 }, "E001")).toBe("TCP 1710");
  });

  it("shows the port for a udp connection", () => {
    expect(wireLabel({ signalType: "udp", networkPort: 5353 }, "E002")).toBe("UDP 5353");
  });

  it("falls back to the cable ID when no port is set yet", () => {
    expect(wireLabel({ signalType: "tcp" }, "E001")).toBe("E001");
  });

  it("leaves ordinary connections showing their cable ID", () => {
    expect(wireLabel({ signalType: "ethernet", networkPort: 80 }, "E001")).toBe("E001");
  });

  it("renders port 0-adjacent edges of the valid range", () => {
    expect(wireLabel({ signalType: "tcp", networkPort: 1 }, "x")).toBe("TCP 1");
    expect(wireLabel({ signalType: "udp", networkPort: 65535 }, "x")).toBe("UDP 65535");
  });
});

import { VIRTUAL_SIGNAL_TYPES, isVirtualSignal, NETWORK_SIGNAL_TYPES as NET } from "../connectorTypes";
import { computeCableSchedule } from "../cableSchedule";

describe("virtual vs physical classification", () => {
  it("classifies tcp/udp as virtual and everything else as physical", () => {
    expect(isVirtualSignal("tcp")).toBe(true);
    expect(isVirtualSignal("udp")).toBe(true);
    for (const st of ["ethernet", "sdi", "hdmi", "dante", "power"] as const) {
      expect(isVirtualSignal(st)).toBe(false);
    }
    expect(isVirtualSignal(undefined)).toBe(false);
    expect([...VIRTUAL_SIGNAL_TYPES].sort()).toEqual(["tcp", "udp"]);
  });

  it("keeps virtual types inside the network family so they stack on ethernet ports", () => {
    expect(NET.has("tcp") && NET.has("udp")).toBe(true);
  });
});

/** Mirrors App.tsx's visibleEdges filter. */
function visible(
  edges: { data: { signalType: string } }[],
  opts: { hideVirtual?: boolean; hidePhysical?: boolean },
) {
  return edges.filter((e) => {
    const v = isVirtualSignal(e.data.signalType as never);
    return !(v ? opts.hideVirtual : opts.hidePhysical);
  });
}

describe("canvas layer visibility", () => {
  const edges = [
    { data: { signalType: "ethernet" } },
    { data: { signalType: "tcp" } },
    { data: { signalType: "udp" } },
    { data: { signalType: "sdi" } },
  ];

  it("shows everything by default", () => {
    expect(visible(edges, {})).toHaveLength(4);
  });

  it("hides only the virtual layer", () => {
    const out = visible(edges, { hideVirtual: true });
    expect(out.map((e) => e.data.signalType)).toEqual(["ethernet", "sdi"]);
  });

  it("hides only the physical layer", () => {
    const out = visible(edges, { hidePhysical: true });
    expect(out.map((e) => e.data.signalType)).toEqual(["tcp", "udp"]);
  });

  it("can hide both layers", () => {
    expect(visible(edges, { hideVirtual: true, hidePhysical: true })).toHaveLength(0);
  });
});

describe("virtual wires are excluded from the cable schedule", () => {
  const port = (id: string) => ({ id, label: id, signalType: "ethernet" as const, direction: "bidirectional" as const });
  const dev = (id: string) => ({
    id, type: "device" as const, position: { x: 0, y: 0 },
    data: { label: id, deviceType: "dsp", ports: [port("p1")] },
  });
  const edge = (id: string, signalType: string) => ({
    id, source: "a", target: "b", sourceHandle: "p1", targetHandle: "p1",
    data: { signalType },
  });

  it("counts the physical run but not the logical streams riding it", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = computeCableSchedule([dev("a"), dev("b")] as any, [
      edge("e1", "ethernet"),
      edge("e2", "tcp"),
      edge("e3", "udp"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any, "sequential");
    expect(rows).toHaveLength(1);
    expect(rows[0].edgeId).toBe("e1");
  });
});
