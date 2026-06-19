import { describe, it, expect } from "vitest";
import { autoNamePorts } from "../portNaming";
import type { PortDirection } from "../types";

const p = (label: string, direction: PortDirection) => ({ label, direction });

describe("autoNamePorts", () => {
  it("leaves named ports alone (but trims whitespace)", () => {
    const out = autoNamePorts([p("SDI In", "input"), p("  HDMI  ", "output")]);
    expect(out.map((x) => x.label)).toEqual(["SDI In", "HDMI"]);
  });

  it("auto-names blank ports per direction", () => {
    const out = autoNamePorts([
      p("", "input"),
      p("", "input"),
      p("", "output"),
      p("", "bidirectional"),
      p("", "passthrough"),
    ]);
    expect(out.map((x) => x.label)).toEqual([
      "Input 1",
      "Input 2",
      "Output 1",
      "Bidir 1",
      "Passthrough 1",
    ]);
  });

  it("does not collide with names already in use", () => {
    const out = autoNamePorts([p("Input 1", "input"), p("", "input")]);
    expect(out.map((x) => x.label)).toEqual(["Input 1", "Input 2"]);
  });

  it("treats whitespace-only labels as blank", () => {
    const out = autoNamePorts([p("   ", "input")]);
    expect(out[0].label).toBe("Input 1");
  });

  it("preserves other fields and order", () => {
    const out = autoNamePorts([
      { label: "", direction: "input" as PortDirection, id: "draft-x", signalType: "sdi" },
    ]);
    expect(out[0]).toMatchObject({ id: "draft-x", signalType: "sdi", label: "Input 1" });
  });
});
