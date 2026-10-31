import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.toml",
      },
      miniflare: {
        // wrangler.toml binds LIMITER to the limiter Worker, which these tests don't run. A stand-in
        // with the same name and class lets the binding resolve; no test here calls it.
        workers: [
          {
            name: "wds-limiter",
            modules: true,
            script: `
                export class EndpointLimiter {}
                export default { fetch: () => new Response(null, { status: 404 }) };
              `,
            compatibilityDate: "2026-08-15",
            durableObjects: { LIMITER: "EndpointLimiter" },
          },
        ],
      },
    }),
  ],
});
