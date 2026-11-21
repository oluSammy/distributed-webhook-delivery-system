import type { Sql } from "postgres";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    sql: Sql;
    tenantId: string;
    session: { id: string; userId: string } | null;
  };
};
