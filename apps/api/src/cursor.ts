import { z } from "@hono/zod-openapi";
import { ApiError } from "./errors";

// Where a page of a list ended: the last row's created_at as text (a Date would drop the
// microseconds) and its id.
export type Cursor = { position: string; id: string };

// The cursor is the last row's position and id, so the next page starts right after it even when
// several rows were created in the same microsecond. Base64url keeps it opaque and URL-safe.
export function encodeCursor({ position, id }: Cursor): string {
  return btoa(JSON.stringify([position, id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeCursor(cursor: string): Cursor {
  try {
    const [position, id] = JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")));
    if (typeof position === "string" && z.uuid().safeParse(id).success) {
      return { position, id };
    }
  } catch {
    // not base64 or not JSON: rejected below
  }
  throw new ApiError(400, "invalid_cursor", "cursor is not one this API returned");
}
