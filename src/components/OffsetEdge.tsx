import { memo, useRef, useEffect } from "react";
import {
  BaseEdge,
  type EdgeProps,
} from "@xyflow/react";
import { useSchematicStore } from "../store";
import type { ConnectionEdge } from "../types";

function OffsetEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  selected,
}: EdgeProps<ConnectionEdge>) {
  const debugEdges = useSchematicStore((s) => s.debugEdges);

  // Read pre-computed route from store (serialized to string to avoid re-render loops)
  const routeStr = useSchematicStore((s) => {
    const r = s.routedEdges[id];
    if (!r) return "";
    return `${r.svgPath}\0${r.labelX}\0${r.labelY}\0${r.turns}`;
  });

  let edgePath: string;
  let lx: number;
  let ly: number;
  let turns: string;

  if (routeStr) {
    const parts = routeStr.split("\0");
    edgePath = parts[0];
    lx = Number(parts[1]);
    ly = Number(parts[2]);
    turns = parts[3];
  } else {
    // Fallback before first recompute
    edgePath = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    lx = (sourceX + targetX) / 2;
    ly = (sourceY + targetY) / 2;
    turns = "pending";
  }

  // Show label at both source and target ends so it's visible even if the path goes behind a device
  const debugLabel = debugEdges ? (
    <>
      <foreignObject
        x={sourceX + 4}
        y={sourceY - 7}
        width={1}
        height={1}
        style={{ pointerEvents: "none", overflow: "visible" }}
      >
        <div style={{
          fontSize: 9,
          fontFamily: "monospace",
          fontWeight: 700,
          color: "#e44",
          background: "rgba(255,255,255,0.9)",
          padding: "0 3px",
          borderRadius: 2,
          whiteSpace: "nowrap",
          width: "max-content",
          border: "1px solid #fcc",
        }}>
          {id}
        </div>
      </foreignObject>
      <foreignObject
        x={targetX - 4}
        y={targetY - 7}
        width={1}
        height={1}
        style={{ pointerEvents: "none", overflow: "visible" }}
      >
        <div style={{
          fontSize: 9,
          fontFamily: "monospace",
          fontWeight: 700,
          color: "#e44",
          background: "rgba(255,255,255,0.9)",
          padding: "0 3px",
          borderRadius: 2,
          whiteSpace: "nowrap",
          width: "max-content",
          direction: "rtl",
          border: "1px solid #fcc",
        }}>
          {id}
        </div>
      </foreignObject>
    </>
  ) : null;

  // Log routing data when debug mode is active
  const prevDebugRef = useRef(false);
  useEffect(() => {
    if (debugEdges && !prevDebugRef.current) {
      console.log(`[EDGE_DEBUG] ${id} | src=${Math.round(sourceX)},${Math.round(sourceY)} tgt=${Math.round(targetX)},${Math.round(targetY)} | ${turns}`);
    }
    prevDebugRef.current = debugEdges;
  }, [debugEdges, id, sourceX, sourceY, targetX, targetY, turns]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        labelX={lx}
        labelY={ly}
        style={{
          ...style,
          strokeWidth: selected ? 3 : 2,
        }}
        markerEnd={markerEnd}
      />
      {debugLabel}
    </>
  );
}

export default memo(OffsetEdgeComponent);
