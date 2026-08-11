/**
 * Company device-library sync (#org-sync): outbox semantics, the push/pull
 * engine, and the store's remote-apply merge.
 *
 * The store reads editor preferences from localStorage at import time, so we
 * install a minimal in-memory localStorage (plus window/navigator shims for
 * the sync engine's online checks) and import everything dynamically after.
 * templateApi's org functions are mocked — these tests exercise the engine's
 * decisions, not the network.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { DeviceTemplate } from "../types";

const api = vi.hoisted(() => ({
  listOrgTemplates: vi.fn(),
  putOrgTemplate: vi.fn(),
  deleteOrgTemplate: vi.fn(),
}));

vi.mock("../templateApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../templateApi")>();
  return { ...actual, ...api };
});

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

function tpl(id: string, label = id): DeviceTemplate {
  return {
    id,
    version: 1,
    deviceType: id,
    category: "infrastructure",
    label,
    ports: [{ id: "p1", label: "IN", signalType: "analog-audio", direction: "input" }],
  } as DeviceTemplate;
}

let store: typeof import("../store")["useSchematicStore"];
let outbox: typeof import("../orgSyncOutbox");
let engine: typeof import("../orgTemplateSync");
let apiMod: typeof import("../templateApi");

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  if (typeof window === "undefined") {
    (globalThis as { window?: unknown }).window = globalThis;
  }
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });
  ({ useSchematicStore: store } = await import("../store"));
  outbox = await import("../orgSyncOutbox");
  engine = await import("../orgTemplateSync");
  apiMod = await import("../templateApi");
});

beforeEach(() => {
  localStorage.clear();
  api.listOrgTemplates.mockReset();
  api.putOrgTemplate.mockReset();
  api.deleteOrgTemplate.mockReset();
  api.listOrgTemplates.mockResolvedValue({ serverTime: "2026-08-11T00:00:00.000Z", templates: [] });
  api.putOrgTemplate.mockResolvedValue({ updatedAt: "2026-08-11T00:00:00.000Z" });
  api.deleteOrgTemplate.mockResolvedValue({ updatedAt: "2026-08-11T00:00:00.000Z" });
  store.setState({
    customTemplates: [],
    customTemplateOrder: [],
    customTemplateGroups: [],
    customTemplateGroupAssignments: {},
  });
});

describe("orgSyncOutbox", () => {
  it("records edits keyed by template key and notifies subscribers", () => {
    const heard: string[] = [];
    const unsub = outbox.subscribeOutbox(() => heard.push("ping"));
    outbox.markOrgTemplateDirty("custom-1", "upsert");
    expect(outbox.loadOrgSyncState().pending["custom-1"].op).toBe("upsert");
    expect(heard).toHaveLength(1);
    unsub();
  });

  it("latest intent replaces earlier ones (delete over upsert)", () => {
    outbox.markOrgTemplateDirty("custom-1", "upsert");
    outbox.markOrgTemplateDirty("custom-1", "delete");
    expect(outbox.loadOrgSyncState().pending["custom-1"].op).toBe("delete");
  });

  it("clearPendingIfUnchanged keeps entries that were re-edited mid-push", () => {
    outbox.markOrgTemplateDirty("custom-1", "upsert");
    const pushed = outbox.loadOrgSyncState().pending["custom-1"];
    // A newer edit lands while the push was in flight.
    const state = outbox.loadOrgSyncState();
    state.pending["custom-1"] = { op: "upsert", editedAt: "2099-01-01T00:00:00.000Z" };
    outbox.saveOrgSyncState(state);
    outbox.clearPendingIfUnchanged("custom-1", pushed);
    expect(outbox.loadOrgSyncState().pending["custom-1"]).toBeDefined();
    // The exact entry that was pushed does clear.
    outbox.clearPendingIfUnchanged("custom-1", { op: "upsert", editedAt: "2099-01-01T00:00:00.000Z" });
    expect(outbox.loadOrgSyncState().pending["custom-1"]).toBeUndefined();
  });
});

describe("store mutations mark the outbox", () => {
  it("add/update/remove custom template queue push work", () => {
    const t = tpl("custom-100");
    store.getState().addCustomTemplate(t);
    expect(outbox.loadOrgSyncState().pending["custom-100"].op).toBe("upsert");
    store.getState().updateCustomTemplate("custom-100", { ...t, label: "renamed" });
    expect(outbox.loadOrgSyncState().pending["custom-100"].op).toBe("upsert");
    store.getState().removeCustomTemplate("custom-100");
    expect(outbox.loadOrgSyncState().pending["custom-100"].op).toBe("delete");
  });

  it("applyRemoteOrgTemplates does NOT mark anything dirty", () => {
    store.getState().applyRemoteOrgTemplates([tpl("custom-200")], []);
    expect(outbox.loadOrgSyncState().pending["custom-200"]).toBeUndefined();
    expect(store.getState().customTemplates.map((t) => t.id)).toContain("custom-200");
  });
});

describe("applyRemoteOrgTemplates merge", () => {
  it("upserts replace by key, deletes drop template + order + group assignment", () => {
    store.getState().addCustomTemplate(tpl("custom-a", "A"));
    store.getState().addCustomTemplate(tpl("custom-b", "B"));
    store.setState({ customTemplateGroupAssignments: { "custom-b": "group-1" } });

    store.getState().applyRemoteOrgTemplates([tpl("custom-a", "A v2"), tpl("custom-c", "C")], ["custom-b"]);

    const s = store.getState();
    expect(s.customTemplates.find((t) => t.id === "custom-a")?.label).toBe("A v2");
    expect(s.customTemplates.find((t) => t.id === "custom-b")).toBeUndefined();
    expect(s.customTemplates.find((t) => t.id === "custom-c")).toBeDefined();
    expect(s.customTemplateOrder).toEqual(["custom-a", "custom-c"]);
    expect(s.customTemplateGroupAssignments["custom-b"]).toBeUndefined();
  });

  it("collapses duplicate order entries left by a pre-sync library", () => {
    store.setState({
      customTemplates: [tpl("custom-dup")],
      customTemplateOrder: ["custom-dup", "custom-dup"],
    });
    store.getState().applyRemoteOrgTemplates([tpl("custom-other")], []);
    expect(store.getState().customTemplateOrder).toEqual(["custom-dup", "custom-other"]);
  });
});

describe("syncOrgTemplates engine", () => {
  it("pushes pending upserts with the template body, then clears them", async () => {
    const t = tpl("custom-push");
    store.getState().addCustomTemplate(t);
    await engine.syncOrgTemplates();
    expect(api.putOrgTemplate).toHaveBeenCalledWith("custom-push", t, expect.any(String));
    expect(outbox.loadOrgSyncState().pending["custom-push"]).toBeUndefined();
  });

  it("pushes pending deletes", async () => {
    store.getState().addCustomTemplate(tpl("custom-del"));
    store.getState().removeCustomTemplate("custom-del");
    await engine.syncOrgTemplates();
    expect(api.deleteOrgTemplate).toHaveBeenCalledWith("custom-del", expect.any(String));
    expect(api.putOrgTemplate).not.toHaveBeenCalled();
  });

  it("adopts the server row on a 409 conflict", async () => {
    const local = tpl("custom-conflict", "mine");
    store.getState().addCustomTemplate(local);
    const serverVersion = tpl("custom-conflict", "theirs, newer");
    api.putOrgTemplate.mockRejectedValue(new apiMod.OrgConflictError({
      id: "custom-conflict",
      data: serverVersion,
      deleted: false,
      updatedAt: "2026-08-11T01:00:00.000Z",
      updatedBy: "colleague",
    }));
    await engine.syncOrgTemplates();
    expect(store.getState().customTemplates.find((t) => t.id === "custom-conflict")?.label)
      .toBe("theirs, newer");
    expect(outbox.loadOrgSyncState().pending["custom-conflict"]).toBeUndefined();
  });

  it("adopts a server tombstone on delete conflict", async () => {
    store.getState().addCustomTemplate(tpl("custom-tomb"));
    // Local re-edit, but a colleague already deleted it with a newer stamp.
    api.putOrgTemplate.mockRejectedValue(new apiMod.OrgConflictError({
      id: "custom-tomb", data: null, deleted: true,
      updatedAt: "2026-08-11T01:00:00.000Z", updatedBy: "colleague",
    }));
    await engine.syncOrgTemplates();
    expect(store.getState().customTemplates.find((t) => t.id === "custom-tomb")).toBeUndefined();
  });

  it("pulls new templates and tombstones into the store and records the high-water mark", async () => {
    store.getState().applyRemoteOrgTemplates([tpl("custom-old")], []);
    api.listOrgTemplates.mockResolvedValue({
      serverTime: "2026-08-11T02:00:00.000Z",
      templates: [
        { id: "custom-new", data: tpl("custom-new", "from server"), deleted: false, updatedAt: "2026-08-11T01:59:00.000Z", updatedBy: "colleague" },
        { id: "custom-old", data: null, deleted: true, updatedAt: "2026-08-11T01:58:00.000Z", updatedBy: "colleague" },
      ],
    });
    await engine.syncOrgTemplates();
    const s = store.getState();
    expect(s.customTemplates.find((t) => t.id === "custom-new")?.label).toBe("from server");
    expect(s.customTemplates.find((t) => t.id === "custom-old")).toBeUndefined();
    expect(outbox.loadOrgSyncState().lastSyncAt).toBe("2026-08-11T02:00:00.000Z");
    expect(api.listOrgTemplates).toHaveBeenCalledWith(undefined);
  });

  it("passes the high-water mark as `since` on subsequent pulls", async () => {
    outbox.setLastSyncAt("2026-08-11T02:00:00.000Z");
    await engine.syncOrgTemplates();
    expect(api.listOrgTemplates).toHaveBeenCalledWith("2026-08-11T02:00:00.000Z");
  });

  it("a pulled row never overwrites a template with an unpushed local edit", async () => {
    const mine = tpl("custom-race", "my offline edit");
    store.getState().addCustomTemplate(mine);
    // Push fails (server hiccup) so the entry stays pending…
    api.putOrgTemplate.mockRejectedValue(new Error("network down"));
    api.listOrgTemplates.mockResolvedValue({
      serverTime: "2026-08-11T03:00:00.000Z",
      templates: [
        { id: "custom-race", data: tpl("custom-race", "server version"), deleted: false, updatedAt: "2026-08-11T02:59:00.000Z", updatedBy: "colleague" },
      ],
    });
    await engine.syncOrgTemplates();
    // …and the local version survives the pull.
    expect(store.getState().customTemplates.find((t) => t.id === "custom-race")?.label)
      .toBe("my offline edit");
    expect(outbox.loadOrgSyncState().pending["custom-race"]).toBeDefined();
  });

  it("leaves the outbox intact when signed out", async () => {
    store.getState().addCustomTemplate(tpl("custom-authless"));
    api.putOrgTemplate.mockRejectedValue(new apiMod.NotAuthenticatedError());
    await engine.syncOrgTemplates();
    expect(outbox.loadOrgSyncState().pending["custom-authless"]).toBeDefined();
  });

  it("first-ever sync seeds the outbox with existing local customs", async () => {
    store.setState({ customTemplates: [tpl("custom-legacy")], customTemplateOrder: ["custom-legacy"] });
    const stop = engine.initOrgTemplateSync();
    expect(outbox.loadOrgSyncState().pending["custom-legacy"]?.op).toBe("upsert");
    stop();
  });

  it("a machine that has synced before does not re-seed", () => {
    outbox.setLastSyncAt("2026-08-11T02:00:00.000Z");
    store.setState({ customTemplates: [tpl("custom-legacy")], customTemplateOrder: ["custom-legacy"] });
    const stop = engine.initOrgTemplateSync();
    expect(outbox.loadOrgSyncState().pending["custom-legacy"]).toBeUndefined();
    stop();
  });
});
