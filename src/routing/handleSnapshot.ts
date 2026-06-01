/**
 * The single point where routing depends on React Flow / the DOM.
 *
 * `routeAllEdges` resolves each connection's endpoints from handle positions that only React Flow
 * knows (it measures them in the DOM). Rather than hand the router a live `ReactFlowInstance` — which
 * can't cross a Web Worker boundary — we snapshot the handle data into a plain, structured-cloneable
 * object on the main thread and pass THAT to the router. The router then runs anywhere (main thread,
 * worker, or headless Node harness) with no DOM coupling.
 *
 * The fields here are exactly what `getHandlePositions` (edgeRouter.ts) reads off
 * `rfInstance.getInternalNode(id)`: the node type, its absolute position, its measured height (for
 * stub-label handle centering), and each handle's box.
 */

import type { ReactFlowInstance } from "@xyflow/react";
import type { SchematicNode } from "../types";

export interface SnapshotHandle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeHandleData {
  type: string | undefined;
  positionAbsolute: { x: number; y: number };
  /** Used to center stub-label l/r handles exactly (the router special-cases these). */
  measuredHeight?: number;
  source: SnapshotHandle[];
  target: SnapshotHandle[];
}

/** Plain map nodeId → handle data. Structured-cloneable; safe to postMessage to a worker. */
export type HandleSnapshot = Record<string, NodeHandleData>;

const cleanHandles = (
  handles: ReadonlyArray<{ id?: string | null; x: number; y: number; width: number; height: number }> | null | undefined,
): SnapshotHandle[] =>
  (handles ?? [])
    .filter((h): h is SnapshotHandle => typeof h.id === "string")
    .map((h) => ({ id: h.id, x: h.x, y: h.y, width: h.width, height: h.height }));

/**
 * Extract the handle-bounds snapshot for the given nodes from a React Flow instance. Call on the
 * main thread (it reads DOM-measured internals); the result is a plain object you can hand to
 * `routeAllEdges` directly or postMessage to the routing worker. Nodes React Flow hasn't measured
 * yet are skipped — the router already tolerates missing endpoints.
 */
export function buildHandleSnapshot(
  nodes: SchematicNode[],
  rfInstance: ReactFlowInstance,
): HandleSnapshot {
  const snapshot: HandleSnapshot = {};
  for (const node of nodes) {
    const internal = rfInstance.getInternalNode(node.id);
    if (!internal) continue;
    const bounds = internal.internals.handleBounds;
    snapshot[node.id] = {
      type: internal.type,
      positionAbsolute: {
        x: internal.internals.positionAbsolute.x,
        y: internal.internals.positionAbsolute.y,
      },
      measuredHeight: internal.measured?.height as number | undefined,
      source: cleanHandles(bounds?.source),
      target: cleanHandles(bounds?.target),
    };
  }
  return snapshot;
}
