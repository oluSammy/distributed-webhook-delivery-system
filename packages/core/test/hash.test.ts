import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "../src/hash.ts";

describe("generateApiKey", () => {
  it("creates a tenant key with the live prefix and a visible prefix", async () => {
    const { key, prefix } = await generateApiKey("tenant");
    expect(key).toMatch(/^whk_live_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(key.slice(0, 13));
  });

  it("creates an operator key with the operator prefix", async () => {
    const { key } = await generateApiKey("operator");
    expect(key.startsWith("whk_op_")).toBe(true);
  });

  it("stores a hash that matches hashing the key again", async () => {
    const { key, hash } = await generateApiKey("tenant");
    expect(hash).toHaveLength(32);
    expect(await hashApiKey(key)).toEqual(hash);
  });

  it("never repeats a key", async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add((await generateApiKey("tenant")).key);
    expect(keys.size).toBe(100);
  });
});
