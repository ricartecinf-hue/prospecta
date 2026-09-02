import { z } from "zod";
import { recordSendFailure, recordSendSuccess } from "@/lib/circuit-breaker";
import { getCampaignConfig, query, transaction } from "@/lib/db";
import { sendDirectMessage } from "@/lib/instagram";
import { reserveDmSlot } from "@/lib/rate-limit";
import { renderDmTemplate } from "@/lib/text";
import { isWithinOperationWindow, nextOperationWindow } from "@/lib/time";
import type { Lead } from "@/lib/types";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({ leadId: z.string().uuid(), sourceJobId: z.string().uuid().optional() });

runWorker("followup", async (job) => {
  const { leadId } = payloadSchema.parse(job.payload);
  const result = await query<Lead & { inbound_count: number }>(
    `SELECT l.*, COUNT(c.id) FILTER (WHERE c.direction = 'inbound')::int AS inbound_count
     FROM leads l LEFT JOIN conversations c ON c.lead_id = l.id
     WHERE l.id = $1 GROUP BY l.id`,
    [leadId],
  );
  const lead = result.rows[0];
  if (!lead || lead.do_not_contact || lead.status !== "dm_sent" || lead.inbound_count > 0) return { action: "complete" };

  const campaign = await getCampaignConfig(lead.niche);
  if (!campaign.dm_template_followup) return { action: "complete" };
  const message = renderDmTemplate(campaign.dm_template_followup, lead.full_name, lead.ig_username);
  const sentAudit = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM audit_log WHERE event = 'instagram.dm.after'
     AND payload->>'jobId' = $1 AND payload->>'ok' = 'true') AS exists`,
    [job.id],
  );
  if (sentAudit.rows[0].exists) {
    await query(
      `INSERT INTO conversations (lead_id, direction, channel, body, external_ref)
       VALUES ($1, 'outbound', 'chrome', $2, $3) ON CONFLICT DO NOTHING`,
      [lead.id, message, job.id],
    );
    return { action: "complete" };
  }
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
  const reservation = await reserveDmSlot(Math.min(30, campaign.max_dm_per_day));
  if (!reservation.allowed) return { action: "reschedule", runAfter: reservation.retryAt, reason: reservation.reason };

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
      return true;
    });
    if (sent) await recordSendSuccess();
  } catch (error) {
    await recordSendFailure(error);
    throw error;
  }
  if (!sent) return { action: "complete" };
  return { action: "complete" };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
