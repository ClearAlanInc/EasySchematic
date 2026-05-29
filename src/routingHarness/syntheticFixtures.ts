/**
 * Synthetic adversarial routing fixtures, built in code so they read as intent
 * rather than opaque JSON. Each targets a known weak spot the Phase-2 robustness
 * work must improve without regressing.
 */

import type { SchematicNode, SignalType, DeviceData } from "../types";
import { computeDeviceHandles } from "./deviceHandleLayout";
import { makeDevice, makeEdge, makePort, makeStubPair, makeFixture, type Fixture } from "./fixtures";

/** Absolute position of a top-level device's named handle. */
function handleAbs(node: SchematicNode, handleId: string): { x: number; y: number } {
  const device = node as { data: DeviceData; measured?: { width?: number; height?: number } };
  const h = computeDeviceHandles(device).find((x) => x.id === handleId);
  const base = node.position;
  return { x: base.x + (h?.relX ?? 0), y: base.y + (h?.relY ?? 0) };
}

/** Source device with N outputs fanning to N stacked targets on the right. */
function fanOutDense(): Fixture {
  const outs = Array.from({ length: 8 }, (_, i) => makePort(`Out ${i + 1}`, "sdi", "output"));
  const src = makeDevice({ id: "src", label: "Router", x: 0, y: 200, ports: outs });
  const nodes: SchematicNode[] = [src];
  const edges = outs.map((p, i) => {
    const tgtIn = makePort("In", "sdi", "input");
    const tgt = makeDevice({ id: `tgt${i}`, label: `Display ${i + 1}`, x: 700, y: i * 110, ports: [tgtIn] });
    nodes.push(tgt);
    return makeEdge({ id: `e${i}`, source: "src", sourceHandle: p.id, target: `tgt${i}`, targetHandle: tgtIn.id, signalType: "sdi" });
  });
  return makeFixture("fan-out-dense", nodes, edges);
}

/** Targets sit to the LEFT of the source — every edge must route backward. */
function backwardEdges(): Fixture {
  const outs = Array.from({ length: 5 }, (_, i) => makePort(`Out ${i + 1}`, "hdmi", "output"));
  const src = makeDevice({ id: "src", label: "Source", x: 800, y: 150, ports: outs });
  const nodes: SchematicNode[] = [src];
  const edges = outs.map((p, i) => {
    const tIn = makePort("In", "hdmi", "input");
    const tgt = makeDevice({ id: `tgt${i}`, label: `Sink ${i + 1}`, x: 0, y: i * 130, ports: [tIn] });
    nodes.push(tgt);
    return makeEdge({ id: `b${i}`, source: "src", sourceHandle: p.id, target: `tgt${i}`, targetHandle: tIn.id, signalType: "hdmi" });
  });
  return makeFixture("backward-edges", nodes, edges);
}

/** Devices nested in room nodes; edges cross room boundaries (rooms are not obstacles). */
function nestedRooms(): Fixture {
  const roomA = { id: "roomA", type: "room", position: { x: 0, y: 0 }, data: { label: "Booth" }, measured: { width: 400, height: 600 } } as unknown as SchematicNode;
  const roomB = { id: "roomB", type: "room", position: { x: 700, y: 0 }, data: { label: "Stage" }, measured: { width: 400, height: 600 } } as unknown as SchematicNode;
  const aOut = makePort("Out", "dante", "output");
  const aOut2 = makePort("Out 2", "ndi", "output");
  const devA = makeDevice({ id: "devA", label: "Mixer", x: 60, y: 80, ports: [aOut, aOut2], parentId: "roomA" });
  const bIn = makePort("In", "dante", "input");
  const bIn2 = makePort("In", "ndi", "input");
  const devB = makeDevice({ id: "devB", label: "Amp", x: 60, y: 100, ports: [bIn], parentId: "roomB" });
  const devC = makeDevice({ id: "devC", label: "Decoder", x: 60, y: 360, ports: [bIn2], parentId: "roomB" });
  const edges = [
    makeEdge({ id: "n1", source: "devA", sourceHandle: aOut.id, target: "devB", targetHandle: bIn.id, signalType: "dante" }),
    makeEdge({ id: "n2", source: "devA", sourceHandle: aOut2.id, target: "devC", targetHandle: bIn2.id, signalType: "ndi" }),
  ];
  return makeFixture("nested-rooms", [roomA, roomB, devA, devB, devC], edges);
}

/** Two stubbed connections from one device — exercises stub-leg routing. */
function stubsSpread(): Fixture {
  const o1 = makePort("Out 1", "sdi", "output");
  const o2 = makePort("Out 2", "sdi", "output");
  const src = makeDevice({ id: "src", label: "Camera", x: 0, y: 120, ports: [o1, o2] });
  const tIn1 = makePort("In", "sdi", "input");
  const tIn2 = makePort("In", "sdi", "input");
  const tgt1 = makeDevice({ id: "tgt1", label: "Switcher A", x: 900, y: 60, ports: [tIn1] });
  const tgt2 = makeDevice({ id: "tgt2", label: "Switcher B", x: 900, y: 360, ports: [tIn2] });

  const pair1 = makeStubPair({
    linkId: "lc1", signalType: "sdi",
    source: "src", sourceHandle: o1.id, srcHandlePos: handleAbs(src, o1.id), srcPortSide: "right",
    target: "tgt1", targetHandle: tIn1.id, tgtHandlePos: handleAbs(tgt1, tIn1.id), tgtPortSide: "left",
  });
  const pair2 = makeStubPair({
    linkId: "lc2", signalType: "sdi",
    source: "src", sourceHandle: o2.id, srcHandlePos: handleAbs(src, o2.id), srcPortSide: "right",
    target: "tgt2", targetHandle: tIn2.id, tgtHandlePos: handleAbs(tgt2, tIn2.id), tgtPortSide: "left",
  });

  return makeFixture(
    "stubs-spread",
    [src, tgt1, tgt2, ...pair1.nodes, ...pair2.nodes],
    [...pair1.edges, ...pair2.edges],
  );
}

/** Parallel edges of different signal types competing for one vertical corridor (R11). */
function mixedSignalCorridor(): Fixture {
  const sigs: SignalType[] = ["sdi", "hdmi", "dante", "ndi", "aes", "usb"];
  const outs = sigs.map((s, i) => makePort(`Out ${i + 1}`, s, "output"));
  const src = makeDevice({ id: "src", label: "Hub", x: 0, y: 300, ports: outs });
  const nodes: SchematicNode[] = [src];
  const edges = sigs.map((s, i) => {
    const tIn = makePort("In", s, "input");
    const tgt = makeDevice({ id: `tgt${i}`, label: `Node ${i + 1}`, x: 600, y: i * 130, ports: [tIn] });
    nodes.push(tgt);
    return makeEdge({ id: `m${i}`, source: "src", sourceHandle: outs[i].id, target: `tgt${i}`, targetHandle: tIn.id, signalType: s });
  });
  return makeFixture("mixed-signal-corridor", nodes, edges);
}

/** A grid of devices wired diagonally so naive routing produces many crossings. */
function crossingGrid(): Fixture {
  const nodes: SchematicNode[] = [];
  const lefts = Array.from({ length: 4 }, (_, i) => {
    const o = makePort("Out", "sdi", "output");
    const d = makeDevice({ id: `L${i}`, label: `L${i}`, x: 0, y: i * 140, ports: [o] });
    nodes.push(d);
    return { d, o };
  });
  const rights = Array.from({ length: 4 }, (_, i) => {
    const inp = makePort("In", "sdi", "input");
    const d = makeDevice({ id: `R${i}`, label: `R${i}`, x: 600, y: i * 140, ports: [inp] });
    nodes.push(d);
    return { d, inp };
  });
  // Wire L[i] -> R[3-i] so connections want to cross.
  const edges = lefts.map((l, i) =>
    makeEdge({ id: `x${i}`, source: l.d.id, sourceHandle: l.o.id, target: rights[3 - i].d.id, targetHandle: rights[3 - i].inp.id, signalType: "sdi" }),
  );
  return makeFixture("crossing-grid", nodes, edges);
}

export function syntheticFixtures(): Fixture[] {
  return [
    fanOutDense(),
    backwardEdges(),
    nestedRooms(),
    stubsSpread(),
    mixedSignalCorridor(),
    crossingGrid(),
  ];
}

/** All fixtures: synthetic + the bundled default schematic + any real exports on disk. */
export async function allFixtures(): Promise<Fixture[]> {
  const { defaultSchematicFixture, loadFileFixtures } = await import("./fixtures");
  return [...syntheticFixtures(), defaultSchematicFixture(), ...loadFileFixtures()];
}
