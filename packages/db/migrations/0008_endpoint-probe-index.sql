-- Up Migration

-- Every dispatcher tick looks for disabled endpoints whose probe time has come, and for the
-- earliest probe time to wake up for. Only disabled endpoints have one, so only they're indexed.
create index idx_endpoints_probe on endpoints (probe_at) where state = 'disabled';
