/**
 * AI-powered PDF drawing import.
 *
 * Sends a PDF drawing package to Claude (Anthropic API, directly from the
 * browser with the user's own key), gets back a structured description of
 * every page — devices, rooms, and point-to-point connections — and rebuilds
 * it with the same matching/layout machinery as the CSV cable-schedule import:
 * one schematic sheet per PDF page, devices matched against the template
 * library, and custom templates created for anything unrecognized.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { DeviceTemplate, SchematicNode, ConnectionEdge, Port } from "./types";
import { SIGNAL_LABELS } from "./types";
import { DEVICE_TYPE_TO_CATEGORY } from "./deviceTypeCategories";
import {
  matchDevices,
  buildImportResult,
  type ParsedConnection,
  type DeviceMatch,
} from "./csvImport";

// ---------- Extraction schema ----------

const aiDeviceSchema = z.object({
  name: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  deviceType: z.string(),
  room: z.string(),
});

const aiConnectionSchema = z.object({
  fromDevice: z.string(),
  fromPort: z.string(),
  toDevice: z.string(),
  toPort: z.string(),
  signalType: z.string(),
  cableId: z.string(),
});

const aiPageSchema = z.object({
  name: z.string(),
  devices: z.array(aiDeviceSchema),
  connections: z.array(aiConnectionSchema),
});

const aiExtractionSchema = z.object({
  pages: z.array(aiPageSchema),
});

export type AiExtraction = z.infer<typeof aiExtractionSchema>;
export type AiPage = z.infer<typeof aiPageSchema>;
export type AiDevice = z.infer<typeof aiDeviceSchema>;

// ---------- Claude call ----------

const MAX_PDF_BYTES = 30 * 1024 * 1024; // API request limit is 32 MB total

function buildPrompt(): string {
  const signalTypes = Object.values(SIGNAL_LABELS).join(", ");
  const deviceTypes = Object.keys(DEVICE_TYPE_TO_CATEGORY)
    .filter((t) => t !== "expansion-card" && t !== "cable-accessory")
    .join(", ");
  return [
    "You are reading an audio-visual system drawing package (signal-flow / schematic PDF).",
    "Recreate its content as structured data, one entry in `pages` per PDF page, in document order.",
    "",
    "For every page:",
    "- `name`: the sheet title from the title block or page heading (fall back to \"Page N\").",
    "- `devices`: every device drawn on that page. `name` must be the label as drawn and unique within the page (append the drawn unit number / suffix when several identical devices exist, e.g. \"Camera 1\", \"Camera 2\"). Fill `manufacturer` and `model` when identifiable, else empty strings. `room` is the room / rack / group the device is drawn inside (use \" > \" between nested levels), or an empty string.",
    `- \`deviceType\`: the closest match from this list: ${deviceTypes}. Use "converter" if nothing fits.`,
    "- `connections`: every wire on the page as a point-to-point run from the signal source to the destination. `fromPort`/`toPort` are the port labels at each end as drawn (empty string if unlabeled). `cableId` is the cable number printed on the wire, or an empty string.",
    `- \`signalType\`: the closest match from this list: ${signalTypes}. Use the drawn signal legend/colors and port types to decide.`,
    "",
    "Off-page references / fly-offs: when a wire leaves the page to a device on another page, record the connection on the page where the SOURCE device is drawn, using the destination device's name for `toDevice` (the destination device itself belongs in `devices` of its own page only).",
    "Do not invent devices or wires that are not in the document. Skip title blocks, legends, notes, and revision tables.",
  ].join("\n");
}

export interface AiImportProgress {
  stage: "uploading" | "analyzing";
  receivedChars: number;
}

/** Read a File into a base64 string (no newlines). */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function extractSchematicFromPdf(
  file: File,
  apiKey: string,
  onProgress?: (p: AiImportProgress) => void,
): Promise<AiExtraction> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error("PDF is too large — the AI import supports files up to 30 MB.");
  }
  const pdfData = await fileToBase64(file);

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  onProgress?.({ stage: "uploading", receivedChars: 0 });
  let received = 0;

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 64000,
    output_config: { format: zodOutputFormat(aiExtractionSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfData },
          },
          { type: "text", text: buildPrompt() },
        ],
      },
    ],
  });

  stream.on("text", (t) => {
    received += t.length;
    onProgress?.({ stage: "analyzing", receivedChars: received });
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to process this document.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The document is too complex for a single import — try importing fewer pages at a time.");
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return aiExtractionSchema.parse(JSON.parse(text));
}

// ---------- Build schematic data from the extraction ----------

export interface AiImportPage {
  name: string;
  nodes: SchematicNode[];
  edges: ConnectionEdge[];
}

export interface AiImportResult {
  pages: AiImportPage[];
  /** Custom templates created for devices not found in the library. */
  newTemplates: DeviceTemplate[];
  matchedDevices: number;
  createdDevices: number;
  totalConnections: number;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "device";
}

/** Build a reusable custom template for a device Claude couldn't match to the library. */
function templateFromAiDevice(device: AiDevice, inferredPorts: Port[], serial: number): DeviceTemplate {
  const label = [device.manufacturer, device.model].filter(Boolean).join(" ") || device.name;
  const deviceType = DEVICE_TYPE_TO_CATEGORY[device.deviceType] ? device.deviceType : "converter";
  return {
    id: `custom-ai-${Date.now()}-${serial}-${slugify(label)}`,
    deviceType,
    label,
    ports: inferredPorts.map((p, i) => ({ ...p, id: `t-${i}` })),
    ...(device.manufacturer ? { manufacturer: device.manufacturer } : {}),
    ...(device.model ? { modelNumber: device.model } : {}),
    searchTerms: [device.manufacturer, device.model, device.name].filter(Boolean),
  };
}

/**
 * Convert Claude's extraction into per-page nodes/edges via the CSV import
 * pipeline, creating custom templates for unmatched devices.
 */
export function buildAiImport(
  extraction: AiExtraction,
  templates: DeviceTemplate[],
): AiImportResult {
  const pages: AiImportPage[] = [];
  const newTemplates: DeviceTemplate[] = [];
  // Unmatched devices are deduped across pages by manufacturer+model (or name)
  // so one real-world product yields one custom template.
  const createdByKey = new Map<string, DeviceTemplate>();
  let matchedDevices = 0;
  let createdDevices = 0;
  let totalConnections = 0;
  let serial = 0;

  extraction.pages.forEach((page, pageIndex) => {
    const roomOf = new Map<string, string>();
    const metaOf = new Map<string, AiDevice>();
    for (const d of page.devices) {
      if (d.room) roomOf.set(d.name, d.room);
      metaOf.set(d.name, d);
    }

    const connections: ParsedConnection[] = page.connections
      .filter((c) => c.fromDevice && c.toDevice && c.fromDevice !== c.toDevice)
      .map((c) => ({
        sourceDevice: c.fromDevice,
        sourcePort: c.fromPort,
        destDevice: c.toDevice,
        destPort: c.toPort,
        signalType: c.signalType,
        sourceRoom: roomOf.get(c.fromDevice) ?? "",
        destRoom: roomOf.get(c.toDevice) ?? "",
      }));
    // Devices drawn with no wires still belong on the page — represent them as
    // rows so matchDevices/buildImportResult see them (self-loops are skipped
    // as edges but still create the node).
    for (const d of page.devices) {
      const inAnyConnection = connections.some(
        (c) => c.sourceDevice === d.name || c.destDevice === d.name,
      );
      if (!inAnyConnection) {
        connections.push({
          sourceDevice: d.name,
          sourcePort: "",
          destDevice: d.name,
          destPort: "",
          signalType: "",
          sourceRoom: d.room,
          destRoom: d.room,
        });
      }
    }
    if (connections.length === 0) return;

    const matches = matchDevices(connections, templates);

    // Replace non-matches with generated custom templates so the drawing uses
    // real (reusable) devices instead of anonymous generic boxes.
    const patched = new Map<string, DeviceMatch>();
    for (const [name, match] of matches) {
      if (match.template) {
        matchedDevices++;
        patched.set(name, match);
        continue;
      }
      const meta = metaOf.get(name) ?? { name, manufacturer: "", model: "", deviceType: "converter", room: "" };
      const key = slugify([meta.manufacturer, meta.model].filter(Boolean).join(" ") || name);
      let tpl = createdByKey.get(key);
      if (!tpl) {
        tpl = templateFromAiDevice(meta, match.inferredPorts, ++serial);
        createdByKey.set(key, tpl);
        newTemplates.push(tpl);
        createdDevices++;
      } else if (match.inferredPorts.length > tpl.ports.length) {
        // A later page revealed more ports for the same product — keep the richer set.
        tpl.ports = match.inferredPorts.map((p, i) => ({ ...p, id: `t-${i}` }));
      }
      patched.set(name, { ...match, template: tpl });
    }

    const cableIds = connections.map((c) => {
      const src = page.connections.find(
        (pc) => pc.fromDevice === c.sourceDevice && pc.toDevice === c.destDevice && pc.fromPort === c.sourcePort && pc.toPort === c.destPort,
      );
      return src?.cableId || undefined;
    });

    const { nodes, edges } = buildImportResult(connections, patched, cableIds);
    totalConnections += edges.length;
    pages.push({ name: page.name || `Page ${pageIndex + 1}`, nodes, edges });
  });

  return { pages, newTemplates, matchedDevices, createdDevices, totalConnections };
}
