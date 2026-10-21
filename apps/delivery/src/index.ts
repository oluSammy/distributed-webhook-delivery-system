import { WorkerEntrypoint } from "cloudflare:workers";
import { classify, importMasterKey, type NextStep, nextStep, parseRetryPolicy } from "@wds/core";
import { createDb } from "@wds/db";
import type { Sql } from "postgres";
import {
  type ClaimedDelivery,
  claimDeliveries,
  DELIVERIES_PER_BATCH,
  LEASE_SECONDS,
} from "./claim";
import type { BatchResult, DeliveryApi } from "./contract";
import { forEachLimited } from "./limit";
import { recordOutcome, releaseClaims } from "./record";
import { Sender } from "./send";

// Workers allow 6 open connections per call; more would queue, with their timeouts already running.
const MAX_IN_FLIGHT = 6;

// Time kept back at the end of the lease for recording an outcome.
const RECORD_MARGIN_MS = 5000;

export default class Delivery extends WorkerEntrypoint<Env> implements DeliveryApi {
  async runBatch(shard: number): Promise<BatchResult> {
    const sql = createDb(this.env.HYPERDRIVE.connectionString);
    try {
      const callId = `shard-${shard}/${crypto.randomUUID()}`;
      const claims = await claimDeliveries(sql, callId);
      const leaseEndsAt = Date.now() + LEASE_SECONDS * 1000;
      console.log(`delivery ${callId}: claimed ${claims.length}`);

      const unsent = new Set(claims);
      try {
        if (claims.length > 0) {
          const masters = new Map([[1, await importMasterKey(this.env.MASTER_KEY_V1, 1)]]);
          const sender = new Sender(masters, this.env.ALLOW_LOCAL_ENDPOINTS === "true");
          await forEachLimited(claims, MAX_IN_FLIGHT, async (claim) => {
            // Too close to the end of the lease: another call could claim it while we send.
            if (Date.now() + claim.timeout_ms + RECORD_MARGIN_MS > leaseEndsAt) {
              return;
            }
            unsent.delete(claim);
            try {
              await deliver(sql, sender, claim);
            } catch (error) {
              // The claim stays leased and comes back when the lease runs out.
              console.error(`delivery ${claim.delivery_id}: failed to deliver`, error);
            }
          });
        }
      } finally {
        if (unsent.size > 0) {
          await releaseClaims(sql, [...unsent]).catch((error) =>
            console.error(`delivery ${callId}: failed to release ${unsent.size} claims`, error),
          );
        }
      }

      return {
        claimed: claims.length,
        nextDueAt: null,
        fullBatch: claims.length === DELIVERIES_PER_BATCH,
      };
    } finally {
      this.ctx.waitUntil(sql.end());
    }
  }

  override async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
}

// Sends one claimed delivery and records what happened.
async function deliver(sql: Sql, sender: Sender, claim: ClaimedDelivery): Promise<void> {
  const result = await sender.send(claim);
  const label = `delivery ${claim.delivery_id} attempt ${claim.attempt_number} → ${claim.url}`;

  if (result.kind === "blocked") {
    const step: NextStep = { state: "dead", reason: "url_not_allowed" };
    const applied = await recordOutcome(sql, claim, step, null);
    console.log(`${label}: not sent, ${result.reason} → ${describe(step, applied)}`);
    return;
  }

  const now = new Date();
  const classification = classify(result, now);
  const step = nextStep(
    classification,
    { attemptCount: claim.attempt_count, createdAt: claim.delivery_created_at },
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
