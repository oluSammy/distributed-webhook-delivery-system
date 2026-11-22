import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Endpoint = {
  id: string;
  deliveries_24h: { succeeded: number; dead: number; pending: number };
  last_delivery_at: string | null;
};

describe("GET /api/endpoints", () => {
  it("gives each endpoint its last 24 hours of deliveries by state, and its newest", async () => {
    const tenant = await makeTenant(sql);
    const busy = await makeEndpoint(sql, tenant);
    const quiet = await makeEndpoint(sql, tenant);
    for (const state of ["succeeded", "succeeded", "dead", "pending"]) {
      const id = await makeDelivery(sql, tenant, busy);
      if (state !== "pending") {
        await sql`delete from delivery_queue where delivery_id = ${id}`;
        await sql`
            update deliveries
            set state = ${state}, finished_at = now(),
                failure_reason = ${state === "dead" ? "max_attempts" : null}
            where id = ${id}
          `;
      }
    }
    const [newest] = await sql<{ created_at: Date }[]>`
        select created_at from deliveries where endpoint_id = ${busy}
        order by created_at desc limit 1
      `;

    const response = await api("/api/endpoints", await makeApiKey(sql, tenant));
    const { endpoints } = (await response.json()) as { endpoints: Endpoint[] };
    expect(endpoints.find((e) => e.id === busy)).toMatchObject({
      deliveries_24h: { succeeded: 2, dead: 1, pending: 1 },
      last_delivery_at: newest?.created_at.toISOString(),
    });
    expect(endpoints.find((e) => e.id === quiet)).toMatchObject({
      deliveries_24h: { succeeded: 0, dead: 0, pending: 0 },
      last_delivery_at: null,
    });
  });
});
