import type { TitleBlockCell, TitleBlockLayout } from "./types";

export interface CellRect {
  x: number;  // fraction of total width (0..1)
  y: number;  // fraction of total height (0..1)
  w: number;  // fraction of total width
  h: number;  // fraction of total height
}

let cellIdCounter = 0;
export function nextCellId(): string {
  return `cell-${++cellIdCounter}`;
}

/**
 * Compute fractional rects for each cell based on the layout grid.
 * Shared by SVG overlay, PDF export, and editor preview.
 */
export function computeCellRects(layout: TitleBlockLayout): Map<string, CellRect> {
  const result = new Map<string, CellRect>();

  // Cumulative column positions
  const colStarts: number[] = [0];
  for (let i = 0; i < layout.columns.length; i++) {
    colStarts.push(colStarts[i] + layout.columns[i]);
  }

  // Cumulative row positions
  const rowStarts: number[] = [0];
  for (let i = 0; i < layout.rows.length; i++) {
    rowStarts.push(rowStarts[i] + layout.rows[i]);
  }

  for (const cell of layout.cells) {
    const x = colStarts[cell.col] ?? 0;
    const y = rowStarts[cell.row] ?? 0;

    let w = 0;
    for (let c = cell.col; c < cell.col + cell.colSpan && c < layout.columns.length; c++) {
      w += layout.columns[c];
    }

    let h = 0;
    for (let r = cell.row; r < cell.row + cell.rowSpan && r < layout.rows.length; r++) {
      h += layout.rows[r];
    }

    result.set(cell.id, { x, y, w, h });
  }

  return result;
}

/**
 * Returns set of "row,col" strings covered by another cell's span.
 */
export function getCoveredPositions(cells: TitleBlockCell[]): Set<string> {
  const covered = new Set<string>();
  for (const cell of cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
        if (r !== cell.row || c !== cell.col) {
          covered.add(`${r},${c}`);
        }
      }
    }
  }
  return covered;
}

/**
 * Returns the cell that covers position (row, col), if any.
 */
export function isCellCoveredBy(cells: TitleBlockCell[], row: number, col: number): TitleBlockCell | undefined {
  for (const cell of cells) {
    if (cell.row === row && cell.col === col) continue;
    if (
      row >= cell.row && row < cell.row + cell.rowSpan &&
      col >= cell.col && col < cell.col + cell.colSpan
    ) {
      return cell;
    }
  }
  return undefined;
}

function cell(
  row: number,
  col: number,
  content: TitleBlockCell["content"],
  opts: Partial<Pick<TitleBlockCell, "colSpan" | "rowSpan" | "fontSize" | "fontWeight" | "fontFamily" | "align" | "color">> = {},
): TitleBlockCell {
  return {
    id: nextCellId(),
    row,
    col,
    rowSpan: opts.rowSpan ?? 1,
    colSpan: opts.colSpan ?? 1,
    content,
    fontSize: opts.fontSize ?? 7,
    fontWeight: opts.fontWeight ?? "normal",
    fontFamily: opts.fontFamily ?? "sans-serif",
    align: opts.align ?? "left",
    color: opts.color ?? "#1e293b",
  };
}

/**
 * Creates the default layout matching the hardcoded 6-row, 2-column title block.
 */
export function createDefaultLayout(): TitleBlockLayout {
  // Reset counter for predictable IDs in tests/default
  cellIdCounter = 0;

  const h = 1 / 6;
  return {
    columns: [0.35, 0.65],
    rows: [h, h, h, h, h, h],
    widthIn: 3.0,
    heightIn: 1.0,
    cells: [
      // Row 0: Show Name (spans 2 cols)
      cell(0, 0, { type: "field", field: "showName" }, { colSpan: 2, fontSize: 9, fontWeight: "bold", align: "center" }),
      // Row 1: Venue (spans 2 cols)
      cell(1, 0, { type: "field", field: "venue" }, { colSpan: 2, fontSize: 7.5, align: "center", color: "#475569" }),
      // Row 2: Designer label | Designer value
      cell(2, 0, { type: "static", text: "Designer:" }, { fontSize: 7, color: "#000000" }),
      cell(2, 1, { type: "field", field: "designer" }, { fontSize: 7 }),
      // Row 3: Engineer label | Engineer value
      cell(3, 0, { type: "static", text: "Engineer:" }, { fontSize: 7, color: "#000000" }),
      cell(3, 1, { type: "field", field: "engineer" }, { fontSize: 7 }),
      // Row 4: Date label | Date value
      cell(4, 0, { type: "static", text: "Date:" }, { fontSize: 7, color: "#000000" }),
      cell(4, 1, { type: "field", field: "date" }, { fontSize: 7 }),
      // Row 5: Drawing Title | Page Number
      cell(5, 0, { type: "field", field: "drawingTitle" }, { fontSize: 7, fontWeight: "bold" }),
      cell(5, 1, { type: "pageNumber" }, { fontSize: 7, fontWeight: "bold", align: "center", color: "#475569" }),
    ],
  };
}
