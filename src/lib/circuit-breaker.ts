import { audit, query, transaction } from "./db";

interface CircuitState {
  consecutive_errors: number;
  paused_until: string | null;
  reason: string | null;
}

const DEFAULT_STATE: CircuitState = { consecutive_errors: 0, paused_until: null, reason: null };

export async function getCircuitState(): Promise<CircuitState> {
  const result = await query<{ value: CircuitState }>("SELECT value FROM agent_state WHERE key = 'circuit_breaker'");
  return { ...DEFAULT_STATE, ...(result.rows[0]?.value ?? {}) };
}

export async function isAutomationPaused() {
  const state = await getCircuitState();
  return Boolean(state.paused_until && new Date(state.paused_until).getTime() > Date.now());
}

export async function recordSendSuccess() {
  await query(
    `INSERT INTO agent_state (key, value) VALUES ('circuit_breaker', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = jsonb_set(agent_state.value, '{consecutive_errors}', '0'::jsonb), updated_at = NOW()`,
    [JSON.stringify(DEFAULT_STATE)],
  );
}

export async function recordSendFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const paused = await transaction(async (client) => {
    const result = await client.query<{ value: CircuitState }>(
      "SELECT value FROM agent_state WHERE key = 'circuit_breaker' FOR UPDATE",
    );
    const current = { ...DEFAULT_STATE, ...(result.rows[0]?.value ?? {}) };
    const count = current.consecutive_errors + 1;
    const next: CircuitState = {
      consecutive_errors: count,
      paused_until: count >= 3 ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() : current.paused_until,
      reason: count >= 3 ? `3 erros consecutivos de envio: ${message}` : current.reason,
    };
    await client.query(
      `INSERT INTO agent_state (key, value) VALUES ('circuit_breaker', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(next)],
    );
    return next.paused_until;
  });
  await audit("dm.send_error", { error: message, pausedUntil: paused });
}

export async function pauseAutomation(reason: string, durationMinutes = 24 * 60) {
  const pausedUntil = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  await query(
    `INSERT INTO agent_state (key, value) VALUES ('circuit_breaker', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ consecutive_errors: 3, paused_until: pausedUntil, reason })],
  );
  await audit("automation.paused", { reason, pausedUntil });
}

export async function resumeAutomation() {
  await query(
    `INSERT INTO agent_state (key, value) VALUES ('circuit_breaker', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(DEFAULT_STATE)],
  );
  await audit("automation.resumed", {});
}
