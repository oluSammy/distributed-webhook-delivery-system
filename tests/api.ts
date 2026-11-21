import worker from "../apps/api/src/index.ts";
import { TEST_DATABASE_URL } from "./db.ts";

// The API Worker, called in-process with stand-in bindings: Hyperdrive is the test database, and
// waking the dispatcher does nothing. Work the Worker leaves for after the response (waitUntil) is
// collected, and finished before api() returns.
const env = {
  HYPERDRIVE: { connectionString: TEST_DATABASE_URL },
  DISPATCHER: { getByName: () => ({ wake: async () => {} }) },
  ALLOW_LOCAL_ENDPOINTS: "true",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  DASHBOARD_URL: "http://dashboard.test",
} as unknown as Env;

export async function api(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${key}`);
  headers.set("content-type", "application/json");
  return call(path, { ...init, headers });
}

// A request with no API key, as a browser sends it: for the sign-in routes.
export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const response = await worker.fetch(new Request(`http://api.test${path}`, init), env, ctx);
  await Promise.all(pending);
  return response;
}
