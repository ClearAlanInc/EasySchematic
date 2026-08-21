/**
 * Persistent outbox for organization (company) device-library sync.
 *
 * A leaf module deliberately free of store imports: the store marks templates
 * dirty here when the user edits them, and the sync engine
 * (orgTemplateSync.ts) drains the outbox toward the API. Entries live in
 * localStorage so edits made offline survive reloads until they're pushed.
 */

import { CLOUD_ENABLED } from "./selfHosted";

const OUTBOX_KEY = "cadesign-org-sync";

export interface OrgOutboxEntry {
  op: "upsert" | "delete";
  /** When the local edit happened — the server resolves conflicts by this. */
  editedAt: string;
}

export interface OrgSyncState {
  /** Server high-water mark from the last successful pull (server clock). */
  lastSyncAt: string | null;
  /** Un-pushed local changes, keyed by template key (id ?? deviceType). */
  pending: Record<string, OrgOutboxEntry>;
}

export function loadOrgSyncState(): OrgSyncState {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OrgSyncState;
      if (parsed && typeof parsed === "object" && parsed.pending) return parsed;
    }
  } catch {
    // Corrupt state — start fresh; worst case is one redundant full pull.
  }
  return { lastSyncAt: null, pending: {} };
}

export function saveOrgSyncState(state: OrgSyncState): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(state));
  } catch {
    // Storage full — sync will re-derive what it can next session.
  }
}

type OutboxListener = () => void;
const listeners = new Set<OutboxListener>();

/** Notifies the sync engine that the outbox gained work (debounced there). */
export function subscribeOutbox(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record a local library change for the next push. An upsert over a pending
 * delete (or vice versa) simply replaces it — only the latest intent matters.
 */
export function markOrgTemplateDirty(key: string, op: "upsert" | "delete"): void {
  if (!CLOUD_ENABLED || typeof window === "undefined") return;
  const state = loadOrgSyncState();
  state.pending[key] = { op, editedAt: new Date().toISOString() };
  saveOrgSyncState(state);
  for (const l of listeners) l();
}

/**
 * Drop a pending entry after a successful push — but only if no newer edit
 * replaced it while the request was in flight.
 */
export function clearPendingIfUnchanged(key: string, pushed: OrgOutboxEntry): void {
  const state = loadOrgSyncState();
  const current = state.pending[key];
  if (current && current.editedAt === pushed.editedAt && current.op === pushed.op) {
    delete state.pending[key];
    saveOrgSyncState(state);
  }
}

export function setLastSyncAt(serverTime: string): void {
  const state = loadOrgSyncState();
  state.lastSyncAt = serverTime;
  saveOrgSyncState(state);
}
