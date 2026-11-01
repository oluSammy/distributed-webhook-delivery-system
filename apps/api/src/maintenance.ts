import { createDb } from "@wds/db";
import { wakeDispatcher } from "./dispatcher";

// How many days of partitions to keep made ahead of today, for events, deliveries and attempts.
const PARTITION_DAYS_AHEAD = 7;

// The jobs the cron runs every 15 minutes. Each one runs on its own: if one fails, the rest still
// run, and the next run tries it again. One line is logged with what each did.
export async function runMaintenance(env: Env): Promise<void> {
  const sql = createDb(env.HYPERDRIVE.connectionString);
  const results: Record<string, unknown> = {};
  const run = async (name: string, job: () => Promise<unknown>) => {
    try {
      results[name] = await job();
    } catch (error) {
      console.error(`maintenance: ${name} failed`, error);
      results[name] = "failed";
    }
  };

  try {
    // First, because without today's partitions every new event, delivery and attempt fails.
    await run("partitions", async () => {
      await sql`select ensure_partitions(${PARTITION_DAYS_AHEAD})`;
      return "ok";
    });
    // A wake-up or alarm can be lost, for example while the dispatcher is being redeployed. Waking
    // it here means waiting events and due deliveries never sit longer than one run. It also runs
    // the create job, for events stored when no wake-up reached it.
    await run("dispatcher", async () => {
      await wakeDispatcher(env);
      return "woken";
    });
  } finally {
    await sql.end();
  }
  console.log("maintenance", results);
}
