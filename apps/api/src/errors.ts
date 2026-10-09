import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "bad_request", message: err.message } }, err.status);
  }
  console.error("unhandled error", err);
  return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
};
