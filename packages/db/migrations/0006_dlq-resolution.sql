-- Up Migration

-- A dead delivery leaves the DLQ when it's redelivered or discarded. It stays dead: terminal
-- states never change. These columns record what was done about it, and when.
alter table deliveries
    add column resolution text
        constraint deliveries_resolution_valid check (resolution in ('redelivered', 'discarded')),
    add column resolved_at timestamptz,
    add constraint deliveries_resolved_at_iff_resolution
        check ((resolution is null) = (resolved_at is null)),
    add constraint deliveries_resolution_only_dead
        check (resolution is null or state = 'dead');

-- The DLQ is the dead deliveries nobody has resolved yet, so that's all the index holds.
drop index idx_deliveries_dead;

create index idx_deliveries_dead on deliveries (tenant_id, created_at desc)
    where state = 'dead' and resolution is null;
    