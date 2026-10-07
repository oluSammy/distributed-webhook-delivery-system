import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateSigningSecret,
  importMasterKey,
  type MasterKey,
} from "../src/crypto.ts";
import { randomBytes, toBase64 } from "../src/encoding.ts";

async function newMaster(version: number): Promise<MasterKey> {
  return importMasterKey(toBase64(randomBytes(32)), version);
}

describe("signing secret encryption", () => {
  it("round-trips a secret", async () => {
    const master = await newMaster(1);
    const secret = generateSigningSecret();
    const encrypted = await encryptSecret(secret, "endpoint-1", master);
    const masters = new Map([[1, master]]);
    expect(await decryptSecret(encrypted, "endpoint-1", masters)).toBe(secret);
  });

  it("produces the documented sizes", async () => {
    const encrypted = await encryptSecret(generateSigningSecret(), "e", await newMaster(1));
    expect(encrypted.secretIv).toHaveLength(12);
    expect(encrypted.dekIv).toHaveLength(12);
    expect(encrypted.dekCiphertext).toHaveLength(48);
  });

  it("fails if the ciphertext is moved to another endpoint", async () => {
    const master = await newMaster(1);
    const encrypted = await encryptSecret(generateSigningSecret(), "endpoint-1", master);
    await expect(decryptSecret(encrypted, "endpoint-2", new Map([[1, master]]))).rejects.toThrow();
  });

  it("fails if the ciphertext was tampered with", async () => {
    const master = await newMaster(1);
    const encrypted = await encryptSecret(generateSigningSecret(), "e", master);
    encrypted.secretCiphertext[0] = (encrypted.secretCiphertext[0] ?? 0) ^ 1;
    await expect(decryptSecret(encrypted, "e", new Map([[1, master]]))).rejects.toThrow();
  });

  it("fails clearly when the master key version is unknown", async () => {
    const encrypted = await encryptSecret(generateSigningSecret(), "e", await newMaster(2));
    await expect(decryptSecret(encrypted, "e", new Map())).rejects.toThrow("version 2");
  });

  it("rejects a master key that is not 32 bytes", async () => {
    await expect(importMasterKey(toBase64(randomBytes(16)), 1)).rejects.toThrow("32 bytes");
  });
});
