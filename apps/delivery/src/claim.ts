import type { Sql } from "postgres";

export const DELIVERIES_PER_BATCH = 10;
const TENANTS_PER_BATCH = 10;
const DELIVERIES_PER_TENANT = 5;

// How long a claim lasts. Longer than the slowest possible batch: 10 deliveries, at most
// 6 in flight, so two rounds of the 30 s maximum timeout, plus time to record outcomes.
const LEASE_SECONDS = 90;

export type ClaimedDelivery = {
  delivery_id: string;
  endpoint_id: string;
  claim_token: string;
};

// Claims up to DELIVERIES_PER_BATCH due deliveries, a few from each tenant with work,
// least recently served tenants first. Each claimed row gets a new claim token, and its
// next_attempt_at moves to the end of the lease, so a crashed call's rows come back by themselves.
export async function claimDeliveries(sql: Sql, claimedBy: string): Promise<ClaimedDelivery[]> {
  return sql<ClaimedDelivery[]>`
      with tenants as (
        select tenant_id
        from tenants_with_work
        order by last_served_at
        limit ${TENANTS_PER_BATCH}
        for update skip locked
      ),
      picked as (
        select q.delivery_id
        from tenants t
        cross join lateral (
          select dq.delivery_id
          from delivery_queue dq
          where dq.tenant_id = t.tenant_id
            and dq.next_attempt_at <= now()
          order by dq.next_attempt_at
          limit ${DELIVERIES_PER_TENANT}
          for update skip locked
        ) q
        limit ${DELIVERIES_PER_BATCH}
      ),
      claimed as (
        update delivery_queue dq
        set next_attempt_at = now() + ${LEASE_SECONDS} * interval '1 second',
            claim_token = gen_random_uuid(),
            claimed_by = ${claimedBy}
        from picked
        where dq.delivery_id = picked.delivery_id
        returning dq.delivery_id, dq.endpoint_id, dq.claim_token
      ),
      rotated as (
        update tenants_with_work w
        set last_served_at = now()
        from tenants t
        where w.tenant_id = t.tenant_id
      )
      select delivery_id, endpoint_id, claim_token from claimed
`;
}
