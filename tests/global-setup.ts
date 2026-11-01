import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "./db.ts";

const MIGRATIONS = fileURLToPath(new URL("../packages/db/migrations", import.meta.url));

// Runs once before the tests: creates the test database if it's missing, then applies any
// migrations it hasn't had yet, exactly as pnpm migrate does for the real one.
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  const server = new URL(url);
  server.pathname = "/postgres";

  const admin = postgres(server.href, { max: 1, onnotice: () => {} });
  try {
    const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists) {
      await admin.unsafe(`create database "${name}"`);
    }
  } finally {
    await admin.end();
  }

  await runner({
    databaseUrl: url.href,
    dir: MIGRATIONS,
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });
}
