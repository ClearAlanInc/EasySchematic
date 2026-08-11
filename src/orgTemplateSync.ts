/**
 * Organization (company) device-library sync engine.
 *
 * The server is authoritative: local edits queue in the outbox
 * (orgSyncOutbox.ts) and push whenever we're online and signed in; pulls fetch
 * everything newer than our last high-water mark and fold it into the store.
 * Conflict policy is last-write-wins by edit time — a stale push gets a 409
 * carrying the newer server row, which we adopt locally.
 *
 * Triggered from App.tsx on the same beats as the cloud schematic cache
 * (mount, `online` event, tab focus) plus a short debounce after any local
 * library edit.
 */

import { useSchematicStore } from "./store";
import {
  listOrgTemplates,
  putOrgTemplate,
  deleteOrgTemplate,
  OrgConflictError,
  NotAuthenticatedError,
  type OrgTemplateEntry,
} from "./templateApi";
import {
  loadOrgSyncState,
  saveOrgSyncState,
  clearPendingIfUnchanged,
  setLastSyncAt,
  subscribeOutbox,
  type OrgOutboxEntry,
} from "./orgSyncOutbox";
import { CLOUD_ENABLED } from "./selfHosted";
import type { DeviceTemplate } from "./types";

const PUSH_DEBOUNCE_MS = 2_000;

let syncing = false;

function keyOf(t: DeviceTemplate): string {
  return t.id ?? t.deviceType;
}

/** Fold a newer server row into the local library (used on 409 adoption). */
function adoptServerRow(row: OrgTemplateEntry): void {
  const store = useSchematicStore.getState();
  if (row.deleted) store.applyRemoteOrgTemplates([], [row.id]);
  else if (row.data) store.applyRemoteOrgTemplates([{ ...row.data, id: row.data.id ?? row.id }], []);
}

/**
 * One full sync pass: push the outbox, then pull changes since the last sync.
 * Safe to call at any time — it no-ops when offline, signed out, mid-sync, or
 * in a build with no API.
 */
export async function syncOrgTemplates(): Promise<void> {
  if (!CLOUD_ENABLED || typeof window === "undefined" || !navigator.onLine || syncing) return;
  syncing = true;
  try {
    // ── Push ──
    const pending = Object.entries(loadOrgSyncState().pending);
    for (const [id, entry] of pending) {
      const store = useSchematicStore.getState();
      try {
        if (entry.op === "delete") {
          await deleteOrgTemplate(id, entry.editedAt);
        } else {
          const tpl = store.customTemplates.find((t) => keyOf(t) === id);
          // Marked for upsert but gone from the library — it was removed
          // through a path that didn't tombstone; treat as a delete.
          if (!tpl) await deleteOrgTemplate(id, entry.editedAt);
          else await putOrgTemplate(id, tpl, entry.editedAt);
        }
        clearPendingIfUnchanged(id, entry);
      } catch (e) {
        if (e instanceof OrgConflictError) {
          adoptServerRow(e.current);
          clearPendingIfUnchanged(id, entry);
        } else if (e instanceof NotAuthenticatedError) {
          return; // Signed out — leave the outbox intact for after login.
        } else {
          return; // Network/server hiccup — retry on the next trigger.
        }
      }
    }

    // ── Pull ──
    const since = loadOrgSyncState().lastSyncAt ?? undefined;
    let res: Awaited<ReturnType<typeof listOrgTemplates>>;
    try {
      res = await listOrgTemplates(since);
    } catch {
      return; // Signed out or offline mid-sync — next trigger retries.
    }

    // Anything still in the outbox has a local edit newer than what we just
    // failed to push (or haven't pushed yet) — local wins until it lands.
    const stillPending = new Set(Object.keys(loadOrgSyncState().pending));
    const upserts: DeviceTemplate[] = [];
    const deletes: string[] = [];
    for (const row of res.templates) {
      if (stillPending.has(row.id)) continue;
      if (row.deleted) deletes.push(row.id);
      else if (row.data) upserts.push({ ...row.data, id: row.data.id ?? row.id });
    }
    if (upserts.length || deletes.length) {
      useSchematicStore.getState().applyRemoteOrgTemplates(upserts, deletes);
    }
    setLastSyncAt(res.serverTime);
  } finally {
    syncing = false;
  }
}

/**
 * First-sync bootstrap: a machine that has never synced seeds the company
 * library with its existing local custom devices. Without this, templates
 * created before sync existed would never reach the server.
 */
function bootstrapOutboxIfFirstSync(): void {
  const state = loadOrgSyncState();
  if (state.lastSyncAt !== null || Object.keys(state.pending).length > 0) return;
  const { customTemplates } = useSchematicStore.getState();
  if (customTemplates.length === 0) return;
  const editedAt = new Date().toISOString();
  for (const t of customTemplates) state.pending[keyOf(t)] = { op: "upsert", editedAt } as OrgOutboxEntry;
  saveOrgSyncState(state);
}

/**
 * Wire up the debounced push-after-edit trigger. Returns a cleanup function.
 * The mount/online/focus triggers live in App.tsx next to the cloud cache's.
 */
export function initOrgTemplateSync(): () => void {
  if (!CLOUD_ENABLED || typeof window === "undefined") return () => {};
  bootstrapOutboxIfFirstSync();
  let timer: number | null = null;
  const unsubscribe = subscribeOutbox(() => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void syncOrgTemplates();
    }, PUSH_DEBOUNCE_MS);
  });
  return () => {
    unsubscribe();
    if (timer != null) window.clearTimeout(timer);
  };
}
