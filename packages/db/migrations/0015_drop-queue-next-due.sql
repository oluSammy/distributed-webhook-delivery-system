 -- Up Migration

  -- idx_queue_next_due (next_attempt_at) answered the Dispatcher's "when is the next delivery due?"
  -- from its first entry. But the claim can use it too, and with one tenant owning most of the queue,
  -- Postgres's statistics make it look cheapest: it walks the queue in time order and skips other
  -- tenants' rows. For a tenant with nothing due, that's the whole queue: 631 ms per claim with
  -- 1,000,000 rows, against 0.4 ms with idx_queue_ready (tenant_id, next_attempt_at). The Dispatcher
  -- now asks per tenant, on idx_queue_ready (findNextDue, apps/dispatcher/src/next-due.ts), so this
  -- index has no job left. It also means one index fewer to update on every queue write.
  drop index idx_queue_next_due;