import { describe, it, expect } from "vitest";
import { computePowerReport } from "../powerReport";
import type { SchematicNode, ConnectionEdge } from "../types";

const distro = (id: string, capacityW: number): SchematicNode =>
  ({
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: { label: id, deviceType: "power", powerCapacityW: capacityW },
  } as unknown as SchematicNode);

const device = (id: string, powerDrawW: number): SchematicNode =>
  ({
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: { label: id, model: id, deviceType: "amp", powerDrawW },
  } as unknown as SchematicNode);

const stubNode = (id: string, link: string, side: "source" | "target"): SchematicNode =>
  ({
    id,
    type: "stub-label",
    position: { x: 0, y: 0 },
    data: { signalType: "power", linkedConnectionId: link, side },
  } as unknown as SchematicNode);

const powerEdge = (id: string, source: string, target: string): ConnectionEdge =>
  ({ id, source, target, data: { signalType: "power" } } as unknown as ConnectionEdge);

/** Two legs of a stubbed power connection src → tgt, joined by linkedConnectionId. */
const stubbedPowerLegs = (
  baseId: string,
  src: string,
  stubSrc: string,
  stubTgt: string,
  tgt: string,
  link: string,
): ConnectionEdge[] => [
  {
    id: `${baseId}-src`,
    source: src,
    target: stubSrc,
    data: { signalType: "power", linkedConnectionId: link },
  } as unknown as ConnectionEdge,
  {
    id: `${baseId}-tgt`,
    source: stubTgt,
    target: tgt,
    data: { signalType: "power", linkedConnectionId: link },
  } as unknown as ConnectionEdge,
];

describe("computePowerReport — distro loading", () => {
  it("counts a direct (non-stubbed) power connection as load", () => {
    const nodes = [distro("strip", 1800), device("amp", 300)];
    const edges = [powerEdge("e1", "strip", "amp")];
    const { distros } = computePowerReport(nodes, edges);
    expect(distros).toHaveLength(1);
    expect(distros[0].loadW).toBe(300);
  });

  it("counts a STUBBED power connection as load (#172)", () => {
    const nodes = [
      distro("strip", 1800),
      device("amp", 300),
      stubNode("stub-e1-src", "link1", "source"),
      stubNode("stub-e1-tgt", "link1", "target"),
    ];
    const edges = stubbedPowerLegs("e1", "strip", "stub-e1-src", "stub-e1-tgt", "amp", "link1");
    const { distros } = computePowerReport(nodes, edges);
    expect(distros[0].loadW).toBe(300);
  });

  it("does not double-count a mix of direct and stubbed loads", () => {
    const nodes = [
      distro("strip", 1800),
      device("amp1", 300),
      device("amp2", 250),
      stubNode("stub-e2-src", "link2", "source"),
      stubNode("stub-e2-tgt", "link2", "target"),
    ];
    const edges = [
      powerEdge("e1", "strip", "amp1"),
      ...stubbedPowerLegs("e2", "strip", "stub-e2-src", "stub-e2-tgt", "amp2", "link2"),
    ];
    const { distros } = computePowerReport(nodes, edges);
    expect(distros[0].loadW).toBe(550);
  });

  it("does not mark a stubbed device as unconnected power", () => {
    const nodes = [
      distro("strip", 1800),
      device("amp", 300),
      stubNode("stub-e1-src", "link1", "source"),
      stubNode("stub-e1-tgt", "link1", "target"),
    ];
    const edges = stubbedPowerLegs("e1", "strip", "stub-e1-src", "stub-e1-tgt", "amp", "link1");
    const { unconnectedPowerW } = computePowerReport(nodes, edges);
    expect(unconnectedPowerW).toBe(0);
  });
});
