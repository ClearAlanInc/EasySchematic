import { describe, it, expect } from "vitest";
import { migrateSchematic, CURRENT_SCHEMA_VERSION } from "../migrations";

describe("v39→v40 bundles migration", () => {
  it("adds an empty bundles map and bumps version", () => {
    const out = migrateSchematic({ version: 39, nodes: [], edges: [] });
    expect(out.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.bundles).toEqual({});
  });

  it("drops a dangling bundleId and dissolves <2-member bundles", () => {
    const out = migrateSchematic({
      version: 39,
      nodes: [],
      edges: [
        { id: "e1", data: { signalType: "sdi", bundleId: "ghost" } }, // no such bundle
        { id: "e2", data: { signalType: "sdi", bundleId: "b1" } }, // bundle with only 1 member
      ],
      bundles: { b1: { id: "b1" } },
    });
    expect(out.edges[0].data.bundleId).toBeUndefined();
    expect(out.edges[1].data.bundleId).toBeUndefined();
    expect(out.bundles).toEqual({});
  });

  it("keeps a valid ≥2-member bundle", () => {
    const out = migrateSchematic({
      version: 39,
      nodes: [],
      edges: [
        { id: "e1", data: { signalType: "sdi", bundleId: "b1" } },
        { id: "e2", data: { signalType: "hdmi", bundleId: "b1" } },
      ],
      bundles: { b1: { id: "b1", label: "Snake A" } },
    });
    expect(out.edges[0].data.bundleId).toBe("b1");
    expect(out.edges[1].data.bundleId).toBe("b1");
    expect(out.bundles.b1.label).toBe("Snake A");
  });
});
