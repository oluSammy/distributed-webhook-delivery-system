-- Up Migration
create function create_daily_partition(parent regclass, day date) returns void
language plpgsql as $$
declare
    partition_name  text := format('%s_p%s', parent::text, to_char(day, 'YYYYMMDD'));
    range_start     timestamptz := day::timestamp at time zone 'UTC';
    range_end       timestamptz := (day + 1)::timestamp at time zone 'UTC';
    begin
        if to_regclass(partition_name) is not null then return;
        end if;
        execute format(
            'create table %I partition of %s for values from (%L) to (%L)',
            partition_name, parent, range_start, range_end
        );
    end;
    $$;


create function ensure_partitions(days_ahead int default 7) returns void
    language plpgsql as $$
    declare
        parent regclass;
        today date := (now() at time zone 'UTC')::date;
    begin
        for parent in
            select pt.partrelid::regclass
            from pg_partitioned_table pt
            join pg_class c on c.oid = pt.partrelid
            where pt.partstrat = 'r'
                and c.relnamespace = 'public'::regnamespace
        loop
            for i in 0..days_ahead loop
                perform create_daily_partition(parent, today + i);
            end loop;
        end loop;
    end;
$$;

create function drop_partitions_older_than(parent regclass, max_age interval) returns int
    language plpgsql as $$
    declare
        child   regclass;
        dropped int := 0;
        cutoff  date := ((now() - max_age) at time zone 'UTC')::date;
    begin
        for child in
            select i.inhrelid::regclass
            from pg_inherits i
            where i.inhparent = parent
        loop
            if to_date(right(child::text, 8), 'YYYYMMDD') < cutoff
        then
                execute format('drop table %s', child);
                dropped := dropped + 1;
            end if;
        end loop;
        return dropped;
    end;
    $$;

-------- Ingestion ---------
create table events (
    id              uuid not null default uuidv7(),
    tenant_id       uuid not null,
    type            text not null,
    payload         jsonb not null,
    idempotency_key text,
    deliveries_created_at   timestamptz,
    created_at      timestamptz not null default now(),
    primary key (id, created_at)
) partition by range (created_at);

create index idx_events_pending_fanout on events (created_at) where deliveries_created_at is null;

create table idempotency_keys (
    tenant_id           uuid not null,
    key                 text not null constraint idempotency_keys_key_length check (length(key) between 1 and 255),
    event_id            uuid not null,
    event_created_at    timestamptz not null,
    request_hash        bytea not null,
    expires_at          timestamptz not null,
    primary key (tenant_id, key)
);

create index idx_idempotency_keys_expires on idempotency_keys (expires_at);

select ensure_partitions(7);