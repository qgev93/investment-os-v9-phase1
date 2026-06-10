import pg from "pg";
import { resolve } from "node:path";
import { FilePhase1Store } from "./fileStore.js";
import { MemoryPhase1Store } from "./memoryStore.js";
import { PostgresPhase1Store } from "./postgresStore.js";
import type { Phase1Store } from "./types.js";

function shouldUseSsl(env: Record<string, string | undefined>): boolean {
  if (env.DATABASE_SSL === "true") return true;
  if (env.DATABASE_SSL === "false") return false;
  return Boolean(env.DATABASE_URL?.includes("supabase.co"));
}

export function createPhase1Store(env: Record<string, string | undefined>): Phase1Store {
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: shouldUseSsl(env) ? { rejectUnauthorized: false } : undefined,
      max: 3,
    });
    return new PostgresPhase1Store(pool);
  }

  return new MemoryPhase1Store();
}

export function createPhase1FileStore(env: Record<string, string | undefined>): Phase1Store {
  if (env.DATABASE_URL) {
    return createPhase1Store(env);
  }

  return new FilePhase1Store(env.PHASE1_STORE_PATH ?? resolve(".phase1/local-store.json"));
}
