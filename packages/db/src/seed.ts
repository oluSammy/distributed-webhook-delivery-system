import {
  encryptSecret,
  firstRow,
  generateApiKey,
  generateSigningSecret,
  importMasterKey,
} from "@wds/core";
import postgres from "postgres";
import { requireEnv } from "./helpers.ts";

const CONSUMER_URL = "http://localhost:4000";

type SeedTenant = {
  name: string;
  retryPolicy?: Record<string, number>; // tenants.retry_policy; missing fields take the defaults
  eventTypes: string[];
  endpoints: { description: string; path: string; subscriptions: string[] }[];
};

const TENANTS: SeedTenant[] = [
  {
    name: "Acme",
    eventTypes: ["order.created", "order.paid", "payment.failed"],
    endpoints: [
      { description: "Always succeeds", path: "/ok", subscriptions: ["order.*"] },
      { description: "Always fails", path: "/fail-rate?p=1", subscriptions: ["payment.failed"] },
    ],
  },
  {
    name: "Globex",
    eventTypes: ["user.signed_up"],
    endpoints: [{ description: "Receives everything", path: "/ok", subscriptions: ["*"] }],
  },
  {
    // For scripts/smoke.ts, which creates its own endpoints on each run. A short retry policy
    // makes a failing delivery is dead in about a minute, not days.
    name: "Smoke",
    retryPolicy: { max_attempts: 3, base_seconds: 10, cap_seconds: 60 },
    eventTypes: ["smoke.test"],
    endpoints: [],
  },
];

const databaseUrl = requireEnv("DATABASE_URL");
const master = await importMasterKey(requireEnv("MASTER_KEY_V1"), 1);

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  // Adds what's missing, so it can run again after new tenants are added here. Keys and secrets
  // can only be shown when they're created, so existing tenants are left alone.
  const printed = await sql.begin(async (tx) => {
    const lines: string[] = [];
    const [operator] = await tx`select 1 from api_keys where scope = 'operator'`;
    if (!operator) {
      const operatorKey = await generateApiKey("operator");
      await tx`
                  insert into api_keys (scope, key_prefix, key_hash)
                  values ('operator', ${operatorKey.prefix}, ${operatorKey.hash})
              `;
      lines.push(`Operator api key: ${operatorKey.key}`);
    }

    for (const tenant of TENANTS) {
      const [existing] = await tx`select 1 from tenants where name = ${tenant.name}`;
      if (existing) {
        lines.push("", `Tenant ${tenant.name} already exists, skipped`);
        continue;
      }
      const { id: tenantId } = firstRow(
        await tx<{ id: string }[]>`
            insert into tenants (name, retry_policy)
            values (${tenant.name}, ${tx.json(tenant.retryPolicy ?? {})})
            returning id
          `,
      );
      lines.push("", `Tenant ${tenant.name} (${tenantId})`);

      const apiKey = await generateApiKey("tenant");
      await tx`
                    insert into api_keys (tenant_id, scope, key_prefix, key_hash)
                    values(${tenantId}, 'tenant', ${apiKey.prefix}, ${apiKey.hash})
                `;

      lines.push(`  API key: ${apiKey.key}`);

      for (const event of tenant.eventTypes) {
        await tx`insert into event_types (tenant_id, name) values (${tenantId}, ${event})`;
      }

      for (const endpoint of tenant.endpoints) {
        const { id: endpointId } = firstRow(
          await tx<{ id: string }[]>`insert into endpoints (tenant_id, url, description)
                            values(${tenantId}, ${CONSUMER_URL + endpoint.path}, ${endpoint.description})
                            returning id
                    `,
        );

        for (const pattern of endpoint.subscriptions) {
          await tx`
                            insert into endpoint_subscriptions (endpoint_id, event_type_pattern)
                            values(${endpointId}, ${pattern})
                        `;
        }

        const secret = generateSigningSecret();
        const encrypted = await encryptSecret(secret, endpointId, master);

        await tx`
                        insert into endpoint_secrets (
                        endpoint_id, secret_ciphertext, secret_iv, dek_ciphertext, dek_iv, kek_version)
                        values(${endpointId}, ${encrypted.secretCiphertext}, ${encrypted.secretIv},
                        ${encrypted.dekCiphertext}, ${encrypted.dekIv}, ${encrypted.kekVersion})
                    `;

        lines.push(
          `  Endpoint ${endpoint.description}: ${CONSUMER_URL + endpoint.path}`,
          `    subscribed to: ${endpoint.subscriptions.join(", ")}`,
          `    signing secret: ${secret}`,
        );
      }
    }
    return lines;
  });

  console.log(printed.join("\n"));
  console.log("\nThese keys and secrets are shown once. Copy what you need now.");
} finally {
  await sql.end();
}
