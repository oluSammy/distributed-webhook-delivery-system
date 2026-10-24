import { describe, expect, it } from "vitest";
import { signWebhook, TIMESTAMP_TOLERANCE_SECONDS, verifyWebhook } from "../src/signing.ts";

// The test vector from the Standard Webhooks specification
const vector = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  message: {
    id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
    timestamp: 1614265330,
    body: '{"test": 2432232314}',
  },
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("signWebhook", () => {
  it("matches the Standard Webhooks test vector", async () => {
    expect(await signWebhook(vector.message, [vector.secret])).toBe(vector.signature);
  });

  it("signs with every secret, separated by spaces", async () => {
    const other = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
    const header = await signWebhook(vector.message, [vector.secret, other]);
    const [first, second] = header.split(" ");
    expect(first).toBe(vector.signature);
    expect(second).toBe(await signWebhook(vector.message, [other]));
    expect(second).not.toBe(first);
  });

  it("changes when any signed part changes", async () => {
    const changed = [
      { ...vector.message, id: "msg_other" },
      { ...vector.message, timestamp: vector.message.timestamp + 1 },
      { ...vector.message, body: '{"test": 2432232315}' },
    ];
    for (const message of changed) {
      expect(await signWebhook(message, [vector.secret])).not.toBe(vector.signature);
    }
  });

  it("rejects a missing or malformed secret", async () => {
    await expect(signWebhook(vector.message, [])).rejects.toThrow("at least one");
    await expect(signWebhook(vector.message, ["not-a-secret"])).rejects.toThrow("whsec_");
  });
});

describe("verifyWebhook", () => {
  const now = vector.message.timestamp;
  const other = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

  it("accepts the Standard Webhooks test vector", async () => {
    expect(await verifyWebhook(vector.message, vector.signature, [vector.secret], now)).toBe(true);
  });

  it("accepts a match on any secret and any signature in the header", async () => {
    const header = `v1,bm90IGEgc2lnbmF0dXJl ${vector.signature}`;
    expect(await verifyWebhook(vector.message, header, [other, vector.secret], now)).toBe(true);
  });

  it("rejects a changed body, the wrong secret or a malformed header", async () => {
    const changed = { ...vector.message, body: '{"test": 2432232315}' };
    expect(await verifyWebhook(changed, vector.signature, [vector.secret], now)).toBe(false);
    expect(await verifyWebhook(vector.message, vector.signature, [other], now)).toBe(false);
    for (const header of ["", "v1,", "v1,%%%", vector.signature.replace("v1,", "v2,")]) {
      expect(await verifyWebhook(vector.message, header, [vector.secret], now)).toBe(false);
    }
  });

  it("rejects a timestamp outside the tolerance, or not a number", async () => {
    const tolerance = TIMESTAMP_TOLERANCE_SECONDS;
    const check = (at: number) =>
      verifyWebhook(vector.message, vector.signature, [vector.secret], at);
    expect(await check(now + tolerance)).toBe(true);
    expect(await check(now + tolerance + 1)).toBe(false);
    expect(await check(now - tolerance - 1)).toBe(false);
    const notANumber = { ...vector.message, timestamp: Number.NaN };
    expect(await verifyWebhook(notANumber, vector.signature, [vector.secret], now)).toBe(false);
  });
});
