-- Up Migration
create table deliveries (
    id                      uuid not null default uuidv7(),
    tenant_id               uuid not null,
    event_id                uuid not null,
    event_created_at        timestamptz not null,
    endpoint_id             uuid not null,
    state                   text not null default 'pending' constraint deliveries_state_valid check (state in ('pending', 'succeeded', 'dead', 'cancelled')),
    attempt_count           int not null default 0,
    throttled_count         int not null default 0,
    failure_reason          text,
    redelivered_from        uuid,
    created_at              timestamptz not null default now(),
    finished_at              timestamptz,
    primary key (id, created_at),
    constraint deliveries_finished_iff_terminal
        check ((state = 'pending') = (finished_at is null)),
    constraint deliveries_dead_has_reason
        check (state <> 'dead' or failure_reason is not null)
) partition by range (created_at);


create index idx_deliveries_endpoint on deliveries (endpoint_id, created_at desc);

create index idx_deliveries_event on deliveries (event_id);
create index idx_deliveries_dead on deliveries (tenant_id, created_at desc) where state = 'dead';

create table delivery_attempts (
    id                      bigint generated always as
  identity,
    delivery_id             uuid not null,
    attempt_number          int not null,
    signed_timestamp        bigint not null,
    outcome                 text not null
                            constraint
  delivery_attempts_outcome_valid
                            check (outcome in ('success',
  'failure', 'throttled', 'non_retryable')),
    response_status         int,
    response_body_truncated text
                            constraint
  delivery_attempts_body_max_4kb
                            check
  (length(response_body_truncated) <= 4096),
    error_kind              text
                            constraint
  delivery_attempts_error_kind_valid
                            check (error_kind in ('timeout',
  'dns', 'tls', 'conn_refused',
                                                  'redirect',
  'http_4xx', 'http_5xx')),
    stale                   boolean not null default false,
    latency_ms              int,
    started_at              timestamptz not null,
    finished_at             timestamptz,
    primary key (id, started_at)
) partition by range (started_at);

 -- ---------- Delivery: hot queue ----------
 create table delivery_queue (
    delivery_id         uuid primary key,
    delivery_created_at timestamptz not null,
    tenant_id           uuid not null,
    endpoint_id         uuid not null,
    next_attempt_at     timestamptz not null,
    claim_token         uuid,
    claimed_by          text,
    constraint delivery_queue_claim_complete
      check ((claim_token is null) = (claimed_by is null))
  ) with (
    fillfactor = 70,
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0
  );

create index idx_queue_ready on delivery_queue (tenant_id,
  next_attempt_at);
  create index idx_queue_endpoint on delivery_queue
  (endpoint_id);

  create table tenants_with_work (
    tenant_id      uuid primary key,
    last_served_at timestamptz not null default '-infinity'
  ) with (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0
  );

  alter table idempotency_keys set (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0
);

select ensure_partitions(7);

create index idx_attempts_delivery on delivery_attempts (delivery_id, attempt_number);

create table dead_delivery_attempts (
    like delivery_attempts including defaults including constraints,
    primary key (id)
);

create index idx_dead_attempts_delivery on dead_delivery_attempts (delivery_id, attempt_number);
create index idx_dead_attempts_started on dead_delivery_attempts (started_at);