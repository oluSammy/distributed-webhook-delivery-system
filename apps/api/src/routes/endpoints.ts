import { createRoute, z } from "@hono/zod-openapi";
import {
  checkEndpointTarget,
  encryptSecret,
  firstRow,
  generateSigningSecret,
  importMasterKey,
  type LimiterHealth,
} from "@wds/core";
import type { LimiterApi } from "@wds/limiter/contract";
import type { Sql } from "postgres";
import { wakeDispatcher } from "../dispatcher";
import { ApiError } from "../errors";
import { parkDeliveries, unparkDeliveries } from "../parking";
import { createRouter } from "../router";

const MAX_SUBSCRIPTIONS = 50;
const EndpointUrl = z.url().max(2048);

const SubscriptionPattern = z
  .string()
  .regex(
    /^(\*|[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?)$/,
    "Must be *, an event type, or a prefix ending in .*",
  );

const CreateEndpointBody = z.object({
  url: EndpointUrl,
  description: z.string().max(500).default(""),
  subscriptions: z.array(SubscriptionPattern).min(1).max(MAX_SUBSCRIPTIONS),
  rate_limit_per_s: z.number().int().min(1).max(10_000).default(50),
  concurrency_limit: z.number().int().min(1).max(100).default(5),
});

const Endpoint = z.object({
  id: z.string(),
  url: z.string(),
  description: z.string(),
  state: z.string(),
  subscriptions: z.array(z.string()),
  rate_limit_per_s: z.number(),
  concurrency_limit: z.number(),
  created_at: z.string(),
});

const CreatedEndpoint = Endpoint.extend({
  signing_secret: z.string(),
});

const EndpointParams = z.object({
  id: z.uuid(),
});

const createEndpoint = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: CreateEndpointBody } }, required: true },
  },
  responses: {
    201: {
      description: "Endpoint created. The signing secret is only shown in this response.",
      content: { "application/json": { schema: CreatedEndpoint } },
    },
  },
});

const listEndpoints = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "The tenant's endpoints",
      content: { "application/json": { schema: z.object({ endpoints: z.array(Endpoint) }) } },
    },
  },
});

const getEndpoint = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: EndpointParams },
  responses: {
    200: {
      description: "One endpoint",
      content: { "application/json": { schema: Endpoint } },
    },
  },
});

const pauseEndpoint = createRoute({
  method: "post",
  path: "/{id}/pause",
  request: { params: EndpointParams },
  responses: {
    200: {
      description: "The endpoint, paused: nothing is sent to it until it's resumed",
      content: { "application/json": { schema: Endpoint } },
    },
  },
});

const resumeEndpoint = createRoute({
  method: "post",
  path: "/{id}/resume",
  request: { params: EndpointParams },
  responses: {
    200: {
      description: "The endpoint, active again: its waiting deliveries are due now",
      content: { "application/json": { schema: Endpoint } },
    },
  },
});

const deleteEndpoint = createRoute({
  method: "delete",
  path: "/{id}",
  request: { params: EndpointParams },
  responses: {
    200: {
      description: "Endpoint deleted, and its pending deliveries cancelled",
      content: {
        "application/json": {
          schema: z.object({ id: z.string(), cancelled_deliveries: z.number() }),
        },
      },
    },
  },
});

// healthy: sending normally. degraded: the endpoint is throttling us, or at least half of the
// recent attempts failed. disabled: its breaker tripped. paused: it, its tenant or everything is.
const Health = z.enum(["healthy", "degraded", "disabled", "paused"]);

const EndpointHealth = z.object({
  id: z.string(),
  state: z.string(),
  health: Health,
  probe_at: z.string().nullable(), // disabled: when the next probe may go
  // What the endpoint's limiter knows, since it last started; null when it can't be reached.
  limiter: z
    .object({
      rate_limit_per_s: z.number(),
      current_rate_per_s: z.number(), // lower than the limit while recovering from a throttle
      concurrency_limit: z.number(),
      slots_in_use: z.number(),
      throttled_until: z.string().nullable(),
      breaker: z.string(),
      recent_attempts: z.number(), // the breaker's window: sent attempts in the last 10 minutes
      recent_failures: z.number(),
    })
    .nullable(),
});

const getEndpointHealth = createRoute({
  method: "get",
  path: "/{id}/health",
  request: { params: EndpointParams },
  responses: {
    200: {
      description: "How the endpoint is doing: its state in Postgres, and what its limiter sees",
      content: { "application/json": { schema: EndpointHealth } },
    },
  },
});

type HealthRow = {
  state: string;
  probe_at: Date | null;
  rate_limit_per_s: number;
  concurrency_limit: number;
  paused: boolean;
};

type EndpointRow = {
  id: string;
  url: string;
  description: string;
  state: string;
  subscriptions: string[];
  rate_limit_per_s: number;
  concurrency_limit: number;
  created_at: Date;
};

export const endpoints = createRouter();

endpoints.openapi(createEndpoint, async (c) => {
  const body = c.req.valid("json");
  const sql = c.get("sql");

  const tenantId = c.get("tenantId");

  let problem: string | null;
  try {
    problem = await checkEndpointTarget(body.url, {
      allowLocal: c.env.ALLOW_LOCAL_ENDPOINTS === "true",
    });
  } catch (err) {
    console.error("endpoint host lookup failed", err);
    throw new ApiError(
      503,
      "dns_lookup_failed",
      "Could not look up the endpoint host name, try again",
    );
  }
  if (problem !== null) {
    throw new ApiError(422, "endpoint_url_not_allowed", `Endpoint URL ${problem}`);
  }

  const master = await importMasterKey(c.env.MASTER_KEY_V1, 1);
  const patterns = [...new Set(body.subscriptions)];

  const { id, secret } = await sql.begin(async (tx) => {
    const { id } = firstRow(
      await tx<{ id: string }[]>`
              insert into endpoints (tenant_id, url, description, rate_limit_per_s, concurrency_limit)
              values (${tenantId}, ${body.url}, ${body.description},
                      ${body.rate_limit_per_s}, ${body.concurrency_limit})
              returning id
            `,
    );

    await tx`
          insert into endpoint_subscriptions (endpoint_id, event_type_pattern)
          select ${id}, pattern from jsonb_array_elements_text(${tx.json(patterns)}) as pattern
        `;

    const secret = generateSigningSecret();
    const encrypted = await encryptSecret(secret, id, master);
    await tx`
        insert into endpoint_secrets
          (endpoint_id, secret_ciphertext, secret_iv, dek_ciphertext, dek_iv, kek_version)
        values
          (${id}, ${encrypted.secretCiphertext}, ${encrypted.secretIv},
           ${encrypted.dekCiphertext}, ${encrypted.dekIv}, ${encrypted.kekVersion})
      `;

    return { id, secret };
  });

  const endpoint = firstRow(await selectEndpoints(sql, tenantId, id));
  return c.json({ ...toResponse(endpoint), signing_secret: secret }, 201);
});

endpoints.openapi(listEndpoints, async (c) => {
  const rows = await selectEndpoints(c.get("sql"), c.get("tenantId"));
  return c.json({ endpoints: rows.map(toResponse) }, 200);
});
endpoints.openapi(getEndpoint, async (c) => {
  const { id } = c.req.valid("param");
  return c.json(toResponse(await findEndpoint(c.get("sql"), c.get("tenantId"), id)), 200);
});

// Pausing a disabled endpoint replaces its breaker state, so probe_at goes too. The flag is set
// first, so the Delivery Worker parks anything claimed from now on, then the waiting deliveries
// are parked. Parking runs even if it was already paused, so a retry finishes the job.
endpoints.openapi(pauseEndpoint, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");
  await sql`
        update endpoints
        set state = 'paused', probe_at = null
        where id = ${id} and tenant_id = ${tenantId} and state in ('active', 'disabled')
      `;
  const endpoint = await findEndpoint(sql, tenantId, id);
  await parkDeliveries(sql, [id]);
  return c.json(toResponse(endpoint), 200);
});

// The flag is cleared first, so endpoint_holds already sees it when the parked deliveries are let
// go (except any its tenant, or a global pause, still holds). The un-park runs even if it wasn't
// paused, so a retry finishes the job.
endpoints.openapi(resumeEndpoint, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");
  await sql`
        update endpoints set state = 'active'
        where id = ${id} and tenant_id = ${tenantId} and state = 'paused'
      `;
  const endpoint = await findEndpoint(sql, tenantId, id);
  if ((await unparkDeliveries(sql, [id])) > 0) {
    c.executionCtx.waitUntil(wakeDispatcher(c.env));
  }
  return c.json(toResponse(endpoint), 200);
});

// Deleting keeps the row (deliveries refer to it) and cancels every pending delivery, parked ones
// included. One being sent right now finds its queue row gone, so its outcome is recorded as stale.
endpoints.openapi(deleteEndpoint, async (c) => {
  const { id } = c.req.valid("param");
  const [row] = await c.get("sql")<{ deleted: boolean; cancelled: number }[]>`
      with deleted as (
        update endpoints
        set state = 'deleted', probe_at = null
        where id = ${id} and tenant_id = ${c.get("tenantId")} and state <> 'deleted'
        returning id
      ),
      dequeued as (
        delete from delivery_queue q
        using deleted
        where q.endpoint_id = deleted.id
        returning q.delivery_id, q.delivery_created_at
      ),
      cancelled as (
        update deliveries d
        set state = 'cancelled', finished_at = now()
        from dequeued
        where d.id = dequeued.delivery_id and d.created_at = dequeued.delivery_created_at
          and d.state = 'pending'
        returning d.id
      )
      select exists (select 1 from deleted) as deleted,
             (select count(*) from cancelled)::int as cancelled
    `;
  if (!row?.deleted) {
    throw new ApiError(404, "not_found", "Endpoint not found");
  }
  return c.json({ id, cancelled_deliveries: row.cancelled }, 200);
});

endpoints.openapi(getEndpointHealth, async (c) => {
  const { id } = c.req.valid("param");
  const [row] = await c.get("sql")<HealthRow[]>`
        select e.state, e.probe_at, e.rate_limit_per_s, e.concurrency_limit, h.paused
        from endpoints e
        join endpoint_holds h on h.endpoint_id = e.id
        where e.id = ${id} and e.tenant_id = ${c.get("tenantId")} and e.state <> 'deleted'
      `;
  if (!row) {
    throw new ApiError(404, "not_found", "Endpoint not found");
  }
  const limiter = await limiterHealth(c.env, id, row);
  return c.json(
    {
      id,
      state: row.state,
      health: healthOf(row, limiter),
      probe_at: row.probe_at?.toISOString() ?? null,
      limiter:
        limiter === null
          ? null
          : {
              rate_limit_per_s: row.rate_limit_per_s,
              current_rate_per_s: Math.round(limiter.ratePerSecond * 10) / 10,
              concurrency_limit: row.concurrency_limit,
              slots_in_use: limiter.slotsInUse,
              throttled_until:
                limiter.pausedUntil === null ? null : new Date(limiter.pausedUntil).toISOString(),
              breaker: limiter.breaker,
              recent_attempts: limiter.recentAttempts,
              recent_failures: limiter.recentFailures,
            },
    },
    200,
  );
});

// Asks the endpoint's limiter Durable Object (one per endpoint, named by its id) for its state.
// If it can't be reached, the answer still has what Postgres knows.
async function limiterHealth(env: Env, id: string, row: HealthRow): Promise<LimiterHealth | null> {
  const limiters = env.LIMITER as DurableObjectNamespace<LimiterApi>;
  try {
    return await limiters
      .getByName(id)
      .health({ ratePerSecond: row.rate_limit_per_s, concurrency: row.concurrency_limit });
  } catch (error) {
    console.error(`endpoint ${id}: limiter unreachable`, error);
    return null;
  }
}

// Postgres decides paused and disabled. The limiter's breaker counts too: if recording a trip
// failed, Postgres still says active while the limiter holds sends back.
function healthOf(row: HealthRow, limiter: LimiterHealth | null): z.infer<typeof Health> {
  if (row.paused) {
    return "paused";
  }
  if (row.state === "disabled" || (limiter !== null && limiter.breaker !== "closed")) {
    return "disabled";
  }
  if (
    limiter !== null &&
    (limiter.pausedUntil !== null ||
      limiter.ratePerSecond < row.rate_limit_per_s ||
      (limiter.recentFailures > 0 && limiter.recentFailures * 2 >= limiter.recentAttempts))
  ) {
    return "degraded";
  }
  return "healthy";
}

async function findEndpoint(sql: Sql, tenantId: string, id: string): Promise<EndpointRow> {
  const [row] = await selectEndpoints(sql, tenantId, id);
  if (!row) {
    throw new ApiError(404, "not_found", "Endpoint not found");
  }
  return row;
}

function selectEndpoints(sql: Sql, tenantId: string, endpointId?: string) {
  return sql<EndpointRow[]>`
      select e.id, e.url, e.description, e.state, e.rate_limit_per_s, e.concurrency_limit,
             e.created_at,
             coalesce(
               jsonb_agg(s.event_type_pattern order by s.event_type_pattern)
                 filter (where s.event_type_pattern is not null),
               '[]'
             ) as subscriptions
      from endpoints e
      left join endpoint_subscriptions s on s.endpoint_id = e.id
      where e.tenant_id = ${tenantId}
        and e.state <> 'deleted'
        ${endpointId === undefined ? sql`` : sql`and e.id = ${endpointId}`}
      group by e.id
      order by e.created_at
    `;
}

function toResponse(row: EndpointRow) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    state: row.state,
    subscriptions: row.subscriptions,
    rate_limit_per_s: row.rate_limit_per_s,
    concurrency_limit: row.concurrency_limit,
    created_at: row.created_at.toISOString(),
  };
}
