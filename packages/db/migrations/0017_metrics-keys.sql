-- Up Migration

-- A third kind of API key, metrics: it can read GET /metrics and nothing else. It's the key a
-- hosted monitoring service (Grafana Cloud) stores to scrape the numbers, so if it ever leaked, it
-- would show counts, never data, and couldn't pause or change anything. Like an operator key, it
-- belongs to no tenant.
alter table api_keys drop constraint api_keys_scope_valid;
alter table api_keys add constraint api_keys_scope_valid
    check (scope in ('tenant', 'operator', 'metrics'));

alter table api_keys drop constraint api_keys_operator_has_no_tenant;
alter table api_keys add constraint api_keys_only_tenant_keys_have_a_tenant
    check ((scope = 'tenant') = (tenant_id is not null));