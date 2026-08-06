/**
 * Template ids must be unique across the whole built-in library.
 *
 * Ids are stable identifiers: saved schematics and the community D1 database
 * reference templates by id, and api/seed/seed.ts inserts them with
 * INSERT OR REPLACE — so a duplicated id means one template silently
 * overwrites the other in the DB and lookups resolve to the wrong device.
 */
import { describe, it, expect } from "vitest";
import { DEVICE_TEMPLATES, CARD_TEMPLATES } from "../deviceLibrary";

describe("device library template ids", () => {
  it("are unique across DEVICE_TEMPLATES and CARD_TEMPLATES", () => {
    const all = [...DEVICE_TEMPLATES, ...CARD_TEMPLATES];
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const t of all) {
      expect(t.id, `template "${t.label}" has no id`).toBeTruthy();
      const prev = seen.get(t.id!);
      if (prev !== undefined) {
        collisions.push(`${t.id} used by both "${prev}" and "${t.label}"`);
      } else {
        seen.set(t.id!, t.label);
      }
    }
    expect(collisions, collisions.join("\n")).toEqual([]);
  });
});
