import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Coverage for the self-hosted / fully-offline build flag (src/selfHosted.ts) and
// the templateApi chokepoint guards that make "zero external contact" provable.
//
// import.meta.env is LIVE in vitest (only inlined in real builds), so each case
// stubs the env and dynamically re-imports the module for a fresh evaluation.

async function importSelfHosted(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
  return await import("../selfHosted");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("selfHosted flag semantics", () => {
  it("hosted default: cloud enabled against api.maestroconnect.clearalan.ca", async () => {
    const m = await importSelfHosted({
      VITE_SELF_HOSTED: undefined,
      VITE_TEMPLATE_API_URL: undefined,
      VITE_DEVICES_URL: undefined,
    });
    expect(m.IS_SELF_HOSTED).toBe(false);
    expect(m.CLOUD_ENABLED).toBe(true);
    expect(m.SUBMIT_ENABLED).toBe(true);
    expect(m.API_URL).toBe("https://api.maestroconnect.clearalan.ca");
    expect(m.DEVICES_URL).toBe("https://devices.maestroconnect.clearalan.ca");
    expect(m.DOCS_URL).toBe("https://docs.maestroconnect.clearalan.ca");
  });

  it("custom API URL without the flag: unchanged cloud behavior", async () => {
    const m = await importSelfHosted({
      VITE_SELF_HOSTED: undefined,
      VITE_TEMPLATE_API_URL: "https://api.example.test",
      VITE_DEVICES_URL: undefined,
    });
    expect(m.IS_SELF_HOSTED).toBe(false);
    expect(m.CLOUD_ENABLED).toBe(true);
    expect(m.API_URL).toBe("https://api.example.test");
  });

  it("self-hosted with no API: fully offline, everything gated", async () => {
    const m = await importSelfHosted({
      VITE_SELF_HOSTED: "true",
      VITE_TEMPLATE_API_URL: undefined,
      VITE_DEVICES_URL: undefined,
    });
    expect(m.IS_SELF_HOSTED).toBe(true);
    expect(m.CLOUD_ENABLED).toBe(false);
    expect(m.SUBMIT_ENABLED).toBe(false);
    expect(m.API_URL).toBe("");
    expect(m.DEVICES_URL).toBe("");
    expect(m.DOCS_URL).toBe("");
  });

  it('accepts "1" as well as "true"', async () => {
    const m = await importSelfHosted({ VITE_SELF_HOSTED: "1" });
    expect(m.IS_SELF_HOSTED).toBe(true);
    expect(m.CLOUD_ENABLED).toBe(false);
  });

  it('does NOT treat "false" or arbitrary values as set', async () => {
    const m = await importSelfHosted({ VITE_SELF_HOSTED: "false" });
    expect(m.IS_SELF_HOSTED).toBe(false);
    expect(m.CLOUD_ENABLED).toBe(true);
  });

  it("treats set-but-empty env vars as unset (Docker build-args arrive empty)", async () => {
    const m = await importSelfHosted({
      VITE_SELF_HOSTED: "",
      VITE_TEMPLATE_API_URL: "",
      VITE_DEVICES_URL: "",
    });
    expect(m.IS_SELF_HOSTED).toBe(false);
    expect(m.CLOUD_ENABLED).toBe(true);
    expect(m.API_URL).toBe("https://api.maestroconnect.clearalan.ca");
    expect(m.DEVICES_URL).toBe("https://devices.maestroconnect.clearalan.ca");
  });

  it("self-hosted app + self-hosted API: cloud enabled against that URL, submit still off without a devices site", async () => {
    const m = await importSelfHosted({
      VITE_SELF_HOSTED: "true",
      VITE_TEMPLATE_API_URL: "https://api.myshop.lan",
      VITE_DEVICES_URL: undefined,
    });
    expect(m.IS_SELF_HOSTED).toBe(true);
    expect(m.CLOUD_ENABLED).toBe(true);
    expect(m.API_URL).toBe("https://api.myshop.lan");
    expect(m.SUBMIT_ENABLED).toBe(false); // no devices site to hand off to
  });

  it("VITE_DOCS_URL points every docs link at a custom site", async () => {
    const m = await importSelfHosted({
      VITE_SELF_HOSTED: "true",
      VITE_TEMPLATE_API_URL: "https://api.myshop.lan",
      VITE_DOCS_URL: "https://docs.myshop.lan",
    });
    expect(m.DOCS_URL).toBe("https://docs.myshop.lan");
  });
});

describe("templateApi chokepoints in fully-offline mode", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled in test")));
    vi.stubGlobal("fetch", fetchSpy);
  });

  async function importTemplateApiOffline() {
    vi.resetModules();
    vi.stubEnv("VITE_SELF_HOSTED", "true");
    vi.stubEnv("VITE_TEMPLATE_API_URL", undefined as unknown as string);
    vi.stubEnv("VITE_DEVICES_URL", undefined as unknown as string);
    return await import("../templateApi");
  }

  it("checkSession resolves null without fetching", async () => {
    const api = await importTemplateApiOffline();
    await expect(api.checkSession()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logout and loadSchematicTemplate no-op without fetching", async () => {
    const api = await importTemplateApiOffline();
    await expect(api.logout()).resolves.toBeUndefined();
    await expect(api.loadSchematicTemplate()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetchTemplates returns the bundled library, not degraded, without fetching", async () => {
    const api = await importTemplateApiOffline();
    const templates = await api.fetchTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(api.isLibraryDegraded()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("every mutating cloud call throws without fetching", async () => {
    const api = await importTemplateApiOffline();
    const calls: Array<Promise<unknown>> = [
      api.requestLogin("a@b.c"),
      api.createDraft({}),
      api.createHandoff(),
      api.saveSchematicToCloud({}),
      api.updateSchematicInCloud("id", {}),
      api.listCloudSchematics(),
      api.loadCloudSchematic("id"),
      api.deleteCloudSchematic("id"),
      api.toggleSchematicSharing("id", true),
      api.loadSharedSchematic("token"),
      api.renameCloudSchematic("id", "n"),
      api.setSchematicAsTemplate("id"),
      api.clearSchematicTemplate(),
      api.createSubmission("create", { deviceType: "t", label: "l", ports: [] }),
    ];
    for (const p of calls) {
      await expect(p).rejects.toThrow(/self-hosted/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hosted default still fetches (guard is flag-scoped, not global)", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SELF_HOSTED", undefined as unknown as string);
    vi.stubEnv("VITE_TEMPLATE_API_URL", undefined as unknown as string);
    const api = await import("../templateApi");
    // checkSession swallows network errors and resolves null — but it must TRY.
    await expect(api.checkSession()).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("api.maestroconnect.clearalan.ca");
  });
});
