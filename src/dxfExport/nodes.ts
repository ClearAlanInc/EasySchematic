import type { ReactFlowInstance } from "@xyflow/react";
import type {
  AnnotationData,
  ConnectionEdge,
  DeviceData,
  RoomData,
  SchematicNode,
  SignalType,
} from "../types";
import type { DxfWriter, EntityStyle } from "./writer";
import { cssFontPxToDxfHeight, pxToIn, tintToWhite, hexToRgb, rgbToTrueColor, truncateToWidth } from "./units";
import { CANONICAL_LAYERS, hexToTrueColor, resolveSignalColor } from "./layers";

/** Matches Tailwind `rounded-lg` on the canvas DeviceNode (8px = 0.083"). */
const DEVICE_CORNER_RADIUS_IN = 8 / 96;

interface HandlePos {
  id: string;
  absX: number;
  absY: number;
}

function getHandlePositions(
  node: SchematicNode,
  rfInstance: ReactFlowInstance,
): HandlePos[] {
  const internal = rfInstance.getInternalNode(node.id);
  if (!internal) return [];
  const absX = internal.internals.positionAbsolute.x;
  const absY = internal.internals.positionAbsolute.y;
  const bounds = internal.internals.handleBounds;
  const result: HandlePos[] = [];
  for (const handle of bounds?.source ?? []) {
    if (handle.id) {
      result.push({
        id: handle.id,
        absX: absX + handle.x + handle.width / 2,
        absY: absY + handle.y + handle.height / 2,
      });
    }
  }
  for (const handle of bounds?.target ?? []) {
    if (handle.id) {
      result.push({
        id: handle.id,
        absX: absX + handle.x + handle.width / 2,
        absY: absY + handle.y + handle.height / 2,
      });
    }
  }
  return result;
}

/** Convert screen-px rect to DXF-inch rect (Y flipped, bottom-left origin). */
function toDxfRect(ax: number, ay: number, w: number, h: number) {
  return {
    x: pxToIn(ax),
    y: -pxToIn(ay + h),
    w: pxToIn(w),
    h: pxToIn(h),
  };
}

/** Emit a room: tinted fill + dashed border + label. */
export function emitRoom(
  writer: DxfWriter,
  node: SchematicNode,
  rfInstance: ReactFlowInstance,
) {
  if (node.type !== "room") return;
  const internal = rfInstance.getInternalNode(node.id);
  if (!internal) return;
  const data = node.data as RoomData;
  const ax = internal.internals.positionAbsolute.x;
  const ay = internal.internals.positionAbsolute.y;
  const w = node.measured?.width ?? 400;
  const h = node.measured?.height ?? 300;
  const rect = toDxfRect(ax, ay, w, h);

  // Fill (tinted)
  if (data.color) {
    const tinted = tintToWhite(data.color, 0.85);
    const tc = hexToTrueColor(tinted);
    writer.addSolidHatchRect(CANONICAL_LAYERS.ROOMS_FILL, rect.x, rect.y, rect.w, rect.h, {
      trueColor: tc,
    });
  }

  // Border
  const borderLt =
    data.borderStyle === "solid" ? "CONTINUOUS" :
    data.borderStyle === "dotted" ? "ES_DOTTED" :
    "ES_DASHED";
  const borderStyle: EntityStyle = { linetype: borderLt };
  if (data.borderColor) {
    borderStyle.trueColor = hexToTrueColor(data.borderColor);
  } else if (data.color) {
    borderStyle.trueColor = hexToTrueColor(data.color);
  }
  writer.addRect(CANONICAL_LAYERS.ROOMS, rect.x, rect.y, rect.w, rect.h, borderStyle);

  // Label — just inside the top-left corner
  if (data.label) {
    const labelSize = data.labelSize ?? 14;
    const heightIn = cssFontPxToDxfHeight(labelSize);
    writer.addText(
      CANONICAL_LAYERS.LABELS,
      rect.x + pxToIn(8),
      rect.y + rect.h - pxToIn(labelSize + 4),
      data.label.toUpperCase(),
      {
        height: heightIn,
        align: "left",
        style: borderStyle.trueColor !== undefined
          ? { trueColor: borderStyle.trueColor }
          : undefined,
      },
    );
  }
}

/** Emit a device: box + header fill + labels + ports + section separators. */
export function emitDevice(
  writer: DxfWriter,
  node: SchematicNode,
  rfInstance: ReactFlowInstance,
  edges: ConnectionEdge[],
  signalColors: Partial<Record<SignalType, string>> | undefined,
) {
  if (node.type !== "device") return;
  const internal = rfInstance.getInternalNode(node.id);
  if (!internal) return;
  const data = node.data as DeviceData;
  const ax = internal.internals.positionAbsolute.x;
  const ay = internal.internals.positionAbsolute.y;
  const w = node.measured?.width ?? 180;
  const h = node.measured?.height ?? 80;
  const rect = toDxfRect(ax, ay, w, h);

  const handles = getHandlePositions(node, rfInstance);

  // Header area — top 40px
  const headerH = 40;
  const headerRect = toDxfRect(ax, ay, w, headerH);
  if (data.headerColor) {
    writer.addSolidHatchRect(
      CANONICAL_LAYERS.DEVICES_HEADER,
      headerRect.x, headerRect.y, headerRect.w, headerRect.h,
      { trueColor: hexToTrueColor(data.headerColor) },
    );
  }

  // Device outer box (rounded to match canvas `rounded-lg`)
  writer.addRoundedRect(
    CANONICAL_LAYERS.DEVICES,
    rect.x, rect.y, rect.w, rect.h,
    DEVICE_CORNER_RADIUS_IN,
  );

  // Header separator (bottom edge of header band)
  writer.addLine(
    CANONICAL_LAYERS.DEVICES,
    rect.x, rect.y + rect.h - pxToIn(headerH),
    rect.x + rect.w, rect.y + rect.h - pxToIn(headerH),
  );

  // Device label in header — truncate with ellipsis if it won't fit.
  // Canvas header uses `px-3` (12px each side). Match that exactly or the
  // DXF will silently over-fit the label and spill past the box edge.
  const HEADER_PAD_PX = 12;
  const labelAvailIn = rect.w - pxToIn(HEADER_PAD_PX * 2);

  if (data.label) {
    const labelHeight = cssFontPxToDxfHeight(12);
    writer.addText(
      CANONICAL_LAYERS.LABELS,
      pxToIn(ax + HEADER_PAD_PX),
      -pxToIn(ay + 16),
      truncateToWidth(data.label, labelAvailIn, labelHeight),
      { height: labelHeight, align: "left" },
    );
  }

  if (data.deviceType) {
    const typeHeight = cssFontPxToDxfHeight(10);
    writer.addText(
      CANONICAL_LAYERS.LABELS,
      pxToIn(ax + HEADER_PAD_PX),
      -pxToIn(ay + 30),
      truncateToWidth(data.deviceType.replace(/-/g, " "), labelAvailIn, typeHeight),
      {
        height: typeHeight,
        align: "left",
        style: { trueColor: rgbToTrueColor(120, 120, 120) },
      },
    );
  }

  // Port labels
  const portMap = new Map(data.ports.map((p) => [p.id, p]));
  const connectedHandles = new Set<string>();
  for (const e of edges) {
    if (e.source === node.id && e.sourceHandle) connectedHandles.add(e.sourceHandle);
    if (e.target === node.id && e.targetHandle) connectedHandles.add(e.targetHandle);
  }
  const bidirLabeled = new Set<string>();
  const portTextHeight = cssFontPxToDxfHeight(10); // matches canvas text-[10px]

  for (const hp of handles) {
    let portId = hp.id;
    if (portId.endsWith("-in")) portId = portId.slice(0, -3);
    else if (portId.endsWith("-out")) portId = portId.slice(0, -4);
    const port = portMap.get(portId);
    if (!port) continue;

    const hex = resolveSignalColor(port.signalType, signalColors);
    const [r, g, b] = hexToRgb(hex);
    const style: EntityStyle = { trueColor: rgbToTrueColor(r, g, b) };

    const labelY = hp.absY;

    if (port.direction === "bidirectional") {
      if (bidirLabeled.has(portId)) continue;
      const inH = `${portId}-in`, outH = `${portId}-out`;
      const connectedOut = connectedHandles.has(outH);
      const connectedIn = connectedHandles.has(inH);
      const onRight = connectedOut && !connectedIn;
      emitPortLabel(writer, port.label, ax, w, labelY, onRight, portTextHeight, style);
      bidirLabeled.add(portId);
    } else {
      const isLeft = port.direction === "input" ? !port.flipped : !!port.flipped;
      emitPortLabel(writer, port.label, ax, w, labelY, !isLeft, portTextHeight, style);
    }
  }

  // Section separators
  const portsWithHandles: { portId: string; section: string | undefined; direction: string; handleY: number }[] = [];
  for (const port of data.ports) {
    const hid = port.direction === "bidirectional" ? `${port.id}-in` : port.id;
    const hp = handles.find((h) => h.id === hid);
    if (hp) portsWithHandles.push({ portId: port.id, section: port.section, direction: port.direction, handleY: hp.absY });
  }
  for (const dir of ["input", "output", "bidirectional"] as const) {
    const list = portsWithHandles.filter((p) => p.direction === dir);
    let lastSec: string | undefined;
    for (const { section, handleY } of list) {
      if (section && section !== lastSec && lastSec !== undefined) {
        const sepY = -pxToIn(handleY - 6);
        const sepStyle: EntityStyle = { linetype: "ES_DASHED" };
        if (dir === "input") {
          writer.addLine(CANONICAL_LAYERS.DEVICES, rect.x, sepY, rect.x + rect.w / 2, sepY, sepStyle);
          writer.addText(CANONICAL_LAYERS.LABELS, rect.x + pxToIn(4), sepY + pxToIn(1), section, { height: cssFontPxToDxfHeight(8) });
        } else if (dir === "output") {
          writer.addLine(CANONICAL_LAYERS.DEVICES, rect.x + rect.w / 2, sepY, rect.x + rect.w, sepY, sepStyle);
          writer.addText(CANONICAL_LAYERS.LABELS, rect.x + rect.w - pxToIn(4), sepY + pxToIn(1), section, { height: cssFontPxToDxfHeight(8), align: "right" });
        } else {
          writer.addLine(CANONICAL_LAYERS.DEVICES, rect.x, sepY, rect.x + rect.w, sepY, sepStyle);
          writer.addText(CANONICAL_LAYERS.LABELS, rect.x + rect.w / 2, sepY + pxToIn(1), section, { height: cssFontPxToDxfHeight(8), align: "center" });
        }
      }
      lastSec = section;
    }
  }
}

function emitPortLabel(
  writer: DxfWriter,
  text: string,
  nodeAx: number,
  nodeW: number,
  labelY: number,
  onRight: boolean,
  heightIn: number,
  style: EntityStyle,
) {
  // Each port label lives in one half of the device (its own column). Cap
  // the width so long labels get "…" instead of spilling into the middle
  // of the box or past the opposite edge.
  const halfWidthIn = pxToIn(nodeW / 2) - pxToIn(10);
  const clipped = truncateToWidth(text, halfWidthIn, heightIn);
  if (onRight) {
    writer.addText(
      CANONICAL_LAYERS.PORTS,
      pxToIn(nodeAx + nodeW - 8),
      -pxToIn(labelY + 2),
      clipped,
      { height: heightIn, align: "right", style },
    );
  } else {
    writer.addText(
      CANONICAL_LAYERS.PORTS,
      pxToIn(nodeAx + 8),
      -pxToIn(labelY + 2),
      clipped,
      { height: heightIn, align: "left", style },
    );
  }
}

/** Emit an annotation (rectangle or ellipse with optional fill + label). */
export function emitAnnotation(
  writer: DxfWriter,
  node: SchematicNode,
  rfInstance: ReactFlowInstance,
) {
  if (node.type !== "annotation") return;
  const internal = rfInstance.getInternalNode(node.id);
  if (!internal) return;
  const data = node.data as AnnotationData;
  const ax = internal.internals.positionAbsolute.x;
  const ay = internal.internals.positionAbsolute.y;
  const w = node.measured?.width ?? 100;
  const h = node.measured?.height ?? 80;
  const rect = toDxfRect(ax, ay, w, h);

  const borderStyle: EntityStyle = {};
  if (data.borderColor) borderStyle.trueColor = hexToTrueColor(data.borderColor);

  if (data.shape === "ellipse") {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const majorRadius = rect.w / 2;
    const ratio = Math.min(1, rect.h / rect.w);
    if (data.color) {
      writer.addSolidHatchEllipse(
        CANONICAL_LAYERS.ANNOTATIONS_FILL,
        cx, cy, majorRadius, 0, ratio,
        { trueColor: hexToTrueColor(data.color) },
      );
    }
    writer.addEllipse(
      CANONICAL_LAYERS.ANNOTATIONS,
      cx, cy, majorRadius, 0, ratio,
      borderStyle,
    );
  } else {
    if (data.color) {
      writer.addSolidHatchRect(
        CANONICAL_LAYERS.ANNOTATIONS_FILL,
        rect.x, rect.y, rect.w, rect.h,
        { trueColor: hexToTrueColor(data.color) },
      );
    }
    writer.addRect(CANONICAL_LAYERS.ANNOTATIONS, rect.x, rect.y, rect.w, rect.h, borderStyle);
  }

  if (data.label) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    writer.addText(
      CANONICAL_LAYERS.LABELS,
      cx, cy,
      data.label,
      {
        height: cssFontPxToDxfHeight(12),
        align: "center",
        vAlign: "middle",
        style: data.borderColor ? { trueColor: hexToTrueColor(data.borderColor) } : undefined,
      },
    );
  }
}
