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

export const CURRENT_SCHEMA_VERSION = 8;

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
