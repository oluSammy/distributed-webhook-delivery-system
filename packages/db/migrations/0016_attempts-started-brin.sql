-- /metrics counts the attempts of the last 5 minutes. delivery_attempts had no index on started_at,
-- so that meant reading the whole of today's partition, millions of rows on a busy day. Attempts are
-- written in roughly started_at order, so a BRIN index (one small summary of the lowest and highest
-- started_at per block range of the table) points at the last few blocks only. It's tiny, and costs
-- almost nothing to keep up on each insert, unlike a regular index. A block range is only skipped
-- once it has been summarized; autosummarize asks autovacuum to summarize each one as it fills,
-- instead of waiting for the table's next vacuum.
create index idx_attempts_started on delivery_attempts using brin (started_at) with (autosummarize = on);