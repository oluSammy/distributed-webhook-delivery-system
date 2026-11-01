-- Up Migration

-- Drops the parent's daily partitions that ended at or before cutoff, oldest first, and returns
-- how many. still_needed, when given, is a query run with $1 = a partition's end: if it returns
-- true, something unfinished still needs that partition's rows, so it and every newer one stay.
create function drop_partitions_before(parent regclass, cutoff timestamptz, still_needed text default null)
returns int
language plpgsql as $$
declare
    part    record;
    needed  boolean;
    dropped int := 0;
begin
    for part in
        select i.inhrelid::regclass as child,
                (to_date(right(i.inhrelid::regclass::text, 8), 'YYYYMMDD') + 1)::timestamp
                    at time zone 'UTC' as ends_at
        from pg_inherits i
        where i.inhparent = parent
        order by ends_at
    loop
        exit when part.ends_at > cutoff;
        if still_needed is not null then
            execute still_needed into needed using part.ends_at;
            exit when needed;
        end if;
        execute format('drop table %s', part.child);
        dropped := dropped + 1;
    end loop;
    return dropped;
end
$$;

-- Never used, and replaced by drop_partitions_before, which can keep a partition still needed.
drop function drop_partitions_older_than(regclass, interval);
  