import { z } from "zod";
import { recordSendFailure, recordSendSuccess } from "@/lib/circuit-breaker";
import { getCampaignConfig, query, transaction } from "@/lib/db";
import { blockDisabledExternalAction } from "@/lib/external-actions";
import { sendDirectMessage } from "@/lib/instagram";
import { enqueueJob } from "@/lib/job-queue";
import { reserveDmSlot } from "@/lib/rate-limit";
import { renderDmTemplate } from "@/lib/text";
import { isWithinOperationWindow, nextOperationWindow } from "@/lib/time";
import type { Lead } from "@/lib/types";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({ leadId: z.string().uuid() });

async function wasSent(jobId: string) {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM audit_log WHERE event = 'instagram.dm.after'
     AND payload->>'jobId' = $1 AND payload->>'ok' = 'true') AS exists`,
    [jobId],
  );
  return result.rows[0].exists;
}

async function persistOutbound(lead: Lead, message: string, jobId: string) {
  return transaction(async (client) => {
    const locked = await client.query<Pick<Lead, "do_not_contact">>("SELECT do_not_contact FROM leads WHERE id = $1 FOR UPDATE", [lead.id]);
    await client.query(
      `INSERT INTO conversations (lead_id, direction, channel, body, external_ref)
       VALUES ($1, 'outbound', 'chrome', $2, $3) ON CONFLICT DO NOTHING`,
      [lead.id, message, jobId],
    );
    if (!locked.rows[0] || locked.rows[0].do_not_contact) return false;
    await client.query("UPDATE leads SET status = 'dm_sent', updated_at = NOW() WHERE id = $1", [lead.id]);
    return true;
  });
}

async function ensureFollowup(leadId: string, sourceJobId: string, hours: number) {
  const existing = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'followup' AND payload->>'sourceJobId' = $1
     AND status IN ('pending','running','done')) AS exists`,
    [sourceJobId],
  );
  if (!existing.rows[0].exists) {
    await enqueueJob("followup", { leadId, sourceJobId }, new Date(Date.now() + hours * 60 * 60 * 1000));
  }
}

runWorker("outreach", async (job) => {
  const { leadId } = payloadSchema.parse(job.payload);
  const leadResult = await query<Lead>("SELECT * FROM leads WHERE id = $1", [leadId]);
  const lead = leadResult.rows[0];
  if (!lead || lead.do_not_contact || lead.status === "do_not_contact" || lead.status !== "qualified") {
    return { action: "complete" };
  }
  const campaign = await getCampaignConfig(lead.niche);
  const message = renderDmTemplate(campaign.dm_template_1, lead.full_name, lead.ig_username);
  if (await wasSent(job.id)) {
    const canContinue = await persistOutbound(lead, message, job.id);
    if (canContinue) await ensureFollowup(lead.id, job.id, campaign.followup_after_hours);
    return { action: "complete" };
  }
  const disabled = await blockDisabledExternalAction(job, "instagram_dm");
  if (disabled) return disabled;
  const startHour = Math.max(9, campaign.window_start_hour);
  const endHour = Math.min(20, campaign.window_end_hour);
  const now = new Date();
  if (!isWithinOperationWindow(now, startHour, endHour)) {
    return {
      action: "reschedule",
      runAfter: nextOperationWindow(now, startHour, endHour),
      reason: "fora da janela operacional",
    };
  }

  const reservation = await reserveDmSlot(Math.min(30, campaign.max_dm_per_day), campaign.niche);
  if (!reservation.allowed) {
    return { action: "reschedule", runAfter: reservation.retryAt, reason: reservation.reason };
  }

  let sent: boolean;
  try {
    sent = await transaction(async (client) => {
      const locked = await client.query<Pick<Lead, "do_not_contact">>("SELECT do_not_contact FROM leads WHERE id = $1 FOR UPDATE", [lead.id]);
      if (!locked.rows[0] || locked.rows[0].do_not_contact) return false;
      await sendDirectMessage(lead.ig_username, message, { jobId: job.id, kind: job.kind });
      await client.query(
        `INSERT INTO conversations (lead_id, direction, channel, body, external_ref)
         VALUES ($1, 'outbound', 'chrome', $2, $3) ON CONFLICT DO NOTHING`,
        [lead.id, message, job.id],
      );
      await client.query("UPDATE leads SET status = 'dm_sent', updated_at = NOW() WHERE id = $1", [lead.id]);
      return true;
    });
    if (sent) await recordSendSuccess();
  } catch (error) {
    await recordSendFailure(error);
    throw error;
  }
  if (!sent) return { action: "complete" };

  await ensureFollowup(lead.id, job.id, campaign.followup_after_hours);
  return { action: "complete" };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
