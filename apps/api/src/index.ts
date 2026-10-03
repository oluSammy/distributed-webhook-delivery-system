import { Hono } from "hono";
import { createDb } from "./db";
import type { DispatcherApi } from "@wds/dispatcher/contract";

const app = new Hono<{ Bindings: Env }>() // creates the router - c.env has the shape of the generated Env

app.get("/healthz", async (c) => c.json({ ok: true }))

app.get("/readyz", async (c) => {
    const sql = createDb(c.env);
    try {
        await sql`select 1`;
        return c.json({
            ok: true, db:
                "up"
        });
    } catch (err) {
        console.error("readyz: database check failed", err);
      return c.json({
            ok: false, db:
                "down"
        }, 503);
    } finally {
        c.executionCtx.waitUntil(sql.end()); // closes the connection whether the query succeeded or failed
    }
});

app.post("/debug/wake", async (c) => {
    const dispatchers = c.env.DISPATCHER as DurableObjectNamespace<DispatcherApi>
    const stub = dispatchers.getByName("shard-0");
    const result = await stub.wake();
    return c.json(result)
})

export default app