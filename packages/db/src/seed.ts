import { encryptSecret, generateApiKey, generateSigningSecret, importMasterKey } from "@wds/core";
import postgres from "postgres";
import { firstRow, requireEnv } from "./helpers.ts";

const CONSUMER_URL = "http://localhost:4000";

const TENANTS = [
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
];

const databaseUrl = requireEnv("DATABASE_URL");
const master = await importMasterKey(requireEnv("MASTER_KEY_V1"), 1);

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const { count } = firstRow(
    await sql<{ count: number }[]>`select count(*)::int as count from tenants`,
  );

  if (count > 0) {
    console.error("Database already has tenants; seed only runs on an empty database.");
    // process.exit(0)
    process.exitCode = 1;
  } else {
    const printed = await sql.begin(async (tx) => {
      const lines: string[] = [];
      const operatorKey = await generateApiKey("operator");
      await tx`
                insert into api_keys (scope, key_prefix, key_hash)
                values ('operator', ${operatorKey.prefix}, ${operatorKey.hash})
            `;
      lines.push(`Operator api key: ${operatorKey.key}`);

      for (const tenant of TENANTS) {
        const { id: tenantId } = firstRow(
          await tx<{ id: string }[]>`
                        insert into tenants (name) values (${tenant.name}) returning id
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
  }
} finally {
  await sql.end();
}
