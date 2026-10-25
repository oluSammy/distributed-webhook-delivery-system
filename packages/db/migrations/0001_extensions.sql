-- Up Migration
-- a Postgres extension that records statistics for every query the database runs: how
--   many times it ran, total and average time, and how many rows it returned.
create extension if not exists
pg_stat_statements;

-- Down Migration
drop extension if exists pg_stat_statements;