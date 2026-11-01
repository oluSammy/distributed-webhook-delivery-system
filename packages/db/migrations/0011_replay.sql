-- Up Migration

-- Whether a subscription pattern matches an event type: '*' matches everything, a type matches
-- itself, and a prefix ending in '.*' matches every type under it ('order.*' matches 'order.paid'
-- and 'order.payment.refunded', not 'orderx.created'). starts_with, not like: '_' is a wildcard in
-- like, and event types can contain it. Creating deliveries and replay both use it, so they can't
-- disagree. A one-expression SQL function like this is inlined into the query that calls it.
create function event_type_matches(pattern text, event_type text) returns boolean
language sql immutable parallel safe
return pattern = '*'
    or pattern = event_type
    or (pattern like '%.*' and starts_with(event_type, left(pattern, -1)));

-- Replay reads one tenant's events in a time range, oldest first. Without this, it would read
-- every tenant's events in that range. Events are written once and never updated, so this costs
-- one index entry per event.
create index idx_events_tenant on events (tenant_id, created_at, id);
