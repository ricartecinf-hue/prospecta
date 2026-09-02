import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";
import type { CampaignConfig } from "./types";

const globalForDb = globalThis as unknown as { prospectaPool?: Pool };

function createPool() {
  const config = env();
  return new Pool({
    connectionString: config.DATABASE_URL,
    options: `-c search_path=${config.DATABASE_SCHEMA},public,extensions`,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: config.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
}

function getPool() {
  if (!globalForDb.prospectaPool) globalForDb.prospectaPool = createPool();
  return globalForDb.prospectaPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  if (!globalForDb.prospectaPool) return;
  await globalForDb.prospectaPool.end();
  delete globalForDb.prospectaPool;
}

export async function audit(event: string, payload: Record<string, unknown> = {}) {
  await query("INSERT INTO audit_log (event, payload) VALUES ($1, $2::jsonb)", [event, JSON.stringify(payload)]);
}

export async function getCampaignConfig(niche?: string): Promise<CampaignConfig> {
  const result = niche
    ? await query<CampaignConfig>("SELECT * FROM campaign_config WHERE niche = $1 AND active = true LIMIT 1", [niche])
    : await query<CampaignConfig>("SELECT * FROM campaign_config WHERE active = true ORDER BY created_at LIMIT 1");
  if (!result.rows[0]) throw new Error(`Nenhuma campanha ativa${niche ? ` para o nicho ${niche}` : ""}.`);
  return result.rows[0];
}
