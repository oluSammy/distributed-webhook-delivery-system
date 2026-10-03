-- Up Migration
create function set_updated_at() returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end
$$;

----------- Tenancy & auth ----------
create table tenants (
    id                  uuid primary key default uuidv7(),
    name                text not null,
    retry_policy        jsonb not null default '{}',
    delivery_timeout_ms int not null default 10000
    constraint tenants_delivery_timeout_range
                        check (delivery_timeout_ms between 1000 and 30000),
    strict_schema       boolean not null default false,
    paused              boolean not null default false,
    created_at          timestamptz not null default now()
);

create table api_keys (
    id              uuid primary key default uuidv7(),
    tenant_id       uuid references tenants (id) on delete cascade,
    scope           text not null constraint api_keys_scope_valid check (scope in ('tenant', 'operator')),
    key_prefix       text not null,
    key_hash        bytea not null unique,
    created_at      timestamptz not null default now(),
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    constraint api_keys_operator_has_no_tenant check ((scope = 'operator') = (tenant_id is null))
);

create table event_types (
    id              uuid primary key default uuidv7(),
    tenant_id       uuid not null references tenants
                    (id) on delete cascade,
    name            text not null
                    constraint event_types_name_format check (name ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
    schema          jsonb,
    created_at      timestamptz not null default now(),
    unique (tenant_id, name)
);

-- ---------- Endpoints ----------
create table endpoints (
    id                  uuid primary key default uuidv7(),
    tenant_id           uuid not null references tenants (id) on delete cascade,
    url                 text not null,
    description         text not null default '',
    state               text not null default 'active' constraint endpoints_state_valid check (state in ('active', 'paused', 'disabled', 'deleted')),
    rate_limit_per_s    int not null default 50 constraint endpoints_rate_limit_positive check (rate_limit_per_s > 0),
    concurrency_limit   int not null default 5 constraint endpoints_concurrency_positive check (concurrency_limit > 0),
    strict_ordering     boolean not null default false,
    updated_at          timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

create index idx_endpoints_tenant on endpoints (tenant_id);

create trigger endpoints_set_updated_at
    before update on endpoints
    for each row execute function
set_updated_at();

create table endpoint_subscriptions (
    endpoint_id        uuid not null references endpoints (id) on delete cascade,
    event_type_pattern text not null constraint endpoint_subscriptions_pattern_format
                       check (event_type_pattern ~ '^(\*|[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?)$'),
    primary key (endpoint_id, event_type_pattern)
);

create table endpoint_secrets (
    id                uuid primary key default uuidv7(),
    endpoint_id       uuid not null references endpoints (id) on delete cascade,
    secret_ciphertext bytea not null,
    secret_iv         bytea not null,
    dek_ciphertext    bytea not null,
    dek_iv            bytea not null,
    kek_version       int not null,
    created_at        timestamptz not null default now(),
    expires_at        timestamptz
);

create index idx_endpoint_secrets_endpoint on
  endpoint_secrets (endpoint_id);

create unique index uq_endpoint_secrets_current
    on endpoint_secrets (endpoint_id)
    where expires_at is null;