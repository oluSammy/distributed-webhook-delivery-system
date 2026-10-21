import { createDb } from "@wds/db";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  const sql = createDb(c.env.HYPERDRIVE.connectionString);
  c.set("sql", sql);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(sql.end());
  }
});
