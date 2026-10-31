-- Up Migration

  -- When a disabled endpoint's next probe may go. Its circuit breaker sets it when it trips (and
  -- again after each failed probe), and clears it when it closes.
  alter table endpoints
      add column probe_at timestamptz,
      add constraint endpoints_probe_at_iff_disabled
          check ((state = 'disabled') = (probe_at is not null));

  -- What the endpoint's owner is told about: for now, its breaker tripping and closing.
  create table notifications (
      id          uuid primary key default uuidv7(),
      tenant_id   uuid not null references tenants (id) on delete cascade,
      endpoint_id uuid not null references endpoints (id) on delete cascade,
      kind        text not null
                  constraint notifications_kind_valid check (kind in ('breaker_tripped', 'breaker_closed')),
      created_at  timestamptz not null default now()
  );