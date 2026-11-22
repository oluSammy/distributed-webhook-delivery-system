-- Up Migration

-- The Deliveries page lists all of a tenant's deliveries, newest first, a page at a time. Without
-- this, Postgres would read every one of the tenant's deliveries and sort them to show the first
-- 50. With it, it reads the newest 50 straight off the index, and the next page starts where the
-- cursor (created_at, id) left off. On the partitioned table it's made on every partition, and on
-- each new one.
create index idx_deliveries_tenant on deliveries (tenant_id, created_at desc, id desc);