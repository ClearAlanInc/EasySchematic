/**
 * At-rest protection for device management passwords.
 *
 * Passwords live in the store (and therefore in the device editor) as plain
 * text, and are enciphered only when the schematic is serialized — to
 * localStorage autosave, to an exported .json, or to any other file write.
 * Reading reverses it, so nothing downstream needs to know this exists.
 *
 * WHAT THIS PROTECTS AGAINST
 *   Casual disclosure: opening a .json in a text editor, skimming an autosave
 *   blob in devtools, a password showing up in a diff, a screenshot, or a file
 *   handed to a colleague. That is a real and common exposure, and this closes
 *   it.
 *
 * WHAT THIS DOES *NOT* PROTECT AGAINST
 *   Anyone who has this source code (it is open source, and the passphrase also
 *   ships inside the built JS bundle) can recover every password from a file.
 *   A hardcoded key cannot do otherwise — the app must decrypt unattended, so
 *   whatever it needs to decrypt is necessarily shipped with it. Treat this as
 *   obfuscation-at-rest with a real but bounded benefit, NOT as protection
 *   against a motivated attacker who holds both the file and the code. Do not
 *   store passwords here that would be damaging if disclosed.
 *
 * For secrets that must resist that, the passphrase has to come from the user
 * (or an OS keychain / the local field agent) and never be committed.
 */

const PASSPHRASE = "ClearAlan1";
/** Marks an enciphered value and versions the scheme so it can be changed later. */
const PREFIX = "enc:v1:";
const NONCE_BYTES = 8;

/** FNV-1a, used only to spread the passphrase + nonce across the PRNG state. */
function hash32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift128 keystream, seeded per-value so equal passwords encipher differently. */
function makeKeystream(nonce: string): () => number {
  const seed = PASSPHRASE + ":" + nonce;
  let x = hash32(seed, 0x811c9dc5) || 1;
  let y = hash32(seed, 0x1b873593) || 2;
  let z = hash32(seed, 0xcc9e2d51) || 3;
  let w = hash32(seed, 0x85ebca6b) || 4;
  return () => {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w & 0xff;
  };
}

function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True when a stored value is already enciphered. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Encipher a plaintext secret for storage. Idempotent, and passes "" through. */
export function encryptSecret(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const nonce = randomNonce();
  const next = makeKeystream(nonce);
  const data = new TextEncoder().encode(plain);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ next();
  return PREFIX + nonce + ":" + bytesToBase64(out);
}

/**
 * Recover a stored secret. Values without the marker are returned unchanged, so
 * files written before this existed (and hand-edited ones) still load.
 */
export function decryptSecret(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored;
  const body = stored.slice(PREFIX.length);
  const sep = body.indexOf(":");
  if (sep < 0) return "";
  const nonce = body.slice(0, sep);
  try {
    const bytes = base64ToBytes(body.slice(sep + 1));
    const next = makeKeystream(nonce);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ next();
    return new TextDecoder().decode(out);
  } catch {
    // Corrupt or truncated value — drop it rather than surfacing garbage.
    return "";
  }
}

/** DeviceData fields protected at rest. Add here and both directions follow. */
export const SECRET_FIELDS = ["password", "sshKey"] as const;

/** Minimal shape this module touches; avoids importing the full node union. */
type MaybeDeviceNode = { type?: string; data?: Record<string, unknown> };

/**
 * Copy of `nodes` with every device secret enciphered — for serialization.
 * Non-mutating: the live store keeps its plaintext so the editor is unaffected.
 */
export function withEncryptedSecrets<T extends MaybeDeviceNode>(nodes: T[]): T[] {
  let touched = false;
  const out = nodes.map((n) => {
    if (n.type !== "device" || !n.data) return n;
    let data: Record<string, unknown> | undefined;
    for (const field of SECRET_FIELDS) {
      const v = n.data[field];
      if (typeof v !== "string" || !v || isEncrypted(v)) continue;
      data ??= { ...n.data };
      data[field] = encryptSecret(v);
    }
    if (!data) return n;
    touched = true;
    return { ...n, data };
  });
  return touched ? out : nodes;
}

/**
 * Decipher device secrets on freshly loaded nodes, in place — matching how
 * the other load-time passes (snapNodesToGrid, applyRoomLockState) operate.
 */
export function decryptNodeSecrets(nodes: MaybeDeviceNode[] | undefined): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (n.type !== "device" || !n.data) continue;
    for (const field of SECRET_FIELDS) {
      const v = n.data[field];
      if (typeof v === "string" && isEncrypted(v)) n.data[field] = decryptSecret(v);
    }
  }
}
