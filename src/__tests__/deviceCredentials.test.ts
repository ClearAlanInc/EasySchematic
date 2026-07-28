import { describe, it, expect } from "vitest";
import { NETWORK_SIGNAL_TYPES } from "../connectorTypes";
import { migrateSchematic, CURRENT_SCHEMA_VERSION } from "../migrations";
import type { DeviceData, Port } from "../types";

/** Mirrors the DeviceEditor gate: show network identity when the device has a
 *  network-signal ("LAN") port, or when any field already holds data. */
function showsNetworkIdentity(data: Pick<DeviceData, "ports" | "hostname" | "username" | "password">): boolean {
  return (
    data.ports.some((p) => NETWORK_SIGNAL_TYPES.has(p.signalType)) ||
    !!data.hostname ||
    !!data.username ||
    !!data.password
  );
}

const port = (signalType: Port["signalType"]): Port => ({
  id: `p-${signalType}`,
  label: signalType,
  signalType,
  direction: "bidirectional",
});

describe("device management credentials", () => {
  it("exposes network identity for devices with an ethernet port", () => {
    expect(showsNetworkIdentity({ ports: [port("ethernet")] })).toBe(true);
  });

  it("exposes network identity for other network signal types", () => {
    for (const st of ["dante", "ndi", "avb", "aes67", "st2110", "srt", "hdbaset"] as const) {
      expect(showsNetworkIdentity({ ports: [port(st)] })).toBe(true);
    }
  });

  it("hides network identity for devices with no network port", () => {
    expect(showsNetworkIdentity({ ports: [port("hdmi"), port("sdi"), port("power")] })).toBe(false);
    expect(showsNetworkIdentity({ ports: [] })).toBe(false);
  });

  it("still exposes the fields when data exists but the network port was removed", () => {
    // Guards against credentials becoming stranded/uneditable after a port edit.
    expect(showsNetworkIdentity({ ports: [port("hdmi")], username: "admin" })).toBe(true);
    expect(showsNetworkIdentity({ ports: [port("hdmi")], password: "secret" })).toBe(true);
    expect(showsNetworkIdentity({ ports: [port("hdmi")], hostname: "dsp-01" })).toBe(true);
  });

  it("migrates a v43 file to the current version without touching device data", () => {
    const nodes = [
      {
        id: "d1",
        type: "device",
        position: { x: 0, y: 0 },
        data: { label: "Q-SYS Core", deviceType: "dsp", ports: [port("ethernet")] },
      },
    ];
    const out = migrateSchematic({ version: 43, nodes, edges: [] });
    expect(out.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.nodes[0].data.username).toBeUndefined();
    expect(out.nodes[0].data.password).toBeUndefined();
    expect(out.nodes[0].data.label).toBe("Q-SYS Core");
  });

  it("round-trips credentials through a current-version migration", () => {
    const nodes = [
      {
        id: "d1",
        type: "device",
        position: { x: 0, y: 0 },
        data: {
          label: "Q-SYS Core",
          deviceType: "dsp",
          ports: [port("ethernet")],
          hostname: "core-110f",
          username: "admin",
          password: "hunter2",
        },
      },
    ];
    const out = migrateSchematic({ version: CURRENT_SCHEMA_VERSION, nodes, edges: [] });
    expect(out.nodes[0].data.hostname).toBe("core-110f");
    expect(out.nodes[0].data.username).toBe("admin");
    expect(out.nodes[0].data.password).toBe("hunter2");
  });
});
