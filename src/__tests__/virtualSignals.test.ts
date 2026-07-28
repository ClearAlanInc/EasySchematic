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
