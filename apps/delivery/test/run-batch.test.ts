import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("delivery worker", () => {
  it("runBatch reports an empty batch", async () => {
    const result = await exports.default.runBatch(0);
    expect(result).toEqual({ claimed: 0, fullBatch: false, nextDueAt: null });
  });

  it("returns 404 for plain HTTP requests", async () => {
    const res = await exports.default.fetch("https://delivery.internal/");
    expect(res.status).toBe(404);
  });
});
