// 1. Kill: kills the whole stack (every Worker at once) while the Delivery Worker is in the middle
//    of a send, starts it again, and checks that the delivery is claimed again once its lease runs
//    out, and succeeds. The test consumer receives it twice: at-least-once.
// 2. Postgres restart: restarts the database while events are being sent, and checks that every
//    event the API accepted (202) is stored and delivered.

// It starts and stops the stack itself, so stop pnpm dev (T1) first. The test consumer
// (pnpm consumer, T2) must be running. Exits with 1 when any check fails.
//
// WDS_SMOKE_KEY   the Smoke tenant's API key (printed by pnpm seed); required
// WDS_SMOKE_KEY   the Smoke tenant's API key (printed by pnpm seed); required
// DATABASE_URL    the local database, for the checks the API doesn't show; required
// WDS_API_URL     default http://localhost:8787
// WDS_CONSUMER_URL  default http://localhost:4000
// WDS_PG_CONTAINER  the Postgres container to restart, default wds-postgres-1 (docker-compose.yml)

import { execFile, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import postgres from "postgres";

const API_URL = process.env.WDS_API_URL ?? "http://localhost:8787";
const CONSUMER_URL = process.env.WDS_CONSUMER_URL ?? "http://localhost:4000";
const API_KEY = process.env.WDS_SMOKE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const PG_CONTAINER = process.env.WDS_PG_CONTAINER ?? "wds-postgres-1";
const EVENT_TYPE = "chaos.test";
const ROOT = join(import.meta.dirname, "..");
const LOG = join(tmpdir(), "wds-chaos-dev.log");

// How long a claim lasts (LEASE_SECONDS in apps/delivery/src/claim.ts). After the kill, the
// delivery waits this long before it can be claimed again.
const LEASE_SECONDS = 90;

// The consumer holds each request this long before answering: long enough to kill the stack
// mid-send, and under the Delivery Worker's 10 s send timeout, so the resend succeeds.
const HOLD_MS = 8000;

// The Postgres restart: events are sent for SEND_MS by SENDERS loops at once, and the database
// is restarted RESTART_AFTER_MS in. Then every accepted event has DRAIN_MS to be delivered: enough
// for a lease (90 s) and a dispatcher retry after a failed tick (30 s).
const SEND_MS = 20_000;
const SENDERS = 4;
const RESTART_AFTER_MS = 5000;
const DRAIN_MS = 180_000;

if (!API_KEY || !DATABASE_URL) {
  console.error("Set WDS_SMOKE_KEY and DATABASE_URL (both are in .env after pnpm seed)");
  process.exit(1);
}

let failures = 0;
function check(passed: boolean, label: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) {
    failures++;
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(API_URL + path, {
    method,
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function isUp(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

// Waits until check() is true, or throws after timeoutMs.
async function waitFor(label: string, timeoutMs: number, check: () => Promise<boolean>) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await sleep(500);
  }
}

// Starts pnpm dev in its own process group, so one signal later stops all of it: pnpm, wrangler,
// and the workerd processes that run the Workers. Killing only wrangler leaves workerd running.
function startStack() {
  const log = openSync(LOG, "a");
  const port = new URL(API_URL).port || "8787";
  const child = spawn("pnpm", ["dev", "--port", port], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("pnpm dev did not start");
  }
  return {
    // SIGKILL: no clean shutdown, as when a machine dies. The group may already be gone.
    kill: () => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    },
  };
}

async function startAndWait() {
  const stack = startStack();
  await waitFor("the API to be ready", 120_000, () => isUp(`${API_URL}/readyz`));
  return stack;
}

if (await isUp(`${API_URL}/healthz`)) {
  console.error(`Something is already running on ${API_URL}: stop pnpm dev first`);
  process.exit(1);
}
if (!(await isUp(`${CONSUMER_URL}/ok`))) {
  console.error(`The test consumer isn't answering at ${CONSUMER_URL}: start pnpm consumer`);
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
// The chaos event type, registered for the Smoke tenant. Its own type keeps endpoints from earlier
// smoke runs (subscribed to smoke.test) out of this run.
await sql`
    insert into event_types (tenant_id, name)
    select tenant_id, ${EVENT_TYPE} from api_keys
    where key_hash = sha256(convert_to(${API_KEY}, 'UTF8')) and scope = 'tenant'
    on conflict do nothing
  `;

console.log(`starting the stack (log: ${LOG})`);
let stack = await startAndWait();
const endpointIds: string[] = [];
try {
  const run = crypto.randomUUID();
  const url = new URL(`/timeout?ms=${HOLD_MS}&run=${run}`, CONSUMER_URL);
  const endpoint = await api<{ id: string }>("POST", "/api/endpoints", {
    url: url.toString(),
    description: "chaos kill",
    subscriptions: [EVENT_TYPE],
  });
  endpointIds.push(endpoint.id);
  const event = await api<{ id: string }>("POST", "/api/events", {
    type: EVENT_TYPE,
    payload: { run },
  });

  // How many times the consumer has received this webhook at this URL.
  const lookup = new URLSearchParams({ webhook_id: event.id, path: url.pathname + url.search });
  const received = async () =>
    ((await (await fetch(`${CONSUMER_URL}/_received?${lookup}`)).json()) as { count: number })
      .count;

  // The delivery's row, its queue row, and how many attempts are recorded.
  const delivery = async () => {
    const [row] = await sql<{ state: string; claimed: boolean | null; attempts: number }[]>`
        select d.state, q.claim_token is not null as claimed,
               (select count(*) from delivery_attempts a where a.delivery_id = d.id)::int as attempts
        from deliveries d
        left join delivery_queue q on q.delivery_id = d.id
        where d.event_id = ${event.id} and d.endpoint_id = ${endpoint.id}
      `;
    return row;
  };

  await waitFor("the consumer to receive the webhook", 30_000, async () => (await received()) > 0);
  stack.kill();
  const killedAt = Date.now();
  await waitFor("the stack to stop", 10_000, async () => !(await isUp(`${API_URL}/healthz`)));
  console.log("killed the stack mid-send\n");

  const afterKill = await delivery();
  check(
    afterKill?.state === "pending",
    `after the kill: delivery ${afterKill?.state}, expected pending`,
  );
  check(afterKill?.claimed === true, "after the kill: still claimed by the killed run");
  check(
    afterKill?.attempts === 0,
    `after the kill: ${afterKill?.attempts} attempt(s) recorded, expected 0`,
  );

  console.log("\nstarting the stack again; the lease ends in about 90 s");
  stack = await startAndWait();
  await waitFor("the delivery to finish", (LEASE_SECONDS + 60) * 1000, async () => {
    return (await delivery())?.state !== "pending";
  });
  const waited = Math.round((Date.now() - killedAt) / 1000);

  const finished = await delivery();
  check(finished?.state === "succeeded", `delivery ${finished?.state}, expected succeeded`);
  check(finished?.attempts === 1, `${finished?.attempts} attempt(s) recorded, expected 1`);
  check(
    waited >= LEASE_SECONDS - 5,
    `sent again ${waited} s after the kill, not before the lease ended`,
  );
  const count = await received();
  check(
    count === 2,
    `the consumer received it ${count} time(s), expected 2 (once before the kill)`,
  );

  // Done with it: it would get the restart's events too, and hold each one for HOLD_MS.
  await api("DELETE", `/api/endpoints/${endpoint.id}`);

  console.log("\nPostgres restart: sending events while the database restarts");
  const restartRun = crypto.randomUUID();
  const okEndpoint = await api<{ id: string }>("POST", "/api/endpoints", {
    url: new URL(`/ok?run=${restartRun}`, CONSUMER_URL).toString(),
    description: "chaos restart",
    subscriptions: [EVENT_TYPE],
  });
  endpointIds.push(okEndpoint.id);

  // Each loop sends one event at a time until SEND_MS is up. accepted: the ids the API answered
  // 202 for; refused: requests that failed (an error status, or no answer).
  const accepted: string[] = [];
  let refused = 0;
  const sendUntil = Date.now() + SEND_MS;
  const sendLoop = async () => {
    while (Date.now() < sendUntil) {
      try {
        const event = await api<{ id: string }>("POST", "/api/events", {
          type: EVENT_TYPE,
          payload: { run: restartRun },
        });
        accepted.push(event.id);
      } catch {
        refused++;
        await sleep(100);
      }
    }
  };
  const sending = Promise.all(Array.from({ length: SENDERS }, sendLoop));
  await sleep(RESTART_AFTER_MS);
  await promisify(execFile)("docker", ["restart", PG_CONTAINER]);
  console.log(`restarted ${PG_CONTAINER}`);
  await sending;
  console.log(`${accepted.length} events accepted, ${refused} requests refused\n`);

  // What became of the accepted events: stored, deliveries created, delivered.
  const progress = async () => {
    const [row] = await sql<
      { stored: number; uncreated: number; deliveries: number; succeeded: number }[]
    >`
        select count(distinct e.id)::int as stored,
               count(distinct e.id) filter (where e.deliveries_created_at is null)::int as uncreated,
               count(d.id)::int as deliveries,
               count(d.id) filter (where d.state = 'succeeded')::int as succeeded
        from events e
        left join deliveries d on d.event_id = e.id and d.event_created_at = e.created_at
          and d.endpoint_id = ${okEndpoint.id}
        where e.id = any(${sql.array(accepted)}::uuid[])
      `;
    return row;
  };
  const drainStart = Date.now();
  let done = await progress();
  while ((done?.succeeded ?? 0) < accepted.length && Date.now() < drainStart + DRAIN_MS) {
    await sleep(2000);
    done = await progress();
  }
  console.log(`waited ${Math.round((Date.now() - drainStart) / 1000)} s for the deliveries`);

  check(refused > 0, `the restart was felt: ${refused} requests refused while it was down`);
  check(
    done?.stored === accepted.length,
    `${done?.stored} of ${accepted.length} accepted events stored`,
  );
  check(done?.uncreated === 0, `${done?.uncreated} stored events still without deliveries`);
  check(
    done?.deliveries === accepted.length,
    `${done?.deliveries} deliveries for ${accepted.length} events, expected one each`,
  );
  check(
    done?.succeeded === accepted.length,
    `${done?.succeeded} of ${accepted.length} deliveries succeeded`,
  );
  // A refused request may still have stored its event: the database committed, then the answer
  // was lost. That's not a loss, and the sender would send it again.
  const [stored] = await sql<{ count: number }[]>`
      select count(*)::int from events
      where payload ->> 'run' = ${restartRun} and created_at > now() - interval '1 hour'
    `;
  console.log(`(${(stored?.count ?? 0) - accepted.length} stored events had no 202 answer)`);
} finally {
  for (const id of endpointIds) {
    await api("DELETE", `/api/endpoints/${id}`).catch(() => {});
  }
  stack.kill();
  await sql.end();
}

console.log(failures === 0 ? "\nchaos passed" : `\nchaos FAILED: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
