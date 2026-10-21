import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("creator worker", () => {
  it("returns 404 for plain HTTP requests", async () => {
    const res = await exports.default.fetch("https://creator.internal/");
    expect(res.status).toBe(404);
  });
});
