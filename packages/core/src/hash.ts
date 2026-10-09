import { randomBytes, toBase64Url } from "./encoding.ts";

const encoder = new TextEncoder();

export async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(data)));
}

export type ApiKeyScope = "tenant" | "operator";

const KEY_PREFIXES: Record<ApiKeyScope, string> = {
  tenant: "whk_live_",
  operator: "whk_op_",
};

const VISIBLE_PREFIX_LENGTH = 4;

export type GeneratedApiKey = {
  key: string;
  prefix: string;
  hash: Uint8Array;
};

export async function generateApiKey(scope: ApiKeyScope): Promise<GeneratedApiKey> {
  const key = KEY_PREFIXES[scope] + toBase64Url(randomBytes(32));
  const prefix = key.slice(0, KEY_PREFIXES[scope].length + VISIBLE_PREFIX_LENGTH);
  return { key, prefix, hash: await sha256(key) };
}

export function hashApiKey(key: string): Promise<Uint8Array> {
  return sha256(key);
}

export function requestHash(type: string, payload: unknown): Promise<Uint8Array> {
  return sha256(`${type}\n${JSON.stringify(payload)}`);
}
