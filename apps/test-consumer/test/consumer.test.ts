import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Sends one webhook to the consumer, with a webhook-id so receipts can be counted. Like the
// delivery Worker, it doesn't follow redirects.
function send(path: string, webhookId = crypto.randomUUID()) {
  return exports.default.fetch(`http://consumer.test${path}`, {
    method: "POST",
    headers: { "webhook-id": webhookId },
    body: "{}",
    redirect: "manual",
  });
}

describe("test consumer", () => {
  it("answers each route with its status", async () => {
    expect((await send("/ok")).status).toBe(200);
    expect((await send("/fail-rate?p=1")).status).toBe(500);
    expect((await send("/fail-rate?p=0")).status).toBe(200);
    expect((await send("/gone")).status).toBe(410);
    expect((await send("/nope")).status).toBe(404);
  });

  it("fails the first `after` receipts of a webhook, then succeeds", async () => {
    const id = crypto.randomUUID();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await send("/500-then-200?after=2", id)).status);
    }
    expect(statuses).toEqual([500, 500, 200, 200]);
    expect((await send("/500-then-200?after=2")).status).toBe(500); // another webhook starts again
  });

  it("sends Retry-After with a 429 when asked", async () => {
    const res = await send("/429?retry_after=7");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect((await send("/429")).headers.get("retry-after")).toBeNull();
  });

  it("redirects without following", async () => {
    const res = await send("/redirect");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://consumer.test/ok");
  });

  it("tells what arrived at a path", async () => {
    const id = crypto.randomUUID();
    await send("/ok", id);
    await send("/ok", id);
    const lookup = (path: string) =>
      exports.default.fetch(
        `http://consumer.test/_received?${new URLSearchParams({ webhook_id: id, path })}`,
      );
    expect(await (await lookup("/ok")).json()).toEqual({
      count: 2,
      request: { id, timestamp: null, signature: null, body: "{}" },
    });
    expect(await (await lookup("/gone")).json()).toEqual({ count: 0, request: null });
  });
});
