-- Up Migration

-- Drops the daily partitions of delivery_attempts that ended at or before cutoff, oldest first.
-- Before each one goes, the attempts of dead deliveries are copied into dead_delivery_attempts,
-- in the same transaction, so the DLQ keeps their history as long as the deliveries themselves.
-- Other attempts are simply dropped: a succeeded or cancelled delivery's history isn't kept as
-- long. Returns how many partitions were dropped and how many attempts were archived.
create function drop_attempt_partitions_before(cutoff timestamptz, out dropped int, out archived int)
language plpgsql as $$
declare
    part   record;
    copied int;
begin
    dropped := 0;
    archived := 0;
    for part in
        select i.inhrelid::regclass as child,
                (to_date(right(i.inhrelid::regclass::text, 8), 'YYYYMMDD') + 1)::timestamp
                    at time zone 'UTC' as ends_at
        from pg_inherits i
        where i.inhparent = 'delivery_attempts'::regclass
        order by ends_at
    loop
        exit when part.ends_at > cutoff;
        -- A delivery is created before its attempts, so only deliveries created before this
        -- partition's end can own them; idx_deliveries_dead finds the dead ones.
        execute format(
            'insert into dead_delivery_attempts
            select a.* from %s a
            join deliveries d on d.id = a.delivery_id
            where d.state = ''dead'' and d.created_at < $1
            on conflict (id) do nothing',
            part.child
        ) using part.ends_at;
        get diagnostics copied = row_count;
        archived := archived + copied;
        execute format('drop table %s', part.child);
        dropped := dropped + 1;
    end loop;
end
$$;
