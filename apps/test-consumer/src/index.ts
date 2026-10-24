import { DurableObject } from "cloudflare:workers";
import { verifyWebhook } from "@wds/core";

// A webhook consumer that misbehaves on command, for tests and demos. The path picks what it does:
//   /ok                     200
//   /fail-rate?p=0.5        500 with probability p, otherwise 200
//   /timeout?ms=15000       200, after waiting ms
//   /hang                   no answer for 10 minutes
//   /500-then-200?after=3   500 for the first `after` receipts of each webhook, then 200
//   /slow-drip?seconds=20   200 at once, then the body one byte a second (&status= to change it)
//   /429?retry_after=30     429, with a Retry-After header when retry_after is given
//   /redirect               302 to /ok (the sender must not follow it)
//   /gone                   410
// GET /_received?webhook_id=…&path=/ok tells what arrived at a path: how many times, and the last
// request (headers and body), so the smoke script can check its signature with the endpoint's secret.
// It checks each signature when WHSEC is set, and logs a webhook that arrives again after it was
// already answered 2xx: a duplicate, which at-least-once delivery allows.

const HANG_MS = 10 * 60_000;
const encoder = new TextEncoder();

type Receipt = {
  count: number; // receipts of this webhook at this URL, this one included
  answeredOk: boolean; // an earlier receipt was answered 2xx
};

// The parts of a request needed to verify its signature.
type ReceivedRequest = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
};

// Remembers the webhooks received, keyed by webhook-id and URL: one event goes to every matching
// endpoint with the same webhook-id. One instance holds them all, in SQLite storage, so counts
// survive restarts and /500-then-200 still works when retries are hours apart.
export class ReceivedLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      create table if not exists received (
        key text primary key,
        count integer not null,
        answered_ok integer not null default 0
      )
    `);
    ctx.storage.sql.exec(`
      create table if not exists last_request (
        key text primary key,
        request text not null
      )
    `);
  }

  arrived(key: string, request: ReceivedRequest): Receipt {
    this.ctx.storage.sql.exec(
      `insert into last_request (key, request) values (?, ?)
       on conflict (key) do update set request = excluded.request`,
      key,
      JSON.stringify(request),
    );
    const row = this.ctx.storage.sql
      .exec<{ count: number; answered_ok: number }>(
        `insert into received (key, count) values (?, 1)
         on conflict (key) do update set count = count + 1
         returning count, answered_ok`,
        key,
      )
      .one();
    return { count: row.count, answeredOk: row.answered_ok === 1 };
  }

  answeredOk(key: string): void {
    this.ctx.storage.sql.exec("update received set answered_ok = 1 where key = ?", key);
  }

  lookup(key: string): { count: number; request: ReceivedRequest | null } {
    const [row] = this.ctx.storage.sql
      .exec<{ count: number; request: string | null }>(
        `select r.count, l.request
         from received r
         left join last_request l using (key)
         where r.key = ?`,
        key,
      )
      .toArray();
    return {
      count: row?.count ?? 0,
      request: row?.request ? (JSON.parse(row.request) as ReceivedRequest) : null,
    };
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const log = env.RECEIVED.getByName("all");
    if (url.pathname === "/_received") {
      const id = url.searchParams.get("webhook_id");
      return Response.json(await log.lookup(`${id} ${url.searchParams.get("path")}`));
    }

    const body = await request.text();
    const webhookId = request.headers.get("webhook-id");
    const key = `${webhookId} ${url.pathname}${url.search}`;

    const receipt = await log.arrived(key, {
      id: webhookId,
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
      body,
    });
    const signature = await checkSignature(request.headers, body, env.WHSEC);
    console.log(
      `${request.method} ${url.pathname}${url.search}  id ${webhookId}` +
        `  attempt ${request.headers.get("webhook-attempt")}  signature ${signature}` +
        (receipt.answeredOk ? "  DUPLICATE (already answered 2xx)" : ""),
    );

    const response = await respond(url, receipt.count);
    if (response.ok) {
      ctx.waitUntil(log.answeredOk(key));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

async function checkSignature(headers: Headers, body: string, whsec: string): Promise<string> {
  const secrets = whsec.split(/\s+/).filter(Boolean);
  if (secrets.length === 0) {
    return "not checked (WHSEC is empty)";
  }
  const message = {
    id: headers.get("webhook-id") ?? "",
    timestamp: Number(headers.get("webhook-timestamp")),
    body,
  };
  const valid = await verifyWebhook(message, headers.get("webhook-signature") ?? "", secrets);
  return valid ? "valid" : "INVALID";
}

async function respond(url: URL, count: number): Promise<Response> {
  switch (url.pathname) {
    case "/ok":
      return new Response("ok");
    case "/fail-rate":
      return Math.random() < param(url, "p", 0.5)
        ? new Response("failing on purpose", { status: 500 })
        : new Response("ok");
    case "/timeout":
      await scheduler.wait(param(url, "ms", 15_000));
      return new Response("ok, but late");
    case "/hang":
      await scheduler.wait(HANG_MS);
      return new Response("ok, much later");
    case "/500-then-200": {
      const after = param(url, "after", 3);
      return count <= after
        ? new Response(`failing ${count} of ${after}`, { status: 500 })
        : new Response("ok");
    }
    case "/slow-drip":
      return slowDrip(param(url, "seconds", 20), param(url, "status", 200));
    case "/429": {
      const retryAfter = url.searchParams.get("retry_after");
      const headers = retryAfter === null ? undefined : { "retry-after": retryAfter };
      return new Response("slow down", { status: 429, headers });
    }
    case "/redirect":
      return Response.redirect(new URL("/ok", url).toString(), 302);
    case "/gone":
      return new Response("gone", { status: 410 });
    default:
      return new Response("no such route", { status: 404 });
  }
}

// A number from the query string, or the fallback when it's missing or not a number.
function param(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name) ?? Number.NaN);
  return Number.isFinite(value) ? value : fallback;
}

// The status and headers go out at once; the body follows one byte a second.
function slowDrip(seconds: number, status: number): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const drip = async () => {
    for (let i = 0; i < seconds; i++) {
      await writer.write(encoder.encode("."));
      await scheduler.wait(1000);
    }
    await writer.close();
  };
  drip().catch(() => {}); // the sender stopped reading
  return new Response(readable, { status });
}
