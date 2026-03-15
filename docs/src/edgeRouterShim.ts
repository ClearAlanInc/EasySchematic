/**
 * Shim for src/edgeRouter.ts — avoids pulling in the pathfinding module.
 */
export interface RoutedEdge {
  edgeId: string;
  svgPath: string;
  waypoints: { x: number; y: number }[];
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  labelX: number;
  labelY: number;
  turns: string;
}

export function routeAllEdges(): Record<string, RoutedEdge> {
  return {};
}
