import { createRoute, z } from "@hono/zod-openapi";
import { firstRow, parseRetryPolicy, retryPolicySchema } from "@wds/core";
import { requireOwner } from "../middleware/auth";
import { createRouter } from "../router";

// The policy with every field filled in: what the Delivery Worker uses.
const RetryPolicy = z.object({
  base_seconds: z.number(), // the first retry waits up to this; each later one up to twice as long
  cap_seconds: z.number(), // ... but never more than this
  max_attempts: z.number(), // gives up (dead, max_attempts) after this many failed attempts
  max_age_seconds: z.number(), // ... or this long after the delivery was made (dead, max_age)
});

const getPolicy = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "How failed deliveries are retried, with the defaults filled in",
      content: { "application/json": { schema: RetryPolicy } },
    },
  },
});

const setPolicy = createRoute({
  method: "put",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: retryPolicySchema } } },
  },
  responses: {
    200: {
      description:
        "The new policy. A field left out takes its default. It applies from each delivery's next attempt, including deliveries already waiting. Owners only, signed in.",
      content: { "application/json": { schema: RetryPolicy } },
    },
  },
});

export const retryPolicy = createRouter();

retryPolicy.openapi(getPolicy, async (c) => {
  const row = firstRow(
    await c.get("sql")<{ retry_policy: unknown }[]>`
        select retry_policy from tenants where id = ${c.get("tenantId")}
      `,
  );
  return c.json(parseRetryPolicy(row.retry_policy), 200);
});

// Stores every field, defaults included, so the stored policy says exactly what's used even if a
// default changes later.
retryPolicy.openapi(setPolicy, async (c) => {
  await requireOwner(c);
  const policy = c.req.valid("json");
  const sql = c.get("sql");
  await sql`update tenants set retry_policy = ${sql.json(policy)} where id = ${c.get("tenantId")}`;
  return c.json(policy, 200);
});
