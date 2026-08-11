/**
 * Offline cloud-save outbox replay (#offline-writes): the decision logic in
 * replayCloudOutbox, exercised through its injectable deps so no IndexedDB or
 * network is involved. Covers the clean replay, the colleague-conflict prompt
 * (both answers), server-side deletion, retry-on-failure, and offline no-op.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { OutboxEntry } from "../cloudCache";
import type { ReplayDeps } from "../cloudSync";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

let replayCloudOutbox: typeof import("../cloudSync")["replayCloudOutbox"];

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  if (typeof window === "undefined") (globalThis as { window?: unknown }).window = globalThis;
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  ({ replayCloudOutbox } = await import("../cloudSync"));
});

function entry(id: string, base: string | null, name = "Studio A"): OutboxEntry {
  return { id, data: { name, version: 50, nodes: [], edges: [] }, queuedAt: "2026-08-11T01:00:00.000Z", baseUpdatedAt: base };
}

function makeDeps(entries: OutboxEntry[], remote: { id: string; name: string; updated_at: string }[]) {
  const removed: string[] = [];
  const notices: string[] = [];
  const deps = {
    removed,
    notices,
    getEntries: async () => entries,
    removeEntry: async (id: string) => { removed.push(id); },
    listRemote: async () => remote,
    update: vi.fn<ReplayDeps["update"]>(async () => ({ updated_at: "2026-08-11T02:00:00.000Z" })),
    saveNew: vi.fn<ReplayDeps["saveNew"]>(async () => ({ id: "new-id", updated_at: "2026-08-11T02:00:00.000Z" })),
    cacheContent: async () => {},
    confirmOverwrite: vi.fn<ReplayDeps["confirmOverwrite"]>(() => true),
    notify: (m: string) => { notices.push(m); },
    recordSaved: vi.fn<ReplayDeps["recordSaved"]>(),
  };
  return deps satisfies ReplayDeps & Record<string, unknown>;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
});

describe("replayCloudOutbox", () => {
  it("replays a clean queued save and clears the entry", async () => {
    const deps = makeDeps(
      [entry("s1", "2026-08-11T00:00:00.000Z")],
      [{ id: "s1", name: "Studio A", updated_at: "2026-08-11T00:00:00.000Z" }],
    );
    await replayCloudOutbox(deps);
    expect(deps.update).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "Studio A" }));
    expect(deps.recordSaved).toHaveBeenCalledWith("s1", "2026-08-11T02:00:00.000Z");
    expect(deps.removed).toEqual(["s1"]);
    expect(deps.confirmOverwrite).not.toHaveBeenCalled();
  });

  it("prompts on a colleague's intervening save and overwrites on OK", async () => {
    const deps = makeDeps(
      [entry("s1", "2026-08-11T00:00:00.000Z")],
      [{ id: "s1", name: "Studio A", updated_at: "2026-08-11T00:30:00.000Z" }], // newer than base
    );
    await replayCloudOutbox(deps);
    expect(deps.confirmOverwrite).toHaveBeenCalledWith("Studio A");
    expect(deps.update).toHaveBeenCalled();
    expect(deps.saveNew).not.toHaveBeenCalled();
    expect(deps.removed).toEqual(["s1"]);
  });

  it("keeps both on Cancel: server version stands, offline version becomes a copy", async () => {
    const deps = makeDeps(
      [entry("s1", "2026-08-11T00:00:00.000Z")],
      [{ id: "s1", name: "Studio A", updated_at: "2026-08-11T00:30:00.000Z" }],
    );
    deps.confirmOverwrite.mockReturnValue(false);
    await replayCloudOutbox(deps);
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.saveNew).toHaveBeenCalledWith(expect.objectContaining({ name: "Studio A (offline copy)" }));
    expect(deps.removed).toEqual(["s1"]);
  });

  it("recreates a schematic that was deleted server-side instead of dropping the work", async () => {
    const deps = makeDeps([entry("s-gone", "2026-08-11T00:00:00.000Z")], []);
    await replayCloudOutbox(deps);
    expect(deps.saveNew).toHaveBeenCalledWith(expect.objectContaining({ name: "Studio A" }));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.removed).toEqual(["s-gone"]);
  });

  it("keeps a failed entry queued for the next beat but continues with others", async () => {
    const deps = makeDeps(
      [entry("s1", null), entry("s2", null, "Studio B")],
      [
        { id: "s1", name: "Studio A", updated_at: "2026-08-11T00:00:00.000Z" },
        { id: "s2", name: "Studio B", updated_at: "2026-08-11T00:00:00.000Z" },
      ],
    );
    deps.update.mockImplementation(async (id: string) => {
      if (id === "s1") throw new Error("network blip");
      return { updated_at: "2026-08-11T02:00:00.000Z" };
    });
    await replayCloudOutbox(deps);
    expect(deps.removed).toEqual(["s2"]);
  });

  it("defers entirely when the server list can't be fetched", async () => {
    const deps = makeDeps([entry("s1", null)], []);
    deps.listRemote = async () => { throw new Error("401"); };
    await replayCloudOutbox(deps);
    expect(deps.removed).toEqual([]);
    expect(deps.update).not.toHaveBeenCalled();
  });

  it("no-ops while offline", async () => {
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
    const deps = makeDeps([entry("s1", null)], []);
    const spy = vi.fn(deps.getEntries);
    deps.getEntries = spy;
    await replayCloudOutbox(deps);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a save with no base stamp never prompts (first sync of a legacy queue)", async () => {
    const deps = makeDeps(
      [entry("s1", null)],
      [{ id: "s1", name: "Studio A", updated_at: "2026-08-11T00:30:00.000Z" }],
    );
    await replayCloudOutbox(deps);
    expect(deps.confirmOverwrite).not.toHaveBeenCalled();
    expect(deps.update).toHaveBeenCalled();
  });
});
