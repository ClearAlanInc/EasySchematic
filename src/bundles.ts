import type { ConnectionEdge, BundleMeta } from "./types";

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
