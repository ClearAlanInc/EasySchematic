import type { DeviceData, Port } from "./types";

export interface AuxResolveContext {
  /** Number of connected port handles — only known at render time in DeviceNode. */
  connectedCount?: number;
}

export interface AuxField {
  token: string;
  label: string;
  group: string;
  resolve: (device: DeviceData, ctx: AuxResolveContext) => string;
}

const str = (v: unknown): string => (v == null || v === "" ? "" : String(v));

const fmtW = (v: unknown): string => (typeof v === "number" ? `${v.toLocaleString()} W` : "");
const fmtMm = (v: unknown): string => (typeof v === "number" ? `${v.toLocaleString()} mm` : "");
const fmtKg = (v: unknown): string => (typeof v === "number" ? `${v.toLocaleString()} kg` : "");
const fmtUsd = (v: unknown): string =>
  typeof v === "number"
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";

export const AUX_FIELDS: AuxField[] = [
  // Identity
  { token: "label", label: "Device Name", group: "Identity", resolve: (d) => str(d.label) },
  { token: "hostname", label: "Hostname", group: "Identity", resolve: (d) => str(d.hostname) },
  { token: "manufacturer", label: "Manufacturer", group: "Identity", resolve: (d) => str(d.manufacturer) },
  { token: "modelNumber", label: "Model Number", group: "Identity", resolve: (d) => str(d.modelNumber) },
  { token: "deviceType", label: "Device Type", group: "Identity", resolve: (d) => str(d.deviceType) },

  // Power
  { token: "powerDrawW", label: "Power Draw", group: "Power", resolve: (d) => fmtW(d.powerDrawW) },
  { token: "powerCapacityW", label: "Power Capacity", group: "Power", resolve: (d) => fmtW(d.powerCapacityW) },
  { token: "poeBudgetW", label: "PoE Budget", group: "Power", resolve: (d) => fmtW(d.poeBudgetW) },
  { token: "voltage", label: "Voltage", group: "Power", resolve: (d) => str(d.voltage) },

  // Physical
  { token: "weightKg", label: "Weight", group: "Physical", resolve: (d) => fmtKg(d.weightKg) },
  { token: "widthMm", label: "Width", group: "Physical", resolve: (d) => fmtMm(d.widthMm) },
  { token: "heightMm", label: "Height", group: "Physical", resolve: (d) => fmtMm(d.heightMm) },
  { token: "depthMm", label: "Depth", group: "Physical", resolve: (d) => fmtMm(d.depthMm) },

  // Cost
  { token: "unitCost", label: "Unit Cost", group: "Cost", resolve: (d) => fmtUsd(d.unitCost) },

  // Ports (derived)
  {
    token: "totalPorts",
    label: "Total Ports",
    group: "Ports",
    resolve: (d) => String(d.ports?.length ?? 0),
  },
  {
    token: "inputPorts",
    label: "Input Ports",
    group: "Ports",
    resolve: (d) => String((d.ports ?? []).filter((p: Port) => p.direction === "input").length),
  },
  {
    token: "outputPorts",
    label: "Output Ports",
    group: "Ports",
    resolve: (d) => String((d.ports ?? []).filter((p: Port) => p.direction === "output").length),
  },
  {
    token: "bidirectionalPorts",
    label: "Bidirectional Ports",
    group: "Ports",
    resolve: (d) => String((d.ports ?? []).filter((p: Port) => p.direction === "bidirectional").length),
  },
  {
    token: "connectedPorts",
    label: "Connected Ports",
    group: "Ports",
    resolve: (_d, ctx) => (ctx.connectedCount == null ? "" : String(ctx.connectedCount)),
  },
];

const FIELD_BY_TOKEN: Record<string, AuxField> = AUX_FIELDS.reduce(
  (acc, f) => {
    acc[f.token] = f;
    return acc;
  },
  {} as Record<string, AuxField>,
);

/** Groups in stable display order. */
export const AUX_FIELD_GROUPS: { group: string; fields: AuxField[] }[] = (() => {
  const order: string[] = [];
  const byGroup = new Map<string, AuxField[]>();
  for (const f of AUX_FIELDS) {
    if (!byGroup.has(f.group)) {
      byGroup.set(f.group, []);
      order.push(f.group);
    }
    byGroup.get(f.group)!.push(f);
  }
  return order.map((group) => ({ group, fields: byGroup.get(group)! }));
})();

const TOKEN_RE = /\{\{(\w+)\}\}/g;

/**
 * Resolve `{{token}}` placeholders in an aux line against device data.
 * Unknown tokens are left as literal text so typos are visible.
 * Undefined/empty values resolve to an empty string.
 */
export function resolveAuxiliaryLine(
  line: string,
  device: DeviceData,
  ctx: AuxResolveContext = {},
): string {
  if (!line || line.indexOf("{{") === -1) return line;
  return line.replace(TOKEN_RE, (match, token: string) => {
    const field = FIELD_BY_TOKEN[token];
    if (!field) return match;
    return field.resolve(device, ctx);
  });
}
