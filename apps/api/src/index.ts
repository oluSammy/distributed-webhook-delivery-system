import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>() // creates the router - c.env has the shape of the generated Env

app.get("/healthz", (c) => c.json({ ok: true }))

export default app