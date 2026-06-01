import type { ConnectionEdge, BundleMeta, SchematicNode, BundleJunctionNode } from "./types";

/** React Flow node type for a bundle's break-in / break-out anchor. */
export const BUNDLE_JUNCTION_TYPE = "bundle-junction" as const;

let bundleCounter = 0;
/** Fresh bundle id (mirrors the linked-connection id scheme). */
export function newBundleId(): string {
  bundleCounter += 1;
  return `bundle-${Date.now().toString(36)}-${bundleCounter}`;
}

/** Edges belonging to a bundle. */
export function bundleMembers(edges: ConnectionEdge[], id: string): ConnectionEdge[] {
  return edges.filter((e) => e.data?.bundleId === id);
}

/** The break-in / break-out anchor nodes for a bundle (either may be missing until the
 *  heal pass spawns it — see Phase 2). Pure; callers read positions off the returned nodes. */
export function bundleJunctionsFor(
  nodes: SchematicNode[],
  id: string,
): { in?: BundleJunctionNode; out?: BundleJunctionNode } {
  let inNode: BundleJunctionNode | undefined;
  let outNode: BundleJunctionNode | undefined;
  for (const n of nodes) {
    if (n.type !== BUNDLE_JUNCTION_TYPE) continue;
    const jn = n as BundleJunctionNode;
    if (jn.data.bundleId !== id) continue;
    if (jn.data.role === "in") inNode = jn;
    else if (jn.data.role === "out") outNode = jn;
  }
  return { in: inNode, out: outNode };
}

/** Drop bundleId from edges whose bundle has <2 members or no meta, and delete those
 *  bundles. Returns the cleaned edges + bundles (pure; callers set()). */
export function gcBundles(
  edges: ConnectionEdge[],
  bundles: Record<string, BundleMeta>,
): { edges: ConnectionEdge[]; bundles: Record<string, BundleMeta> } {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const id = e.data?.bundleId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const liveBundles: Record<string, BundleMeta> = {};
  for (const [id, meta] of Object.entries(bundles)) {
    if ((counts.get(id) ?? 0) >= 2) liveBundles[id] = meta;
  }
  const cleanedEdges = edges.map((e) => {
    const id = e.data?.bundleId;
    if (id && !liveBundles[id]) {
      const { bundleId: _b, ...rest } = e.data!;
      return { ...e, data: rest as ConnectionEdge["data"] };
    }
    return e;
  });
  return { edges: cleanedEdges, bundles: liveBundles };
}
