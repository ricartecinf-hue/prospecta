import { audit, query } from "./db";
import type { Job, JobKind } from "./types";

export type HandlerResult = { action: "complete" } | { action: "reschedule"; runAfter: Date; reason?: string };

export async function claimJob<T>(kind: JobKind): Promise<Job<T> | null> {
  const result = await query<Job<T>>("SELECT * FROM claim_job($1)", [kind]);
  return result.rows[0] ?? null;
}

export async function recoverStaleJobs(maxAgeMinutes = 15) {
  const result = await query<{ id: string; kind: JobKind }>(
    `UPDATE jobs SET status = 'pending', run_after = NOW(),
       last_error = 'recuperado após interrupção do worker', updated_at = NOW()
     WHERE status = 'running' AND updated_at < NOW() - ($1 * INTERVAL '1 minute')
     RETURNING id, kind`,
    [maxAgeMinutes],
  );
  if (result.rowCount) {
    await audit("jobs.stale_recovered", {
      count: result.rowCount,
      jobIds: result.rows.map((job) => job.id),
    });
  }
  return result.rowCount ?? 0;
}

export async function enqueueJob(
  kind: JobKind,
  payload: Record<string, unknown>,
  runAfter = new Date(),
  maxAttempts = 3,
) {
  const result = await query<Job>(
    `INSERT INTO jobs (kind, payload, run_after, max_attempts)
     VALUES ($1, $2::jsonb, $3, $4) RETURNING *`,
    [kind, JSON.stringify(payload), runAfter, maxAttempts],
  );
  await audit("job.enqueued", { jobId: result.rows[0].id, kind, runAfter: runAfter.toISOString() });
  return result.rows[0];
}

export async function completeJob(job: Job<unknown>) {
  await query("UPDATE jobs SET status = 'done', updated_at = NOW() WHERE id = $1 AND status = 'running'", [job.id]);
  await audit("job.completed", { jobId: job.id, kind: job.kind });
}

export async function rescheduleJob(job: Job<unknown>, runAfter: Date, reason?: string) {
  await query(
    `UPDATE jobs SET status = 'pending', attempts = 0, run_after = $2,
       last_error = $3, updated_at = NOW() WHERE id = $1`,
    [job.id, runAfter, reason ?? null],
  );
  await audit("job.rescheduled", { jobId: job.id, kind: job.kind, runAfter: runAfter.toISOString(), reason });
}

export async function failJob(job: Job<unknown>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.max_attempts;
  const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  await query(
    `UPDATE jobs SET status = $2, last_error = $3,
       run_after = CASE WHEN $2 = 'pending' THEN NOW() + ($4 * INTERVAL '1 second') ELSE run_after END,
       updated_at = NOW() WHERE id = $1`,
    [job.id, dead ? "dead" : "pending", message.slice(0, 4000), delaySeconds],
  );
  await audit(dead ? "job.dead" : "job.failed", { jobId: job.id, kind: job.kind, attempts: job.attempts, error: message });
}

export async function cancelLeadJobs(leadId: string) {
  await query(
    `UPDATE jobs SET status = 'done', last_error = 'cancelled: do_not_contact', updated_at = NOW()
     WHERE status = 'pending' AND kind IN ('outreach', 'followup') AND payload->>'leadId' = $1`,
    [leadId],
  );
}
