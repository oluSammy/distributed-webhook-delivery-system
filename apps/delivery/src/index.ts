import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type Acquired,
  type Classification,
  classify,
  type EndpointLimiter,
  importMasterKey,
  type NextStep,
  nextStep,
  parseRetryPolicy,
} from "@wds/core";
import { createDb } from "@wds/db";
import type { LimiterApi } from "@wds/limiter/contract";
import type { Sql } from "postgres";
import { type ClaimedDelivery, claimDeliveries, LEASE_SECONDS } from "./claim";
import type { BatchResult, DeliveryApi } from "./contract";
import { forEachLimited } from "./limit";
import { recordOutcome, releaseClaims } from "./record";
import { Sender } from "./send";

// Workers allow 6 open connections per call; more would queue, with their timeouts already running.
const MAX_IN_FLIGHT = 6;

// Time kept back at the end of the lease for recording an outcome.
const RECORD_MARGIN_MS = 5000;

// When the limiter can't be reached, the delivery waits this long rather than being sent with no
// limits: an outage holds deliveries back instead of letting them flood the endpoint.
const LIMITER_DOWN_WAIT_MS = 10_000;

export default class Delivery extends WorkerEntrypoint<Env> implements DeliveryApi {
  async runBatch(shard: number): Promise<BatchResult> {
    const sql = createDb(this.env.HYPERDRIVE.connectionString);
    try {
      const callId = `shard-${shard}/${crypto.randomUUID()}`;
      const claims = await claimDeliveries(sql, callId);
      const leaseEndsAt = Date.now() + LEASE_SECONDS * 1000;
      console.log(`delivery ${callId}: claimed ${claims.length}`);

      // Claims to give back unsent, with when each is due again (null: now). Every claim starts
      // here and leaves when it's sent; one the limiter holds back gets the limiter's time.
      const unsent = new Map<ClaimedDelivery, Date | null>(claims.map((claim) => [claim, null]));
      try {
        if (claims.length > 0) {
          const masters = new Map([[1, await importMasterKey(this.env.MASTER_KEY_V1, 1)]]);
          const sender = new Sender(masters, this.env.ALLOW_LOCAL_ENDPOINTS === "true");
          const limiter = durableLimiter(this.env);
          await forEachLimited(claims, MAX_IN_FLIGHT, async (claim) => {
            // Too close to the end of the lease: another call could claim it while we send.
            if (Date.now() + claim.timeout_ms + RECORD_MARGIN_MS > leaseEndsAt) {
              return;
            }
            const slot = await acquireSlot(limiter, claim);
            if (!slot.go) {
              unsent.set(claim, new Date(slot.retryAt));
              return;
            }
            unsent.delete(claim);
            let result: Classification | null = null;
            try {
              result = await deliver(sql, sender, claim);
            } catch (error) {
              // The claim stays leased and comes back when the lease runs out.
              console.error(`delivery ${claim.delivery_id}: failed to deliver`, error);
            } finally {
              // If this fails, the slot frees itself when its lease ends.
              await limiter
                .release(claim.endpoint_id, slot.slotId, result)
                .catch((error) =>
                  console.error(`delivery ${claim.delivery_id}: release failed`, error),
                );
            }
          });
        }
      } finally {
        if (unsent.size > 0) {
          await releaseClaims(sql, unsent).catch((error) =>
            console.error(`delivery ${callId}: failed to release ${unsent.size} claims`, error),
          );
        }
      }

      return {
        claimed: claims.length,
      };
    } finally {
      this.ctx.waitUntil(sql.end());
    }
  }

  override async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
}

// The limiter on Cloudflare: one EndpointLimiter Durable Object per endpoint, named by its id.
function durableLimiter(env: Env): EndpointLimiter {
  const limiters = env.LIMITER as DurableObjectNamespace<LimiterApi>;
  return {
    acquire: (endpointId, limits, leaseMs) =>
      limiters.getByName(endpointId).acquire(limits, leaseMs),
    release: (endpointId, slotId, result) => limiters.getByName(endpointId).release(slotId, result),
  };
}

// Asks the endpoint's limiter whether this delivery can be sent now. The slot is leased for the
// send's timeout plus the time kept for recording, so a slot this call never releases frees itself.
async function acquireSlot(limiter: EndpointLimiter, claim: ClaimedDelivery): Promise<Acquired> {
  const limits = { ratePerSecond: claim.rate_limit_per_s, concurrency: claim.concurrency_limit };
  try {
    const slot = await limiter.acquire(
      claim.endpoint_id,
      limits,
      claim.timeout_ms + RECORD_MARGIN_MS,
    );
    if (!slot.go) {
      console.log(
        `delivery ${claim.delivery_id}: limiter says wait until ${new Date(slot.retryAt).toISOString()}`,
      );
    }
    return slot;
  } catch (error) {
    console.error(`delivery ${claim.delivery_id}: limiter unreachable, waiting`, error);
    return { go: false, retryAt: Date.now() + LIMITER_DOWN_WAIT_MS };
  }
}

// Sends one claimed delivery and records what happened. Returns what the endpoint's answer meant,
// for the limiter, or null when nothing was sent.
async function deliver(
  sql: Sql,
  sender: Sender,
  claim: ClaimedDelivery,
): Promise<Classification | null> {
  const result = await sender.send(claim);
  const label = `delivery ${claim.delivery_id} attempt ${claim.attempt_number} → ${claim.url}`;

  if (result.kind === "blocked") {
    const step: NextStep = { state: "dead", reason: "url_not_allowed" };
    const applied = await recordOutcome(sql, claim, step, null);
    console.log(`${label}: not sent, ${result.reason} → ${describe(step, applied)}`);
    return null;
  }

  const now = new Date();
  const classification = classify(result, now);
  const step = nextStep(
    classification,
    {
      attemptCount: claim.attempt_count,
      throttledCount: claim.throttled_count,
      createdAt: claim.delivery_created_at,
    },
    parseRetryPolicy(claim.retry_policy),
    now,
  );
  const applied = await recordOutcome(sql, claim, step, {
    outcome: classification.outcome,
    errorKind: classification.errorKind,
    status: result.kind === "response" ? result.status : null,
    body: result.kind === "response" ? result.body : null,
    signedTimestamp: result.signedTimestamp,
    startedAt: result.startedAt,
    latencyMs: result.latencyMs,
  });

  const what =
    result.kind === "response"
      ? `HTTP ${result.status}`
      : result.error instanceof Error
        ? result.error.name
        : "error";
  console.log(
    `${label}: ${what} in ${result.latencyMs} ms, ${classification.outcome} → ${describe(step, applied)}`,
  );

  return classification;
}

function describe(step: NextStep, applied: boolean): string {
  if (!applied) {
    return "stale claim, outcome discarded";
  }
  switch (step.state) {
    case "succeeded":
      return "succeeded";
    case "dead":
      return `dead (${step.reason})`;
    case "pending":
      return `retry at ${step.nextAttemptAt.toISOString()}`;
  }
}
