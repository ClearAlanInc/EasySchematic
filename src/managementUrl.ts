/**
 * Builds the management URL for a device — the address the "Open Management UI"
 * context-menu action navigates to.
 *
 * The address comes from the port flagged as the management interface
 * (`networkConfig.isManagement`); the path/scheme come from the device. Opening
 * it is a top-level navigation in a new tab, so unlike an in-page fetch it is
 * NOT subject to mixed-content or CORS restrictions — plain-http gear works
 * fine even when the editor itself is served over https.
 */
import type { DeviceData, Port } from "./types";
import { isValidIpv4 } from "./networkValidation";

/**
 * The port whose address identifies this device on the network.
 *
 * Prefers an explicitly flagged port. Falls back to the sole addressed port
 * when there is exactly one — unambiguous, and spares the user a checkbox on
 * the common single-NIC device.
 */
export function findManagementPort(data: Pick<DeviceData, "ports">): Port | undefined {
  const ports = data.ports ?? [];
  // An explicit designation stands on its own — the address may still be blank
  // (hostname-only gear) or arrive later.
  const explicit = ports.find((p) => p.networkConfig?.isManagement);
  if (explicit) return explicit;
  const addressed = ports.filter((p) => p.networkConfig?.ip?.trim());
  return addressed.length === 1 ? addressed[0] : undefined;
}

/** The management host — the flagged port's IP, else the device hostname. */
export function findManagementHost(data: Pick<DeviceData, "ports" | "hostname">): string | undefined {
  const ip = findManagementPort(data)?.networkConfig?.ip?.trim();
  if (ip && isValidIpv4(ip)) return ip;
  const host = data.hostname?.trim();
  return host || undefined;
}

/** Normalizes the user-entered path: "admin" → "/admin"; ":8080/x" and "/x" pass through. */
function normalizePath(raw: string | undefined): string {
  const path = (raw ?? "").trim();
  if (!path) return "";
  return /^[/:?#]/.test(path) ? path : "/" + path;
}

export interface ManagementTarget {
  /** URL to navigate to — always http(s). */
  url: string;
  /** Same URL with credentials embedded, when auth mode is "basic-url" and both exist. */
  urlWithCredentials?: string;
  host: string;
  /** Label of the port supplying the address, when it came from a port. */
  viaPortLabel?: string;
}

/**
 * Resolve a device's management target, or undefined when it has no usable
 * address. Never returns a non-http(s) URL: the scheme is chosen from a fixed
 * set and the user-supplied path is appended to an already-valid origin, so it
 * cannot introduce a javascript:/data: scheme.
 */
export function buildManagementTarget(
  data: Pick<DeviceData, "ports" | "hostname" | "managementPath" | "managementScheme" | "managementAuth" | "username" | "password">,
): ManagementTarget | undefined {
  const host = findManagementHost(data);
  if (!host) return undefined;

  const scheme = data.managementScheme === "https" ? "https" : "http";
  const url = `${scheme}://${host}${normalizePath(data.managementPath)}`;

  const target: ManagementTarget = {
    url,
    host,
    viaPortLabel: findManagementPort(data)?.label,
  };

  if (data.managementAuth === "basic-url" && data.username && data.password) {
    target.urlWithCredentials =
      `${scheme}://${encodeURIComponent(data.username)}:${encodeURIComponent(data.password)}@${host}` +
      normalizePath(data.managementPath);
  }
  return target;
}

export interface SshTarget {
  /** `ssh://[user@]host` — handed to the OS, which routes it to the registered
   *  terminal handler (Terminal.app on macOS; PuTTY/Windows Terminal or a
   *  desktop handler elsewhere, if one is registered). */
  url: string;
  host: string;
  username?: string;
  /** A stored password exists. SSH cannot accept one over the URL, so the caller
   *  copies it to the clipboard for pasting at the password prompt. */
  hasPassword: boolean;
}

/**
 * The SSH target for a device, or undefined when the management interface does
 * not advertise SSH (or there is no address to reach).
 *
 * Note the deliberate omission: no password rides the URL. OpenSSH refuses
 * passwords on the command line by design, and the ssh:// scheme has no field
 * for one — so credentials are handed over out-of-band via the clipboard.
 */
export function buildSshTarget(
  data: Pick<DeviceData, "ports" | "hostname" | "username" | "password">,
): SshTarget | undefined {
  const port = findManagementPort(data);
  if (!port?.networkConfig?.supportsSsh) return undefined;
  const host = findManagementHost(data);
  if (!host) return undefined;

  const user = data.username?.trim();
  return {
    url: `ssh://${user ? encodeURIComponent(user) + "@" : ""}${host}`,
    host,
    username: user || undefined,
    hasPassword: !!data.password,
  };
}

/**
 * One-line summary of a stored SSH key, so the editor can show what's held
 * without rendering the key material.
 */
export function describeSshKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "none stored";
  const lines = trimmed.split(/\r?\n/).length;
  const header = trimmed.match(/-----BEGIN ([A-Z0-9 ]+?) PRIVATE KEY-----/);
  if (header) {
    const kind = header[1].trim();
    return `${kind === "OPENSSH" ? "OpenSSH" : kind} private key · ${lines} lines`;
  }
  // Public keys are a single "ssh-<type> <base64> [comment]" line.
  const pub = trimmed.match(/^(ssh-[a-z0-9-]+|ecdsa-[a-z0-9-]+)\s/i);
  if (pub) return `${pub[1]} public key`;
  return `${trimmed.length} characters`;
}

/** Effective auth mode: defaults to clipboard hand-off when credentials exist. */
export function effectiveAuthMode(data: Pick<DeviceData, "managementAuth" | "username" | "password">) {
  if (data.managementAuth) return data.managementAuth;
  return data.username || data.password ? "clipboard" : "none";
}
