import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./types";

export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }));
        return c.json(
          { error: { code: "invalid_request", message: "Request validation failed", details } },
          400,
        );
      }
    },
  });
}
