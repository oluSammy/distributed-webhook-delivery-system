import worker from "../apps/api/src/index.ts";
import { TEST_DATABASE_URL } from "./db.ts";

// The API Worker, called in-process with stand-in bindings: Hyperdrive is the test database, and
// waking the dispatcher does nothing. Work the Worker leaves for after the response (waitUntil) is
// collected, and finished before api() returns.
const env = {
  HYPERDRIVE: { connectionString: TEST_DATABASE_URL },
  DISPATCHER: { getByName: () => ({ wake: async () => {} }) },
  ALLOW_LOCAL_ENDPOINTS: "true",
} as unknown as Env;

export async function api(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${key}`);
  headers.set("content-type", "application/json");
  const response = await worker.fetch(
    new Request(`http://api.test${path}`, { ...init, headers }),
    env,
    ctx,
  );
  await Promise.all(pending);
  return response;
}
