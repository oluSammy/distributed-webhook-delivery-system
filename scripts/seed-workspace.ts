// Fills a person's own workspace with realistic data for the dashboard, through the running
// system: event types, endpoints on the test consumer that succeed, fail, throttle or are gone,
// and a few hundred events. The deliveries, attempts, retries and dead ones are then real: the
// Workers make them exactly as they would in production.
//
// pnpm seed:workspace <github-login> [events]
//   <github-login>  whose workspace: the tenant they own, made when they first signed in
//   [events]        how many events to send; 300 if left out
//
// DATABASE_URL      for what the API has no route for yet: event types, a key, the retry policy
// WDS_API_URL       default http://localhost:8787
// WDS_CONSUMER_URL  default http://localhost:4000
//
// Needs `pnpm dev` and `pnpm consumer` running. Running it again adds what's missing and sends
// more events.

import { setTimeout as sleep } from "node:timers/promises";
import { generateApiKey } from "@wds/core";
import postgres from "postgres";

const API_URL = process.env.WDS_API_URL ?? "http://localhost:8787";
const CONSUMER_URL = process.env.WDS_CONSUMER_URL ?? "http://localhost:4000";
const BATCH_SIZE = 50;
const BATCH_GAP_MS = 2000; // between batches, so the events don't all share one second

// Short, so failing deliveries die within minutes and every state shows up while you watch:
// 5 attempts, waits from 10 s up to 60 s, given up after 10 minutes (throttled ones too).
const RETRY_POLICY = { max_attempts: 5, base_seconds: 10, cap_seconds: 60, max_age_seconds: 600 };

const EVENT_TYPES = [
  "order.created",
  "order.paid",
  "order.refunded",
  "invoice.paid",
  "invoice.overdue",
  "customer.created",
  "customer.updated",
];

// Each endpoint is a route on the test consumer that behaves in one way.
const ENDPOINTS = [
  // Succeeds at once.
  { description: "Orders webhook", path: "/ok", subscriptions: ["order.*"] },
  // Fails 3 times in 10: most succeed after a retry or two; a few die.
  {
    description: "Billing service",
    path: "/fail-rate?p=0.3",
    subscriptions: ["order.paid", "invoice.*"],
  },
  // Fails 6 times in 10: lots of retries to watch, and about 1 delivery in 13 dies (0.6^5), while
  // the endpoint stays active (the circuit breaker only trips above 90% failures).
  {
    description: "Search indexer",
    path: "/fail-rate?p=0.6",
    subscriptions: ["order.created", "customer.*"],
  },
  // Always fails: the circuit breaker disables the endpoint, and its deliveries wait for it.
  { description: "CRM sync", path: "/fail-rate?p=1", subscriptions: ["customer.*"] },
  // Always answers 429: throttled tries, which don't use up attempts, until the 10 minutes run out.
  { description: "Analytics", path: "/429?retry_after=30", subscriptions: ["order.created"] },
  // Answers 410 Gone: dead at the first attempt, no retries; the breaker disables it soon after.
  { description: "Legacy ERP", path: "/gone", subscriptions: ["invoice.overdue"] },
];

const login = process.argv[2];
const eventCount = Number(process.argv[3] ?? 300);
if (!login || !Number.isInteger(eventCount) || eventCount < 1) {
  console.error("Usage: pnpm seed:workspace <github-login> [events]");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is missing (it's read from the root .env)");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  const [workspace] = await sql<{ id: string; name: string }[]>`
      select t.id, t.name
      from users u
      join memberships m on m.user_id = u.id and m.role = 'owner'
      join tenants t on t.id = m.tenant_id
      where u.login = ${login}
      order by m.created_at
      limit 1
    `;
  if (!workspace) {
    console.error(`${login} owns no workspace yet: sign in to the dashboard once, then run this.`);
    process.exit(1);
  }

  await sql`update tenants set retry_policy = ${sql.json(RETRY_POLICY)} where id = ${workspace.id}`;
  for (const type of EVENT_TYPES) {
    await sql`
        insert into event_types (tenant_id, name) values (${workspace.id}, ${type})
        on conflict (tenant_id, name) do nothing
      `;
  }
  const key = await generateApiKey("tenant");
  await sql`
      insert into api_keys (tenant_id, scope, key_prefix, key_hash)
      values (${workspace.id}, 'tenant', ${key.prefix}, ${key.hash})
    `;

  const created = await createMissingEndpoints(key.key);
  await sendEvents(key.key);

  console.log(`Workspace: ${workspace.name} (${workspace.id})`);
  console.log(`Retry policy: ${JSON.stringify(RETRY_POLICY)}`);
  console.log(`Endpoints created: ${created.length ? created.join(", ") : "none (all there)"}`);
  console.log(`Events sent: ${eventCount}`);
  console.log(`API key, shown once: ${key.key}`);
  console.log("\nDeliveries keep changing for about 10 minutes as retries run and some die.");
} finally {
  await sql.end();
}

// Creates the endpoints the workspace doesn't have yet (matched by description). Their signing
// secrets aren't printed: nothing here checks signatures.
async function createMissingEndpoints(key: string): Promise<string[]> {
  const { endpoints } = (await callApi(key, "GET", "/api/endpoints")) as {
    endpoints: { description: string }[];
  };
  const existing = new Set(endpoints.map((endpoint) => endpoint.description));
  const created = [];
  for (const endpoint of ENDPOINTS) {
    if (existing.has(endpoint.description)) {
      continue;
    }
    await callApi(key, "POST", "/api/endpoints", {
      url: CONSUMER_URL + endpoint.path,
      description: endpoint.description,
      subscriptions: endpoint.subscriptions,
    });
    created.push(endpoint.description);
  }
  return created;
}

async function sendEvents(key: string): Promise<void> {
  for (let sent = 0; sent < eventCount; sent += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, eventCount - sent);
    const events = Array.from({ length: size }, () => sampleEvent());
    await callApi(key, "POST", "/api/events/batch", { events });
    if (sent + size < eventCount) {
      await sleep(BATCH_GAP_MS);
    }
  }
}

// An event of a random type, with a payload like a real shop's.
function sampleEvent(): { type: string; payload: Record<string, unknown> } {
  const type = pick(EVENT_TYPES);
  const customer = `cus_${randomId()}`;
  if (type.startsWith("order.")) {
    return {
      type,
      payload: {
        order_id: `ord_${randomId()}`,
        customer_id: customer,
        amount: 500 + Math.floor(Math.random() * 20_000), // in cents
        currency: pick(["USD", "EUR", "GBP", "NGN"]),
      },
    };
  }
  if (type.startsWith("invoice.")) {
    return {
      type,
      payload: {
        invoice_id: `in_${randomId()}`,
        customer_id: customer,
        amount_due: 1000 + Math.floor(Math.random() * 50_000),
        due_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      },
    };
  }
  const n = Math.floor(Math.random() * 10_000);
  return {
    type,
    payload: { customer_id: customer, email: `customer${n}@example.com`, name: `Customer ${n}` },
  };
}

async function callApi(
  key: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(API_URL + path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 8);
}
