/**
 * Shim for src/migrations.ts.
 */
export const CURRENT_SCHEMA_VERSION = 2;

export function migrateSchematic(data: unknown): unknown {
  return data;
}
