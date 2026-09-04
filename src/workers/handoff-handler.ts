import { z } from "zod";
import { getCampaignConfig, query } from "@/lib/db";
import { blockDisabledExternalAction } from "@/lib/external-actions";
import type { HandlerResult } from "@/lib/job-queue";
import type { CampaignConfig, Job, Lead } from "@/lib/types";
import {
  assertHandoffChannel,
  HANDOFF_WHATSAPP_NUMBER,
  sendWhatsApp,
} from "@/lib/whatsapp";

const payloadSchema = z.object({ leadId: z.string().uuid() });

export interface HandoffDependencies {
  query: typeof query;
  getCampaignConfig: (niche?: string) => Promise<CampaignConfig>;
  blockDisabledExternalAction: typeof blockDisabledExternalAction;
  sendWhatsApp: typeof sendWhatsApp;
  assertHandoffChannel: typeof assertHandoffChannel;
}

const defaults: HandoffDependencies = {
  query,
  getCampaignConfig,
  blockDisabledExternalAction,
  sendWhatsApp,
  assertHandoffChannel,
};

export function buildHandoffMessage(
  lead: Pick<Lead, "full_name" | "ig_username" | "score" | "score_reason" | "ig_profile_url">,
  history: string,
) {
  return [
    "🔥 Lead quente do Instagram",
    `Nome: ${lead.full_name || "Não informado"}`,
    `Instagram: @${lead.ig_username}`,
    `Score: ${lead.score}/100 — ${lead.score_reason || "sem justificativa"}`,
    `Perfil: ${lead.ig_profile_url || `https://instagram.com/${lead.ig_username}`}`,
    "",
    "Resumo da conversa:",
    history || "Sem mensagens registradas.",
  ].join("\n");
}

export function createHandoffHandler(overrides: Partial<HandoffDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async function handoffHandler(job: Job): Promise<HandlerResult> {
    const { leadId } = payloadSchema.parse(job.payload);
    const leadResult = await deps.query<Lead>("SELECT * FROM leads WHERE id = $1", [leadId]);
    const lead = leadResult.rows[0];
    if (!lead || lead.do_not_contact || lead.status === "handed_off") return { action: "complete" };

    const campaign = await deps.getCampaignConfig(lead.niche);
    if (campaign.whatsapp_number !== HANDOFF_WHATSAPP_NUMBER) {
      throw new Error(`Handoff requer o destinatário ${HANDOFF_WHATSAPP_NUMBER}.`);
    }
    const sentAudit = await deps.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM audit_log WHERE event = 'whatsapp.handoff.after'
       AND payload->>'jobId' = $1 AND payload->>'ok' = 'true') AS exists`,
      [job.id],
    );
    if (sentAudit.rows[0].exists) {
      await deps.query("UPDATE leads SET status = 'handed_off', updated_at = NOW() WHERE id = $1", [lead.id]);
      return { action: "complete" };
    }
    const disabled = await deps.blockDisabledExternalAction(job, "whatsapp_handoff");
    if (disabled) return disabled;

    deps.assertHandoffChannel();
    const conversations = await deps.query<{ direction: string; body: string; sent_at: Date }>(
      "SELECT direction, body, sent_at FROM conversations WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 10",
      [lead.id],
    );
    const history = conversations.rows.reverse().map((message) =>
      `${message.direction === "inbound" ? "Lead" : "Ricardo"}: ${message.body}`,
    ).join("\n");
    const text = buildHandoffMessage(lead, history);
    await deps.sendWhatsApp(HANDOFF_WHATSAPP_NUMBER, text, { jobId: job.id, leadId: lead.id });
    await deps.query("UPDATE leads SET status = 'handed_off', updated_at = NOW() WHERE id = $1", [lead.id]);
    return { action: "complete" };
  };
}
