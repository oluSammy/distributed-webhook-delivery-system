-- Up Migration

-- Settings for the whole system, in one row. paused holds every delivery, for example
-- during a risky deploy.
create table global_settings (
    id      boolean primary key default true constraint global_settings_one_row check (id),
    paused  boolean not null default false
);
insert into global_settings default values;

-- Whether each endpoint's deliveries are held back, and why:
-- - disabled: its circuit breaker tripped, so only a probe may be sent.
-- - paused: the endpoint, its tenant or the whole system is paused, so nothing is sent.
create view endpoint_holds as
select e.id as endpoint_id,
        e.state = 'disabled' as disabled,
        e.state = 'paused' or t.paused or g.paused as paused
from endpoints e
join tenants t on t.id = e.tenant_id
cross join global_settings g;
