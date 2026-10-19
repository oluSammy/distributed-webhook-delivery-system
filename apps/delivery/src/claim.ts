import type { Sql } from "postgres";

export const DELIVERIES_PER_BATCH = 10;
const TENANTS_PER_BATCH = 10;
const DELIVERIES_PER_TENANT = 5;

// How long a claim lasts. Longer than the slowest possible batch: 10 deliveries, at most
// 6 in flight, so two rounds of the 30 s maximum timeout, plus time to record outcomes.
export const LEASE_SECONDS = 90;

export type ClaimedDelivery = {
  delivery_id: string;
  delivery_created_at: Date;
  endpoint_id: string;
  claim_token: string;
  event_id: string;
  event_type: string;
  event_created_at: Date;
  payload: string; // the event payload as JSON text, never parsed here
  attempt_count: number;
  attempt_number: number; // this attempt: every earlier one, failed or throttled, plus 1
  url: string;
  timeout_ms: number;
  retry_policy: unknown; // the tenant's stored policy, checked by parseRetryPolicy
  secrets: StoredSecret[]; // every unexpired secret, oldest first
};

export type StoredSecret = {
  secret_ciphertext: string; // base64, like the other three byte fields
  secret_iv: string;
  dek_ciphertext: string;
  dek_iv: string;
  kek_version: number;
};

// Claims up to DELIVERIES_PER_BATCH due deliveries, a few from each tenant with work,
// least recently served tenants first. Each claimed row gets a new claim token, and its
// next_attempt_at moves to the end of the lease, so a crashed call's rows come back by themselves.
// Also returns everything needed to send each one, so the whole batch costs a single query.
export async function claimDeliveries(sql: Sql, claimedBy: string): Promise<ClaimedDelivery[]> {
  return sql<ClaimedDelivery[]>`
    with next_tenants as (
      select tenant_id
      from tenants_with_work
      order by last_served_at
      limit ${TENANTS_PER_BATCH}
      for update skip locked
    ),
    picked as (
      select q.delivery_id
      from next_tenants t
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
      returning dq.delivery_id, dq.delivery_created_at, dq.endpoint_id, dq.claim_token
    ),
    rotated as (
      update tenants_with_work w
      set last_served_at = now()
      from next_tenants t
      where w.tenant_id = t.tenant_id
    )
    select c.delivery_id, c.delivery_created_at, c.endpoint_id, c.claim_token,
           d.event_id, ev.type as event_type, ev.created_at as event_created_at,
           ev.payload::text as payload,
           d.attempt_count, d.attempt_count + d.throttled_count + 1 as attempt_number,
           en.url, t.delivery_timeout_ms as timeout_ms, t.retry_policy, s.secrets
    from claimed c
    join deliveries d on d.id = c.delivery_id and d.created_at = c.delivery_created_at
    join events ev on ev.id = d.event_id and ev.created_at = d.event_created_at
    join endpoints en on en.id = c.endpoint_id
    join tenants t on t.id = en.tenant_id
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
               'secret_ciphertext', encode(es.secret_ciphertext, 'base64'),
               'secret_iv', encode(es.secret_iv, 'base64'),
               'dek_ciphertext', encode(es.dek_ciphertext, 'base64'),
               'dek_iv', encode(es.dek_iv, 'base64'),
               'kek_version', es.kek_version
             ) order by es.created_at), '[]') as secrets
      from endpoint_secrets es
      where es.endpoint_id = c.endpoint_id
        and (es.expires_at is null or es.expires_at > now())
    ) s
  `;
}
