import { z } from "zod";
import { getCampaignConfig, query } from "@/lib/db";
import type { Lead } from "@/lib/types";
import { sendWhatsApp } from "@/lib/whatsapp";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({ leadId: z.string().uuid() });

runWorker("handoff", async (job) => {
  const { leadId } = payloadSchema.parse(job.payload);
  const leadResult = await query<Lead>("SELECT * FROM leads WHERE id = $1", [leadId]);
  const lead = leadResult.rows[0];
  if (!lead || lead.do_not_contact || lead.status === "handed_off") return { action: "complete" };
  const campaign = await getCampaignConfig(lead.niche);
  const sentAudit = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM audit_log WHERE event = 'whatsapp.handoff.after'
     AND payload->>'jobId' = $1 AND payload->>'ok' = 'true') AS exists`,
    [job.id],
  );
  if (sentAudit.rows[0].exists) {
    await query("UPDATE leads SET status = 'handed_off', updated_at = NOW() WHERE id = $1", [lead.id]);
    return { action: "complete" };
  }
  const conversations = await query<{ direction: string; body: string; sent_at: Date }>(
    "SELECT direction, body, sent_at FROM conversations WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 10",
    [lead.id],
  );
  const history = conversations.rows.reverse().map((message) =>
    `${message.direction === "inbound" ? "Lead" : "Ricardo"}: ${message.body}`,
  ).join("\n");
  const text = [
    "🔥 Lead quente do Instagram",
    `Nome: ${lead.full_name || "Não informado"}`,
    `Instagram: @${lead.ig_username}`,
    `Score: ${lead.score}/100 — ${lead.score_reason || "sem justificativa"}`,
    `Perfil: https://instagram.com/${lead.ig_username}`,
    "",
    "Conversa:",
    history || "Sem mensagens registradas.",
  ].join("\n");
  await sendWhatsApp(campaign.whatsapp_number, text, { jobId: job.id, leadId: lead.id });
  await query("UPDATE leads SET status = 'handed_off', updated_at = NOW() WHERE id = $1", [lead.id]);
  return { action: "complete" };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
