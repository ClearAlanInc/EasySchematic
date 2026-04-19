import type { ReactFlowInstance } from "@xyflow/react";
import { GRID_SIZE, useSchematicStore } from "../store";
import type { ConnectionEdge, SchematicNode, SignalType } from "../types";
import { orthogonalize } from "../edgeRouter";
import { simplifyWaypoints } from "../pathfinding";
import { DxfWriter, type EntityStyle } from "./writer";
import { pxToIn } from "./units";
import {
  buildLayerDefs,
  CANONICAL_LAYERS,
  hexToTrueColor,
  LTYPE_DEFS,
  lineStyleToLtype,
  resolveSignalColor,
  signalLayerName,
} from "./layers";
import {
  collectAllArcCrossings,
  emitCableIdLabels,
  emitCustomLabel,
  emitEdgeGeometry,
  emitRoundedWaypointPath,
  emitStubEnd,
  resolveLineStyle,
} from "./geometry";
import { emitAnnotation, emitDevice, emitRoom } from "./nodes";
import { emitTitleBlock } from "./titleBlock";
import { emitLegend } from "./legend";

const PADDING_IN = 0.25;
const STUB_DEFAULT_LEN = 40;

interface Point { x: number; y: number }

/**
 * Export the current schematic as a DXF (R2000 / AC1015) file and trigger a
 * browser download.
 */
export function exportDxf(rfInstance: ReactFlowInstance) {
  const state = useSchematicStore.getState();
  const { nodes, edges, routedEdges } = state;
  if (nodes.length === 0) return;

  const writer = new DxfWriter();

  // ─── Compute extents in inch-space ─────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const internal = rfInstance.getInternalNode(node.id);
    if (!internal) continue;
    const ax = internal.internals.positionAbsolute.x;
    const ay = internal.internals.positionAbsolute.y;
    const w = node.measured?.width ?? 180;
    const h = node.measured?.height ?? 80;
    const x1 = pxToIn(ax), x2 = pxToIn(ax + w);
    const y1 = -pxToIn(ay), y2 = -pxToIn(ay + h);
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxY = Math.max(maxY, y1, y2);
  }
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 10; maxY = 10;
  }
  const extMin = { x: minX - PADDING_IN, y: minY - PADDING_IN };
  const extMax = { x: maxX + PADDING_IN, y: maxY + PADDING_IN };
  writer.setExtents(extMin, extMax);

  // ─── Collect signal types actually in use ──────────────────────────
  const usedSignalTypes = new Set<SignalType>();
  for (const edge of edges) {
    if (edge.data?.signalType) usedSignalTypes.add(edge.data.signalType);
  }

  const layerDefs = buildLayerDefs(usedSignalTypes, state.signalColors);

  // ─── Emit header sections ──────────────────────────────────────────
  writer.writeHeader();
  writer.writeClasses();
  writer.writeTables(layerDefs, LTYPE_DEFS);
  writer.writeBlocks();
  writer.startEntities();

  // ─── Rooms (fill + outline + label) ─────────────────────────────────
  for (const node of nodes) {
    if (node.type === "room") emitRoom(writer, node, rfInstance);
  }

  // ─── Devices ────────────────────────────────────────────────────────
  for (const node of nodes) {
    if (node.type === "device") emitDevice(writer, node, rfInstance, edges, state.signalColors);
  }

  // ─── Annotations ────────────────────────────────────────────────────
  for (const node of nodes) {
    if (node.type === "annotation") emitAnnotation(writer, node, rfInstance);
  }

  // ─── Connection lines (with hops + per-edge line style) ─────────────
  const allArcCrossings = collectAllArcCrossings(routedEdges);

  for (const edge of edges) {
    const routed = routedEdges[edge.id];
    if (!routed) continue;
    const sig = edge.data?.signalType;
    const layer = sig ? signalLayerName(sig) : CANONICAL_LAYERS.DEFAULT;
    const hex = sig ? resolveSignalColor(sig, state.signalColors) : "#000000";
    const trueColor = hexToTrueColor(hex);
    const lineStyle = resolveLineStyle(edge, state.signalLineStyles);
    let linetype = lineStyleToLtype(lineStyle);
    if (edge.data?.connectorMismatch && !edge.data?.allowIncompatible) {
      linetype = "ES_MISMATCH";
    }

    const entityStyle: EntityStyle = {
      trueColor,
      linetype,
      lineWeight: 25,
    };

    // Stubbed connections: emit two separate short paths (source + target sides)
    if (edge.data?.stubbed) {
      emitStubbedEdge(writer, edge, routed, layer, entityStyle, nodes, rfInstance, trueColor);
      continue;
    }

    emitEdgeGeometry(writer, routed, layer, entityStyle, allArcCrossings);

    // Labels (cable ID + custom)
    emitCableIdLabels(
      writer, edge, routed,
      state.cableIdLabelMode, state.cableIdGap, state.cableIdMidOffset,
      trueColor,
    );
    emitCustomLabel(
      writer, edge, routed,
      state.customLabelMode, state.customLabelGap, state.customLabelMidOffset,
      trueColor,
    );
  }

  // ─── Title block (if configured) ───────────────────────────────────
  if (state.titleBlock && state.titleBlockLayout) {
    const hasContent = Object.values(state.titleBlock).some(
      (v) => typeof v === "string" && v.trim().length > 0,
    );
    if (hasContent) {
      emitTitleBlock(writer, state.titleBlock, state.titleBlockLayout, extMin, extMax);
    }
  }

  // ─── Legend (if enabled) ───────────────────────────────────────────
  if (state.colorKeyEnabled) {
    emitLegend(
      writer,
      edges,
      state.signalColors,
      state.signalLineStyles,
      state.colorKeyOverrides,
      extMin,
      extMax,
      state.colorKeyColumns ?? 2,
    );
  }

  // ─── Close out ──────────────────────────────────────────────────────
  writer.endEntities();
  writer.writeObjects();
  writer.writeEof();

  // ─── Download ───────────────────────────────────────────────────────
  const blob = new Blob([writer.toString()], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${state.schematicName.replace(/[^a-zA-Z0-9-_ ]/g, "")}.dxf`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Stubbed edges emit TWO independent short paths — one from each device handle
 * toward its own stub endpoint. This mirrors `OffsetEdge.buildStub` exactly so
 * the DXF matches the canvas.
 */
function emitStubbedEdge(
  writer: DxfWriter,
  edge: ConnectionEdge,
  routed: { waypoints: Point[]; segments: { x1: number; y1: number; x2: number; y2: number; axis: "h" | "v" }[] },
  layer: string,
  style: EntityStyle,
  nodes: SchematicNode[],
  rfInstance: ReactFlowInstance,
  trueColor: number,
) {
  const srcHandle = findHandlePos(rfInstance, edge.source, edge.sourceHandle);
  const tgtHandle = findHandlePos(rfInstance, edge.target, edge.targetHandle);
  if (!srcHandle || !tgtHandle) return;

  // Derive exit direction from the first/last routed segment when available.
  // Fall back to +1 (source exits right) / -1 (target exits left).
  const srcDir = firstSegmentUnitX(routed.segments);
  const tgtDir = lastSegmentUnitX(routed.segments);
  const srcExitDx = srcDir !== 0 ? srcDir : 1;
  const tgtExitDx = tgtDir !== 0 ? -tgtDir : -1;

  const srcPath = buildStubPath(
    srcHandle,
    srcExitDx,
    edge.data?.stubSourceEnd,
    edge.data?.stubSourceWaypoints,
  );
  const tgtPath = buildStubPath(
    tgtHandle,
    tgtExitDx,
    edge.data?.stubTargetEnd,
    edge.data?.stubTargetWaypoints,
  );

  // Emit both paths with the rounded-corner + hop treatment. Stubs don't take
  // hops on themselves (they're too short), so an empty crossing list is fine.
  emitRoundedWaypointPath(writer, srcPath, [], [], layer, style);
  emitRoundedWaypointPath(writer, tgtPath, [], [], layer, style);

  // Stub end labels — source end labels the TARGET device, target end labels
  // the SOURCE device (the label tells the reader where the connection goes).
  const sourceNode = nodes.find((n) => n.id === edge.source);
  const targetNode = nodes.find((n) => n.id === edge.target);
  if (sourceNode && targetNode) {
    if (srcPath.length >= 2) {
      const endPt = srcPath[srcPath.length - 1];
      const towardPt = srcPath[srcPath.length - 2];
      emitStubEnd(writer, endPt, towardPt, `\u2192 ${deviceEndLabel(targetNode, nodes)}`, trueColor);
    }
    if (tgtPath.length >= 2) {
      const endPt = tgtPath[tgtPath.length - 1];
      const towardPt = tgtPath[tgtPath.length - 2];
      emitStubEnd(writer, endPt, towardPt, `\u2192 ${deviceEndLabel(sourceNode, nodes)}`, trueColor);
    }
  }
}

/** Build a single stub path mirroring OffsetEdge.buildStub. All in screen-px. */
function buildStubPath(
  handle: Point,
  exitDx: number,
  customEnd: Point | undefined,
  waypoints: Point[] | undefined,
): Point[] {
  const endX = customEnd ? customEnd.x : handle.x + exitDx * STUB_DEFAULT_LEN;
  const endY = customEnd ? customEnd.y : handle.y;
  const intermediates = waypoints ?? [];

  // Runway: a point one grid unit back from the endpoint on the horizontal
  // approach line — ensures the line enters the label horizontally.
  const runwayX = endX - exitDx * GRID_SIZE;
  const needsRunway = endY !== handle.y || intermediates.length > 0;

  const raw: Point[] = [
    { x: handle.x, y: handle.y },
    ...intermediates,
    ...(needsRunway ? [{ x: runwayX, y: endY }] : []),
    { x: endX, y: endY },
  ];
  return simplifyWaypoints(orthogonalize(raw));
}

/** First routed segment's unit-X component (0 if the segment is vertical). */
function firstSegmentUnitX(segs: { x1: number; x2: number; y1: number; y2: number }[]): number {
  if (segs.length === 0) return 0;
  const s = segs[0];
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  return len === 0 ? 0 : dx / len;
}

function lastSegmentUnitX(segs: { x1: number; x2: number; y1: number; y2: number }[]): number {
  if (segs.length === 0) return 0;
  const s = segs[segs.length - 1];
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  return len === 0 ? 0 : dx / len;
}

/** Absolute position of a specific handle on a node, in screen-px. */
function findHandlePos(rfInstance: ReactFlowInstance, nodeId: string, handleId: string | null | undefined): Point | null {
  if (!handleId) return null;
  const internal = rfInstance.getInternalNode(nodeId);
  if (!internal) return null;
  const absX = internal.internals.positionAbsolute.x;
  const absY = internal.internals.positionAbsolute.y;
  const bounds = internal.internals.handleBounds;
  for (const handle of [...(bounds?.source ?? []), ...(bounds?.target ?? [])]) {
    if (handle.id === handleId) {
      return {
        x: absX + handle.x + handle.width / 2,
        y: absY + handle.y + handle.height / 2,
      };
    }
  }
  return null;
}

function deviceEndLabel(node: SchematicNode, allNodes: SchematicNode[]): string {
  const label = (node.data as { label?: string }).label ?? "";
  let room: string | undefined;
  if (node.parentId) {
    const parent = allNodes.find((n) => n.id === node.parentId);
    if (parent) room = (parent.data as { label?: string }).label;
  }
  return room ? `${label} (${room})` : label;
}
