-- Up Migration

-- Tenants with stored events still waiting for their deliveries to be created. The Creator Worker
-- takes events from these tenants in turn, least recently served first, so one tenant's burst
-- can't hold up everyone else's events. It's what tenants_with_work does for sending.
-- The API Worker adds the tenant when it stores events; the Creator Worker removes it once it has
-- none left; the maintenance cron adds back any that's missing.
create table tenants_with_events (
    tenant_id      uuid primary key,
    last_served_at timestamptz not null default '-infinity'
) with (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0
);

-- One tenant's waiting events, oldest first. Like the index it replaces, it holds only events still
-- waiting, so it stays small however big events gets.
create index idx_events_waiting on events (tenant_id, created_at) where deliveries_created_at is null;
drop index idx_events_pending_fanout;

-- Events already waiting when this runs.
insert into tenants_with_events (tenant_id)
select distinct tenant_id from events where deliveries_created_at is null
on conflict do nothing;
