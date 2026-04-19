/**
 * Schema migrations for EasySchematic save files.
 *
 * Each migration takes a raw JSON object at version N and returns version N+1.
 * Migrations run sequentially from the file's version up to CURRENT_SCHEMA_VERSION.
 *
 * When bumping the schema version (middle number in 0.x.y):
 *   1. Increment CURRENT_SCHEMA_VERSION
 *   2. Add a migration function: migrations[oldVersion] = (data) => { ... return data; }
 *   3. Update package.json version to 0.<new schema version>.0
 */

import { createDefaultLayout } from "./titleBlockLayout";
import { DEFAULT_CONNECTOR } from "./connectorTypes";

export const CURRENT_SCHEMA_VERSION = 27;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Migration = (data: any) => any;

const migrations: Record<number, Migration> = {
  1: (data) => {
    // v1 → v2: add optional signalColors field (no data transform needed)
    data.version = 2;
    return data;
  },
  2: (data) => {
    // v2 → v3: add date and drawingTitle to titleBlock
    if (data.titleBlock) {
      data.titleBlock.date ??= "";
      data.titleBlock.drawingTitle ??= "";
    }
    data.version = 3;
    return data;
  },
  3: (data) => {
    // v3 → v4: add company, revision, logo to titleBlock
    if (data.titleBlock) {
      data.titleBlock.company ??= "";
      data.titleBlock.revision ??= "";
      data.titleBlock.logo ??= "";
    }
    data.version = 4;
    return data;
  },
  4: (data) => {
    // v4 → v5: add titleBlockLayout with default grid layout
    data.titleBlockLayout ??= createDefaultLayout();
    data.version = 5;
    return data;
  },
  5: (data) => {
    // v5 → v6: titleBlockLayout.widthFraction → widthIn (fixed inches)
    if (data.titleBlockLayout) {
      const frac = data.titleBlockLayout.widthFraction ?? 0.3;
      // Convert fraction to approximate inches (assuming 11" landscape - 0.8" margins)
      data.titleBlockLayout.widthIn = Math.round(frac * 10.2 * 4) / 4; // round to nearest 0.25"
      delete data.titleBlockLayout.widthFraction;
    }
    data.version = 6;
    return data;
  },
  6: (data) => {
    // v6 → v7: add customFields array to titleBlock
    if (data.titleBlock) {
      data.titleBlock.customFields ??= [];
    }
    data.version = 7;
    return data;
  },
  7: (data) => {
    // v7 → v8: add optional hiddenSignalTypes and hideDeviceTypes (both default to empty/false)
    data.version = 8;
    return data;
  },
  8: (data) => {
    // v8 → v9: add permanent `model` field to device nodes (template identity for pack lists)
    // Backfill from baseLabel if present (device still auto-numbered), otherwise from label
    if (data.nodes) {
      for (const node of data.nodes) {
        if (node.type === "device" && node.data) {
          node.data.model ??= node.data.baseLabel ?? node.data.label;
        }
      }
    }
    data.version = 9;
    return data;
  },
  9: (data) => {
    // v9 → v10: add reportLayouts for persisting report print preview settings
    data.reportLayouts ??= {};
    data.version = 10;
    return data;
  },
  10: (data) => {
    // v10 → v11: add connectorType to all ports using DEFAULT_CONNECTOR[signalType]
    if (data.nodes) {
      for (const node of data.nodes) {
        if (node.type === "device" && node.data?.ports) {
          for (const port of node.data.ports) {
            if (!port.connectorType && port.signalType) {
              port.connectorType = DEFAULT_CONNECTOR[port.signalType as keyof typeof DEFAULT_CONNECTOR] ?? "other";
            }
          }
        }
      }
    }
    // Also migrate custom templates stored in the file
    if (data.customTemplates) {
      for (const tmpl of data.customTemplates) {
        if (tmpl.ports) {
          for (const port of tmpl.ports) {
            if (!port.connectorType && port.signalType) {
              port.connectorType = DEFAULT_CONNECTOR[port.signalType as keyof typeof DEFAULT_CONNECTOR] ?? "other";
            }
          }
        }
      }
    }
    data.version = 11;
    return data;
  },
  11: (data) => {
    // v11 → v12: add optional templatePresets (no data transform needed)
    data.version = 12;
    return data;
  },
  13: (data) => {
    // v13 → v14: dhcpServer added as optional field on DeviceData — no transform needed
    data.version = 14;
    return data;
  },
  14: (data) => {
    // v14 → v15: multicable/cable accessory fields — all optional, no transform needed
    data.version = 15;
    return data;
  },
  15: (data) => {
    // v15 → v16: cableLength on connections — optional, no transform needed
    data.version = 16;
    return data;
  },
  16: (data) => {
    // v16 → v17: modular device slots (expansion cards) — optional field, no transform needed
    data.version = 17;
    return data;
  },
  12: (data) => {
    // v12 → v13: add addressable flag to ports
    // Network switch ports are pass-through (non-addressable)
    const NET_SIGNALS = new Set(["ethernet", "ndi", "dante", "avb", "srt", "hdbaset"]);
    for (const node of data.nodes ?? []) {
      if (node.type === "device" && node.data?.deviceType === "network-switch") {
        for (const p of node.data.ports ?? []) {
          if (NET_SIGNALS.has(p.signalType)) {
            p.addressable = false;
          }
        }
      }
    }
    data.version = 13;
    return data;
  },
  17: (data) => {
    // v17 → v18: Convert cam-lok ports from generic "power" to phase-specific signal types
    // and rename "Cam-Lok 400A Breakout" → "Lex Hammerhead 400A Splitter"
    const LABEL_MAP: Record<string, string> = {
      // Company Switch 200A
      "Cam-Lok Out A": "power-l1",
      "Cam-Lok Out B": "power-l2",
      "Cam-Lok Out C": "power-l3",
      "Cam-Lok Out N": "power-neutral",
      // Company Switch 400A
      "Cam-Lok Out A1": "power-l1",
      "Cam-Lok Out B1": "power-l2",
      "Cam-Lok Out C1": "power-l3",
      "Cam-Lok Out A2": "power-l1",
      "Cam-Lok Out B2": "power-l2",
      "Cam-Lok Out C2": "power-l3",
      // Company Switch 100A Single Phase
      "Cam-Lok Out 1": "power-l1",
      "Cam-Lok Out 2": "power-neutral",
      // 400A Breakout inputs
      "Cam-Lok In A": "power-l1",
      "Cam-Lok In B": "power-l2",
      "Cam-Lok In C": "power-l3",
    };

    for (const node of data.nodes ?? []) {
      if (node.type !== "device" || !node.data?.ports) continue;

      // Rename 400A Breakout
      if (node.data.label === "Cam-Lok 400A Breakout") {
        node.data.label = "Lex Hammerhead 400A Splitter";
        node.data.manufacturer = "Lex Products";
        node.data.modelNumber = "DB400N1J4AJ2CC-63";
      }

      // Migrate cam-lok port signal types
      for (const p of node.data.ports) {
        if (p.connectorType === "cam-lok" && p.signalType === "power") {
          const mapped = LABEL_MAP[p.label];
          if (mapped) p.signalType = mapped;
        }
      }
    }

    // Update edges whose source port was migrated
    for (const edge of data.edges ?? []) {
      if (edge.data?.signalType !== "power") continue;
      const srcNode = (data.nodes ?? []).find((n: { id: string }) => n.id === edge.source);
      if (!srcNode?.data?.ports) continue;
      const portId = edge.sourceHandle?.replace(/-(in|out)$/, "");
      const srcPort = srcNode.data.ports.find((p: { id: string }) => p.id === portId);
      if (srcPort && srcPort.signalType !== "power") {
        edge.data.signalType = srcPort.signalType;
      }
    }

    data.version = 18;
    return data;
  },
  18: (data) => {
    // v18 → v19: adapter visibility fields — all optional, no transform needed
    data.version = 19;
    return data;
  },
  19: (data) => {
    // v19 → v20: hostname moved from PortNetworkConfig to DeviceData, notes on Port
    // Migrate any port-level hostname to device-level
    for (const node of data.nodes ?? []) {
      if (node.type !== "device" || !node.data?.ports) continue;
      for (const p of node.data.ports) {
        if (p.networkConfig?.hostname) {
          if (!node.data.hostname) node.data.hostname = p.networkConfig.hostname;
          delete p.networkConfig.hostname;
        }
      }
    }
    data.version = 20;
    return data;
  },
  20: (data) => {
    // v20 → v21: poeDrawW/linkSpeed on Port, poeBudgetW on DeviceData, aes67 signal type — all optional
    data.version = 21;
    return data;
  },
  21: (data) => {
    // v21 → v22: flipped on Port — optional, no transform needed
    data.version = 22;
    return data;
  },
  22: (data) => {
    // v22 → v23: autoRoute on SchematicFile — optional, defaults to true
    data.version = 23;
    return data;
  },
  23: (data) => {
    // v23 → v24: nested subrooms — rooms may now have a parentId pointing to
    // another room. No data transform needed; parentId is already a valid
    // React Flow node field and existing rooms simply have none.
    data.version = 24;
    return data;
  },

  24: (data) => {
    // v24 → v25: Split label visibility into cable ID / custom label controls (#61)
    // Migrate top-level showConnectionLabels → showCableIdLabels
    if (data.showConnectionLabels !== undefined) {
      data.showCableIdLabels = data.showConnectionLabels;
      delete data.showConnectionLabels;
    }
    // Migrate per-edge hideLabel → hideCableId + hideCustomLabel
    if (data.edges) {
      for (const edge of data.edges) {
        if (edge.data?.hideLabel !== undefined) {
          edge.data.hideCableId = edge.data.hideLabel;
          edge.data.hideCustomLabel = edge.data.hideLabel;
          delete edge.data.hideLabel;
        }
      }
    }
    data.version = 25;
    return data;
  },
  25: (data) => {
    // v25 → v26: introduce "avb" signal type. Historical templates (L'Acoustics LA7.16,
    // LA-RAK II AVB) carried AVB ports mislabeled as "dante". Convert any port whose
    // label starts with "AVB" and signalType is "dante" to the new "avb" type.
    for (const node of data.nodes ?? []) {
      if (node.type === "device") {
        for (const p of node.data?.ports ?? []) {
          if (p.signalType === "dante" && typeof p.label === "string" && /^avb\b/i.test(p.label)) {
            p.signalType = "avb";
          }
        }
      }
    }
    data.version = 26;
    return data;
  },
  26: (data) => {
    // v26 → v27: unify the hardcoded deviceType line under the device name into the
    // auxiliaryData pipeline and switch each row to carrying its own header/footer slot.
    //
    // Migration steps per device:
    //   1. If auxiliaryData is already a string[] (pre-v27 shape), convert each entry to
    //      an AuxRow using the device's top-level auxPosition (if any) as the default slot.
    //      Empty auxPosition falls back to "footer" — matches today's rendering.
    //   2. Remove the now-stale top-level auxPosition field.
    //   3. If the device has no aux data and wasn't explicitly suppressed via the legacy
    //      top-level hideDeviceTypes flag, seed a single header row with {{deviceType}}
    //      so new and old schematics look identical after the hardcoded line goes away.
    const legacySuppressed = data.hideDeviceTypes === true;
    for (const node of data.nodes ?? []) {
      if (node.type !== "device" || !node.data) continue;
      const raw = node.data.auxiliaryData;
      const legacySlot: "header" | "footer" =
        node.data.auxPosition === "header" ? "header" : "footer";
      if (Array.isArray(raw) && raw.length > 0) {
        node.data.auxiliaryData = raw.map((line: unknown) =>
          typeof line === "string"
            ? { text: line, position: legacySlot }
            : (line as { text: string; position?: "header" | "footer" }),
        );
      } else if (!legacySuppressed) {
        node.data.auxiliaryData = [{ text: "{{deviceType}}", position: "header" }];
      }
      delete node.data.auxPosition;
    }
    delete data.hideDeviceTypes;
    data.version = 27;
    return data;
  },
};

/**
 * Migrate a schematic file from its current version to CURRENT_SCHEMA_VERSION.
 * Returns the migrated data (mutated in place).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateSchematic(data: any): any {
  let version = data.version ?? 1;

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) {
      console.warn(
        `No migration for schema version ${version} → ${version + 1}. Skipping.`,
      );
      version++;
      continue;
    }
    data = migrate(data);
    version = data.version;
  }

  return data;
}
