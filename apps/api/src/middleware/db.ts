import { createMiddleware } from "hono/factory";
import { createDb } from "../db";
import type { AppEnv } from "../types";

export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  const sql = createDb(c.env);
  c.set("sql", sql);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(sql.end());
  }
});
