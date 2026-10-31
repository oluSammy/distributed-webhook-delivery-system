-- Up Migration

-- Pausing, resuming, a breaker trip or close, and the probe job all look up one endpoint's rows
-- by next_attempt_at: waiting ones to park, parked ones ('infinity') to un-park. With
-- next_attempt_at in the index, that's a range scan instead of reading all the endpoint's rows.
-- It adds almost nothing to writes: an update of next_attempt_at already changes idx_queue_ready,
-- so it can never be a HOT update, and every index gets a new entry either way.
drop index idx_queue_endpoint;
create index idx_queue_endpoint on delivery_queue (endpoint_id, next_attempt_at);