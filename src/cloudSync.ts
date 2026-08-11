/**
 * Coordination layer between the network API (templateApi) and local cache (cloudCache).
 * Provides cache-aware schematic operations for offline reading, and a write
 * outbox: cloud saves made offline queue in IndexedDB and replay on reconnect.
 * Replay detects a colleague's intervening save by comparing the server's
 * updated_at against the stamp the offline save was based on, and asks the
 * user whether to overwrite or keep both.
 */

import {
  listCloudSchematics,
  loadCloudSchematic,
  updateSchematicInCloud,
  saveSchematicToCloud,
} from "./templateApi";
import {
  getCachedSchematics,
  getCachedSchematic,
  cacheSchematicList,
  cacheSchematicContent,
  putOutboxEntry,
  getOutboxEntries,
  removeOutboxEntry,
  type CachedSchematic,
  type OutboxEntry,
} from "./cloudCache";
import { useSchematicStore } from "./store";

/** List schematics: API first, cache fallback. */
export async function listSchematics(): Promise<CachedSchematic[]> {
  if (navigator.onLine) {
    try {
      const list = await listCloudSchematics();
      await cacheSchematicList(list);
      backgroundFetchContent(list);
      // Return server list with cached content attached
      const cached = await getCachedSchematics();
      const dataMap = new Map(cached.map((s) => [s.id, s.data]));
      return list.map((s) => ({ ...s, data: dataMap.get(s.id) ?? null }));
    } catch {
      // Online but API failed (captive portal, server down) — fall through
    }
  }
  return getCachedSchematics();
}

/** Load a single schematic: API first, cache fallback. */
export async function loadSchematic(id: string): Promise<unknown> {
  if (navigator.onLine) {
    try {
      const data = await loadCloudSchematic(id);
      await cacheSchematicContent(id, data);
      return data;
    } catch {
      // Fall through to cache
    }
  }
  const cached = await getCachedSchematic(id);
  if (cached) return cached;
  throw new Error("Schematic not available offline");
}

/**
 * Refresh the cloud cache: fetch list + content for stale entries.
 * Call on reconnect and app focus.
 */
export async function refreshCloudCache(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const list = await listCloudSchematics();
    await cacheSchematicList(list);
    await backgroundFetchContent(list);
  } catch {
    // Silently fail — cache is still usable
  }
}

// ─── Write outbox ────────────────────────────────────────

/**
 * Queue a cloud save that couldn't happen right now (offline / network drop).
 * Also optimistically updates the read cache so reopening the schematic —
 * even offline — shows the version the user just saved.
 */
export async function queueCloudSave(id: string, data: unknown, baseUpdatedAt: string | null): Promise<void> {
  await putOutboxEntry({ id, data, queuedAt: new Date().toISOString(), baseUpdatedAt });
  await cacheSchematicContent(id, data).catch(() => { /* cache is best-effort */ });
}

/** Number of queued offline saves (drives UI hints). */
export async function pendingCloudSaves(): Promise<number> {
  return (await getOutboxEntries().catch(() => [])).length;
}

/** Injectable for tests — everything replayCloudOutbox touches. */
export interface ReplayDeps {
  getEntries: () => Promise<OutboxEntry[]>;
  removeEntry: (id: string) => Promise<void>;
  listRemote: () => Promise<{ id: string; name: string; updated_at: string }[]>;
  update: (id: string, data: unknown) => Promise<{ updated_at: string }>;
  saveNew: (data: unknown) => Promise<{ id: string; updated_at: string }>;
  cacheContent: (id: string, data: unknown) => Promise<void>;
  /** Ask the user: overwrite the colleague's newer version? false = keep both. */
  confirmOverwrite: (name: string) => boolean;
  notify: (message: string, kind: "success" | "error" | "info") => void;
  /** Reflect a completed save into the open document, if it's the same one. */
  recordSaved: (id: string, updatedAt: string) => void;
}

function defaultReplayDeps(): ReplayDeps {
  return {
    getEntries: getOutboxEntries,
    removeEntry: removeOutboxEntry,
    listRemote: listCloudSchematics,
    update: updateSchematicInCloud,
    saveNew: saveSchematicToCloud,
    cacheContent: cacheSchematicContent,
    confirmOverwrite: (name) =>
      window.confirm(
        `"${name}" changed in the cloud while you were offline.\n\n` +
        `OK — replace it with your offline version.\n` +
        `Cancel — keep both (yours is saved as a copy).`,
      ),
    notify: (message, kind) => useSchematicStore.getState().addToast(message, kind),
    recordSaved: (id, updatedAt) => {
      const store = useSchematicStore.getState();
      if (store.cloudSchematicId === id) store.setCloudSavedAt(updatedAt);
    },
  };
}

let replaying = false;

/**
 * Push queued offline saves to the cloud. Call on reconnect and app focus
 * (piggybacks on the same beats as refreshCloudCache). Silently defers when
 * offline, signed out, or when the server can't be reached.
 */
export async function replayCloudOutbox(deps: ReplayDeps = defaultReplayDeps()): Promise<void> {
  if (replaying) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  replaying = true;
  try {
    const entries = await deps.getEntries().catch(() => [] as OutboxEntry[]);
    if (entries.length === 0) return;

    // One list call covers conflict stamps for every entry. Failure here means
    // the server is unreachable or we're signed out — retry on the next beat.
    let remote: Awaited<ReturnType<ReplayDeps["listRemote"]>>;
    try {
      remote = await deps.listRemote();
    } catch {
      return;
    }
    const remoteById = new Map(remote.map((r) => [r.id, r]));

    for (const entry of entries) {
      const row = remoteById.get(entry.id);
      const name =
        (entry.data as { name?: string } | null)?.name ?? row?.name ?? "Untitled Schematic";
      try {
        if (!row) {
          // Deleted server-side while we were offline — recreate rather than
          // silently dropping the user's work.
          const created = await deps.saveNew(entry.data);
          await deps.cacheContent(created.id, entry.data).catch(() => {});
          deps.notify(`"${name}" was deleted in the cloud — your offline version was saved as a new schematic.`, "info");
        } else if (entry.baseUpdatedAt && row.updated_at > entry.baseUpdatedAt) {
          // A colleague saved while we were offline.
          if (deps.confirmOverwrite(name)) {
            const result = await deps.update(entry.id, entry.data);
            await deps.cacheContent(entry.id, entry.data).catch(() => {});
            deps.recordSaved(entry.id, result.updated_at);
            deps.notify(`Offline changes to "${name}" saved to cloud.`, "success");
          } else {
            const copy = { ...(entry.data as Record<string, unknown>), name: `${name} (offline copy)` };
            const created = await deps.saveNew(copy);
            await deps.cacheContent(created.id, copy).catch(() => {});
            deps.notify(`Kept the cloud version of "${name}"; your offline changes were saved as "${name} (offline copy)".`, "info");
          }
        } else {
          const result = await deps.update(entry.id, entry.data);
          await deps.cacheContent(entry.id, entry.data).catch(() => {});
          deps.recordSaved(entry.id, result.updated_at);
          deps.notify(`Offline changes to "${name}" saved to cloud.`, "success");
        }
        await deps.removeEntry(entry.id);
      } catch {
        // This entry failed (network blip, quota, validation) — keep it queued
        // and let the next beat retry. Continue with the other entries.
      }
    }
  } finally {
    replaying = false;
  }
}

// ─── Internal ────────────────────────────────────────────

/** Fetch full content for schematics that are stale or uncached. */
async function backgroundFetchContent(list: import("./templateApi").CloudSchematic[]): Promise<void> {
  const cached = await getCachedSchematics();
  const cacheMap = new Map(cached.map((s) => [s.id, s]));

  for (const s of list) {
    const c = cacheMap.get(s.id);
    if (!c?.data || c.updated_at < s.updated_at) {
      try {
        const data = await loadCloudSchematic(s.id);
        await cacheSchematicContent(s.id, data);
      } catch {
        // Individual fetch failed — skip, try again later
      }
    }
  }
}
