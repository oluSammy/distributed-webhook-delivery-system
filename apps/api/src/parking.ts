import type { Sql } from "postgres";

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
