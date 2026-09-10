import assert from "node:assert/strict";
import test from "node:test";
import { createOutreachHandler, SINAPSI_FIRST_DM_TEXT } from "./outreach-handler";
import type { CampaignConfig, Job, Lead } from "@/lib/types";

const leadId = "11111111-1111-4111-8111-111111111111";
const job = { id: "22222222-2222-4222-8222-222222222222", kind: "outreach", payload: { leadId } } as unknown as Job;
const baseLead: Lead = {
  id: leadId, ig_username: "ana.psi", ig_user_id: null, full_name: "Ana Silva", bio: null,
  followers_count: null, following_count: null, posts_count: null, profile_pic_url: null,
  whatsapp: null, email: null, ig_profile_url: "https://instagram.com/ana.psi", recent_posts: [],
  niche: "psicologo", score: 88, score_reason: null, is_icp: true, score_breakdown: null,
  qualified_at: null, status: "qualified", do_not_contact: false, source: null,
  discovered_at: new Date(), updated_at: new Date(),
};
const campaign: CampaignConfig = {
  id: "33333333-3333-4333-8333-333333333333", niche: "psicologo", icp_description: "x",
  icp_hashtags: [], icp_competitors: [], icp_locations: [], product_name: "Sinapsi", product_url: null,
  verified_claims: [], dm_template_1: SINAPSI_FIRST_DM_TEXT, dm_template_followup: "oi novamente",
  whatsapp_number: "5554981133456", max_dm_per_day: 30, window_start_hour: 9, window_end_hour: 20,
  min_score_to_dm: 65, followup_after_hours: 48, active: true, created_at: new Date(), updated_at: new Date(),
};

function rows<T>(value: T[]) { return { rows: value }; }

function setup(options: { lead?: Lead | null; sent?: boolean; textSent?: boolean; disabled?: unknown; inside?: boolean; reservation?: unknown; sendError?: Error; locked?: boolean; followupExists?: boolean } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const sent: unknown[][] = [];
  const recorded = { success: 0, failures: 0, enqueued: 0 };
  const client = {
    query: async <T>(sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT do_not_contact")) return rows([{ do_not_contact: options.locked ?? false }] as T[]);
      return rows([] as T[]);
    },
  };
  const query = async <T>(sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT * FROM leads")) return rows((options.lead === undefined ? [baseLead] : options.lead ? [options.lead] : []) as T[]);
    if (sql.includes("event = 'instagram.dm.after'")) return rows([{ exists: options.sent ?? false }] as T[]);
    if (sql.includes("event = 'instagram.dm.text.after'")) return rows([{ exists: options.textSent ?? false }] as T[]);
    if (sql.includes("kind = 'followup'")) return rows([{ exists: options.followupExists ?? false }] as T[]);
    return rows([] as T[]);
  };
  const handler = createOutreachHandler({
    query: query as never,
    transaction: async (callback) => callback(client as never),
    getCampaignConfig: async () => campaign,
    blockDisabledExternalAction: async () => options.disabled as never ?? null,
    sendDirectMessage: async (...args) => { if (options.sendError) throw options.sendError; sent.push(args); },
    enqueueJob: async () => { recorded.enqueued += 1; return {} as never; },
    reserveDmSlot: async () => options.reservation as never ?? { allowed: true, nextAllowedAt: new Date() },
    renderDmTemplate: (template, fullName) => template.replace("{{first_name}}", fullName?.split(" ")[0] ?? ""),
    isWithinOperationWindow: () => options.inside ?? true,
    nextOperationWindow: () => new Date("2026-01-02T12:00:00Z"),
    recordSendSuccess: async () => { recorded.success += 1; },
    recordSendFailure: async () => { recorded.failures += 1; },
    now: () => new Date("2026-01-01T12:00:00Z"),
  });
  return { handler, calls, sent, recorded };
}

test("outreach encerra lead ausente ou inelegível sem ação externa", async () => {
  const { handler, sent } = setup({ lead: null });
  assert.deepEqual(await handler(job), { action: "complete" });
  assert.equal(sent.length, 0);

  const optedOut = setup({ lead: { ...baseLead, do_not_contact: true } });
  assert.deepEqual(await optedOut.handler(job), { action: "complete" });
});

test("outreach respeita trava, janela e limite diário", async () => {
  const blocked = setup({ disabled: { action: "reschedule", runAfter: new Date(), reason: "desativada" } });
  assert.equal((await blocked.handler(job)).action, "reschedule");

  const outside = setup({ inside: false });
  assert.equal((await outside.handler(job)).action, "reschedule");

  const capped = setup({ reservation: { allowed: false, retryAt: new Date(), reason: "daily_limit" } });
  assert.equal((await capped.handler(job)).action, "reschedule");
});

test("outreach envia somente texto e agenda follow-up", async () => {
  const { handler, sent, calls, recorded } = setup();
  assert.deepEqual(await handler(job), { action: "complete" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "ana.psi");
  assert.match(String(sent[0][1]), /Oi, Ana! Tudo bem/);
  assert.match(String(sent[0][1]), /Ou ainda faz isso manualmente ou de outra forma\?/);
  assert.deepEqual(sent[0][3], { skipText: false });
  assert.equal(calls.some((call) => call.values.some((value) => String(value).includes("[Imagem enviada:"))), false);
  assert.deepEqual(recorded, { success: 1, failures: 0, enqueued: 1 });
});

test("outreach é idempotente após auditoria de envio e registra falha do Chrome", async () => {
  const resumed = setup({ sent: true });
  assert.deepEqual(await resumed.handler(job), { action: "complete" });
  assert.equal(resumed.sent.length, 0);

  const lockedAfterAudit = setup({ sent: true, locked: true, followupExists: true });
  assert.deepEqual(await lockedAfterAudit.handler(job), { action: "complete" });

  const failed = setup({ sendError: new Error("Chrome indisponível") });
  await assert.rejects(() => failed.handler(job), /Chrome indisponível/);
  assert.equal(failed.recorded.failures, 1);
});

test("outreach encerra se o lead virar opt-out antes do envio", async () => {
  const locked = setup({ locked: true });
  assert.deepEqual(await locked.handler(job), { action: "complete" });
  assert.equal(locked.recorded.success, 0);
});

test("outreach não repete o texto quando uma tentativa anterior já o auditou", async () => {
  const retry = setup({ textSent: true });
  await retry.handler(job);
  assert.deepEqual(retry.sent[0][3], { skipText: true });
});
