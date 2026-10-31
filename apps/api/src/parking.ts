import type { Sql } from "postgres";

// How many endpoints one park or un-park statement covers when a whole tenant, or everything, is
// paused or resumed. Each statement moves all of those endpoints' rows, so this bounds how long
// one runs and holds its locks.
const ENDPOINTS_PER_BATCH = 100;

// Parks the waiting deliveries of these endpoints ('infinity': never due), only while
// endpoint_holds says they're paused, and returns how many. Rows claimed right now are left
// alone: if they come back, the Delivery Worker parks them.
export async function parkDeliveries(sql: Sql, endpointIds: string[]): Promise<number> {
  const parked = await sql`
      update delivery_queue q
      set next_attempt_at = 'infinity'
      from endpoint_holds h
      where q.endpoint_id in (select jsonb_array_elements_text(${sql.json(endpointIds)})::uuid)
        and q.claim_token is null
        and q.next_attempt_at < 'infinity'
        and h.endpoint_id = q.endpoint_id and h.paused
    `;
  return parked.count;
}

// Makes the parked deliveries of these endpoints due now, except those endpoint_holds still
// holds (the endpoint is disabled, or something is still paused). Returns how many.
export async function unparkDeliveries(sql: Sql, endpointIds: string[]): Promise<number> {
  const unparked = await sql`
      update delivery_queue q
      set next_attempt_at = now()
      from endpoint_holds h
      where q.endpoint_id in (select jsonb_array_elements_text(${sql.json(endpointIds)})::uuid)
        and q.next_attempt_at = 'infinity'
        and h.endpoint_id = q.endpoint_id and not h.disabled and not h.paused
    `;
  return unparked.count;
}

// Runs move (parkDeliveries or unparkDeliveries) over every endpoint of a tenant, or of every
// tenant when tenantId is null, ENDPOINTS_PER_BATCH at a time in id order. Each batch is its own
// statement, committed as it goes. Returns how many deliveries moved in all.
export async function moveInBatches(
  sql: Sql,
  tenantId: string | null,
  move: (sql: Sql, endpointIds: string[]) => Promise<number>,
): Promise<number> {
  let moved = 0;
  let after: string | null = null;
  for (;;) {
    const batch: { id: string }[] = await sql<{ id: string }[]>`
        select id from endpoints
        where state <> 'deleted'
          ${tenantId === null ? sql`` : sql`and tenant_id = ${tenantId}`}
          ${after === null ? sql`` : sql`and id > ${after}`}
        order by id
        limit ${ENDPOINTS_PER_BATCH}
      `;
    const last = batch.at(-1);
    if (last === undefined) {
      return moved;
    }
    moved += await move(
      sql,
      batch.map((endpoint) => endpoint.id),
    );
    after = last.id;
  }
}
