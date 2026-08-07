import { describe, it, expect } from "vitest";
import {
  parseVlanList,
  formatVlanList,
  trunkAllows,
  effectiveVlan,
  vlanLinkInfo,
  findPropagationTargets,
} from "../vlanPropagation";
import { computeVlanConflicts } from "../networkValidation";
import type { SchematicNode, ConnectionEdge, Port, PortNetworkConfig } from "../types";

const device = (
  id: string,
  ports: Partial<Port>[],
  extra: Record<string, unknown> = {},
): SchematicNode =>
  ({
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      deviceType: "custom",
      ports: ports.map((p, i) => ({
        id: `${id}-p${i}`,
        label: `Port ${i}`,
        signalType: "ethernet",
        direction: "bidirectional",
        connectorType: "rj45",
        ...p,
      })),
      ...extra,
    },
  } as unknown as SchematicNode);

const netEdge = (
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
  signalType = "ethernet",
): ConnectionEdge =>
  ({
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: { signalType },
  } as unknown as ConnectionEdge);

const access = (vlan?: number): PortNetworkConfig => ({ vlan });
const trunk = (vlans: number[], native?: number, all = false): PortNetworkConfig => ({
  vlanMode: "trunk",
  trunkVlans: vlans.length ? vlans : undefined,
  trunkAllVlans: all || undefined,
  nativeVlan: native,
});

describe("parseVlanList / formatVlanList", () => {
  it("parses singles, ranges, and mixes", () => {
    expect(parseVlanList("1,10,20-23")).toEqual([1, 10, 20, 21, 22, 23]);
    expect(parseVlanList(" 5 , 3 - 4 ")).toEqual([3, 4, 5]);
    expect(parseVlanList("")).toEqual([]);
  });

  it("rejects malformed and out-of-range input", () => {
    expect(parseVlanList("abc")).toBeNull();
    expect(parseVlanList("0")).toBeNull();
    expect(parseVlanList("4095")).toBeNull();
    expect(parseVlanList("30-20")).toBeNull();
    expect(parseVlanList("1,,2")).toBeNull();
  });

  it("formats back to compact range syntax", () => {
    expect(formatVlanList([1, 10, 20, 21, 22, 23])).toBe("1,10,20-23");
    expect(formatVlanList([3, 1, 2])).toBe("1-3");
    expect(formatVlanList([])).toBe("");
  });
});

describe("trunkAllows", () => {
  it("honours the allowed list, native VLAN, and the all flag", () => {
    expect(trunkAllows(trunk([10, 20]), 10)).toBe(true);
    expect(trunkAllows(trunk([10, 20]), 30)).toBe(false);
    expect(trunkAllows(trunk([10], 99), 99)).toBe(true);
    expect(trunkAllows(trunk([], undefined, true), 4094)).toBe(true);
  });
});

describe("effectiveVlan", () => {
  const parent: Port = { id: "p", label: "P", signalType: "ethernet", direction: "bidirectional", networkConfig: access(30) } as Port;
  const sub: Port = { id: "s", label: "S", signalType: "tcp", direction: "bidirectional", parentPortId: "p" } as Port;

  it("inherits the parent port's VLAN on sub-handles", () => {
    expect(effectiveVlan(sub, [parent, sub])).toBe(30);
  });

  it("lets a sub-handle override for per-stream tagging", () => {
    const tagged = { ...sub, networkConfig: access(99) } as Port;
    expect(effectiveVlan(tagged, [parent, tagged])).toBe(99);
  });
});

describe("vlanLinkInfo", () => {
  const port = (nc?: PortNetworkConfig): Port =>
    ({ id: "x", label: "X", signalType: "ethernet", direction: "bidirectional", networkConfig: nc } as Port);

  it("labels matching access links and flags mismatches", () => {
    expect(vlanLinkInfo(port(access(10)), port(access(10)))).toEqual({ label: "VLAN 10", issue: null });
    expect(vlanLinkInfo(port(access(10)), port(access(20))).issue).toMatch(/mismatch: 10 vs 20/);
    expect(vlanLinkInfo(port(), port())).toEqual({ label: null, issue: null });
    expect(vlanLinkInfo(port(access(10)), port())).toEqual({ label: "VLAN 10", issue: null });
  });

  it("checks access VLANs against the far trunk's allowed set", () => {
    expect(vlanLinkInfo(port(access(10)), port(trunk([10, 20]))).issue).toBeNull();
    expect(vlanLinkInfo(port(access(30)), port(trunk([10, 20]))).issue).toMatch(/not allowed on trunk/);
    expect(vlanLinkInfo(port(access(30)), port(trunk([], undefined, true))).issue).toBeNull();
  });

  it("requires trunk/trunk links to share at least one VLAN", () => {
    expect(vlanLinkInfo(port(trunk([10, 20])), port(trunk([20, 30]))).issue).toBeNull();
    expect(vlanLinkInfo(port(trunk([10])), port(trunk([20]))).issue).toMatch(/do not overlap/);
    expect(vlanLinkInfo(port(trunk([10])), port(trunk([], undefined, true))).issue).toBeNull();
  });
});

describe("findPropagationTargets", () => {
  it("reaches the far port of a direct wire", () => {
    const nodes = [device("A", [{}]), device("B", [{}])];
    const edges = [netEdge("e1", "A", "B", "A-p0", "B-p0")];
    expect(findPropagationTargets({ nodeId: "A", portId: "A-p0" }, nodes, edges))
      .toEqual([{ nodeId: "B", portId: "B-p0" }]);
  });

  it("reaches every far port on a multi-connect fan-out", () => {
    const nodes = [device("AP", [{ multiConnect: true }]), device("B", [{}]), device("C", [{}])];
    const edges = [
      netEdge("e1", "AP", "B", "AP-p0", "B-p0"),
      netEdge("e2", "AP", "C", "AP-p0", "C-p0"),
    ];
    const targets = findPropagationTargets({ nodeId: "AP", portId: "AP-p0" }, nodes, edges);
    expect(targets).toHaveLength(2);
    expect(targets).toContainEqual({ nodeId: "B", portId: "B-p0" });
    expect(targets).toContainEqual({ nodeId: "C", portId: "C-p0" });
  });

  it("stops at trunk ports", () => {
    const nodes = [device("A", [{}]), device("B", [{ networkConfig: trunk([10, 20]) }])];
    const edges = [netEdge("e1", "A", "B", "A-p0", "B-p0")];
    expect(findPropagationTargets({ nodeId: "A", portId: "A-p0" }, nodes, edges)).toEqual([]);
  });

  it("ignores virtual stream wires", () => {
    const nodes = [device("A", [{}]), device("B", [{}])];
    const edges = [netEdge("e1", "A", "B", "A-p0", "B-p0", "tcp")];
    expect(findPropagationTargets({ nodeId: "A", portId: "A-p0" }, nodes, edges)).toEqual([]);
  });

  it("does not hop through ordinary devices", () => {
    // A — B(p0,p1) — C: propagation from A must reach B-p0 but never C.
    const nodes = [device("A", [{}]), device("B", [{}, {}]), device("C", [{}])];
    const edges = [
      netEdge("e1", "A", "B", "A-p0", "B-p0"),
      netEdge("e2", "B", "C", "B-p1", "C-p0"),
    ];
    expect(findPropagationTargets({ nodeId: "A", portId: "A-p0" }, nodes, edges))
      .toEqual([{ nodeId: "B", portId: "B-p0" }]);
  });

  it("continues through passthrough circuits to the far device", () => {
    // A → panel circuit (rear in, front out) → B
    const nodes = [
      device("A", [{}]),
      device("PP", [{ direction: "passthrough" }]),
      device("B", [{}]),
    ];
    const edges = [
      netEdge("e1", "A", "PP", "A-p0", "PP-p0-rear"),
      netEdge("e2", "PP", "B", "PP-p0-front", "B-p0"),
    ];
    const targets = findPropagationTargets({ nodeId: "A", portId: "A-p0" }, nodes, edges);
    expect(targets).toEqual([{ nodeId: "B", portId: "B-p0" }]);
  });

  it("crosses stub-split edges to the real far endpoint", () => {
    const stub = (id: string): SchematicNode =>
      ({ id, type: "stub-label", position: { x: 0, y: 0 }, data: {} } as unknown as SchematicNode);
    const nodes = [device("A", [{}]), device("B", [{}]), stub("sA"), stub("sB")];
    const edges = [
      { ...netEdge("l1", "A", "sA", "A-p0", undefined), data: { signalType: "ethernet", linkedConnectionId: "L" } },
      { ...netEdge("l2", "sB", "B", undefined, "B-p0"), data: { signalType: "ethernet", linkedConnectionId: "L" } },
    ] as unknown as ConnectionEdge[];
    expect(findPropagationTargets({ nodeId: "A", portId: "A-p0" }, nodes, edges))
      .toEqual([{ nodeId: "B", portId: "B-p0" }]);
  });
});

describe("computeVlanConflicts", () => {
  it("reports both ends of a mismatched access link", () => {
    const nodes = [
      device("A", [{ networkConfig: access(10) }]),
      device("B", [{ networkConfig: access(20) }]),
    ];
    const edges = [netEdge("e1", "A", "B", "A-p0", "B-p0")];
    const conflicts = computeVlanConflicts(nodes, edges);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].message).toMatch(/VLAN mismatch/);
  });

  it("is silent for a healthy access-to-trunk link", () => {
    const nodes = [
      device("A", [{ networkConfig: access(10) }]),
      device("B", [{ networkConfig: trunk([10, 20]) }]),
    ];
    const edges = [netEdge("e1", "A", "B", "A-p0", "B-p0")];
    expect(computeVlanConflicts(nodes, edges)).toEqual([]);
  });
});
