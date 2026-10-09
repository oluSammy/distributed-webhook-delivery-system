import { createDb } from "./db";
import { handleError } from "./errors";
import { requireTenant } from "./middleware/auth";
import { withDb } from "./middleware/db";
import { createRouter } from "./router";
import { events } from "./routes/events";

const app = createRouter();

app.get("/healthz", async (c) => c.json({ ok: true }));

app.get("/readyz", async (c) => {
  const sql = createDb(c.env);
  try {
    await sql`select 1`;
    return c.json({
      ok: true,
      db: "up",
    });
  } catch (err) {
    console.error("readyz: database check failed", err);
    return c.json(
      {
        ok: false,
        db: "down",
      },
      503,
    );
  } finally {
    c.executionCtx.waitUntil(sql.end()); // closes the connection whether the query succeeded or failed
  }
});

app.use("/api/*", withDb, requireTenant); // connection, then auth
app.route("/api/events", events);

app.onError(handleError);

export default app;
