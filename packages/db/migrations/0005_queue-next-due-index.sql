-- Up Migration

-- The dispatcher asks "when is the next delivery due?" after every tick:
-- select min(next_attempt_at) from delivery_queue. idx_queue_ready starts with tenant_id,
-- so it can't answer that without reading every entry; this index answers it from its first entry.

create index idx_queue_next_due on delivery_queue (next_attempt_at);