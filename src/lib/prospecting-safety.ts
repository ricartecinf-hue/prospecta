import { audit, query, transaction } from "./db";
import { OPERATION_TIME_ZONE } from "./time";

export const PROSPECTING_LIMITS = {
  nightly: 150,
  hourly: 30,
  intervalMs: 8_000,
} as const;

interface SafetyState {
  paused_until: string | null;
  reason: string | null;
}

export interface ProspectingPermit {
  allowed: boolean;
  runAfter: Date;
  reason: "allowed" | "scheduled_pause" | "protection_pause" | "hourly_limit" | "nightly_limit" | "visit_interval";
}

function parts(date: Date) {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute),
  };
}

function timezoneOffsetMs(date: Date) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATION_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second)) - date.getTime();
}

function zonedDate(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - timezoneOffsetMs(guess));
}

export function prospectingSchedule(date: Date): ProspectingPermit {
  const local = parts(date);
  const minuteOfDay = local.hour * 60 + local.minute;
  if (minuteOfDay >= 120 && minuteOfDay <= 180) {
    return { allowed: false, runAfter: zonedDate(local.year, local.month, local.day, 3, 1), reason: "scheduled_pause" };
  }
  if (minuteOfDay >= 221 && minuteOfDay <= 420) {
    return { allowed: false, runAfter: zonedDate(local.year, local.month, local.day, 7, 1), reason: "scheduled_pause" };
  }
  return { allowed: true, runAfter: date, reason: "allowed" };
}

export function prospectingNightKey(date: Date) {
  const local = parts(date);
  const anchor = local.hour < 20
    ? new Date(Date.UTC(local.year, local.month - 1, local.day - 1, 12))
    : new Date(Date.UTC(local.year, local.month - 1, local.day, 12));
  const day = parts(anchor);
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

function nextNight(date: Date) {
  const local = parts(date);
  return local.hour < 20
    ? zonedDate(local.year, local.month, local.day, 20, 0)
    : zonedDate(local.year, local.month, local.day + 1, 20, 0);
}

export async function reserveProspectingVisit(context: Record<string, unknown> = {}): Promise<ProspectingPermit> {
  const now = new Date();
  const scheduled = prospectingSchedule(now);
  if (!scheduled.allowed) return scheduled;
  const nightKey = prospectingNightKey(now);

  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('prospecta:prospecting_safety'))");
    const stateResult = await client.query<{ value: SafetyState }>(
      "SELECT value FROM agent_state WHERE key = 'prospecting_safety'",
    );
    const state = stateResult.rows[0]?.value;
    if (state?.paused_until && new Date(state.paused_until) > now) {
      return { allowed: false, runAfter: new Date(state.paused_until), reason: "protection_pause" };
    }

    const night = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM audit_log
        WHERE event = 'prospector.profile_visit' AND payload->>'nightKey' = $1`,
      [nightKey],
    );
    if ((night.rows[0]?.count ?? 0) >= PROSPECTING_LIMITS.nightly) {
      return { allowed: false, runAfter: nextNight(now), reason: "nightly_limit" };
    }

    const hour = await client.query<{ count: number; first_at: Date | null }>(
      `SELECT COUNT(*)::int AS count, MIN(created_at) AS first_at FROM audit_log
        WHERE event = 'prospector.profile_visit' AND created_at > NOW() - INTERVAL '1 hour'`,
    );
    if ((hour.rows[0]?.count ?? 0) >= PROSPECTING_LIMITS.hourly && hour.rows[0]?.first_at) {
      return {
        allowed: false,
        runAfter: new Date(hour.rows[0].first_at.getTime() + 60 * 60 * 1000 + 1_000),
        reason: "hourly_limit",
      };
    }

    const last = await client.query<{ created_at: Date }>(
      "SELECT created_at FROM audit_log WHERE event = 'prospector.profile_visit' ORDER BY created_at DESC LIMIT 1",
    );
    const nextVisit = last.rows[0] ? new Date(last.rows[0].created_at.getTime() + PROSPECTING_LIMITS.intervalMs) : now;
    if (nextVisit > now) return { allowed: false, runAfter: nextVisit, reason: "visit_interval" };

    await client.query(
      "INSERT INTO audit_log (event, payload) VALUES ('prospector.profile_visit', $1::jsonb)",
      [JSON.stringify({ ...context, nightKey })],
    );
    return { allowed: true, runAfter: now, reason: "allowed" };
  });
}

export async function getProspectingAvailability(): Promise<ProspectingPermit> {
  const now = new Date();
  const scheduled = prospectingSchedule(now);
  if (!scheduled.allowed) return scheduled;
  const result = await query<{ value: SafetyState }>("SELECT value FROM agent_state WHERE key = 'prospecting_safety'");
  const state = result.rows[0]?.value;
  if (state?.paused_until && new Date(state.paused_until) > now) {
    return { allowed: false, runAfter: new Date(state.paused_until), reason: "protection_pause" };
  }
  return scheduled;
}

export async function pauseProspecting(reason: string, durationMinutes = 120) {
  const pausedUntil = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  await query(
    `INSERT INTO agent_state (key, value) VALUES ('prospecting_safety', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ paused_until: pausedUntil, reason })],
  );
  await audit("prospector.protection_paused", { reason, pausedUntil, durationMinutes });
  return new Date(pausedUntil);
}
