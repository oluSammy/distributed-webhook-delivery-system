import { createRoute, z } from "@hono/zod-openapi";
import { firstRow } from "@wds/core";
import { requireOwner } from "../middleware/auth";
import { createRouter } from "../router";

const renameTenant = createRoute({
  method: "patch",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ name: z.string().trim().min(1).max(100) }) },
      },
    },
  },
  responses: {
    200: {
      description: "The tenant, renamed. Owners only, signed in.",
      content: { "application/json": { schema: z.object({ id: z.string(), name: z.string() }) } },
    },
  },
});

export const tenant = createRouter();

// The tenant the request is for: the key's, or the one the dashboard is showing.
tenant.openapi(renameTenant, async (c) => {
  await requireOwner(c);
  const { name } = c.req.valid("json");
  const row = firstRow(
    await c.get("sql")<{ id: string; name: string }[]>`
        update tenants set name = ${name} where id = ${c.get("tenantId")} returning id, name
      `,
  );
  return c.json(row, 200);
});
