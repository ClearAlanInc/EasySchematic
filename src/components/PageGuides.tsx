import { memo, useMemo } from "react";
import { useViewport } from "@xyflow/react";
import { useSchematicStore } from "../store";
import { computePageGrid } from "../printPageGrid";
import { getPaperSize } from "../printConfig";
import { nodesOnSheet } from "../sheets";

/**
 * Discreet page-size guides on the normal canvas (#page-guides): faint dashed
 * outlines of the print page grid so users can lay out rooms and notes to
 * avoid page splits WITHOUT entering Print View. Just frames and tiny corner
 * labels — the full treatment (title blocks, crossing labels, color key)
 * stays in Print View's PageBoundaryOverlay.
 *
 * Non-interactive: pointer events pass straight through to the canvas.
 */
function PageGuidesComponent() {
  const { x: vx, y: vy, zoom } = useViewport();

  const printPaperId = useSchematicStore((s) => s.printPaperId);
  const printOrientation = useSchematicStore((s) => s.printOrientation);
  const printScale = useSchematicStore((s) => s.printScale);
  const printCustomWidthIn = useSchematicStore((s) => s.printCustomWidthIn);
  const printCustomHeightIn = useSchematicStore((s) => s.printCustomHeightIn);
  const printOriginOffsetX = useSchematicStore((s) => s.printOriginOffsetX);
  const printOriginOffsetY = useSchematicStore((s) => s.printOriginOffsetY);
  const titleBlockHeightIn = useSchematicStore((s) => s.titleBlockLayout?.heightIn ?? 1);
  const activeSheetId = useSchematicStore((s) => s.activeSheetId);
  const firstSheetId = useSchematicStore((s) => s.schematicSheets[0]?.id ?? "sheet-1");
  const multiSheet = useSchematicStore((s) => s.schematicSheets.length > 1);

  // Digest of node geometry — the grid only depends on positions/sizes, so a
  // string selector keeps re-renders away from unrelated node edits.
  const geometryDigest = useSchematicStore((s) =>
    s.nodes
      .map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)},${n.measured?.width ?? 0},${n.measured?.height ?? 0},${n.parentId ?? ""}`)
      .join("|"),
  );

  const paperSize = getPaperSize(printPaperId, printCustomWidthIn, printCustomHeightIn);

  const pages = useMemo(() => {
    const state = useSchematicStore.getState();
    const sheetNodes = multiSheet
      ? nodesOnSheet(state.nodes, state.edges, activeSheetId, firstSheetId)
      : state.nodes;
    if (sheetNodes.length === 0) return [];
    return computePageGrid(
      paperSize, printOrientation, printScale, sheetNodes,
      titleBlockHeightIn, printOriginOffsetX, printOriginOffsetY,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometryDigest stands in for nodes
  }, [geometryDigest, paperSize, printOrientation, printScale, titleBlockHeightIn,
      printOriginOffsetX, printOriginOffsetY, activeSheetId, firstSheetId, multiSheet]);

  if (pages.length === 0) return null;

  const paperLabel = `${paperSize.label} ${printOrientation}`;
  // Keep line weights and text constant on screen regardless of zoom.
  const strokeW = 1 / zoom;
  const fontSize = 10 / zoom;

  return (
    <div
      data-print-hide
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}
    >
      <svg
        style={{
          position: "absolute",
          overflow: "visible",
          width: 1,
          height: 1,
          transform: `translate(${vx}px, ${vy}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {pages.map((p) => (
          <g key={p.index}>
            <rect
              x={p.x}
              y={p.y}
              width={p.widthPx}
              height={p.heightPx}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={strokeW}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              opacity={0.8}
            />
            <text
              x={p.x + 6 / zoom}
              y={p.y + 4 / zoom + fontSize}
              fontSize={fontSize}
              fontFamily="'Inter', system-ui, sans-serif"
              fill="var(--color-text-muted)"
              opacity={0.7}
            >
              {`Page ${p.index + 1}${p.index === 0 ? ` — ${paperLabel}` : ""}`}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default memo(PageGuidesComponent);
