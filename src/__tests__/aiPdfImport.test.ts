import { describe, it, expect } from "vitest";
import { buildAiImport, type AiExtraction } from "../aiPdfImport";
import type { DeviceTemplate, DeviceNode, ConnectionEdge } from "../types";

const libTemplate: DeviceTemplate = {
  id: "lib-atem",
  deviceType: "video-switcher",
  label: "Blackmagic ATEM Mini Pro",
  manufacturer: "Blackmagic Design",
  modelNumber: "ATEM Mini Pro",
  searchTerms: ["atem", "mini pro"],
  ports: [
    { id: "in1", label: "HDMI In 1", signalType: "hdmi", direction: "input" },
    { id: "in2", label: "HDMI In 2", signalType: "hdmi", direction: "input" },
    { id: "out", label: "HDMI Out", signalType: "hdmi", direction: "output" },
  ],
};

function extraction(): AiExtraction {
  return {
    pages: [
      {
        name: "Video System",
        devices: [
          { name: "ATEM Mini Pro", manufacturer: "Blackmagic Design", model: "ATEM Mini Pro", deviceType: "video-switcher", room: "Control Room" },
          { name: "MysteryBox 9000", manufacturer: "Acme", model: "MB-9000", deviceType: "scaler", room: "Control Room" },
        ],
        connections: [
          { fromDevice: "MysteryBox 9000", fromPort: "Out A", toDevice: "ATEM Mini Pro", toPort: "HDMI In 1", signalType: "HDMI", cableId: "V001" },
        ],
      },
      {
        name: "Audio System",
        devices: [
          { name: "MysteryBox 9000 #2", manufacturer: "Acme", model: "MB-9000", deviceType: "scaler", room: "" },
          { name: "Lonely Panel", manufacturer: "", model: "", deviceType: "wall-plate", room: "Stage" },
        ],
        connections: [],
      },
    ],
  };
}

describe("buildAiImport", () => {
  it("matches library devices and creates custom templates for unknown ones", () => {
    const result = buildAiImport(extraction(), [libTemplate]);

    expect(result.pages).toHaveLength(2);
    expect(result.matchedDevices).toBeGreaterThanOrEqual(1);

    // The unknown Acme box becomes one custom template despite appearing on two pages
    const acme = result.newTemplates.filter((t) => t.manufacturer === "Acme");
    expect(acme).toHaveLength(1);
    expect(acme[0].deviceType).toBe("scaler");
    expect(acme[0].id).toMatch(/^custom-ai-/);

    // Matched device uses the library template's ports
    const page1Devices = result.pages[0].nodes.filter((n) => n.type === "device") as DeviceNode[];
    const atem = page1Devices.find((n) => n.data.label === "ATEM Mini Pro");
    expect(atem).toBeDefined();
    expect(atem!.data.ports.map((p) => p.label)).toContain("HDMI In 1");
  });

  it("carries cable IDs onto the created edges", () => {
    const result = buildAiImport(extraction(), [libTemplate]);
    const edges = result.pages[0].edges as ConnectionEdge[];
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.cableId).toBe("V001");
    expect(edges[0].data?.signalType).toBe("hdmi");
  });

  it("creates nodes for devices that have no connections", () => {
    const result = buildAiImport(extraction(), [libTemplate]);
    const page2Devices = result.pages[1].nodes.filter((n) => n.type === "device") as DeviceNode[];
    const labels = page2Devices.map((n) => n.data.label);
    expect(labels).toContain("Lonely Panel");
    // No self-loop edge was produced for it
    expect(result.pages[1].edges).toHaveLength(0);
  });

  it("puts roomed devices inside room nodes", () => {
    const result = buildAiImport(extraction(), [libTemplate]);
    const rooms = result.pages[0].nodes.filter((n) => n.type === "room");
    expect(rooms.map((r) => (r.data as { label: string }).label)).toContain("Control Room");
    const page1Devices = result.pages[0].nodes.filter((n) => n.type === "device") as DeviceNode[];
    const atem = page1Devices.find((n) => n.data.label === "ATEM Mini Pro");
    expect(atem!.parentId).toBe(rooms[0].id);
  });

  it("skips pages with nothing on them", () => {
    const empty: AiExtraction = { pages: [{ name: "Notes", devices: [], connections: [] }] };
    const result = buildAiImport(empty, [libTemplate]);
    expect(result.pages).toHaveLength(0);
  });
});
