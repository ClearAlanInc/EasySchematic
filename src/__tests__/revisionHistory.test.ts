/**
 * Document revision numbering (#revision-history): minor/major bump semantics,
 * the metadata log, title-block auto-sync, and file round-tripping.
 *
 * The store reads editor preferences from localStorage at import time, so we
 * install a minimal in-memory localStorage and import the store dynamically.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

let store: typeof import("../store")["useSchematicStore"];
let migrate: typeof import("../migrations")["migrateSchematic"];

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  ({ useSchematicStore: store } = await import("../store"));
  ({ migrateSchematic: migrate } = await import("../migrations"));
});

beforeEach(() => {
  store.setState({
    revision: { major: 1, minor: 0 },
    revisionHistory: [],
    titleBlock: { showName: "", venue: "", designer: "", engineer: "", date: "", drawingTitle: "", company: "", revision: "", logo: "", customFields: [] },
  });
});

describe("revision bumps", () => {
  it("minor bump increments minor and logs an entry", () => {
    store.getState().bumpMinorRevision();
    const s = store.getState();
    expect(s.revision).toEqual({ major: 1, minor: 1 });
    expect(s.revisionHistory).toHaveLength(1);
    expect(s.revisionHistory[0]).toMatchObject({ major: 1, minor: 1, kind: "minor" });
    expect(new Date(s.revisionHistory[0].savedAt).getTime()).not.toBeNaN();
  });

  it("major bump increments major, resets minor, and records the note + author", () => {
    store.getState().bumpMinorRevision();
    store.getState().bumpMinorRevision();
    store.getState().bumpMajorRevision("Issued for construction", "russ@clearalan.ca");
    const s = store.getState();
    expect(s.revision).toEqual({ major: 2, minor: 0 });
    const last = s.revisionHistory.at(-1)!;
    expect(last).toMatchObject({ major: 2, minor: 0, kind: "major", note: "Issued for construction", savedBy: "russ@clearalan.ca" });
  });

  it("auto-fills the title block revision while it holds an auto-format value", () => {
    store.getState().bumpMinorRevision();
    expect(store.getState().titleBlock.revision).toBe("v1.1");
    store.getState().bumpMajorRevision();
    expect(store.getState().titleBlock.revision).toBe("v2.0");
  });

  it("never overwrites a hand-typed title block revision", () => {
    store.setState({ titleBlock: { ...store.getState().titleBlock, revision: "Rev C" } });
    store.getState().bumpMinorRevision();
    expect(store.getState().titleBlock.revision).toBe("Rev C");
    expect(store.getState().revision).toEqual({ major: 1, minor: 1 });
  });

  it("caps the history at 500 entries, dropping the oldest", () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      major: 1, minor: i + 1, kind: "minor" as const, savedAt: "2026-08-13T00:00:00.000Z",
    }));
    store.setState({ revision: { major: 1, minor: 500 }, revisionHistory: entries });
    store.getState().bumpMinorRevision();
    const s = store.getState();
    expect(s.revisionHistory).toHaveLength(500);
    expect(s.revisionHistory[0].minor).toBe(2); // oldest (minor 1) dropped
    expect(s.revisionHistory.at(-1)!.minor).toBe(501);
  });
});

describe("file round-trip", () => {
  it("exportToJSON carries revision and history", () => {
    store.getState().bumpMinorRevision();
    const data = store.getState().exportToJSON();
    expect(data.revision).toEqual({ major: 1, minor: 1 });
    expect(data.revisionHistory).toHaveLength(1);
  });

  it("v50 files migrate to v51 with a fresh 1.0 revision", () => {
    const migrated = migrate({ version: 50, name: "Old", nodes: [], edges: [] });
    expect(migrated.version).toBeGreaterThanOrEqual(51);
    expect(migrated.revision).toEqual({ major: 1, minor: 0 });
    expect(migrated.revisionHistory).toEqual([]);
  });

  it("importFromJSON restores revision state", () => {
    store.getState().importFromJSON({
      version: 51,
      name: "Restored",
      nodes: [],
      edges: [],
      revision: { major: 3, minor: 7 },
      revisionHistory: [{ major: 3, minor: 7, kind: "minor", savedAt: "2026-08-13T00:00:00.000Z" }],
    });
    const s = store.getState();
    expect(s.revision).toEqual({ major: 3, minor: 7 });
    expect(s.revisionHistory).toHaveLength(1);
  });
});
