import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { recordSendFailure, recordSendSuccess } from "@/lib/circuit-breaker";
import { getCampaignConfig, query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { blockDisabledExternalAction } from "@/lib/external-actions";
import { sendDirectMessage } from "@/lib/instagram";
import { enqueueJob, type HandlerResult } from "@/lib/job-queue";
import { reserveDmSlot } from "@/lib/rate-limit";
import { renderDmTemplate } from "@/lib/text";
import { isWithinOperationWindow, nextOperationWindow } from "@/lib/time";
import type { CampaignConfig, Job, Lead } from "@/lib/types";

const payloadSchema = z.object({ leadId: z.string().uuid() });

export const SINAPSI_FIRST_DM_TEXT = "Oi {{first_name}}, tudo bem? Trabalho com bastante profissional de psicologia e criei o Sinapsi pra resolver um problema que ouço muito: gestão do consultório tomando tempo que deveria ser dos pacientes. Agenda, prontuário e financeiro num só lugar. Dá uma olhada 👇";

type SqlClient = { query: typeof query };

export interface OutreachDependencies {
  query: typeof query;
  transaction: <T>(callback: (client: SqlClient) => Promise<T>) => Promise<T>;
  getCampaignConfig: (niche?: string) => Promise<CampaignConfig>;
  blockDisabledExternalAction: typeof blockDisabledExternalAction;
  sendDirectMessage: typeof sendDirectMessage;
  enqueueJob: typeof enqueueJob;
  reserveDmSlot: typeof reserveDmSlot;
  renderDmTemplate: typeof renderDmTemplate;
  isWithinOperationWindow: typeof isWithinOperationWindow;
  nextOperationWindow: typeof nextOperationWindow;
  recordSendSuccess: typeof recordSendSuccess;
  recordSendFailure: typeof recordSendFailure;
  now: () => Date;
  imagePath: () => string;
  imageExists: (path: string) => boolean;
}

const defaults: OutreachDependencies = {
  query,
  transaction,
  getCampaignConfig,
  blockDisabledExternalAction,
  sendDirectMessage,
  enqueueJob,
  reserveDmSlot,
  renderDmTemplate,
  isWithinOperationWindow,
  nextOperationWindow,
  recordSendSuccess,
  recordSendFailure,
  now: () => new Date(),
  imagePath: () => resolve(process.cwd(), env().SINAPSI_DM_IMAGE_PATH),
  imageExists: existsSync,
};

function messageWithImageMarker(message: string, imagePath?: string) {
  return imagePath ? `${message}\n[Imagem enviada: ${imagePath.split("/").pop()}]` : message;
}

export function createOutreachHandler(overrides: Partial<OutreachDependencies> = {}) {
  const deps = { ...defaults, ...overrides };

  async function wasSent(jobId: string) {
    const result = await deps.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM audit_log WHERE event = 'instagram.dm.after' AND payload->>'jobId' = $1 AND payload->>'ok' = 'true') AS exists",
      [jobId],
    );
    return result.rows[0].exists;
  }

  async function wasTextSent(jobId: string) {
    const result = await deps.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM audit_log WHERE event = 'instagram.dm.text.after' AND payload->>'jobId' = $1 AND payload->>'ok' = 'true') AS exists",
      [jobId],
    );
    return result.rows[0].exists;
  }

  async function persistOutbound(lead: Lead, message: string, jobId: string) {
    return deps.transaction(async (client) => {
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
    const existing = await deps.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'followup' AND payload->>'sourceJobId' = $1
       AND status IN ('pending','running','done')) AS exists`,
      [sourceJobId],
    );
    if (!existing.rows[0].exists) {
      await deps.enqueueJob("followup", { leadId, sourceJobId }, new Date(deps.now().getTime() + hours * 60 * 60 * 1000));
    }
  }

  return async function outreachHandler(job: Job): Promise<HandlerResult> {
    const { leadId } = payloadSchema.parse(job.payload);
    const leadResult = await deps.query<Lead>("SELECT * FROM leads WHERE id = $1", [leadId]);
    const lead = leadResult.rows[0];
    if (!lead || lead.do_not_contact || lead.status === "do_not_contact" || lead.status !== "qualified") return { action: "complete" };

    const campaign = await deps.getCampaignConfig(lead.niche);
    const text = deps.renderDmTemplate(campaign.dm_template_1, lead.full_name, lead.ig_username);
    const imagePath = lead.niche === "psicologo" ? deps.imagePath() : undefined;
    const storedMessage = messageWithImageMarker(text, imagePath);

    if (await wasSent(job.id)) {
      const canContinue = await persistOutbound(lead, storedMessage, job.id);
      if (canContinue) await ensureFollowup(lead.id, job.id, campaign.followup_after_hours);
      return { action: "complete" };
    }
    const disabled = await deps.blockDisabledExternalAction(job, "instagram_dm");
    if (disabled) return disabled;
    if (imagePath && !deps.imageExists(imagePath)) throw new Error(`Imagem obrigatória da primeira DM do Sinapsi não encontrada: ${imagePath}`);

    const startHour = Math.max(9, campaign.window_start_hour);
    const endHour = Math.min(20, campaign.window_end_hour);
    const now = deps.now();
    if (!deps.isWithinOperationWindow(now, startHour, endHour)) {
      return { action: "reschedule", runAfter: deps.nextOperationWindow(now, startHour, endHour), reason: "fora da janela operacional" };
    }
    const reservation = await deps.reserveDmSlot(Math.min(30, campaign.max_dm_per_day), campaign.niche);
    if (!reservation.allowed) return { action: "reschedule", runAfter: reservation.retryAt, reason: reservation.reason };

    let sent: boolean;
    try {
      sent = await deps.transaction(async (client) => {
        const locked = await client.query<Pick<Lead, "do_not_contact">>("SELECT do_not_contact FROM leads WHERE id = $1 FOR UPDATE", [lead.id]);
        if (!locked.rows[0] || locked.rows[0].do_not_contact) return false;
        const textAlreadySent = await wasTextSent(job.id);
        await deps.sendDirectMessage(lead.ig_username, text, { jobId: job.id, kind: job.kind }, { imagePath, skipText: textAlreadySent });
        await client.query(
          `INSERT INTO conversations (lead_id, direction, channel, body, external_ref)
           VALUES ($1, 'outbound', 'chrome', $2, $3) ON CONFLICT DO NOTHING`,
          [lead.id, storedMessage, job.id],
        );
        await client.query("UPDATE leads SET status = 'dm_sent', updated_at = NOW() WHERE id = $1", [lead.id]);
        return true;
      });
      if (sent) await deps.recordSendSuccess();
    } catch (error) {
      await deps.recordSendFailure(error);
      throw error;
    }
    if (!sent) return { action: "complete" };
    await ensureFollowup(lead.id, job.id, campaign.followup_after_hours);
    return { action: "complete" };
  };
}
