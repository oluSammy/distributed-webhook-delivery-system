-- Up Migration

-- A name for each API key, so the Settings page can say which is which ("Production server",
-- "CI"). Keys made before this have none: the page shows their prefix instead.
alter table api_keys add column name text not null default '';