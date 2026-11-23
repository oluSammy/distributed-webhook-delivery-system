import { join } from "node:path";
import { runner } from "node-pg-migrate";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "./db.ts";

const MIGRATIONS = join(import.meta.dirname, "../packages/db/migrations");

// Runs once before the tests: waits until no other test run is using the database, creates it if
// it's missing, then applies any migrations it hasn't had yet, exactly as pnpm migrate does for the
// real one. Returns what vitest runs after the last test: letting the next run in.
export default async function setup(): Promise<() => Promise<void>> {
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

  const release = await takeTheDatabase(url.href);
  await runner({
    databaseUrl: url.href,
    dir: MIGRATIONS,
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });

  const sql = postgres(url.href, { max: 1, onnotice: () => {} });
  try {
    await sql`select ensure_partitions(7)`;
  } finally {
    await sql.end();
  }
  return release;
}

// Every test empties the tables first, so two runs at once (two terminals, or a terminal and an
// editor) delete each other's rows and fail at random. A run holds this lock until it ends, and a
// second run waits for it. It's a Postgres advisory lock: held by the connection, so a run that
// crashes lets go too.
async function takeTheDatabase(url: string): Promise<() => Promise<void>> {
  const lock = postgres(url, { max: 1, onnotice: () => {} });
  const [free] = await lock<{ taken: boolean }[]>`
      select pg_try_advisory_lock(hashtext('wds tests')) as taken
    `;
  if (!free?.taken) {
    console.log("Another test run is using the test database: waiting for it to finish…");
    await lock`select pg_advisory_lock(hashtext('wds tests'))`;
  }
  return () => lock.end();
}
