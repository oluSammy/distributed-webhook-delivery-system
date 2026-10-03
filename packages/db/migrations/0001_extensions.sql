-- Up Migration
create extension if not exists
pg_stat_statements;

-- Down Migration
drop extension if exists pg_stat_statements;