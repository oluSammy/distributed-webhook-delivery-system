import { createRoute, z } from "@hono/zod-openapi";
import { dailyLimit, eventsToday, nextReset } from "../daily-limit";
import { createRouter } from "../router";

const getUsage = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description:
        "Events accepted today (UTC) against the daily limit, and when the count starts again",
      content: {
        "application/json": {
          schema: z.object({
            day: z.string(), // today, UTC: 2026-11-24
            events: z.number(),
            daily_limit: z.number(),
            resets_at: z.string(), // the next 00:00 UTC
          }),
        },
      },
    },
  },
});

export const usage = createRouter();

usage.openapi(getUsage, async (c) => {
  const now = new Date();
  return c.json(
    {
      day: now.toISOString().slice(0, 10),
      events: await eventsToday(c.get("sql"), c.get("tenantId")),
      daily_limit: dailyLimit(c.env),
      resets_at: nextReset(now).toISOString(),
    },
    200,
  );
});
