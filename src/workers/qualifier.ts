import { z } from "zod";
import { audit, getCampaignConfig, query } from "@/lib/db";
import { readProfile } from "@/lib/instagram";
import { enqueueJob } from "@/lib/job-queue";
import { geminiRetryReason, qualifyProfile } from "@/lib/openai";
import type { Lead } from "@/lib/types";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({ leadId: z.string().uuid() });

async function reconcileOutreach(leadId: string, qualified: boolean) {
  if (!qualified) {
    await query(
      `UPDATE jobs SET status = 'done', last_error = 'cancelled: lead reprovado na requalificação', updated_at = NOW()
       WHERE kind IN ('outreach', 'followup') AND status = 'pending' AND payload->>'leadId' = $1`,
      [leadId],
    );
    return;
  }
  const existing = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'outreach' AND payload->>'leadId' = $1
     AND status IN ('pending', 'running')) AS exists`,
    [leadId],
  );
  if (!existing.rows[0].exists) await enqueueJob("outreach", { leadId });
}

runWorker("qualify", async (job) => {
  const { leadId } = payloadSchema.parse(job.payload);
  const result = await query<Lead>("SELECT * FROM leads WHERE id = $1", [leadId]);
  const lead = result.rows[0];
  if (!lead || lead.do_not_contact || lead.status === "do_not_contact") return { action: "complete" };

  const campaign = await getCampaignConfig(lead.niche);
  const profile = await readProfile(lead.ig_username);
  let qualification;
  try {
    qualification = await qualifyProfile(profile, campaign);
  } catch (error) {
    const retryReason = geminiRetryReason(error);
    if (!retryReason) throw error;
    const delayMs = retryReason.includes("cota") ? 60 * 60 * 1000 : 30 * 1000;
    const runAfter = new Date(Date.now() + delayMs);
    await audit("gemini.qualification.deferred", { jobId: job.id, leadId: lead.id, reason: retryReason, runAfter });
    return { action: "reschedule", runAfter, reason: retryReason };
  }
  const qualified = qualification.is_icp && qualification.score >= campaign.min_score_to_dm;

  await query(
    `UPDATE leads SET score = $2, score_reason = $3, is_icp = $4, score_breakdown = $5::jsonb,
       qualified_at = NOW(), status = $6, updated_at = NOW() WHERE id = $1`,
    [
      lead.id,
      qualification.score,
      qualification.reason,
      qualification.is_icp,
      JSON.stringify(qualification.breakdown),
      qualified ? "qualified" : "disqualified",
    ],
  );
  console.info(`[worker:qualify] resultado ${JSON.stringify({
    username: lead.ig_username,
    score: qualification.score,
    reason: qualification.reason,
    is_icp: qualification.is_icp,
    breakdown: qualification.breakdown,
  })}`);
  await reconcileOutreach(lead.id, qualified);
  return { action: "complete" };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
