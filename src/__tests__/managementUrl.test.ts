import { describe, it, expect } from "vitest";
import {
  findManagementPort,
  findManagementHost,
  buildManagementTarget,
  buildSshTarget,
  describeSshKey,
  describeManagementGap,
  effectiveAuthMode,
} from "../managementUrl";
import type { Port, PortNetworkConfig } from "../types";

const netPort = (id: string, nc: PortNetworkConfig): Port => ({
  id,
  label: id,
  signalType: "ethernet",
  direction: "bidirectional",
  networkConfig: nc,
});

describe("management interface selection", () => {
  it("uses the port explicitly flagged as management", () => {
    const ports = [
      netPort("dante", { ip: "10.0.1.5" }),
      netPort("mgmt", { ip: "192.168.1.50", isManagement: true }),
    ];
    expect(findManagementPort({ ports })?.id).toBe("mgmt");
    expect(findManagementHost({ ports })).toBe("192.168.1.50");
  });

  it("falls back to the sole addressed port when none is flagged", () => {
    const ports = [netPort("lan", { ip: "192.168.1.50" }), netPort("dante", {})];
    expect(findManagementPort({ ports })?.id).toBe("lan");
  });

  it("stays ambiguous — no guess — when several ports are addressed and none flagged", () => {
    const ports = [netPort("a", { ip: "10.0.0.1" }), netPort("b", { ip: "10.0.0.2" })];
    expect(findManagementPort({ ports })).toBeUndefined();
  });

  it("falls back to the device hostname when no port carries an IP", () => {
    expect(findManagementHost({ ports: [netPort("lan", {})], hostname: "core-110f" })).toBe("core-110f");
  });

  it("ignores a malformed IP and falls through to hostname", () => {
    const ports = [netPort("lan", { ip: "999.1.1", isManagement: true })];
    expect(findManagementHost({ ports, hostname: "dsp-01" })).toBe("dsp-01");
  });

  it("returns no target when there is no address at all", () => {
    expect(buildManagementTarget({ ports: [netPort("lan", {})] })).toBeUndefined();
    expect(buildManagementTarget({ ports: [] })).toBeUndefined();
  });
});

describe("management URL construction", () => {
  const ports = [netPort("mgmt", { ip: "192.168.1.50", isManagement: true })];

  it("defaults to http with no path", () => {
    expect(buildManagementTarget({ ports })?.url).toBe("http://192.168.1.50");
  });

  it("honours the https scheme", () => {
    expect(buildManagementTarget({ ports, managementScheme: "https" })?.url).toBe("https://192.168.1.50");
  });

  it("normalizes a path without a leading slash", () => {
    expect(buildManagementTarget({ ports, managementPath: "admin" })?.url).toBe("http://192.168.1.50/admin");
  });

  it("passes through paths starting with / : # or ?", () => {
    expect(buildManagementTarget({ ports, managementPath: "/admin" })?.url).toBe("http://192.168.1.50/admin");
    expect(buildManagementTarget({ ports, managementPath: ":8080/setup" })?.url).toBe("http://192.168.1.50:8080/setup");
    expect(buildManagementTarget({ ports, managementPath: "#/login" })?.url).toBe("http://192.168.1.50#/login");
  });

  it("reports which port supplied the address", () => {
    expect(buildManagementTarget({ ports })?.viaPortLabel).toBe("mgmt");
  });

  it("never yields a non-http scheme, even from a hostile path", () => {
    for (const path of ["javascript:alert(1)", "data:text/html,x", "//evil.example.com"]) {
      const url = buildManagementTarget({ ports, managementPath: path })!.url;
      expect(url.startsWith("http://192.168.1.50")).toBe(true);
    }
  });
});

describe("credential hand-off", () => {
  const ports = [netPort("mgmt", { ip: "192.168.1.50", isManagement: true })];

  it("omits credentials from the URL unless basic-url is chosen", () => {
    const t = buildManagementTarget({ ports, username: "admin", password: "pw", managementAuth: "clipboard" });
    expect(t?.urlWithCredentials).toBeUndefined();
    expect(t?.url).not.toContain("admin");
  });

  it("embeds and percent-encodes credentials for basic-url", () => {
    const t = buildManagementTarget({
      ports,
      username: "ad min",
      password: "p@ss:word",
      managementAuth: "basic-url",
      managementPath: "/admin",
    });
    expect(t?.urlWithCredentials).toBe("http://ad%20min:p%40ss%3Aword@192.168.1.50/admin");
  });

  it("skips credential embedding when either half is missing", () => {
    expect(buildManagementTarget({ ports, username: "admin", managementAuth: "basic-url" })?.urlWithCredentials)
      .toBeUndefined();
  });

  it("defaults to clipboard hand-off when credentials exist, none otherwise", () => {
    expect(effectiveAuthMode({ username: "admin", password: "pw" })).toBe("clipboard");
    expect(effectiveAuthMode({})).toBe("none");
    expect(effectiveAuthMode({ username: "admin", managementAuth: "none" })).toBe("none");
  });
});

describe("SSH console target", () => {
  const sshPort = (extra: Partial<PortNetworkConfig> = {}) =>
    [netPort("mgmt", { ip: "192.168.1.50", isManagement: true, supportsSsh: true, ...extra })];

  it("builds an ssh:// URL with the username", () => {
    const t = buildSshTarget({ ports: sshPort(), username: "admin" });
    expect(t?.url).toBe("ssh://admin@192.168.1.50");
    expect(t?.host).toBe("192.168.1.50");
    expect(t?.username).toBe("admin");
  });

  it("omits the user component when no username is stored", () => {
    expect(buildSshTarget({ ports: sshPort() })?.url).toBe("ssh://192.168.1.50");
  });

  it("never puts the password in the URL — ssh cannot accept one", () => {
    const t = buildSshTarget({ ports: sshPort(), username: "admin", password: "hunter2" });
    expect(t?.url).not.toContain("hunter2");
    expect(t?.url).toBe("ssh://admin@192.168.1.50");
    expect(t?.hasPassword).toBe(true); // caller hands it over via the clipboard
  });

  it("reports hasPassword false when none is stored", () => {
    expect(buildSshTarget({ ports: sshPort(), username: "admin" })?.hasPassword).toBe(false);
  });

  it("percent-encodes an awkward username", () => {
    expect(buildSshTarget({ ports: sshPort(), username: "dom\\user" })?.url)
      .toBe("ssh://dom%5Cuser@192.168.1.50");
  });

  it("is unavailable unless the management port advertises SSH", () => {
    const ports = [netPort("mgmt", { ip: "192.168.1.50", isManagement: true })];
    expect(buildSshTarget({ ports, username: "admin" })).toBeUndefined();
  });

  it("ignores supportsSsh on a port that is not the management interface", () => {
    const ports = [
      netPort("mgmt", { ip: "192.168.1.50", isManagement: true }),
      netPort("other", { ip: "10.0.0.9", supportsSsh: true }),
    ];
    expect(buildSshTarget({ ports })).toBeUndefined();
  });

  it("is unavailable without a reachable address", () => {
    expect(buildSshTarget({ ports: [netPort("mgmt", { isManagement: true, supportsSsh: true })] }))
      .toBeUndefined();
  });

  it("falls back to the device hostname", () => {
    const ports = [netPort("mgmt", { ip: "192.168.1.50", isManagement: true, supportsSsh: true })];
    ports[0].networkConfig!.ip = undefined;
    expect(buildSshTarget({ ports, hostname: "core-110f", username: "admin" })?.url)
      .toBe("ssh://admin@core-110f");
  });
});

describe("ssh key summary", () => {
  it("names an OpenSSH private key and counts its lines", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----";
    expect(describeSshKey(key)).toBe("OpenSSH private key · 4 lines");
  });

  it("names other private key flavours", () => {
    expect(describeSshKey("-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----"))
      .toContain("RSA private key");
  });

  it("recognises a public key", () => {
    expect(describeSshKey("ssh-ed25519 AAAAC3NzaC1... russ@mbp")).toBe("ssh-ed25519 public key");
  });

  it("never echoes the key material", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETMATERIAL\n-----END OPENSSH PRIVATE KEY-----";
    expect(describeSshKey(key)).not.toContain("SECRETMATERIAL");
  });

  it("handles empty and unrecognised input", () => {
    expect(describeSshKey("")).toBe("none stored");
    expect(describeSshKey("   ")).toBe("none stored");
    expect(describeSshKey("blob")).toBe("4 characters");
  });
});

describe("diagnosing an unreachable management interface", () => {
  it("explains a designated port that has no address (the reported bug)", () => {
    const ports = [netPort("Ethernet 1", { isManagement: true, supportsSsh: true })];
    const gap = describeManagementGap({ ports });
    expect(gap).toContain("No management address");
    expect(gap).toContain("Ethernet 1");
  });

  it("explains a malformed IP specifically", () => {
    const ports = [netPort("LAN", { ip: "192.168.1", isManagement: true })];
    const gap = describeManagementGap({ ports });
    expect(gap).toContain("192.168.1");
    expect(gap).toContain("not a valid IPv4");
  });

  it("reports no gap once an address exists", () => {
    expect(describeManagementGap({ ports: [netPort("LAN", { ip: "192.168.1.50", isManagement: true })] }))
      .toBeUndefined();
  });

  it("reports no gap when a hostname supplies the address", () => {
    expect(describeManagementGap({ ports: [netPort("LAN", { isManagement: true })], hostname: "core-110f" }))
      .toBeUndefined();
  });

  it("stays silent when nothing is designated — nothing to explain", () => {
    expect(describeManagementGap({ ports: [netPort("LAN", {})] })).toBeUndefined();
    expect(describeManagementGap({ ports: [] })).toBeUndefined();
  });
});
