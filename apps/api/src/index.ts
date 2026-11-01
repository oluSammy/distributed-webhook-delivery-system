import { createDb } from "@wds/db";
import { handleError } from "./errors";
import { runMaintenance } from "./maintenance";
import { requireOperator, requireTenant } from "./middleware/auth";
import { withDb } from "./middleware/db";
import { createRouter } from "./router";
import { admin } from "./routes/admin";
import { deliveries } from "./routes/deliveries";
import { dlq } from "./routes/dlq";
import { endpoints } from "./routes/endpoints";
import { events } from "./routes/events";

const app = createRouter();

app.get("/healthz", async (c) => c.json({ ok: true }));

app.get("/readyz", async (c) => {
  const sql = createDb(c.env.HYPERDRIVE.connectionString);
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
app.route("/api/endpoints", endpoints);
app.route("/api/deliveries", deliveries);
app.route("/api/dlq", dlq);

app.use("/admin/*", withDb, requireOperator);
app.route("/admin", admin);

app.onError(handleError);

// fetch serves the API; scheduled runs the maintenance cron ([triggers] in wrangler.toml).
export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    await runMaintenance(env);
  },
} satisfies ExportedHandler<Env>;
