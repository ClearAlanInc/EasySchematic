import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { BundleJunctionNode as BundleJunctionNodeType } from "../types";

/**
 * Break-in / break-out junction box for a bundle.
 *
 * Phase 1 STUB: renders a minimal placeholder. The real draggable break-out box
 * (bundle label + Nx count, signal color, in/out styling) lands in Phase 4, and
 * nothing spawns nodes of this type until Phase 2 — so this currently renders for
 * no one. Kept intentionally tiny so an early-spawned junction is at least locatable
 * on the canvas during Phase 2/3 development.
 */
function BundleJunctionNodeComponent({ data }: NodeProps<BundleJunctionNodeType>) {
  return (
    <div
      data-bundle-junction={data.role}
      style={{
        width: 12,
        height: 12,
        marginLeft: -6,
        marginTop: -6,
        borderRadius: 3,
        background: "#94a3b8",
        border: "1px solid #475569",
        opacity: 0.6,
      }}
    />
  );
}

export default memo(BundleJunctionNodeComponent);
