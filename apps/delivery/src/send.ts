import {
  checkEndpointTarget,
  decryptSecret,
  fromBase64,
  type MasterKey,
  signWebhook,
} from "@wds/core";
import type { ClaimedDelivery } from "./claim";

export type SendResult =
  | { kind: "response"; status: number; latencyMs: number; signedTimestamp: number }
  | { kind: "error"; error: unknown; latencyMs: number; signedTimestamp: number }
  | { kind: "blocked"; reason: string };

type PreparedEndpoint = {
  problem: string | null;
  secrets: string[];
};

export class Sender {
  private readonly endpoints = new Map<string, Promise<PreparedEndpoint>>();

  constructor(
    private readonly masters: ReadonlyMap<number, MasterKey>,
    private readonly allowLocal: boolean,
  ) {}

  async send(claim: ClaimedDelivery): Promise<SendResult> {
    const endpoint = await this.prepare(claim);
    if (endpoint.problem !== null) {
      return { kind: "blocked", reason: `Endpoint URL ${endpoint.problem}` };
    }

    const body = webhookBody(claim);
    const signedTimestamp = Math.floor(Date.now() / 1000);
    const signature = await signWebhook(
      { id: claim.event_id, timestamp: signedTimestamp, body },
      endpoint.secrets,
    );

    const started = Date.now();
    try {
      const response = await fetch(claim.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": claim.event_id,
          "webhook-timestamp": String(signedTimestamp),
          "webhook-signature": signature,
          "webhook-attempt": String(claim.attempt_count + 1),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(claim.timeout_ms),
      });
      await response.body?.cancel();
      return {
        kind: "response",
        status: response.status,
        latencyMs: Date.now() - started,
        signedTimestamp,
      };
    } catch (error) {
      return { kind: "error", error, latencyMs: Date.now() - started, signedTimestamp };
    }
  }

  private prepare(claim: ClaimedDelivery): Promise<PreparedEndpoint> {
    let prepared = this.endpoints.get(claim.endpoint_id);
    if (prepared === undefined) {
      prepared = this.prepareEndpoint(claim);
      this.endpoints.set(claim.endpoint_id, prepared);
    }

    return prepared;
  }

  private async prepareEndpoint(claim: ClaimedDelivery): Promise<PreparedEndpoint> {
    const problem = await checkEndpointTarget(claim.url, { allowLocal: this.allowLocal });
    if (problem !== null) {
      return { problem, secrets: [] };
    }
    const secrets = await Promise.all(
      claim.secrets.map((stored) =>
        decryptSecret(
          {
            secretCiphertext: fromBase64(stored.secret_ciphertext),
            secretIv: fromBase64(stored.secret_iv),
            dekCiphertext: fromBase64(stored.dek_ciphertext),
            dekIv: fromBase64(stored.dek_iv),
            kekVersion: stored.kek_version,
          },
          claim.endpoint_id,
          this.masters,
        ),
      ),
    );
    return { problem: null, secrets };
  }
}

// {"type":…,"timestamp":…,"data":…}, built as text: the payload goes in exactly as stored,
// without being parsed and serialised again.
function webhookBody(claim: ClaimedDelivery): string {
  const type = JSON.stringify(claim.event_type);
  const timestamp = JSON.stringify(claim.event_created_at.toISOString());
  return `{"type":${type},"timestamp":${timestamp},"data":${claim.payload}}`;
}
