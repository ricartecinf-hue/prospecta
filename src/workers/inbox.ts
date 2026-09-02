import { cancelLeadJobs, enqueueJob } from "@/lib/job-queue";
import { readInboxReplies } from "@/lib/instagram";
import { isOptOut, showsInterest } from "@/lib/text";
import { query, transaction } from "@/lib/db";
import type { Lead } from "@/lib/types";
import { runWorker } from "@/lib/worker";

runWorker("inbox_poll", async () => {
  const replies = await readInboxReplies();
  for (const reply of replies) {
    const leadResult = await query<Lead>(
      "SELECT * FROM leads WHERE lower(ig_username) = lower($1) AND status IN ('dm_sent', 'replied') LIMIT 1",
      [reply.username],
    );
    const lead = leadResult.rows[0];
    if (!lead || lead.do_not_contact) continue;

    const duplicate = await query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM conversations
       WHERE lead_id = $1 AND direction = 'inbound' AND body = $2) AS exists`,
      [lead.id, reply.body],
    );
    if (duplicate.rows[0].exists) continue;

    const optedOut = isOptOut(reply.body);
    const interested = !optedOut && showsInterest(reply.body);
    const recorded = await transaction(async (client) => {
      const locked = await client.query<{ do_not_contact: boolean }>("SELECT do_not_contact FROM leads WHERE id = $1 FOR UPDATE", [lead.id]);
      if (!locked.rows[0] || locked.rows[0].do_not_contact) return false;
      await client.query(
        "INSERT INTO conversations (lead_id, direction, channel, body) VALUES ($1, 'inbound', 'chrome', $2)",
        [lead.id, reply.body],
      );
      await client.query(
        `UPDATE leads SET do_not_contact = $2,
          status = CASE WHEN $2 THEN 'do_not_contact' ELSE 'replied' END,
          updated_at = NOW() WHERE id = $1`,
        [lead.id, optedOut],
      );
      await client.query(
        "INSERT INTO audit_log (event, payload) VALUES ('instagram.reply_detected', $1::jsonb)",
        [JSON.stringify({ leadId: lead.id, username: lead.ig_username, optedOut, interested })],
      );
      return true;
    });

    if (!recorded) continue;

    if (optedOut) await cancelLeadJobs(lead.id);
    if (interested) {
      const existing = await query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'handoff' AND status IN ('pending','running')
         AND payload->>'leadId' = $1) AS exists`,
        [lead.id],
      );
      if (!existing.rows[0].exists) await enqueueJob("handoff", { leadId: lead.id });
    }
  }
  return { action: "reschedule", runAfter: new Date(Date.now() + 5 * 60 * 1000), reason: "polling a cada 5 minutos" };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
