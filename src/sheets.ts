/**
 * Multiple schematic pages ("sheets") in one file (#multi-page).
 *
 * The model is sheets-over-one-database: every node and edge lives in the
 * single global store, and each top-level node carries `data.sheetId` naming
 * the schematic page it appears on. The canvas renders one sheet at a time;
 * reports, VLAN propagation, and connectivity remain global and therefore
 * span pages for free.
 *
 * Resolution rules (resolveNodeSheet):
 *  - A child node (inside a room) is on its root ancestor's sheet.
 *  - Waypoint nodes follow the edge they belong to (via its source device).
 *  - Bundle junctions follow any member edge of their bundle.
 *  - Anything without a sheetId is on the first sheet — which is also why
 *    pre-multi-page files need no per-node migration.
 *
 * Invariant: an edge never crosses sheets. Moving devices to another sheet
 * first splits any crossing wire into a stub pair (wire tags), one stub per
 * side, so each leg stays intra-sheet.
 */

import type { SchematicNode, ConnectionEdge } from "./types";

export interface SheetDef {
  id: string;
  label: string;
}

export const DEFAULT_SHEET: SheetDef = { id: "sheet-1", label: "Page 1" };

export function newSheetId(): string {
  return `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Resolve which sheet a node renders on. See module docs for the rules. */
export function resolveNodeSheet(
  node: SchematicNode,
  nodeMap: Map<string, SchematicNode>,
  edges: ConnectionEdge[],
  firstSheetId: string,
  _depth = 0,
): string {
  if (_depth > 8) return firstSheetId; // cycle guard — malformed parent chains

  // Children render on their root ancestor's sheet.
  if (node.parentId) {
    const parent = nodeMap.get(node.parentId);
    if (parent) return resolveNodeSheet(parent, nodeMap, edges, firstSheetId, _depth + 1);
  }

  const own = (node.data as { sheetId?: unknown }).sheetId;
  if (typeof own === "string" && own) return own;

  if (node.type === "waypoint") {
    const edgeId = (node.data as { edgeId?: unknown }).edgeId;
    const edge = typeof edgeId === "string" ? edges.find((e) => e.id === edgeId) : undefined;
    const src = edge && nodeMap.get(edge.source);
    if (src) return resolveNodeSheet(src, nodeMap, edges, firstSheetId, _depth + 1);
  }

  if (node.type === "bundle-junction") {
    const bundleId = (node.data as { bundleId?: unknown }).bundleId;
    const member = typeof bundleId === "string"
      ? edges.find((e) => e.data?.bundleId === bundleId)
      : undefined;
    const src = member && nodeMap.get(member.source);
    if (src) return resolveNodeSheet(src, nodeMap, edges, firstSheetId, _depth + 1);
  }

  return firstSheetId;
}

/** Nodes visible on the given sheet. */
export function nodesOnSheet(
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
  sheetId: string,
  firstSheetId: string,
): SchematicNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));
  return nodes.filter((n) => resolveNodeSheet(n, nodeMap, edges, firstSheetId) === sheetId);
}

/** True when a sheet holds no user content (safe to delete). */
export function sheetIsEmpty(
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
  sheetId: string,
  firstSheetId: string,
): boolean {
  return nodesOnSheet(nodes, edges, sheetId, firstSheetId).length === 0;
}
