import { describe, it, expect } from "vitest";
import { computeNetworkReport, buildNetworkReportCsv, maskSecret, MASKED_SECRET } from "../networkReport";
import { encryptSecret } from "../credentials";
import type { SchematicNode } from "../types";

function switchWithCreds(): SchematicNode {
  return {
    id: "sw1",
    type: "device",
    position: { x: 0, y: 0 },
    data: {
      label: "Core Switch",
      deviceType: "network-switch",
      username: "admin",
      password: encryptSecret("hunter2"),
      ports: [
        {
          id: "p1", label: "Port 1", signalType: "ethernet", direction: "bidirectional",
          networkConfig: { ip: "10.0.0.2" },
        },
        {
          id: "p2", label: "MGMT", signalType: "ethernet", direction: "bidirectional",
          networkConfig: { ip: "10.0.0.1", isManagement: true },
        },
      ],
    },
  } as unknown as SchematicNode;
}

describe("network report credentials", () => {
  it("attaches device credentials to the management row only, decrypted", () => {
    const rows = computeNetworkReport([switchWithCreds()]);
    const mgmt = rows.find((r) => r.portLabel === "MGMT")!;
    const other = rows.find((r) => r.portLabel === "Port 1")!;
    expect(mgmt.isManagement).toBe(true);
    expect(mgmt.username).toBe("admin");
    expect(mgmt.password).toBe("hunter2");
    expect(other.username).toBe("");
    expect(other.password).toBe("");
  });

  it("falls back to the device's first row when no port is flagged management", () => {
    const node = switchWithCreds();
    const data = node.data as { ports: { networkConfig?: { isManagement?: boolean } }[] };
    delete data.ports[1].networkConfig!.isManagement;
    const rows = computeNetworkReport([node]);
    expect(rows[0].username).toBe("admin");
    expect(rows.filter((r) => r.username).length).toBe(1);
  });

  it("masks credentials in the CSV unless revealed", () => {
    const rows = computeNetworkReport([switchWithCreds()]);
    const masked = buildNetworkReportCsv(rows);
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain(MASKED_SECRET);
    const revealed = buildNetworkReportCsv(rows, true);
    expect(revealed).toContain("hunter2");
    expect(revealed).toContain("admin");
  });

  it("maskSecret leaves empty values empty", () => {
    expect(maskSecret("", false)).toBe("");
    expect(maskSecret("x", false)).toBe(MASKED_SECRET);
    expect(maskSecret("x", true)).toBe("x");
  });
});

describe("devices with credentials but no addressable ports", () => {
  it("still appear as one credential row", () => {
    const node = {
      id: "sw2", type: "device", position: { x: 0, y: 0 },
      data: {
        label: "Edge Switch", deviceType: "network-switch",
        username: "admin", password: "pw",
        ports: [
          { id: "p1", label: "LAN 1", signalType: "ethernet", direction: "bidirectional", addressable: false },
        ],
      },
    } as never;
    const rows = computeNetworkReport([node]);
    expect(rows).toHaveLength(1);
    expect(rows[0].deviceLabel).toBe("Edge Switch");
    expect(rows[0].username).toBe("admin");
    expect(rows[0].isManagement).toBe(true);
  });
});
