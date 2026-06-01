/** Glue: route a fixture's nodes/edges headlessly via the mock ReactFlow instance. */

import type { SchematicNode, ConnectionEdge, BundleMeta } from "../types";
import { routeAllEdges, type RoutedEdge } from "../edgeRouter";
import { createMockRfInstance } from "./mockRfInstance";
import { buildHandleSnapshot } from "../routing/handleSnapshot";

export interface RoutedFixture {
  nodes: SchematicNode[];
  edges: ConnectionEdge[];
  routes: Record<string, RoutedEdge>;
  overBudget: boolean;
}

export function routeFixture(
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
  opts: { timeBudgetMs?: number; bundles?: Record<string, BundleMeta> } = {},
): RoutedFixture {
  const rf = createMockRfInstance(nodes);
  const handles = buildHandleSnapshot(nodes, rf);
  const { routes, overBudget } = routeAllEdges(
    nodes,
    edges,
    handles,
    false,
    undefined,
    opts.timeBudgetMs,
    opts.bundles,
  );
  return { nodes, edges, routes, overBudget };
}
