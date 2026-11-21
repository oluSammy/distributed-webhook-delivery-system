import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { ApiError } from "../errors";
import { createRouter } from "../router";
import type { AppEnv } from "../types";

const Tenant = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["owner", "member"]),
});

const Me = z.object({
  user: z.object({
    id: z.string(),
    login: z.string(),
    name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    is_operator: z.boolean(),
  }),
  tenant_id: z.string(), // the tenant the dashboard is showing: one of tenants
  tenants: z.array(Tenant), // every tenant the person is in, by name
});

const getMe = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "The signed-in person, their tenants, and the one the dashboard is showing",
      content: { "application/json": { schema: Me } },
    },
  },
});

const switchTenant = createRoute({
  method: "put",
  path: "/tenant",
  request: {
    body: { content: { "application/json": { schema: z.object({ tenant_id: z.uuid() }) } } },
  },
  responses: {
    200: {
      description: "The dashboard now shows this tenant",
      content: { "application/json": { schema: z.object({ tenant_id: z.string() }) } },
    },
  },
});

// The routes about the signed-in person. They need a session: a key has no person behind it.
export const me = createRouter();

me.openapi(getMe, async (c) => {
  const session = requireSession(c);
  const sql = c.get("sql");
  const [[user], tenants] = await Promise.all([
    sql<z.infer<typeof Me>["user"][]>`
        select id, login, name, avatar_url, is_operator from users where id = ${session.userId}
      `,
    sql<z.infer<typeof Tenant>[]>`
        select t.id, t.name, m.role
        from memberships m
        join tenants t on t.id = m.tenant_id
        where m.user_id = ${session.userId}
        order by t.name
      `,
  ]);
  if (!user) {
    throw new ApiError(401, "unauthorized", "Signed out or session expired");
  }
  return c.json({ user, tenant_id: c.get("tenantId"), tenants }, 200);
});

// Points this session at another tenant, if the person is in it.
me.openapi(switchTenant, async (c) => {
  const session = requireSession(c);
  const { tenant_id } = c.req.valid("json");
  const [row] = await c.get("sql")<{ tenant_id: string }[]>`
      update sessions s set tenant_id = ${tenant_id}
      where s.id = ${session.id}
        and exists (
          select 1 from memberships m where m.user_id = s.user_id and m.tenant_id = ${tenant_id}
        )
      returning tenant_id
    `;
  if (!row) {
    throw new ApiError(404, "tenant_not_found", "You're not a member of that tenant");
  }
  return c.json({ tenant_id: row.tenant_id }, 200);
});

function requireSession(c: Context<AppEnv>): { id: string; userId: string } {
  const session = c.get("session");
  if (!session) {
    throw new ApiError(403, "session_required", "Only for people signed in to the dashboard");
  }
  return session;
}
