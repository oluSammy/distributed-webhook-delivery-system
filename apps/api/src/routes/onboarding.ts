import { createRoute, z } from "@hono/zod-openapi";
import { firstRow } from "@wds/core";
import { createRouter } from "../router";

const getOnboarding = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description:
        "How far the tenant is through getting started, read from its data: each step is done once what it asks for exists.",
      content: {
        "application/json": {
          schema: z.object({
            steps: z.object({
              event_type: z.boolean(), // an event type is registered
              endpoint: z.boolean(), // an endpoint exists (not deleted)
              delivered: z.boolean(), // a delivery has arrived: the endpoint and its check work
              event_sent: z.boolean(), // the tenant's code sent an event (not a test)
            }),
            event_type: z.string().nullable(), // the first registered type, for the curl example
            endpoint_id: z.string().nullable(), // the first endpoint, to send a test to
          }),
        },
      },
    },
  },
});

export const onboarding = createRouter();

// One query, four "is there at least one" checks. Each stops at the first row it finds, so it's
// as quick for a busy tenant as for a new one.
onboarding.openapi(getOnboarding, async (c) => {
  const tenantId = c.get("tenantId");
  const row = firstRow(
    await c.get("sql")<
      {
        event_type: string | null;
        endpoint_id: string | null;
        delivered: boolean;
        event_sent: boolean;
      }[]
    >`
        select
          (select name from event_types where tenant_id = ${tenantId}
            order by created_at limit 1) as event_type,
          (select id from endpoints where tenant_id = ${tenantId} and state <> 'deleted'
            order by created_at limit 1) as endpoint_id,
          exists (select 1 from deliveries where tenant_id = ${tenantId} and state = 'succeeded')
            as delivered,
          exists (select 1 from events where tenant_id = ${tenantId} and type <> 'webhook.test')
            as event_sent
      `,
  );
  return c.json(
    {
      steps: {
        event_type: row.event_type !== null,
        endpoint: row.endpoint_id !== null,
        delivered: row.delivered,
        event_sent: row.event_sent,
      },
      event_type: row.event_type,
      endpoint_id: row.endpoint_id,
    },
    200,
  );
});
