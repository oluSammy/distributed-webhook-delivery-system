import { createRoute, z } from "@hono/zod-openapi";
import { firstRow, generateApiKey } from "@wds/core";
import { ApiError } from "../errors";
import { requireOwner } from "../middleware/auth";
import { createRouter } from "../router";

// An API key as the list shows it: never the key itself, which only its creator ever sees.
const ApiKey = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(), // its first characters, like whk_live_a1B2, to tell keys apart
  created_at: z.string(),
  last_used_at: z.string().nullable(), // to the minute; null if never used
});

const KeyParams = z.object({ id: z.uuid() });

const listKeys = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "The tenant's API keys that still work, newest first",
      content: { "application/json": { schema: z.object({ keys: z.array(ApiKey) }) } },
    },
  },
});

const createKey = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ name: z.string().trim().min(1).max(100) }) },
      },
    },
  },
  responses: {
    201: {
      description:
        "The new key. key is the key itself, shown only this once: only its hash is kept. Owners only, signed in.",
      content: { "application/json": { schema: ApiKey.extend({ key: z.string() }) } },
    },
  },
});

const revokeKey = createRoute({
  method: "delete",
  path: "/{id}",
  request: { params: KeyParams },
  responses: {
    204: { description: "Revoked: requests with it get 401 from now on. Owners only, signed in." },
  },
});

export const keys = createRouter();

keys.openapi(listKeys, async (c) => {
  const rows = await c.get("sql")<KeyRow[]>`
      select id, name, key_prefix, created_at, last_used_at
      from api_keys
      where tenant_id = ${c.get("tenantId")} and scope = 'tenant' and revoked_at is null
      order by created_at desc
    `;
  return c.json({ keys: rows.map(toResponse) }, 200);
});

keys.openapi(createKey, async (c) => {
  await requireOwner(c);
  const { name } = c.req.valid("json");
  const { key, prefix, hash } = await generateApiKey("tenant");
  const row = firstRow(
    await c.get("sql")<KeyRow[]>`
        insert into api_keys (tenant_id, scope, name, key_prefix, key_hash)
        values (${c.get("tenantId")}, 'tenant', ${name}, ${prefix}, ${hash})
        returning id, name, key_prefix, created_at, last_used_at
      `,
  );
  return c.json({ ...toResponse(row), key }, 201);
});

keys.openapi(revokeKey, async (c) => {
  await requireOwner(c);
  const { id } = c.req.valid("param");
  const [row] = await c.get("sql")`
      update api_keys set revoked_at = now()
      where id = ${id} and tenant_id = ${c.get("tenantId")} and revoked_at is null
      returning id
    `;
  if (!row) {
    throw new ApiError(404, "key_not_found", "No such API key, or it's already revoked");
  }
  return c.body(null, 204);
});

type KeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
};

function toResponse(row: KeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at?.toISOString() ?? null,
  };
}
