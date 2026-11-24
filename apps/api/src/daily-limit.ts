import type { Context } from "hono";
import type { Sql, TransactionSql } from "postgres";
import { ApiError } from "./errors";
import type { AppEnv } from "./types";

const DEFAULT_DAILY_LIMIT = 50_000;

export type Usage = { events: number; daily_limit: number };

// DAILY_EVENT_LIMIT from the API Worker's vars; 50,000 when it isn't set. A value that's set but
// isn't a whole number above 0 is a mistake in the config, so it throws instead of guessing.
export function dailyLimit(vars: { DAILY_EVENT_LIMIT?: string }): number {
  if (vars.DAILY_EVENT_LIMIT === undefined) {
    return DEFAULT_DAILY_LIMIT;
  }
  const limit = Number(vars.DAILY_EVENT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("DAILY_EVENT_LIMIT must be a whole number of events, at least 1");
  }
  return limit;
}

// Adds n events to the tenant's count for today, unless that would pass the limit. Used as a CTE
// in the statement that stores the events: when it returns no row, the events aren't stored either.
// Postgres locks today's row while one request updates it, so two at once can't both slip past.
// The ::int casts matter: without them Postgres compares the two numbers as text, and "500" sorts
// after "1000".
export function countToday(sql: Sql | TransactionSql, tenantId: string, n: number, limit: number) {
  return sql<Usage[]>`
      insert into tenant_daily_usage (tenant_id, day, events)
      select ${tenantId}, (now() at time zone 'utc')::date, ${n}::int
      where ${n}::int <= ${limit}::int
      on conflict (tenant_id, day) do update
        set events = tenant_daily_usage.events + excluded.events
        where tenant_daily_usage.events + excluded.events <= ${limit}::int
      returning events, ${limit}::int as daily_limit
    `;
}

// Today's count so far: 0 before the day's first event.
export async function eventsToday(sql: Sql | TransactionSql, tenantId: string): Promise<number> {
  const [row] = await sql<{ events: number }[]>`
      select events from tenant_daily_usage
      where tenant_id = ${tenantId} and day = (now() at time zone 'utc')::date
    `;
  return row?.events ?? 0;
}

// The 429 when n more events would pass today's limit, saying where the tenant stands.
export async function limitReached(
  sql: Sql | TransactionSql,
  tenantId: string,
  n: number,
  limit: number,
): Promise<ApiError> {
  const events = await eventsToday(sql, tenantId);
  const most = limit.toLocaleString("en");
  const message =
    n === 1 || events >= limit
      ? `This account has sent ${events.toLocaleString("en")} events today, its daily limit of ${most}. The limit resets at 00:00 UTC.`
      : `This batch of ${n.toLocaleString("en")} would take today's total to ${(events + n).toLocaleString("en")}, over the daily limit of ${most}. The limit resets at 00:00 UTC.`;
  return new ApiError(429, "daily_event_limit_reached", message, {
    "Retry-After": String(secondsToReset()),
  });
}

// Where the tenant stands, on every accepted response, so its code can slow down before the limit.
export function setUsageHeaders(c: Context<AppEnv>, usage: Usage): void {
  c.header("RateLimit-Limit", String(usage.daily_limit));
  c.header("RateLimit-Remaining", String(Math.max(0, usage.daily_limit - usage.events)));
  c.header("RateLimit-Reset", String(secondsToReset()));
}

// The next 00:00 UTC, when the count starts again.
export function nextReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// Seconds until then, for Retry-After and RateLimit-Reset.
export function secondsToReset(now = new Date()): number {
  return Math.ceil((nextReset(now).getTime() - now.getTime()) / 1000);
}
