import type { Fragment, Sql } from "postgres";

// Joins each delivery d to its last attempt that counted (not stale), as "last": its HTTP status,
// or the error when no response came back (a timeout, a refused connection). One small lookup per
// row on idx_attempts_delivery. A dead delivery's attempts may have moved to
// dead_delivery_attempts when their partition was dropped, so both tables are read.
// started_at >= created_at changes nothing but lets Postgres skip older partitions.
export function joinLastAttempt(sql: Sql): Fragment {
  return sql`
      left join lateral (
        select t.response_status, t.error_kind
        from (
          select a.attempt_number, a.response_status, a.error_kind
          from delivery_attempts a
          where a.delivery_id = d.id and a.started_at >= d.created_at and not a.stale
          union all
          select x.attempt_number, x.response_status, x.error_kind
          from dead_delivery_attempts x
          where x.delivery_id = d.id and not x.stale
        ) t
        order by t.attempt_number desc
        limit 1
      ) last on true
    `;
}
