/**
 * IndexedDB cache for cloud schematics: a read cache of metadata + full
 * content for offline access, plus a write outbox — cloud saves made while
 * offline queue here and replay on reconnect (see cloudSync.ts).
 */

import type { CloudSchematic } from "./templateApi";

const DB_NAME = "maestro-cloud-cache";
const DB_VERSION = 2;
const SCHEMATICS_STORE = "schematics";
const OUTBOX_STORE = "outbox";

/** A cloud save captured while offline, awaiting replay. One per schematic —
 *  a newer queued save simply replaces the older one. */
export interface OutboxEntry {
  /** Cloud schematic id the save targets. */
  id: string;
  /** Full SchematicFile export at the moment of the save. */
  data: unknown;
  queuedAt: string;
  /** The cloud updated_at we last synced from — replay compares the server's
   *  current stamp against this to detect a colleague's intervening save. */
  baseUpdatedAt: string | null;
}

export interface CachedSchematic extends CloudSchematic {
  data: unknown | null; // full SchematicFile content, null if not yet fetched
}

// ─── Database ────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

// Database names used before product renames (oldest first). Their contents
// (cached cloud schematics and, critically, any queued offline saves) are
// copied into the current database once, then the old ones are deleted.
const LEGACY_DB_NAMES = ["easyschematic-cloud-cache", "cadesign-cloud-cache"];

function openNamed(name: string, version?: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    if (upgrade) req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });
}

/** Best-effort one-time copy of the legacy databases into `db`. Never throws. */
async function migrateLegacyDb(db: IDBDatabase): Promise<void> {
  let known: (string | undefined)[] | null = null;
  try {
    if (typeof indexedDB.databases === "function") {
      known = (await indexedDB.databases()).map((d) => d.name);
    }
  } catch {
    known = null;
  }
  for (const legacyName of LEGACY_DB_NAMES) {
    try {
      if (known && !known.includes(legacyName)) continue;
      const old = await openNamed(legacyName);
      if (old.objectStoreNames.length === 0) {
        old.close();
        indexedDB.deleteDatabase(legacyName);
        continue;
      }
      const [schematics, outbox] = await Promise.all([readAll(old, SCHEMATICS_STORE), readAll(old, OUTBOX_STORE)]);
      old.close();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SCHEMATICS_STORE, OUTBOX_STORE], "readwrite");
        const sStore = tx.objectStore(SCHEMATICS_STORE);
        const oStore = tx.objectStore(OUTBOX_STORE);
        // Don't clobber anything already written under the new name.
        for (const row of schematics) sStore.add(row).onerror = (e) => e.preventDefault();
        for (const row of outbox) oStore.add(row).onerror = (e) => e.preventDefault();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      indexedDB.deleteDatabase(legacyName);
    } catch {
      // Migration is best-effort; the app works fine from an empty cache.
    }
  }
}

function openCache(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openNamed(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(SCHEMATICS_STORE)) {
      db.createObjectStore(SCHEMATICS_STORE, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
      db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
    }
  }).then(async (db) => {
    await migrateLegacyDb(db);
    return db;
  });
  return dbPromise;
}

// ─── Schematic Cache ─────────────────────────────────────

export async function getCachedSchematics(): Promise<CachedSchematic[]> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEMATICS_STORE, "readonly");
    const req = tx.objectStore(SCHEMATICS_STORE).getAll();
    req.onsuccess = () => resolve(req.result as CachedSchematic[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedSchematic(id: string): Promise<unknown | null> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEMATICS_STORE, "readonly");
    const req = tx.objectStore(SCHEMATICS_STORE).get(id);
    req.onsuccess = () => {
      const cached = req.result as CachedSchematic | undefined;
      resolve(cached?.data ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Cache metadata for all schematics. Preserves existing `data` fields. */
export async function cacheSchematicList(schematics: CloudSchematic[]): Promise<void> {
  const db = await openCache();
  const existing = await getCachedSchematics();
  const dataMap = new Map(existing.map((s) => [s.id, s.data]));

  // Remove cached schematics that no longer exist on the server
  const serverIds = new Set(schematics.map((s) => s.id));

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEMATICS_STORE, "readwrite");
    const store = tx.objectStore(SCHEMATICS_STORE);

    for (const cached of existing) {
      if (!serverIds.has(cached.id)) {
        store.delete(cached.id);
      }
    }

    for (const s of schematics) {
      const entry: CachedSchematic = { ...s, data: dataMap.get(s.id) ?? null };
      store.put(entry);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Cache full content for a single schematic. */
export async function cacheSchematicContent(id: string, data: unknown): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEMATICS_STORE, "readwrite");
    const store = tx.objectStore(SCHEMATICS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as CachedSchematic | undefined;
      if (existing) {
        store.put({ ...existing, data });
      } else {
        store.put({ id, name: "", size_bytes: 0, shared: 0, share_token: null, created_at: "", updated_at: "", data });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeCachedSchematic(id: string): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEMATICS_STORE, "readwrite");
    tx.objectStore(SCHEMATICS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Wipe all cached data (for logout). Also drops any queued offline saves —
 *  they belonged to the account that just signed out. */
export async function clearCache(): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SCHEMATICS_STORE, OUTBOX_STORE], "readwrite");
    tx.objectStore(SCHEMATICS_STORE).clear();
    tx.objectStore(OUTBOX_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Write Outbox ────────────────────────────────────────

/** Queue (or replace) the pending offline save for a schematic. */
export async function putOutboxEntry(entry: OutboxEntry): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = () => resolve(req.result as OutboxEntry[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOutboxEntry(id: string): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
