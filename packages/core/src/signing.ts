import { fromBase64, toBase64 } from "./encoding.ts";

const encoder = new TextEncoder();
const SECRET_PREFIX = "whsec_";

// How far the webhook-timestamp may be from the receiver's clock. Older messages are rejected, so a
// captured request can't be replayed later.
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type WebhookMessage = {
  id: string;
  timestamp: number; // unix seconds
  body: string;
};

// The webhook-signature header (Standard Webhooks): "v1,<base64 HMAC-SHA256>" for each secret,
// separated by spaces, so during a rotation the consumer can verify with either one.
export async function signWebhook(
  message: WebhookMessage,
  secrets: readonly string[],
): Promise<string> {
  if (secrets.length === 0) {
    throw new Error("at least one signing secret is required");
  }
  const content = signedContent(message);
  const signatures = await Promise.all(
    secrets.map(async (secret) => {
      const key = await importSigningKey(secret, "sign");
      const signature = await crypto.subtle.sign("HMAC", key, content);
      return `v1,${toBase64(new Uint8Array(signature))}`;
    }),
  );
  return signatures.join(" ");
}

function signedContent(message: WebhookMessage) {
  return encoder.encode(`${message.id}.${message.timestamp}.${message.body}`);
}

function importSigningKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  if (!secret.startsWith(SECRET_PREFIX)) {
    throw new Error(`signing secret must start with ${SECRET_PREFIX}`);
  }
  return crypto.subtle.importKey(
    "raw",
    fromBase64(secret.slice(SECRET_PREFIX.length)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

// True when the header holds a valid signature from one of the secrets and the timestamp is within
// the tolerance. crypto.subtle.verify compares the signatures in constant time.
export async function verifyWebhook(
  message: WebhookMessage,
  header: string,
  secrets: readonly string[],
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (
    !Number.isInteger(message.timestamp) ||
    Math.abs(now - message.timestamp) > TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const content = signedContent(message);
  const signatures = parseSignatures(header);
  for (const secret of secrets) {
    const key = await importSigningKey(secret, "verify");
    for (const signature of signatures) {
      if (await crypto.subtle.verify("HMAC", key, signature, content)) {
        return true;
      }
    }
  }
  return false;
}

// The v1 signatures in a header, decoded. Other versions and malformed parts are skipped.
function parseSignatures(header: string): Uint8Array<ArrayBuffer>[] {
  const signatures = [];
  for (const part of header.split(" ")) {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) {
      continue;
    }
    try {
      signatures.push(fromBase64(signature));
    } catch {
      // not valid base64
    }
  }
  return signatures;
}
