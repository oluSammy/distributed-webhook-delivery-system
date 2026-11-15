// Ingest load test (k6): how many events a second the API Worker accepts, and how fast it answers.
// 1. single: one event per request (POST /api/events), the arrival rate stepping up 25 → 200/s.
// 2. batch: 100 events per request (POST /api/events/batch), 10 requests/s (1,000 events/s).
// Events are bench.ingest, a type no endpoint subscribes to, so only ingest is measured.
//
// Once, register the type for the Smoke tenant:
//   docker exec wds-postgres-1 psql -U webhooks -d webhooks -c "insert into event_types (tenant_id, name) select id, 'bench.ingest' from tenants where name = 'Smoke' on conflict do nothing"
// Then, with pnpm dev:bench running:
//   k6 run -e KEY=$WDS_SMOKE_KEY bench/ingest.js
//
// KEY   the Smoke tenant's API key; required
// API   default http://localhost:8787
import { check } from "k6";
import http from "k6/http";

const API = __ENV.API || "http://localhost:8787";
const headers = { authorization: `Bearer ${__ENV.KEY}`, "content-type": "application/json" };

export const options = {
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  scenarios: {
    single: {
      executor: "ramping-arrival-rate",
      exec: "single",
      startRate: 25,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 300,
      stages: [
        { target: 25, duration: "20s" },
        { target: 50, duration: "20s" },
        { target: 100, duration: "20s" },
        { target: 200, duration: "20s" },
        { target: 200, duration: "20s" },
      ],
    },
    batch: {
      executor: "constant-arrival-rate",
      exec: "batch",
      startTime: "110s",
      rate: 10,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  // Correctness, not speed: under 1% of requests may fail. Speed is read from the summary.
  thresholds: {
    "http_req_failed{scenario:single}": ["rate<0.01"],
    "http_req_failed{scenario:batch}": ["rate<0.01"],
    "http_req_duration{scenario:single}": ["p(99)>=0"],
    "http_req_duration{scenario:batch}": ["p(99)>=0"],
  },
};

export function single() {
  const body = JSON.stringify({ type: "bench.ingest", payload: { at: Date.now() } });
  const res = http.post(`${API}/api/events`, body, { headers });
  check(res, { 202: (r) => r.status === 202 });
}

export function batch() {
  const events = Array.from({ length: 100 }, (_, n) => ({ type: "bench.ingest", payload: { n } }));
  const res = http.post(`${API}/api/events/batch`, JSON.stringify({ events }), { headers });
  check(res, { 202: (r) => r.status === 202 });
}
