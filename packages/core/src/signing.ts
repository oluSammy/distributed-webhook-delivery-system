import { fromBase64, toBase64 } from "./encoding.ts";

const encoder = new TextEncoder();
const SECRET_PREFIX = "whsec_";

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
  const content = encoder.encode(`${message.id}.${message.timestamp}.${message.body}`);
  const signatures = await Promise.all(
    secrets.map(async (secret) => {
      const key = await importSigningKey(secret);
      const signature = await crypto.subtle.sign("HMAC", key, content);
      return `v1,${toBase64(new Uint8Array(signature))}`;
    }),
  );
  return signatures.join(" ");
}

function importSigningKey(secret: string): Promise<CryptoKey> {
  if (!secret.startsWith(SECRET_PREFIX)) {
    throw new Error(`signing secret must start with ${SECRET_PREFIX}`);
  }
  return crypto.subtle.importKey(
    "raw",
    fromBase64(secret.slice(SECRET_PREFIX.length)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
