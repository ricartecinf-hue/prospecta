import { transaction } from "./db";

export type DmReservation = { allowed: true; nextAllowedAt: Date } | { allowed: false; retryAt: Date; reason: "daily_limit" | "interval" };

export async function reserveDmSlot(maxPerDay: number, niche: string, minSeconds = 90, maxSeconds = 240): Promise<DmReservation> {
  return transaction(async (client) => {
    // Trava única: é a mesma sessão do Chrome/Instagram enviando por todos os nichos,
    // então o intervalo mínimo entre DMs precisa ser global, não por nicho.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('prospecta:dm-send'))");
    const stateResult = await client.query<{ next_dm_at: Date | null }>(
      `SELECT NULLIF(value->>'next_dm_at', '')::timestamptz AS next_dm_at
       FROM agent_state WHERE key = 'delivery' FOR UPDATE`,
    );
    const nextDmAt = stateResult.rows[0]?.next_dm_at;
    if (nextDmAt && nextDmAt.getTime() > Date.now()) {
      return { allowed: false, retryAt: nextDmAt, reason: "interval" };
    }

    // Contador diário separado por nicho — cada campanha respeita seu próprio max_dm_per_day.
    const rateResult = await client.query<{ allowed: boolean }>(
      "SELECT increment_rate_limit($2, $1) AS allowed",
      [maxPerDay, `dm_total:${niche}`],
    );
    if (!rateResult.rows[0]?.allowed) {
      const retry = await client.query<{ retry_at: Date }>(
        `SELECT (date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '1 day 9 hours')
          AT TIME ZONE 'America/Sao_Paulo' AS retry_at`,
      );
      return { allowed: false, retryAt: retry.rows[0].retry_at, reason: "daily_limit" };
    }

    const delay = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
    const nextAllowedAt = new Date(Date.now() + delay * 1000);
    await client.query(
      `INSERT INTO agent_state (key, value) VALUES ('delivery', jsonb_build_object('next_dm_at', $1::timestamptz))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [nextAllowedAt],
    );
    return { allowed: true, nextAllowedAt };
  });
}
