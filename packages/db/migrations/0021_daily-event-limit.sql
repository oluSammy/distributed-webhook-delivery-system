-- Up Migration

-- Events accepted per tenant per UTC day, for the daily event limit
-- 9; the limit itself is DAILY_EVENT_LIMIT in the API Worker's config, the same for every tenant).
-- Storing events adds to today's row in the same statement, which locks the row, so two requests at
-- once can't both pass the limit. The maintenance job deletes days older than 30.
create table tenant_daily_usage (
    tenant_id uuid not null references tenants (id) on delete cascade,
    day       date not null,
    events    int not null,
    primary key (tenant_id, day)
);