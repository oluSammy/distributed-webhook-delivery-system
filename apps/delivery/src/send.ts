import {
  checkEndpointTarget,
  decryptSecret,
  fromBase64,
  type MasterKey,
  signWebhook,
} from "@wds/core";
import type { ClaimedDelivery } from "./claim";

const BODY_LIMIT = 4096;

// What happened when sending: the consumer answered, the request failed, or it was never sent.
export type SendResult =
  | {
      kind: "response";
      status: number;
      retryAfter: string | null;
      body: string | null; // start of the body, failed attempts only
      signedTimestamp: number;
      startedAt: Date;
      latencyMs: number;
    }
  | { kind: "error"; error: unknown; signedTimestamp: number; startedAt: Date; latencyMs: number }
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

    const startedAt = new Date();
    try {
      const response = await fetch(claim.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": claim.event_id,
          "webhook-timestamp": String(signedTimestamp),
          "webhook-signature": signature,
          "webhook-attempt": String(claim.attempt_number),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(claim.timeout_ms),
      });

      const latencyMs = Date.now() - startedAt.getTime();
      const ok = response.status >= 200 && response.status < 300;

      return {
        kind: "response",
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: ok ? await discard(response) : await readStart(response, BODY_LIMIT),
        signedTimestamp,
        startedAt,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt.getTime();
      return { kind: "error", error, signedTimestamp, startedAt, latencyMs };
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

// Closes the connection without reading the body.
async function discard(response: Response): Promise<null> {
  await response.body?.cancel();
  return null;
}

// The first `limit` bytes of the body as text, then closes the connection. A body that stalls
// or breaks stops the reading but keeps what arrived. NUL characters are removed: Postgres text
// can't store them.
async function readStart(response: Response, limit: number): Promise<string | null> {
  if (response.body === null) {
    return null;
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const take = Math.min(value.length, limit - length);
      bytes.set(value.subarray(0, take), length);
      length += take;
    }
  } catch {
    // keep what was read
  } finally {
    reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(bytes.subarray(0, length)).replaceAll("\0", "");
}

// {"type":…,"timestamp":…,"data":…}, built as text: the payload goes in exactly as stored,
// without being parsed and serialised again.
function webhookBody(claim: ClaimedDelivery): string {
  const type = JSON.stringify(claim.event_type);
  const timestamp = JSON.stringify(claim.event_created_at.toISOString());
  return `{"type":${type},"timestamp":${timestamp},"data":${claim.payload}}`;
}
