import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  withEncryptedSecrets,
  decryptNodeSecrets,
} from "../credentials";

describe("credential enciphering", () => {
  it("round-trips a secret", () => {
    const secret = "hunter2";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("round-trips unicode and long secrets", () => {
    for (const s of ["pässwörd–ü", "🔐🔑", "a".repeat(500), "with:colons:and=symbols/+"]) {
      expect(decryptSecret(encryptSecret(s))).toBe(s);
    }
  });

  it("marks enciphered values and hides the plaintext", () => {
    const enc = encryptSecret("admin123");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain("admin123");
  });

  it("produces different ciphertext for identical secrets (per-value nonce)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("is idempotent — never double-enciphers", () => {
    const once = encryptSecret("secret");
    expect(encryptSecret(once)).toBe(once);
    expect(decryptSecret(encryptSecret(once))).toBe("secret");
  });

  it("passes empty values through", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("returns legacy plaintext unchanged (files written before this existed)", () => {
    expect(decryptSecret("plaintextpw")).toBe("plaintextpw");
    expect(isEncrypted("plaintextpw")).toBe(false);
  });

  it("returns empty for corrupt ciphertext rather than throwing", () => {
    expect(decryptSecret("enc:v1:deadbeef:!!!not-base64!!!")).toBe("");
    expect(decryptSecret("enc:v1:malformed")).toBe("");
  });
});

const deviceNode = (id: string, password?: string) => ({
  id,
  type: "device",
  position: { x: 0, y: 0 },
  data: { label: id, deviceType: "dsp", ports: [], ...(password ? { password } : {}) },
});

describe("node serialization boundaries", () => {
  it("enciphers device passwords without mutating the live nodes", () => {
    const nodes = [deviceNode("d1", "hunter2")];
    const out = withEncryptedSecrets(nodes);
    expect(nodes[0].data.password).toBe("hunter2"); // store keeps plaintext for the editor
    expect(isEncrypted(out[0].data.password!)).toBe(true);
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("leaves nodes untouched when there is nothing to encipher", () => {
    const nodes = [deviceNode("d1"), { id: "r1", type: "room", position: { x: 0, y: 0 }, data: {} }];
    expect(withEncryptedSecrets(nodes)).toBe(nodes); // same reference — no needless copy
  });

  it("only touches device nodes", () => {
    const nodes = [{ id: "n1", type: "note", position: { x: 0, y: 0 }, data: { password: "notasecret" } }];
    const out = withEncryptedSecrets(nodes);
    expect(out[0].data.password).toBe("notasecret");
  });

  it("deciphers on load, completing the save→load cycle", () => {
    const saved = JSON.parse(JSON.stringify(withEncryptedSecrets([deviceNode("d1", "hunter2")])));
    expect(JSON.stringify(saved)).not.toContain("hunter2");
    decryptNodeSecrets(saved);
    expect(saved[0].data.password).toBe("hunter2");
  });

  it("leaves legacy plaintext passwords readable on load", () => {
    const legacy = [deviceNode("d1", "oldplaintext")];
    decryptNodeSecrets(legacy);
    expect(legacy[0].data.password).toBe("oldplaintext");
  });

  it("tolerates undefined node lists", () => {
    expect(() => decryptNodeSecrets(undefined)).not.toThrow();
  });
});

const SAMPLE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDsecretkeymaterialdonotleakAAAEBanotherline
-----END OPENSSH PRIVATE KEY-----`;

describe("ssh key at rest", () => {
  it("round-trips a multi-line private key", () => {
    const enc = encryptSecret(SAMPLE_KEY);
    expect(enc).not.toContain("secretkeymaterial");
    expect(enc).not.toContain("BEGIN OPENSSH");
    expect(decryptSecret(enc)).toBe(SAMPLE_KEY);
  });

  it("enciphers sshKey alongside password on serialization", () => {
    const nodes = [{
      id: "d1",
      type: "device",
      position: { x: 0, y: 0 },
      data: { label: "Core", deviceType: "dsp", ports: [], password: "hunter2", sshKey: SAMPLE_KEY },
    }];
    const out = withEncryptedSecrets(nodes);
    const blob = JSON.stringify(out);
    expect(blob).not.toContain("hunter2");
    expect(blob).not.toContain("secretkeymaterial");
    expect(isEncrypted(out[0].data.sshKey!)).toBe(true);
    // live store keeps plaintext for the editor
    expect(nodes[0].data.sshKey).toBe(SAMPLE_KEY);
  });

  it("completes the save→load cycle for both secrets", () => {
    const saved = JSON.parse(JSON.stringify(withEncryptedSecrets([{
      id: "d1",
      type: "device",
      position: { x: 0, y: 0 },
      data: { label: "Core", deviceType: "dsp", ports: [], password: "pw", sshKey: SAMPLE_KEY },
    }])));
    decryptNodeSecrets(saved);
    expect(saved[0].data.password).toBe("pw");
    expect(saved[0].data.sshKey).toBe(SAMPLE_KEY);
  });

  it("enciphers an sshKey even when no password is set", () => {
    const nodes = [{
      id: "d1", type: "device", position: { x: 0, y: 0 },
      data: { label: "Core", deviceType: "dsp", ports: [], sshKey: SAMPLE_KEY },
    }];
    expect(isEncrypted(withEncryptedSecrets(nodes)[0].data.sshKey!)).toBe(true);
  });
});
