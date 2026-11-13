# Manual smoke test (local)

A hands-on walk through the system, one piece at a time, against the local dev stack. Where
`pnpm smoke` runs the whole flow in one go, this does each step by hand and looks at the database
after it, so you can see what every part does.

Parts 1–4 are written up here. Parts 5–9 are listed at the end, still to do.

## Before you start

### Three terminals

| Terminal | Command | What it is |
|---|---|---|
| T1 | `pnpm dev` | Postgres in Docker, and the five Workers (the API on `localhost:8787`) |
| T2 | `pnpm consumer` | the test consumer, a fake customer server on `localhost:4000` |
| T3 | the commands below | where you work |

### In every new T3 terminal

```sh
cd ~/Documents/webhook-delivery-system
. ./.env.learn
q() { docker exec -i wds-postgres-1 psql -U webhooks -d webhooks -qtA "$@"; }
```

- `. ./.env.learn` loads the values saved as you go (`TENANT`, `KEY`, endpoint and event ids).
  The file matches `.env.*` in `.gitignore`. Skip this line the first time, before it exists.
- `q` runs SQL in the local database. `-qtA` prints plain rows: no headers, borders or
  `INSERT 0 1` lines, so a result can be saved in a variable.
- Both last only as long as the terminal is open.

### Check the API reaches the database

```sh
curl -s localhost:8787/readyz; echo
```

Expect `{"ok":true,"db":"up"}`.

### Make sure today has a partition

`events`, `deliveries` and `delivery_attempts` are split into one partition per UTC day. The
maintenance cron keeps 7 days made ahead, but locally it only runs when fired, so after a few days
away they run out and every insert fails with `no partition of relation "events" found for row`.

```sh
q -c "select ensure_partitions(7)"
```

It makes today's partition and the next 7 days', skipping any that exist, so it's safe to run
any time.

### Rules for copying commands

- `$NAME` is a shell variable set in an earlier step. Leave it as written; the shell fills it in.
  If a result is unexpectedly empty, check it with `echo "[$NAME]"`.
- Every command must reach the shell as one line. A long line that wraps when copied can be split
  after `-d`, and zsh then tries to run the JSON as a command (`no such file or directory: {…}`).
  That's why each API call first puts its JSON in `BODY`, then sends `-d "$BODY"`.
- No heredocs: a heredoc whose closing marker is indented never ends, and the shell waits at
  `heredoc>`. Press Ctrl+C to get out.

---

## Part 1: a tenant, an API key, event types

**A tenant** is one customer of the webhook service. Everything belongs to one: endpoints,
events, deliveries. **An API key** is the tenant's password for the API, and tells the API which
tenant is calling. **An event type** (`order.created`) must be registered before events of that
type are accepted, so a typo is refused instead of going nowhere.

There's no API route to create tenants or keys (in a product that's the sign-up page; here it's
`pnpm seed`), so this part does what the seed does, in SQL.

### 1. Create the tenant

```sh
TENANT=$(q -c "insert into tenants (name, retry_policy) values ('Learn', '{\"max_attempts\": 4, \"base_seconds\": 10, \"cap_seconds\": 60}') returning id")
echo $TENANT
```

Expect a `uuidv7` id (`01a1…`): it starts with the time it was made, so newer ids sort later.

`retry_policy` is how often and how long a failing delivery is retried. The defaults (10
attempts, waits from about 30 s up to 2 h) are too slow to watch, so Learn gets 4 attempts, waits
from 10 s, never more than 60 s: a failing delivery dies in about 2 minutes.

### 2. Create the API key

```sh
KEY="whk_live_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
q -v key="$KEY" -v tenant="$TENANT" <<< "insert into api_keys (tenant_id, scope, key_prefix, key_hash) values (:'tenant', 'tenant', left(:'key', 13), sha256(convert_to(:'key', 'UTF8')))"
printf 'TENANT=%s\nKEY=%s\n' "$TENANT" "$KEY" > .env.learn
```

- The key is `whk_live_` and 32 random bytes in a URL-safe alphabet, the format
  `generateApiKey` makes (`packages/core/src/hash.ts`). The prefix tells anyone who finds a key
  what it is, and secret scanners look for it.
- `<<<` (a here-string) sends the SQL to psql as input. psql fills in `:'key'` and `:'tenant'`
  (safely quoted) only in input it reads, not in `-c`.
- The database stores two things, never the key:
  - `key_prefix`: the first 13 characters, to recognise a key in a list
  - `key_hash`: `sha256` of the key. It's one way: a stolen database gives hashes, which can't
    call the API.

Check that the stored hash is the key's sha256:

```sh
q -c "select scope, key_prefix, encode(key_hash, 'hex') from api_keys where tenant_id = '$TENANT'"
echo -n "$KEY" | shasum -a 256
```

Expect one row, and its 64 hex characters equal to the `shasum` line.

### 3. Register event types

```sh
q -c "insert into event_types (tenant_id, name) values ('$TENANT', 'order.created'), ('$TENANT', 'order.paid'), ('$TENANT', 'payment.failed')"
q -c "select name from event_types where tenant_id = '$TENANT'"
```

### 4. How the API knows who's calling

```sh
curl -s localhost:8787/api/endpoints; echo
curl -s localhost:8787/api/endpoints -H "Authorization: Bearer whk_live_wrong"; echo
curl -s localhost:8787/api/endpoints -H "Authorization: Bearer $KEY"; echo
BODY='{"type":"order.craeted","payload":{}}'
curl -s localhost:8787/api/events -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY"; echo
```

| Call | Answer |
|---|---|
| no key | 401 `Missing API key` |
| wrong key | 401 `Invalid API key` |
| your key | `{"endpoints":[]}` |
| unregistered type | 422 `unknown_event_type`, and nothing is saved |

`requireTenant` (`apps/api/src/middleware/auth.ts`) hashes the bearer key, looks the hash up in
`api_keys` (unrevoked, scope `tenant`) and keeps its `tenant_id`. Every query after that filters
by it, and the tenant comes from the key, never from the request, so one tenant can't read
another's data.

---

## Part 2: an endpoint

**An endpoint** is a URL on the customer's server where webhooks go. **Subscriptions** say
which events it wants: `order.created` (exactly), `order.*` (any type starting `order.`), `*`
(everything). **The signing secret** is shared between us and the customer's server, one per
endpoint: we sign every webhook with it, and the customer uses it to check the webhook is ours
and unchanged. It's shown once, when the endpoint is created.

### 1. Create it

```sh
BODY='{"url":"http://localhost:4000/ok","description":"Orders","subscriptions":["order.*"]}'
RES=$(curl -s localhost:8787/api/endpoints -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY")
echo "$RES" | jq
EP_OK=$(echo "$RES" | jq -r .id); SECRET_OK=$(echo "$RES" | jq -r .signing_secret)
printf 'EP_OK=%s\nSECRET_OK=%s\n' "$EP_OK" "$SECRET_OK" >> .env.learn
```

- `/ok` on the test consumer always answers 200.
- `rate_limit_per_s: 50` and `concurrency_limit: 5` are the defaults: at most 50 webhooks a
  second, and 5 at once, to this endpoint.
- `endpoint_url_not_allowed` means the URL points at a private address (like `localhost`), which
  the API refuses so it can't be used to reach servers inside our network. Locally,
  `ALLOW_LOCAL_ENDPOINTS=true` in `.dev.vars` turns that check off.

### 2. What was saved

`createEndpoint` (`apps/api/src/routes/endpoints.ts`) writes three tables in one transaction:

```sh
q -c "select url, state, rate_limit_per_s, concurrency_limit from endpoints where id = '$EP_OK'"
q -c "select event_type_pattern from endpoint_subscriptions where endpoint_id = '$EP_OK'"
q -c "select length(secret_ciphertext), length(secret_iv), length(dek_ciphertext), length(dek_iv), kek_version from endpoint_secrets where endpoint_id = '$EP_OK'"
```

Expect `http://localhost:4000/ok|active|50|5`, then `order.*`, then `66|12|48|12|1`.

### 3. How the secret is stored

The secret has to be read back to sign each webhook, so it's encrypted, not hashed, with two keys:

| Key | What it is | Where it lives |
|---|---|---|
| DEK (data key) | random, made for this endpoint only | in the database, encrypted itself |
| master key (`MASTER_KEY_V1`) | one for the whole system | only in the Workers' secrets |

```
whsec_…  ──encrypted with the DEK──────────►  secret_ciphertext  (66 bytes)
DEK      ──encrypted with the master key───►  dek_ciphertext     (48 bytes)
```

- 66: the 50-byte secret plus AES-GCM's 16-byte tag, which makes decryption fail if any byte was
  changed. 48: the 32-byte DEK plus its tag.
- 12 and 12: the IVs, random starting values, so encrypting the same thing twice never looks the same.
- 1: `kek_version`, which master key encrypted it, so the master key can be changed later.
- A stolen database is useless without the master key. The endpoint id is mixed into the
  encryption (`additionalData`), so a secret's row copied onto another endpoint won't decrypt.

### 4. Try it

```sh
curl -s localhost:8787/api/endpoints/$EP_OK -H "Authorization: Bearer $KEY" | jq
BODY='{"url":"http://localhost:4000/ok","subscriptions":["order*"]}'
curl -s localhost:8787/api/endpoints -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq
q -c "select t, event_type_matches('order.*', t) from unnest(array['order.created','order.paid','payment.failed']) t"
```

- Reading the endpoint back shows no `signing_secret`.
- `order*` (no dot) is a 400: `Must be *, an event type, or a prefix ending in .*`.
- `event_type_matches` is the function that picks the endpoints for each event: `order.*`
  matches `order.created` and `order.paid`, not `payment.failed`.

---

## Part 3: one event, all the way through

**An event** is something that happened at the customer's business. **A delivery** is "send this
event to this endpoint": one per matching endpoint, each tracked on its own. **An attempt** is
one try at sending a delivery.

```
1. API         saves the event in events, answers 202, wakes the dispatcher
2. Dispatcher  (a Durable Object) runs a tick:
3.   Creator     finds the matching endpoints, writes deliveries + delivery_queue rows
4.   Delivery    claims due rows, asks the endpoint's limiter, signs, POSTs
5.             records the result in delivery_attempts, finishes the delivery, removes it from the queue
```

The API answers 202 (accepted), not 200: it only saves the event, and sending happens just after,
in the background, so a slow customer server never slows `POST /api/events`.

`deliveries` is the permanent record of every delivery. `delivery_queue` is the to-do list: only
deliveries still waiting, each with `next_attempt_at` (not before this). It stays small, so finding
the next job is fast.

### 1. Send one event

```sh
BODY='{"type":"order.created","payload":{"order_id":42,"total":19.99}}'
EVENT=$(curl -s localhost:8787/api/events -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq -r .id)
echo "EVENT=$EVENT" | tee -a .env.learn
```

T2 prints `POST /ok  id <event id>  attempt 1  signature not checked (WHSEC is empty)`.

### 2. Follow it through the tables

```sh
q -c "select type, created_at, deliveries_created_at from events where id = '$EVENT'"
q -c "select state, attempt_count, created_at, finished_at from deliveries where event_id = '$EVENT'"
q -c "select count(*) from delivery_queue q join deliveries d on d.id = q.delivery_id where d.event_id = '$EVENT'"
q -c "select a.attempt_number, a.outcome, a.response_status, a.latency_ms from delivery_attempts a join deliveries d on d.id = a.delivery_id where d.event_id = '$EVENT'"
```

| Table | Expect | Meaning |
|---|---|---|
| events | `deliveries_created_at` set | the creator has handled it |
| deliveries | `succeeded\|1` | one delivery, done after one attempt |
| delivery_queue | `0` | finished, so off the to-do list |
| delivery_attempts | `1\|success\|200\|<ms>` | one try, answered 200 |

### 3. The timeline

```sh
q -c "select step, at from (select 'event saved' step, created_at at from events where id = '$EVENT' union all select 'deliveries created', deliveries_created_at from events where id = '$EVENT' union all select 'attempt started', a.started_at from delivery_attempts a join deliveries d on d.id = a.delivery_id where d.event_id = '$EVENT' union all select 'delivery finished', finished_at from deliveries where event_id = '$EVENT') t order by at"
```

The four steps, in order, within a fraction of a second.

### 4. Check the signature, as a customer would

```sh
R=$(curl -s "localhost:4000/_received?webhook_id=$EVENT&path=/ok")
echo "$R" | jq '.count, .request'
WID=$(jq -r .request.id <<<"$R"); TS=$(jq -r .request.timestamp <<<"$R"); BODY=$(jq -r .request.body <<<"$R"); SIG=$(jq -r .request.signature <<<"$R")
echo "received: $SIG"
echo "computed: v1,$(printf '%s.%s.%s' "$WID" "$TS" "$BODY" | openssl dgst -sha256 -mac HMAC -macopt hexkey:$(printf '%s' "${SECRET_OK#whsec_}" | base64 -d | xxd -p -c 256) -binary | base64)"
```

- `count` 1: it arrived once.
- received and computed are identical. The computed line is HMAC-SHA256 of
  `<webhook-id>.<timestamp>.<body>`, keyed with the secret after `whsec_` (base64-decoded), then
  base64 with `v1,` in front: the [Standard Webhooks](https://www.standardwebhooks.com/) format,
  and what `signWebhook` does (`packages/core/src/signing.ts`).
- One changed character in the body gives a different signature. The timestamp is signed too, so
  an old webhook can't be sent again later as new: customers reject old timestamps.

The body's `data` comes back as `{"total": 19.99, "order_id": 42}`: different key order, and
spaces. `events.payload` is `jsonb`, which Postgres stores in its own form (keys sorted by length,
then alphabetically) and prints with spaces. The signature is over the exact text sent, so it
still matches. A customer must verify against the raw body received, never re-encoded JSON.

### 5. An event nobody subscribed to

```sh
BODY='{"type":"payment.failed","payload":{"order_id":42}}'
E2=$(curl -s localhost:8787/api/events -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq -r .id)
sleep 1; q -c "select deliveries_created_at is not null as handled, (select count(*) from deliveries where event_id = '$E2') as deliveries from events where id = '$E2'"
```

Expect `t|0`: the creator handled the event, but `order.*` doesn't match `payment.failed`, so no
delivery. The event is still stored, and a later endpoint can get it by replay (Part 8).

---

## Part 4: retries, backoff and throttling

How each answer is treated (`classify`, `packages/core/src/classify.ts`):

| The endpoint answers | Outcome | What happens |
|---|---|---|
| 2xx | success | done |
| 5xx, timeout, no connection, 408 | failure | retried later; counts toward `max_attempts` |
| 429, or 503 with `Retry-After` | throttled | retried later, not counted as a failure; the endpoint is slowed down |
| other 4xx (400, 404, 410…) | non_retryable | dead at once |

How long a failure waits (`backoffSeconds`, `packages/core/src/backoff.ts`): a random time
between 0 and a ceiling that doubles with each failure, never above the cap. For Learn (base 10 s,
cap 60 s): up to 10 s, then up to 20 s, then up to 40 s, then dead after the 4th failure. The
randomness (jitter) spreads out retries of deliveries that failed together, so they don't all hit
a recovering server at the same moment.

### A. Fails twice, then works

`/500-then-200?after=2` answers 500 to the first two receipts of each webhook, then 200.

```sh
BODY='{"url":"http://localhost:4000/500-then-200?after=2","description":"Flaky","subscriptions":["order.paid"]}'
curl -s localhost:8787/api/endpoints -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq
EP_FLAKY=$(q -c "select id from endpoints where tenant_id = '$TENANT' and url like '%500-then-200%' and state <> 'deleted' order by created_at desc limit 1")
echo "EP_FLAKY=$EP_FLAKY" | tee -a .env.learn
```

Send an `order.paid` event, then watch for 45 seconds:

```sh
BODY='{"type":"order.paid","payload":{"order_id":43}}'
E3=$(curl -s localhost:8787/api/events -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq -r .id)
echo "E3=$E3" | tee -a .env.learn
for i in {1..15}; do q -c "select split_part(e.url, '/', 4) as path, d.state, d.attempt_count, round(extract(epoch from q.next_attempt_at - now())) as due_in_s from deliveries d join endpoints e on e.id = d.endpoint_id left join delivery_queue q on q.delivery_id = d.id where d.event_id = '$E3' order by 1"; echo ---; sleep 3; done
```

- Two deliveries, because two endpoints match `order.paid`: `ok` is `succeeded` at once;
  `500-then-200` goes `pending|1|…`, `pending|2|…`, then `succeeded|2|`. One endpoint's failures
  don't touch the other's delivery.
- `attempt_count` counts failures, not tries.
- T2 shows the same webhook arrive three times with the same `id` and a rising `attempt`. The id
  stays the same on every retry, which is how a customer spots a webhook it has already handled.

The attempts, and the real waits between them:

```sh
q -c "select a.attempt_number, a.outcome, a.response_status, a.error_kind, round(extract(epoch from a.started_at - lag(a.started_at) over (order by a.started_at)), 1) as waited_s from delivery_attempts a join deliveries d on d.id = a.delivery_id where d.event_id = '$E3' and d.endpoint_id = '$EP_FLAKY' order by a.started_at"
```

Expect `1|failure|500|http_5xx|`, then `2|failure|500|http_5xx|<0–10>`, then `3|success|200||<0–20>`.

Nothing sleeps while a delivery waits. After a failure the Delivery Worker sets `next_attempt_at`
and returns; the dispatcher sets a Durable Object alarm for the earliest one, and nothing runs
until it fires. A 2-hour wait costs nothing.

### B. "Slow down" (429)

`/429?retry_after=15` always answers 429 with `Retry-After: 15`.

```sh
BODY='{"url":"http://localhost:4000/429?retry_after=15","description":"Busy","subscriptions":["payment.failed"]}'
curl -s localhost:8787/api/endpoints -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq
EP_429=$(q -c "select id from endpoints where tenant_id = '$TENANT' and url like '%/429%' and state <> 'deleted' order by created_at desc limit 1")
echo "EP_429=$EP_429" | tee -a .env.learn
BODY='{"type":"payment.failed","payload":{"order_id":42}}'
E4=$(curl -s localhost:8787/api/events -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$BODY" | jq -r .id)
echo "E4=$E4" | tee -a .env.learn
for i in {1..12}; do date +%T; q -c "select d.state, d.attempt_count, d.throttled_count, round(extract(epoch from q.next_attempt_at - now())) as due_in_s from deliveries d left join delivery_queue q on q.delivery_id = d.id where d.event_id = '$E4'"; echo ---; sleep 4; done
```

- `attempt_count` stays 0 while `throttled_count` rises: busy isn't broken, so a throttle never
  uses up attempts. Only `max_age` (72 h by default) ends a delivery that's always throttled.
- `due_in_s` jumps back to about 15 each time: `Retry-After` is followed, but never below
  `base_seconds` (so `Retry-After: 0` can't make a tight loop) or above `cap_seconds`.

The endpoint's limiter slowed down too:

```sh
curl -s localhost:8787/api/endpoints/$EP_429/health -H "Authorization: Bearer $KEY" | jq
```

- `current_rate_per_s: 25`: halved from 50 by the throttle. It never goes below 1, and climbs
  back 5 per minute (AIMD: cut quickly, recover gently, as TCP does).
- `throttled_until`: about 15 s ahead. Until then no delivery goes to this endpoint, because a
  busy server is busy for all our webhooks. Each endpoint has its own limiter (a Durable Object),
  asked before every send.
- `recent_attempts` stays 0: the circuit breaker leaves throttles out, and counts only failures.

Clean up, since this endpoint would throttle for 3 days:

```sh
curl -s -X DELETE localhost:8787/api/endpoints/$EP_429 -H "Authorization: Bearer $KEY" | jq
q -c "select state, finished_at is not null from deliveries where event_id = '$E4'"
```

Expect `{"id":"…","cancelled_deliveries":1}`, then `cancelled|t`. Deleting an endpoint takes its
waiting deliveries off the queue and marks them `cancelled`; the rows stay, so the history is kept.

---

## Still to do

5. Dead deliveries: `/fail-rate?p=1` and `/gone`, the DLQ (`GET /api/dlq`), redeliver and discard
6. Idempotency keys (`Idempotency-Key`, `Idempotent-Replayed`) and `POST /api/events/batch`
7. Pausing an endpoint, a tenant and everything (`/admin`, operator key), and cancelling a delivery
8. Replay (`POST /api/endpoints/:id/replay`), endpoint health, the circuit breaker
9. The maintenance cron by hand: `curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"`

---

## When something goes wrong

| You see | Cause | Fix |
|---|---|---|
| `heredoc>` | a heredoc's closing line is indented | Ctrl+C; use the one-line form |
| `zsh: no such file or directory: {"url":…}` | the line broke after `-d`, so the JSON ran as a command | put the JSON in `BODY`, send `-d "$BODY"` |
| plain `404` and `jq: parse error … column 8` | no route matched, usually an empty `$ID` (`/api/endpoints//health`) | `echo "[$EP_429]"`; get the id again from the database |
| a query prints nothing | no rows match, often an empty or stale variable | `echo` the variables; query with fewer filters |
| `invalid input syntax for type uuid` | a URL or name where an id goes | use the `$` variable holding the id |
| `no partition of relation … found for row` | today's partition is missing | `q -c "select ensure_partitions(7)"` |
| a loop that seems stuck | it's running, but its query returns no rows | Ctrl+C; check the variables |
| a variable empty in a new terminal | variables don't carry over | `. ./.env.learn`, and the `q` line |
