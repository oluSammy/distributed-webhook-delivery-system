// end to end, against a running system: creates endpoints on the test
// consumer, sends one event, waits until every delivery has finished, then checks each outcome,
// each attempt, and the signature the consumer received. Exits with 1 when any check fails.
//
// WDS_SMOKE_KEY   the Smoke tenant's API key (printed by pnpm seed); required
// WDS_API_URL     default http://localhost:8787
// WDS_CONSUMER_URL  default http://localhost:4000

import { setTimeout as sleep } from "node:timers/promises";
import { verifyWebhook } from "@wds/core";

const API_URL = process.env.WDS_API_URL ?? "http://localhost:8787";
const CONSUMER_URL = process.env.WDS_CONSUMER_URL ?? "http://localhost:4000";
const API_KEY = process.env.WDS_SMOKE_KEY;
const EVENT_TYPE = "smoke.test";
const TIMEOUT_MS = 3 * 60_000;
const POLL_MS = 2000;

// What each endpoint must end with, given the Smoke tenant's policy (3 attempts).
const CASES = [
  { path: "/ok", state: "succeeded", reason: null, statuses: [200] },
  { path: "/500-then-200?after=2", state: "succeeded", reason: null, statuses: [500, 500, 200] },
  { path: "/fail-rate?p=1", state: "dead", reason: "max_attempts", statuses: [500, 500, 500] },
  { path: "/gone", state: "dead", reason: "gone", statuses: [410] },
];

type Delivery = {
  id: string;
  endpoint_id: string;
  state: string;
  failure_reason: string | null;
};

type DeliveryWithAttempts = Delivery & {
  attempts: { response_status: number | null; error_kind: string | null }[];
};

type Received = {
  count: number;
  request: { id: string; timestamp: string; signature: string; body: string } | null;
};

if (!API_KEY) {
  console.error("Set WDS_SMOKE_KEY to the Smoke tenant's API key (pnpm seed prints it)");
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

// Polls the event's deliveries until each endpoint's has finished, or the time is up.
async function waitForDeliveries(eventId: string, endpointIds: string[]) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const { deliveries } = await api<{ deliveries: Delivery[] }>(
      "GET",
      `/api/deliveries?event_id=${eventId}`,
    );
    const ours = new Map(
      deliveries.filter((d) => endpointIds.includes(d.endpoint_id)).map((d) => [d.endpoint_id, d]),
    );
    const finished = [...ours.values()].filter((d) => d.state !== "pending").length;
    if (finished === endpointIds.length || Date.now() > deadline) {
      return ours;
    }
    await sleep(POLL_MS);
  }
}

// Endpoints from earlier runs still exist and receive this run's event too. A run ID in each URL
// keeps their receipts apart in the consumer, which counts by webhook-id and URL.
const run = crypto.randomUUID();
console.log(`smoke run ${run}: API ${API_URL}, consumer ${CONSUMER_URL}\n`);

const endpoints = [];
for (const expected of CASES) {
  const url = new URL(expected.path, CONSUMER_URL);
  url.searchParams.set("run", run);
  const created = await api<{ id: string; signing_secret: string }>("POST", "/api/endpoints", {
    url: url.toString(),
    description: `smoke ${expected.path}`,
    subscriptions: [EVENT_TYPE],
  });
  endpoints.push({ ...expected, url, id: created.id, secret: created.signing_secret });
}

const event = await api<{ id: string }>("POST", "/api/events", {
  type: EVENT_TYPE,
  payload: { run },
});

console.log(`event ${event.id} sent, waiting for ${endpoints.length} deliveries…\n`);
const started = Date.now();
const deliveries = await waitForDeliveries(
  event.id,
  endpoints.map((e) => e.id),
);
console.log(`finished after ${Math.round((Date.now() - started) / 1000)} s\n`);

for (const endpoint of endpoints) {
  const summary = deliveries.get(endpoint.id);
  if (!summary) {
    check(false, `${endpoint.path}: a delivery was created`);
    continue;
  }
  const delivery = await api<DeliveryWithAttempts>("GET", `/api/deliveries/${summary.id}`);
  const ending = delivery.failure_reason
    ? `${delivery.state} (${delivery.failure_reason})`
    : delivery.state;
  const wanted = endpoint.reason ? `${endpoint.state} (${endpoint.reason})` : endpoint.state;
  check(ending === wanted, `${endpoint.path}: ${ending}, expected ${wanted}`);
  // The HTTP status, or what went wrong when there was no response (timeout, connection refused).
  const statuses = delivery.attempts.map((a) => a.response_status ?? a.error_kind);
  check(
    statuses.join() === endpoint.statuses.join(),
    `${endpoint.path}: attempts ${statuses.join(", ")}, expected ${endpoint.statuses.join(", ")}`,
  );
}

// The consumer kept the request it received; verify it as a customer would, with the secret the
// API returned when the endpoint was created.
const ok = endpoints[0];
if (ok) {
  const path = ok.url.pathname + ok.url.search;
  const lookup = new URLSearchParams({ webhook_id: event.id, path });
  const received = await fetch(`${CONSUMER_URL}/_received?${lookup}`)
    .then((response) => response.json() as Promise<Received>)
    .catch((error: Error): Received => {
      console.log(`consumer lookup failed: ${error.message}`);
      return { count: 0, request: null };
    });
  check(received.count === 1, `${ok.path}: received ${received.count} time(s), expected 1`);
  const valid =
    received.request !== null &&
    (await verifyWebhook(
      {
        id: received.request.id,
        timestamp: Number(received.request.timestamp),
        body: received.request.body,
      },
      received.request.signature,
      [ok.secret],
    ));
  check(valid, `${ok.path}: signature valid with the endpoint's secret`);
}

console.log(failures === 0 ? "\nsmoke passed" : `\nsmoke FAILED: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
