import type { BreakerChange } from "@wds/core";
import type { Sql } from "postgres";

// Records what the limiter's circuit breaker did, in one statement each:
// - tripped: the endpoint is disabled until probe_at, its owner is notified, and its waiting
//   deliveries are parked ('infinity': never due) so claims stop picking them up. Rows that are
//   claimed right now are left alone; they park themselves when they next ask the limiter.
// - reopened: a probe failed, so the next one waits until the new probe_at.
// - closed: a probe succeeded; the endpoint is active again and its parked deliveries are due now.
// Each one only applies if the endpoint is in the state the change expects, so a change that
// arrives late, or an endpoint paused or deleted meanwhile, is left alone. Returns how many
// deliveries were parked or un-parked.
export async function recordBreakerChange(
  sql: Sql,
  endpointId: string,
  change: BreakerChange,
): Promise<number> {
  switch (change.kind) {
    case "tripped": {
      const parked = await sql`
          with disabled as (
            update endpoints
            set state = 'disabled', probe_at = ${new Date(change.probeAt)}
            where id = ${endpointId} and state = 'active'
            returning id, tenant_id
          ),
          notified as (
            insert into notifications (tenant_id, endpoint_id, kind)
            select tenant_id, id, 'breaker_tripped' from disabled
          )
          update delivery_queue
          set next_attempt_at = 'infinity'
          where endpoint_id in (select id from disabled)
            and claim_token is null
            and next_attempt_at < 'infinity'
        `;
      return parked.count;
    }
    case "reopened":
      await sql`
          update endpoints set probe_at = ${new Date(change.probeAt)}
          where id = ${endpointId} and state = 'disabled'
        `;
      return 0;
    case "closed": {
      const unparked = await sql`
          with enabled as (
            update endpoints
            set state = 'active', probe_at = null
            where id = ${endpointId} and state = 'disabled'
            returning id, tenant_id
          ),
          notified as (
            insert into notifications (tenant_id, endpoint_id, kind)
            select tenant_id, id, 'breaker_closed' from enabled
          )
          update delivery_queue
          set next_attempt_at = now()
          where endpoint_id in (select id from enabled)
            and next_attempt_at = 'infinity'
        `;
      return unparked.count;
    }
  }
}
