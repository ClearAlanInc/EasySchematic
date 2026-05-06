/**
 * Refresh src/defaultSchematic.json against the current device library.
 *
 *   1. Run all schema migrations (e.g. v19 → v28: cam-lok power split, AVB
 *      signal type, auxiliaryData restructure, label visibility split, …)
 *   2. For every device that already has a templateId: pull current FACTUAL_FIELDS
 *      from the template and reconcile ports (uses src/templateSync.ts).
 *   3. For every templateless device: attach a templateId IF there is exactly one
 *      library template whose label OR `manufacturer + " " + modelNumber` exactly
 *      matches the device's `model`/`label` AND deviceType matches. Then refresh.
 *      Otherwise leave it alone.
 *   4. Write the migrated/refreshed schematic back to src/defaultSchematic.json.
 *
 * Run: pnpm tsx scripts/refresh-default-schematic.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateSchematic, CURRENT_SCHEMA_VERSION } from "../src/migrations";
import { syncDeviceWithTemplate } from "../src/templateSync";
import type { DeviceTemplate, DeviceData } from "../src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCHEMATIC_PATH = path.join(ROOT, "src/defaultSchematic.json");
const FALLBACK_PATH = path.join(ROOT, "src/deviceLibrary.fallback.json");

type RawSchematic = {
  version: number;
  nodes: Array<{ id: string; type: string; data: DeviceData & Record<string, unknown> }>;
  edges?: unknown[];
  [key: string]: unknown;
};

const schematic: RawSchematic = JSON.parse(readFileSync(SCHEMATIC_PATH, "utf8"));
const templates: DeviceTemplate[] = JSON.parse(readFileSync(FALLBACK_PATH, "utf8"));

console.log(`Schematic at v${schematic.version}, target v${CURRENT_SCHEMA_VERSION}`);
console.log(`Library: ${templates.length} templates`);

// ─── 1. Migrate ─────────────────────────────────────────────────────────────
const oldVersion = schematic.version;
const migrated = migrateSchematic(schematic) as RawSchematic;
console.log(`Migrated v${oldVersion} → v${migrated.version}\n`);

// ─── 2. Build template indexes ──────────────────────────────────────────────
const tplById = new Map<string, DeviceTemplate>();
const tplByKey = new Map<string, DeviceTemplate[]>();
const pushKey = (k: string, t: DeviceTemplate) => {
  const norm = k.trim().toLowerCase();
  if (!norm) return;
  const arr = tplByKey.get(norm) ?? [];
  arr.push(t);
  tplByKey.set(norm, arr);
};
for (const t of templates) {
  if (t.id) tplById.set(t.id, t);
  if (t.label) pushKey(t.label, t);
  if (t.manufacturer && t.modelNumber) pushKey(`${t.manufacturer} ${t.modelNumber}`, t);
  if (t.modelNumber) pushKey(t.modelNumber, t);
}

function findUnambiguousMatch(
  data: DeviceData,
): DeviceTemplate | undefined {
  const candidates = new Set<DeviceTemplate>();
  const keys = [data.model, data.label]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().toLowerCase());
  for (const k of keys) {
    const hits = tplByKey.get(k) ?? [];
    for (const h of hits) if (h.deviceType === data.deviceType) candidates.add(h);
  }
  if (candidates.size === 1) return [...candidates][0];
  return undefined;
}

// ─── 3. Walk devices ────────────────────────────────────────────────────────
const refreshed: string[] = [];
const attached: string[] = [];
const noChange: string[] = [];
const stale: string[] = [];
const skipped: string[] = [];

const edges = (migrated.edges ?? []) as Parameters<typeof syncDeviceWithTemplate>[3];

for (const node of migrated.nodes) {
  if (node.type !== "device") continue;
  const data = node.data;

  if (data.templateId) {
    const tpl = tplById.get(data.templateId as string);
    if (!tpl) {
      stale.push(`${data.label} (templateId=${data.templateId} not in library)`);
      continue;
    }
    const before = JSON.stringify(data);
    const result = syncDeviceWithTemplate(data, tpl, node.id, edges);
    const after = JSON.stringify(result.updatedData);
    node.data = result.updatedData as typeof node.data;
    if (before === after) {
      noChange.push(`${data.label} (already current)`);
    } else {
      const factual = result.preview.factualChanges.length;
      refreshed.push(
        `${data.label}  factual=${factual} ports(+${result.preview.portsAdded.length}/-${result.preview.portsRemovedSafe.length}/orphan=${result.preview.portsOrphanedWithEdges.length})`,
      );
    }
    continue;
  }

  // templateless: try unambiguous attach
  const candidate = findUnambiguousMatch(data);
  if (!candidate) {
    skipped.push(`${data.label} (${data.deviceType}) — no unambiguous match`);
    continue;
  }
  data.templateId = candidate.id;
  const result = syncDeviceWithTemplate(data, candidate, node.id, edges);
  node.data = result.updatedData as typeof node.data;
  attached.push(
    `${data.label}  →  ${candidate.label}  ports(+${result.preview.portsAdded.length}/-${result.preview.portsRemovedSafe.length}/orphan=${result.preview.portsOrphanedWithEdges.length})`,
  );
}

// ─── 4. Report ──────────────────────────────────────────────────────────────
const banner = (s: string) => console.log(`\n=== ${s} ===`);

banner(`Refreshed (had templateId): ${refreshed.length}`);
refreshed.forEach((s) => console.log(`  ✓ ${s}`));

banner(`Attached (templateless → matched): ${attached.length}`);
attached.forEach((s) => console.log(`  + ${s}`));

banner(`No change (already current): ${noChange.length}`);
noChange.forEach((s) => console.log(`  · ${s}`));

banner(`Skipped (no unambiguous match): ${skipped.length}`);
skipped.forEach((s) => console.log(`  ? ${s}`));

banner(`Stale templateIds (template removed from library): ${stale.length}`);
stale.forEach((s) => console.log(`  ✗ ${s}`));

// ─── 5. Write ───────────────────────────────────────────────────────────────
writeFileSync(SCHEMATIC_PATH, JSON.stringify(migrated, null, 2) + "\n", "utf8");
console.log(`\nWrote ${path.relative(ROOT, SCHEMATIC_PATH)} (v${migrated.version})`);
