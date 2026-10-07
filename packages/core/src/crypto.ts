import { fromBase64, randomBytes, toBase64 } from "./encoding.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const KEY_LENGTH = 32;
const IV_LENGTH = 12;

export type MasterKey = {
  version: number;
  key: CryptoKey;
};

export type EncryptedSecret = {
  secretCiphertext: Uint8Array<ArrayBuffer>;
  secretIv: Uint8Array<ArrayBuffer>;
  dekCiphertext: Uint8Array<ArrayBuffer>;
  dekIv: Uint8Array<ArrayBuffer>;
  kekVersion: number;
};

export function generateSigningSecret(): string {
  return `whsec_${toBase64(randomBytes(32))}`;
}

export async function importMasterKey(base64: string, version: number): Promise<MasterKey> {
  const raw = fromBase64(base64);
  if (raw.length !== KEY_LENGTH) {
    throw new Error(`master key v${version} must be ${KEY_LENGTH} bytes, got ${raw.length}`);
  }
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { version, key };
}

export async function encryptSecret(
  secret: string,
  endpointId: string,
  master: MasterKey,
): Promise<EncryptedSecret> {
  const rawDek = randomBytes(KEY_LENGTH);
  const dek = await crypto.subtle.importKey("raw", rawDek, "AES-GCM", false, ["encrypt"]);

  const secretIv = randomBytes(IV_LENGTH);
  const secretCiphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: secretIv, additionalData: encoder.encode(endpointId) },
      dek,
      encoder.encode(secret),
    ),
  );

  const dekIv = randomBytes(IV_LENGTH);
  const dekCiphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: dekIv }, master.key, rawDek),
  );
  return { secretCiphertext, secretIv, dekCiphertext, dekIv, kekVersion: master.version };
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  endpointId: string,
  masters: ReadonlyMap<number, MasterKey>,
): Promise<string> {
  const master = masters.get(encrypted.kekVersion);
  if (!master) {
    throw new Error(`no master key for version ${encrypted.kekVersion}`);
  }

  const rawDek = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encrypted.dekIv },
    master.key,
    encrypted.dekCiphertext,
  );
  const dek = await crypto.subtle.importKey("raw", rawDek, "AES-GCM", false, ["decrypt"]);

  const secret = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encrypted.secretIv, additionalData: encoder.encode(endpointId) },
    dek,
    encrypted.secretCiphertext,
  );
  return decoder.decode(secret);
}
