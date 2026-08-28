import { type ReactFlowInstance } from "@xyflow/react";
import { jsPDF } from "jspdf";
import { toPng } from "html-to-image";
import { freezeSvgColors } from "./freezeSvgColors";
import {
  type PaperSize,
  type Orientation,
  PAGE_MARGIN_IN,
} from "./printConfig";
import { computePageGrid, type PageRect } from "./printPageGrid";
import type { TitleBlock, TitleBlockLayout, DeviceData, SchematicNode, ConnectionEdge } from "./types";
import type { RoutedEdge } from "./edgeRouter";
import { computeCellRects, normalizeSizes, getFieldValue } from "./titleBlockLayout";
import { useSchematicStore } from "./store";
import { DEFAULT_SIGNAL_COLORS } from "./signalColors";
import { transformLabelNow } from "./labelCaseUtils";
import { collectColorKeyEntries, layoutColorKey, type ColorKeyEntry } from "./colorKeyLayout";
import { nodesOnSheet, resolveNodeSheet } from "./sheets";
import { buildManagementTarget } from "./managementUrl";
import type { StubLabelData } from "./types";

const DPI = 96;
// 5 × 96 = 480 DPI — well above the 300 DPI print standard, sharp even at high
// zoom in PDF viewers. Bumped from 1.5 to fix soft/pixelated printed output.
// The "FAST" deflate compression on addImage below keeps PDF sizes in check
// independently of pixelRatio — see commit 38ce285.
const TARGET_PIXEL_RATIO = 5;
// Cap raster dimension to stay under browser canvas limits (~16384px in Chrome)
// on huge custom paper sizes. Falls back to a lower effective DPI on those.
const MAX_RASTER_DIMENSION_PX = 12000;

// ─── Inter font embedding for jsPDF ───

let interRegularB64: string | null = null;
let interBoldB64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function loadInterFont(doc: jsPDF) {
  if (!interRegularB64) {
    const [regularRes, boldRes] = await Promise.all([
      fetch("/fonts/Inter-Regular.ttf"),
      fetch("/fonts/Inter-Bold.ttf"),
    ]);
    if (!regularRes.ok || !boldRes.ok) {
      throw new Error(`Font fetch failed: regular=${regularRes.status} bold=${boldRes.status}`);
    }
    const [regular, bold] = await Promise.all([
      regularRes.arrayBuffer(),
      boldRes.arrayBuffer(),
    ]);
    interRegularB64 = arrayBufferToBase64(regular);
    interBoldB64 = arrayBufferToBase64(bold);
  }
  doc.addFileToVFS("Inter-Regular.ttf", interRegularB64);
  doc.addFileToVFS("Inter-Bold.ttf", interBoldB64!);
  doc.addFont("Inter-Regular.ttf", "Inter", "normal");
  doc.addFont("Inter-Bold.ttf", "Inter", "bold");
}

/** Build @font-face CSS with base64-embedded Inter for html-to-image.
 *  Bypasses html-to-image's flaky auto font-embedding so glyphs like → survive. */
function getInterFontEmbedCSS(): string {
  if (!interRegularB64 || !interBoldB64) return "";
  return [
    `@font-face { font-family: 'Inter'; font-weight: 400; font-style: normal; src: url(data:font/truetype;base64,${interRegularB64}) format('truetype'); }`,
    `@font-face { font-family: 'Inter'; font-weight: 700; font-style: normal; src: url(data:font/truetype;base64,${interBoldB64}) format('truetype'); }`,
  ].join("\n");
}

/** Wait for rendering to settle (edge routing debounce, etc.) */
function waitForRender(ms = 200): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, ms);
      });
    });
  });
}

function showLoadingOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = "pdf-export-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Inter', system-ui, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background:white; padding:24px 40px; border-radius:8px; text-align:center; box-shadow: 0 4px 24px rgba(0,0,0,0.3);">
      <div style="font-size:16px; font-weight:600; color:#1f2937; margin-bottom:8px;">Generating PDF...</div>
      <div id="pdf-export-progress" style="font-size:13px; color:#6b7280;">Preparing pages</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function updateProgress(text: string) {
  const el = document.getElementById("pdf-export-progress");
  if (el) el.textContent = text;
}

function removeLoadingOverlay() {
  document.getElementById("pdf-export-overlay")?.remove();
}

const PDF_FONT_MAP: Record<string, string> = {
  "sans-serif": "Inter",
  "serif": "times",
  "monospace": "courier",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

async function drawTitleBlock(
  doc: jsPDF,
  pageWIn: number,
  pageHIn: number,
  tb: TitleBlock,
  layout: TitleBlockLayout,
  pageNum: number,
  totalPages: number,
) {
  const margin = PAGE_MARGIN_IN;
  const tbHeight = layout.heightIn;
  const tbTop = pageHIn - margin - tbHeight;
  const fullTbWidth = pageWIn - 2 * margin;
  const tbWidth = Math.min(layout.widthIn, fullTbWidth);
  const tbLeft = margin + fullTbWidth - tbWidth;

  const cellRects = computeCellRects(layout);
  const pad = 0.05;

  // Border
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.005);
  doc.rect(tbLeft, tbTop, tbWidth, tbHeight);

  // Cumulative positions (normalized to 0..1)
  const normCols = normalizeSizes(layout.columns);
  const normRows = normalizeSizes(layout.rows);
  const colStarts: number[] = [0];
  for (let i = 0; i < normCols.length; i++) {
    colStarts.push(colStarts[i] + normCols[i]);
  }
  const rowStarts: number[] = [0];
  for (let i = 0; i < normRows.length; i++) {
    rowStarts.push(rowStarts[i] + normRows[i]);
  }

  // Build skip sets for merged cells
  const skipHLines = new Set<string>();
  const skipVLines = new Set<string>();
  for (const cell of layout.cells) {
    for (let r = cell.row + 1; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
        skipHLines.add(`${r},${c}`);
      }
    }
    for (let c = cell.col + 1; c < cell.col + cell.colSpan; c++) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        skipVLines.add(`${c},${r}`);
      }
    }
  }

  // Horizontal grid lines
  for (let ri = 1; ri < layout.rows.length; ri++) {
    const y = tbTop + rowStarts[ri] * tbHeight;
    let segStart: number | null = null;
    for (let c = 0; c < layout.columns.length; c++) {
      if (skipHLines.has(`${ri},${c}`)) {
        if (segStart !== null) {
          doc.line(tbLeft + colStarts[segStart] * tbWidth, y, tbLeft + colStarts[c] * tbWidth, y);
          segStart = null;
        }
      } else {
        if (segStart === null) segStart = c;
      }
    }
    if (segStart !== null) {
      doc.line(tbLeft + colStarts[segStart] * tbWidth, y, tbLeft + tbWidth, y);
    }
  }

  // Vertical grid lines
  for (let ci = 1; ci < layout.columns.length; ci++) {
    const x = tbLeft + colStarts[ci] * tbWidth;
    let segStart: number | null = null;
    for (let r = 0; r < layout.rows.length; r++) {
      if (skipVLines.has(`${ci},${r}`)) {
        if (segStart !== null) {
          doc.line(x, tbTop + rowStarts[segStart] * tbHeight, x, tbTop + rowStarts[r] * tbHeight);
          segStart = null;
        }
      } else {
        if (segStart === null) segStart = r;
      }
    }
    if (segStart !== null) {
      doc.line(x, tbTop + rowStarts[segStart] * tbHeight, x, tbTop + tbHeight);
    }
  }

  // Cell content
  for (const cell of layout.cells) {
    const rect = cellRects.get(cell.id);
    if (!rect) continue;

    const cellX = tbLeft + rect.x * tbWidth;
    const cellY = tbTop + rect.y * tbHeight;
    const cellW = rect.w * tbWidth;
    const cellH = rect.h * tbHeight;

    const fontName = PDF_FONT_MAP[cell.fontFamily] ?? "Inter";
    const fontStyle = cell.fontWeight === "bold" ? "bold" : "normal";

    if (cell.content.type === "logo") {
      if (tb.logo) {
        try {
          const logoPad = 0.03;
          const availW = cellW - logoPad * 2;
          const availH = cellH - logoPad * 2;
          // Load image and await decode to get natural dimensions
          const img = new Image();
          img.src = tb.logo;
          await new Promise<void>((resolve) => {
            if (img.naturalWidth > 0) { resolve(); return; }
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
          const natW = img.naturalWidth || availW;
          const natH = img.naturalHeight || availH;
          const aspect = natW / natH;
          let drawW = availW;
          let drawH = availW / aspect;
          if (drawH > availH) {
            drawH = availH;
            drawW = availH * aspect;
          }
          const drawX = cellX + logoPad + (availW - drawW) / 2;
          const drawY = cellY + logoPad + (availH - drawH) / 2;
          doc.addImage(tb.logo, "PNG", drawX, drawY, drawW, drawH);
        } catch {
          // Logo rendering failed — skip silently
        }
      }
      continue;
    }

    let text: string;
    let color = cell.color;
    switch (cell.content.type) {
      case "field": {
        const value = getFieldValue(tb, cell.content.field);
        text = value || "";
        if (!value) continue; // Don't render empty fields in PDF
        break;
      }
      case "static":
        text = cell.content.text;
        color = cell.color;
        break;
      case "pageNumber":
        text = `Page ${pageNum} / ${totalPages}`;
        break;
    }

    doc.setFont(fontName, fontStyle);
    doc.setFontSize(cell.fontSize);
    const [r, g, b] = hexToRgb(color);
    doc.setTextColor(r, g, b);

    let textX: number;
    let align: "left" | "center" | "right";
    if (cell.align === "center") {
      textX = cellX + cellW / 2;
      align = "center";
    } else if (cell.align === "right") {
      textX = cellX + cellW - pad;
      align = "right";
    } else {
      textX = cellX + pad;
      align = "left";
    }

    const textY = cellY + cellH / 2 + (cell.fontSize / 72) * 0.35;
    doc.text(text, textX, textY, { align });
  }
}

function drawContentBorder(
  doc: jsPDF,
  pageWIn: number,
  pageHIn: number,
) {
  const margin = PAGE_MARGIN_IN;
  const contentW = pageWIn - 2 * margin;
  const contentH = pageHIn - 2 * margin;
  doc.saveGraphicsState();
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.005);
  doc.rect(margin, margin, contentW, contentH);
  doc.restoreGraphicsState();
}

interface PdfCrossingLabel {
  /** X position in inches */
  x: number;
  /** Y position in inches */
  y: number;
  text: string;
  anchor: "left" | "right" | "up" | "down";
  /** Signal wire color (hex) */
  color: string;
}

function computePdfCrossingLabels(
  page: PageRect,
  pages: PageRect[],
  routedEdges: Record<string, RoutedEdge>,
  edges: ConnectionEdge[],
  nodes: SchematicNode[],
  scale: number,
): PdfCrossingLabel[] {
  if (pages.length <= 1) return [];

  // Collect page boundary lines in canvas px (internal edges only)
  const minCol = Math.min(...pages.map((p) => p.col));
  const minRow = Math.min(...pages.map((p) => p.row));
  const vLines = new Set<number>();
  const hLines = new Set<number>();
  for (const p of pages) {
    if (p.col > minCol) vLines.add(p.x);
    if (p.row > minRow) hLines.add(p.y);
    vLines.add(p.x + p.widthPx);
    hLines.add(p.y + p.heightPx);
  }

  const marginPx = page.contentX - page.x;

  // Build node info lookup. Devices use their own label/room. Stub-label nodes
  // proxy to the FAR device of their logical connection (the device on the other
  // side of the linkedConnectionId pair) — so cross-page indicators on a stub-leg
  // edge still point the reader toward the actual destination.
  const nodeInfo = new Map<string, { label: string; room?: string }>();
  for (const n of nodes) {
    if (n.type !== "device") continue;
    const data = n.data as DeviceData;
    let room: string | undefined;
    if (n.parentId) {
      const parent = nodes.find((p) => p.id === n.parentId);
      if (parent) room = (parent.data as { label?: string }).label;
    }
    nodeInfo.set(n.id, { label: transformLabelNow(data.label), room });
  }
  for (const n of nodes) {
    if (n.type !== "stub-label") continue;
    const stubData = n.data as { linkedConnectionId?: string; side?: "source" | "target" };
    if (!stubData.linkedConnectionId) continue;
    // Find the partner leg (the OTHER edge with the same linkedConnectionId)
    const myEdge = edges.find((e) =>
      e.data?.linkedConnectionId === stubData.linkedConnectionId &&
      (stubData.side === "source" ? e.target === n.id : e.source === n.id),
    );
    if (!myEdge) continue;
    const partnerEdge = edges.find((e) =>
      e.data?.linkedConnectionId === stubData.linkedConnectionId && e.id !== myEdge.id,
    );
    if (!partnerEdge) continue;
    const farDeviceId = stubData.side === "source" ? partnerEdge.target : partnerEdge.source;
    const farInfo = nodeInfo.get(farDeviceId);
    if (farInfo) nodeInfo.set(n.id, farInfo);
  }

  const edgeMap = new Map(edges.map((e) => [e.id, e]));
  const labels: PdfCrossingLabel[] = [];

  // Resolve signal color for an edge
  const storeColors = useSchematicStore.getState().signalColors;
  const resolveColor = (edge: ConnectionEdge): string => {
    const st = edge.data?.signalType;
    if (!st) return DEFAULT_SIGNAL_COLORS.custom;
    return storeColors?.[st] ?? DEFAULT_SIGNAL_COLORS[st];
  };

  // Convert canvas px to inches relative to this page's content area
  const toPageX = (cx: number) => PAGE_MARGIN_IN + (cx - page.contentX) * scale / DPI;
  const toPageY = (cy: number) => PAGE_MARGIN_IN + (cy - page.contentY) * scale / DPI;

  for (const [edgeId, route] of Object.entries(routedEdges)) {
    const edge = edgeMap.get(edgeId);
    if (!edge) continue;
    const sourceInfo = nodeInfo.get(edge.source);
    const targetInfo = nodeInfo.get(edge.target);
    if (!sourceInfo || !targetInfo) continue;

    const edgeColor = resolveColor(edge);

    for (const seg of route.segments) {
      if (seg.axis === "h") {
        const y = seg.y1;
        const minX = Math.min(seg.x1, seg.x2);
        const maxX = Math.max(seg.x1, seg.x2);
        const goingRight = seg.x2 > seg.x1;
        for (const bx of vLines) {
          if (bx > minX && bx < maxX) {
            const rightwardTarget = goingRight ? targetInfo : sourceInfo;
            const leftwardTarget = goingRight ? sourceInfo : targetInfo;

            const insetPx = marginPx * 0.15;
            const leftPx = bx - marginPx - insetPx;
            const rightPx = bx + marginPx + insetPx;

            if (leftPx >= page.contentX && leftPx <= page.contentX + page.contentW) {
              const text = fmtLabel(rightwardTarget);
              labels.push({ x: toPageX(leftPx), y: toPageY(y), text, anchor: "left", color: edgeColor });
            }
            if (rightPx >= page.contentX && rightPx <= page.contentX + page.contentW) {
              const text = fmtLabel(leftwardTarget);
              labels.push({ x: toPageX(rightPx), y: toPageY(y), text, anchor: "right", color: edgeColor });
            }
          }
        }
      } else {
        const x = seg.x1;
        const minY = Math.min(seg.y1, seg.y2);
        const maxY = Math.max(seg.y1, seg.y2);
        const goingDown = seg.y2 > seg.y1;
        for (const by of hLines) {
          if (by > minY && by < maxY) {
            const downwardTarget = goingDown ? targetInfo : sourceInfo;
            const upwardTarget = goingDown ? sourceInfo : targetInfo;

            const insetPx = marginPx * 0.15;
            const upPx = by - marginPx - insetPx;
            const downPx = by + marginPx + insetPx;

            if (upPx >= page.contentY && upPx <= page.contentY + page.contentH) {
              const text = fmtLabel(downwardTarget);
              labels.push({ x: toPageX(x), y: toPageY(upPx), text, anchor: "up", color: edgeColor });
            }
            if (downPx >= page.contentY && downPx <= page.contentY + page.contentH) {
              const text = fmtLabel(upwardTarget);
              labels.push({ x: toPageX(x), y: toPageY(downPx), text, anchor: "down", color: edgeColor });
            }
          }
        }
      }
    }
  }

  return labels;
}

function fmtLabel(info: { label: string; room?: string }): string {
  if (info.room) return `${info.label} (${info.room})`;
  return info.label;
}

const ARROW_CHARS: Record<string, string> = {
  left: "\u2192",  // → (points right, meaning "continues to the right")
  right: "\u2190", // ← (points left, meaning "continues to the left")
  up: "\u2193",    // ↓ (points down, meaning "continues downward")
  down: "\u2191",  // ↑ (points up, meaning "continues upward")
};

function drawCrossingLabels(doc: jsPDF, labels: PdfCrossingLabel[]) {
  if (labels.length === 0) return;
  doc.saveGraphicsState();

  const fontSize = 6; // points
  const pad = 0.02; // inches — uniform on all sides
  const radius = 0.02;

  doc.setFont("Inter", "normal");
  doc.setFontSize(fontSize);

  for (const l of labels) {
    const arrow = ARROW_CHARS[l.anchor];
    const displayText = `${arrow} ${l.text}`;
    const textW = doc.getTextWidth(displayText);
    const boxW = textW + pad * 2;
    const boxH = fontSize / 72 + pad * 2;

    let boxX: number;
    let boxY: number;

    switch (l.anchor) {
      case "left":
        boxX = l.x - boxW;
        boxY = l.y - boxH / 2;
        break;
      case "right":
        boxX = l.x;
        boxY = l.y - boxH / 2;
        break;
      case "up":
        boxX = l.x - boxW / 2;
        boxY = l.y - boxH;
        break;
      case "down":
        boxX = l.x - boxW / 2;
        boxY = l.y;
        break;
    }

    // White pill background with signal-colored border
    const [cr, cg, cb] = hexToRgb(l.color);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(cr, cg, cb);
    doc.setLineWidth(0.004);
    doc.roundedRect(boxX, boxY, boxW, boxH, radius, radius, "FD");

    // Arrow + text as single string
    doc.setFont("Inter", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(55, 65, 81);
    doc.text(displayText, boxX + pad, boxY + boxH / 2 + (fontSize / 72) * 0.35);
  }
  doc.restoreGraphicsState();
}

/** Convert SVG dash-array string (e.g. "8 4") to inch-scaled numeric array for jsPDF. */
function dashArrayToInches(dashStr: string | undefined, scale: number): number[] {
  if (!dashStr) return [];
  return dashStr.split(/\s+/).map((v) => parseFloat(v) * scale);
}

function drawColorKey(
  doc: jsPDF,
  pageWIn: number,
  pageHIn: number,
  entries: ColorKeyEntry[],
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right",
  columns: number,
) {
  if (entries.length === 0) return;
  doc.saveGraphicsState();

  const margin = PAGE_MARGIN_IN;
  const fontSize = 6; // pt
  const headerFontSize = 7; // pt
  const swatchLen = 0.25; // inches
  const swatchGap = 0.06;
  const cellW = 0.8;
  const cellH = fontSize / 72 * 1.8;
  const padding = 0.08;
  const headerH = headerFontSize / 72 * 1.8;
  const dashScale = swatchLen / 20; // SVG units → inches

  const geo = layoutColorKey(entries, columns, cellW, cellH, padding, headerH);

  // Flush with drawing border — locked into the corner like the title block
  const contentW = pageWIn - 2 * margin;
  const drawingH = pageHIn - 2 * margin; // full drawing border height
  const isRight = corner.includes("right");
  const isBottom = corner.includes("bottom");

  const ox = isRight ? margin + contentW - geo.width : margin;
  const oy = isBottom ? margin + drawingH - geo.height : margin;

  // White fill + black border — matches title block style
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.005);
  doc.rect(ox, oy, geo.width, geo.height, "FD");

  // Header divider line
  doc.line(ox, oy + padding + headerH, ox + geo.width, oy + padding + headerH);

  // Header text
  doc.setFont("Inter", "bold");
  doc.setFontSize(headerFontSize);
  doc.setTextColor(0, 0, 0);
  doc.text("SIGNAL KEY", ox + padding, oy + padding + headerFontSize / 72 * 0.85);

  // Entries
  doc.setFont("Inter", "normal");
  doc.setFontSize(fontSize);
  doc.setLineWidth(0.012);

  for (const { entry, x, y } of geo.entries) {
    const absX = ox + x;
    const absY = oy + y;
    const lineY = absY + cellH / 2;

    // Swatch line
    const [r, g, b] = hexToRgb(entry.color);
    doc.setDrawColor(r, g, b);
    const dash = dashArrayToInches(entry.dashArray, dashScale);
    if (dash.length > 0) {
      doc.setLineDashPattern(dash, 0);
    }
    doc.line(absX, lineY, absX + swatchLen, lineY);
    if (dash.length > 0) {
      doc.setLineDashPattern([], 0);
    }

    // Label
    doc.setTextColor(0, 0, 0);
    doc.text(entry.label, absX + swatchLen + swatchGap, lineY + (fontSize / 72) * 0.35);
  }

  doc.restoreGraphicsState();
}

export async function exportPdf(
  rfInstance: ReactFlowInstance,
  paperSize: PaperSize,
  orientation: Orientation,
  scale: number,
  titleBlock: TitleBlock,
  layout: TitleBlockLayout,
): Promise<void> {
  const store0 = useSchematicStore.getState();
  const { printOriginOffsetX, printOriginOffsetY } = store0;
  const allNodes = store0.nodes;
  const allEdges = store0.edges;
  if (allNodes.length === 0) return;

  // Multi-page documents (#multi-page): the PDF covers EVERY schematic page,
  // one page-grid per sheet, appended in sheet order — so a drawing package
  // exports as one document and fly-off links can jump between its pages.
  const sheetsList = store0.schematicSheets;
  const firstSheetId = sheetsList[0]?.id ?? "sheet-1";
  const multiSheet = sheetsList.length > 1;
  const savedSheetId = store0.activeSheetId;

  interface PdfPageEntry {
    sheetId: string;
    page: PageRect;
    sheetPages: PageRect[];
    sheetNodes: SchematicNode[];
    sheetEdges: ConnectionEdge[];
    pdfPageNo: number;
    isSheetFirst: boolean;
  }
  const entries: PdfPageEntry[] = [];
  for (const sh of sheetsList) {
    const sheetNodes = multiSheet ? nodesOnSheet(allNodes, allEdges, sh.id, firstSheetId) : allNodes;
    if (sheetNodes.length === 0) continue;
    const idSet = new Set(sheetNodes.map((n) => n.id));
    const sheetEdges = allEdges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
    const grid = computePageGrid(paperSize, orientation, scale, sheetNodes, layout.heightIn, printOriginOffsetX, printOriginOffsetY);
    grid.forEach((page, gi) => {
      entries.push({ sheetId: sh.id, page, sheetPages: grid, sheetNodes, sheetEdges, pdfPageNo: entries.length + 1, isSheetFirst: gi === 0 });
    });
  }
  if (entries.length === 0) return;

  /** Absolute canvas position of a node (walks room parent chains). */
  const nodeMapAll = new Map(allNodes.map((n) => [n.id, n] as const));
  const absPosOf = (n: SchematicNode): { x: number; y: number } => {
    let x = n.position.x, y = n.position.y, pid = n.parentId;
    let guard = 0;
    while (pid && guard++ < 8) {
      const par = nodeMapAll.get(pid);
      if (!par) break;
      x += par.position.x; y += par.position.y; pid = par.parentId;
    }
    return { x, y };
  };

  /** PDF page number showing the given canvas point of a given sheet. */
  const pdfPageAt = (sheetId: string, cx: number, cy: number): number | undefined =>
    entries.find(
      (e) => e.sheetId === sheetId &&
        cx >= e.page.x && cx < e.page.x + e.page.widthPx &&
        cy >= e.page.y && cy < e.page.y + e.page.heightPx,
    )?.pdfPageNo;

  showLoadingOverlay();

  // Resolve paper dimensions
  const pageWIn =
    orientation === "landscape"
      ? Math.max(paperSize.widthIn, paperSize.heightIn)
      : Math.min(paperSize.widthIn, paperSize.heightIn);
  const pageHIn =
    orientation === "landscape"
      ? Math.min(paperSize.widthIn, paperSize.heightIn)
      : Math.max(paperSize.widthIn, paperSize.heightIn);

  // Create jsPDF document (first page added automatically)
  const doc = new jsPDF({
    orientation: orientation === "landscape" ? "landscape" : "portrait",
    unit: "in",
    format: [pageWIn, pageHIn],
  });

  // Load Inter font into jsPDF — must succeed before drawing
  try {
    await loadInterFont(doc);
  } catch (err) {
    console.error("Failed to load Inter font for PDF:", err);
    removeLoadingOverlay();
    return;
  }

  // Save current state
  const savedViewport = rfInstance.getViewport();
  const container = document.querySelector(".react-flow") as HTMLElement;
  const savedWidth = container.style.width;
  const savedHeight = container.style.height;

  // Save selection state
  const rfNodes = rfInstance.getNodes();
  const selectedNodeIds = rfNodes.filter((n) => n.selected).map((n) => n.id);
  const rfEdges = rfInstance.getEdges();
  const selectedEdgeIds = rfEdges.filter((e) => e.selected).map((e) => e.id);

  // Deselect all
  rfInstance.setNodes(rfNodes.map((n) => ({ ...n, selected: false })));
  rfInstance.setEdges(rfEdges.map((e) => ({ ...e, selected: false })));

  // Add capturing attribute to hide overlays
  document.documentElement.setAttribute("data-export-capturing", "");

  // Content area dimensions in real pixels for capture
  // Use full page height (minus margins only) so nodes near the title block boundary
  // don't get clipped — the title block is drawn as vector graphics on top afterward
  const contentWPx = (pageWIn - 2 * PAGE_MARGIN_IN) * DPI;
  const contentHPx = (pageHIn - 2 * PAGE_MARGIN_IN) * DPI;

  // Derive a filename from the title block
  const fileName = (titleBlock.drawingTitle || titleBlock.showName || "Schematic").replace(/[^a-zA-Z0-9-_ ]/g, "") || "Schematic";

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const page = entry.page;
      updateProgress(`Capturing page ${i + 1} of ${entries.length}...`);

      // Bring this entry's schematic page onto the canvas before capturing.
      if (multiSheet && useSchematicStore.getState().activeSheetId !== entry.sheetId) {
        useSchematicStore.getState().setActiveSheet(entry.sheetId);
        await waitForRender(450);
      }

      if (i > 0) {
        doc.addPage([pageWIn, pageHIn], orientation === "landscape" ? "landscape" : "portrait");
      }

      // Resize container to match content capture area
      container.style.width = `${contentWPx}px`;
      container.style.height = `${contentHPx}px`;

      // Set viewport to show this page's content area
      rfInstance.setViewport(
        {
          x: -page.contentX * scale,
          y: -page.contentY * scale,
          zoom: scale,
        },
        { duration: 0 },
      );

      // Wait for edges to route and render to settle
      await waitForRender(200);

      // Capture the viewport element
      const viewportEl = document.querySelector(".react-flow__viewport") as HTMLElement;
      if (!viewportEl) continue;

      // Firefox returns `undefined` from getPropertyValue() for unrecognized CSS
      // properties, but html-to-image calls .trim() on the result without a null
      // check. Patch it to return '' instead while html-to-image runs.
      const origGetPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue;
      CSSStyleDeclaration.prototype.getPropertyValue = function (prop) {
        return origGetPropertyValue.call(this, prop) ?? '';
      };
      const longestSidePx = Math.max(contentWPx, contentHPx);
      const pixelRatio = Math.max(
        1,
        Math.min(TARGET_PIXEL_RATIO, MAX_RASTER_DIMENSION_PX / longestSidePx),
      );
      // Freeze var(--color-…) strokes to concrete colors so Chromium's
      // html-to-image clone keeps the connection lines (#173).
      const restoreColors = freezeSvgColors(viewportEl);
      let dataUrl: string;
      try {
        dataUrl = await toPng(viewportEl, {
          backgroundColor: "#ffffff",
          width: contentWPx,
          height: contentHPx,
          pixelRatio,
          fontEmbedCSS: getInterFontEmbedCSS(),
          style: {
            width: `${contentWPx}px`,
            height: `${contentHPx}px`,
            transform: `translate(${-page.contentX * scale}px, ${-page.contentY * scale}px) scale(${scale})`,
          },
        });
      } finally {
        restoreColors();
        CSSStyleDeclaration.prototype.getPropertyValue = origGetPropertyValue;
      }

      // Add image to PDF page (full height minus margins — title block drawn on top)
      const imgWidthIn = pageWIn - 2 * PAGE_MARGIN_IN;
      const imgHeightIn = pageHIn - 2 * PAGE_MARGIN_IN;
      doc.addImage(dataUrl, "PNG", PAGE_MARGIN_IN, PAGE_MARGIN_IN, imgWidthIn, imgHeightIn, undefined, "FAST");

      // Draw content border and title block with vector graphics
      drawContentBorder(doc, pageWIn, pageHIn);
      await drawTitleBlock(doc, pageWIn, pageHIn, titleBlock, layout, i + 1, entries.length);

      // Draw crossing labels — computed within this sheet's own grid, with the
      // referenced page numbers shifted into the document-wide numbering.
      const storeState = useSchematicStore.getState();
      const sheetPageOffset = entries.find((e) => e.sheetId === entry.sheetId)!.pdfPageNo - 1;
      const pdfLabels = computePdfCrossingLabels(
        page, entry.sheetPages, storeState.routedEdges, entry.sheetEdges, entry.sheetNodes, scale,
      );
      for (const l of pdfLabels) {
        l.text = l.text.replace(/ Pg (\d+)$/, (_m, num) => ` Pg ${Number(num) + sheetPageOffset}`);
      }
      drawCrossingLabels(doc, pdfLabels);

      // Draw color key / signal legend
      if (storeState.colorKeyEnabled) {
        const ckPage = storeState.colorKeyPage;
        const showOnThis = ckPage === "all" || (ckPage === "first" && i === 0) || (ckPage === "last" && i === entries.length - 1);
        if (showOnThis) {
          const ckEntries = collectColorKeyEntries(storeState.edges, storeState.signalColors, storeState.signalLineStyles, storeState.colorKeyOverrides);
          drawColorKey(doc, pageWIn, pageHIn, ckEntries, storeState.colorKeyCorner, storeState.colorKeyColumns);
        }
      }

      // ── Interactive link annotations (#pdf-links) ──────────────────────
      // Coordinates: canvas px -> inches on this PDF page.
      const toPdfX = (cx: number) => PAGE_MARGIN_IN + ((cx - page.contentX) * scale) / DPI;
      const toPdfY = (cy: number) => PAGE_MARGIN_IN + ((cy - page.contentY) * scale) / DPI;
      const onThisPage = (cx: number, cy: number) =>
        cx >= page.x && cx < page.x + page.widthPx && cy >= page.y && cy < page.y + page.heightPx;
      // Measured sizes are freshest AFTER this sheet rendered for capture.
      const liveNodes = new Map(useSchematicStore.getState().nodes.map((n) => [n.id, n] as const));

      for (const n of entry.sheetNodes) {
        const live = liveNodes.get(n.id) ?? n;

        // 1. Device name -> management interface URL.
        if (n.type === "device") {
          const data = n.data as DeviceData;
          if (data.offCanvas) continue;
          const target = buildManagementTarget(data);
          if (target) {
            const abs = absPosOf(live);
            const w = (live.measured?.width as number | undefined) ?? 144;
            const headerH = 34; // the name band at the top of the device box
            if (onThisPage(abs.x + w / 2, abs.y + headerH / 2)) {
              doc.link(toPdfX(abs.x), toPdfY(abs.y), (w * scale) / DPI, (headerH * scale) / DPI, { url: target.url });
            }
          }
        }

        // 2. Wire-tag fly-off -> the partner tag's PDF page.
        if (n.type === "stub-label") {
          const link = (n.data as StubLabelData).linkedConnectionId;
          const partner = allNodes.find(
            (m) => m.type === "stub-label" && m.id !== n.id && (m.data as StubLabelData).linkedConnectionId === link,
          );
          if (!partner) continue;
          const partnerSheet = resolveNodeSheet(partner, nodeMapAll, allEdges, firstSheetId);
          const pAbs = absPosOf(partner);
          const pW = (liveNodes.get(partner.id)?.measured?.width as number | undefined) ?? 80;
          const pH = (liveNodes.get(partner.id)?.measured?.height as number | undefined) ?? 14;
          const targetPage = pdfPageAt(partnerSheet, pAbs.x + pW / 2, pAbs.y + pH / 2);
          if (!targetPage || targetPage === entry.pdfPageNo) continue;
          const abs = absPosOf(live);
          const w = (live.measured?.width as number | undefined) ?? 80;
          const h = (live.measured?.height as number | undefined) ?? 14;
          if (onThisPage(abs.x + w / 2, abs.y + h / 2)) {
            doc.link(toPdfX(abs.x), toPdfY(abs.y), (w * scale) / DPI, (h * scale) / DPI, { pageNumber: targetPage });
          }
        }
      }
    }

    // Save the PDF
    updateProgress("Saving PDF...");
    doc.save(`${fileName}.pdf`);
  } finally {
    // Restore everything
    if (multiSheet && useSchematicStore.getState().activeSheetId !== savedSheetId) {
      useSchematicStore.getState().setActiveSheet(savedSheetId);
    }
    document.documentElement.removeAttribute("data-export-capturing");
    container.style.width = savedWidth;
    container.style.height = savedHeight;
    rfInstance.setViewport(savedViewport, { duration: 0 });

    // Restore selection
    rfInstance.setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: selectedNodeIds.includes(n.id) })),
    );
    rfInstance.setEdges((eds) =>
      eds.map((e) => ({ ...e, selected: selectedEdgeIds.includes(e.id) })),
    );

    removeLoadingOverlay();
  }
}
