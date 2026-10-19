import type { ErrorKind, NextStep, Outcome } from "@wds/core";
import type { Sql } from "postgres";
import type { ClaimedDelivery } from "./claim";

export type AttemptRecord = {
  outcome: Outcome;
  errorKind: ErrorKind | null;
  status: number | null;
  body: string | null;
  signedTimestamp: number;
  startedAt: Date;
  latencyMs: number;
};

// Records one attempt and what it led to, in a single statement. Every change is guarded by the
// claim token: if another call has claimed the delivery since, nothing changes, the attempt is
// still recorded (the request did reach the consumer) with stale = true, and this returns false.
// attempt is null when nothing was sent (the URL failed its re-check).
export async function recordOutcome(
  sql: Sql,
  claim: ClaimedDelivery,
  step: NextStep,
  attempt: AttemptRecord | null,
): Promise<boolean> {
  const outcome = attempt?.outcome;
  const failed = outcome === "failure" || outcome === "non_retryable" ? 1 : 0;
  const throttled = outcome === "throttled" ? 1 : 0;

  const mine =
    step.state === "pending"
      ? sql`
            update delivery_queue
            set next_attempt_at = ${step.nextAttemptAt}, claim_token = null, claimed_by = null
            where delivery_id = ${claim.delivery_id} and claim_token = ${claim.claim_token}
            returning delivery_id, delivery_created_at
          `
      : sql`
            delete from delivery_queue
            where delivery_id = ${claim.delivery_id} and claim_token = ${claim.claim_token}
            returning delivery_id, delivery_created_at
          `;

  const finish =
    step.state === "pending"
      ? sql``
      : sql`, state = ${step.state}, failure_reason = ${step.state === "dead" ? step.reason : null}, finished_at = now()`;

  const recordAttempt =
    attempt === null
      ? sql``
      : sql`,
            attempt as (
              insert into delivery_attempts (delivery_id, attempt_number, signed_timestamp,
                outcome, response_status, response_body_truncated, error_kind, stale,
                latency_ms, started_at, finished_at)
              values (${claim.delivery_id}, ${claim.attempt_number}, ${attempt.signedTimestamp},
                ${attempt.outcome}, ${attempt.status}, ${attempt.body}, ${attempt.errorKind},
                not exists (select 1 from mine), ${attempt.latencyMs}, ${attempt.startedAt}, now())
            )`;

  const [row] = await sql<{ applied: boolean }[]>`
            with mine as (${mine}),
            changed as (
              update deliveries d
              set attempt_count = attempt_count + ${failed},
                  throttled_count = throttled_count + ${throttled}
                  ${finish}
              from mine
              where d.id = mine.delivery_id
                and d.created_at = mine.delivery_created_at
                and d.state = 'pending'
            )
            ${recordAttempt}
            select exists (select 1 from mine) as applied
          `;
  return row?.applied ?? false;
}

// Gives back claims that were never sent, so they're due again now instead of when the lease runs out.
export async function releaseClaims(sql: Sql, claims: readonly ClaimedDelivery[]): Promise<void> {
  const rows = claims.map(({ delivery_id, claim_token }) => ({ delivery_id, claim_token }));
  await sql`
      update delivery_queue q
      set next_attempt_at = now(), claim_token = null, claimed_by = null
      from jsonb_to_recordset(${sql.json(rows)}) as r(delivery_id uuid, claim_token uuid)
      where q.delivery_id = r.delivery_id and q.claim_token = r.claim_token
    `;
}
