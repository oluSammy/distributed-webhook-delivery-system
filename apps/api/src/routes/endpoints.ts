import { createRoute, z } from "@hono/zod-openapi";
import { encryptSecret, firstRow, generateSigningSecret, importMasterKey } from "@wds/core";
import type { Sql } from "postgres";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const MAX_SUBSCRIPTIONS = 50;

const SubscriptionPattern = z
  .string()
  .regex(
    /^(\*|[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?)$/,
    "Must be *, an event type, or a prefix ending in .*",
  );

const EndpointUrl = z
  .url()
  .max(2048)
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Must be an http(s) URL",
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
  const [row] = await selectEndpoints(c.get("sql"), c.get("tenantId"), id);
  if (!row) {
    throw new ApiError(404, "not_found", "Endpoint not found");
  }
  return c.json(toResponse(row), 200);
});

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
