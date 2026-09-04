import assert from "node:assert/strict";
import test from "node:test";
import { buildHandoffMessage, createHandoffHandler } from "./handoff-handler";
import type { CampaignConfig, Job, Lead } from "@/lib/types";

const leadId = "44444444-4444-4444-8444-444444444444";
const job = { id: "55555555-5555-4555-8555-555555555555", kind: "handoff", payload: { leadId } } as unknown as Job;
const lead: Lead = {
  id: leadId, ig_username: "ana.psi", ig_user_id: null, full_name: "Ana Silva", bio: null,
  followers_count: null, following_count: null, posts_count: null, profile_pic_url: null,
  whatsapp: null, email: null, ig_profile_url: "https://instagram.com/ana.psi", recent_posts: [],
  niche: "psicologo", score: 91, score_reason: "Perfil ideal", is_icp: true, score_breakdown: null,
  qualified_at: null, status: "replied", do_not_contact: false, source: null,
  discovered_at: new Date(), updated_at: new Date(),
};
const campaign: CampaignConfig = {
  id: "66666666-6666-4666-8666-666666666666", niche: "psicologo", icp_description: "x",
  icp_hashtags: [], icp_competitors: [], icp_locations: [], product_name: "Sinapsi", product_url: null,
  verified_claims: [], dm_template_1: "x", dm_template_followup: null, whatsapp_number: "5554981133456",
  max_dm_per_day: 30, window_start_hour: 9, window_end_hour: 20, min_score_to_dm: 65,
  followup_after_hours: 48, active: true, created_at: new Date(), updated_at: new Date(),
};

function rows<T>(value: T[]) { return { rows: value }; }

function setup(options: { lead?: Lead | null; sent?: boolean; disabled?: unknown; number?: string } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const whatsapps: unknown[][] = [];
  let asserted = 0;
  const query = async <T>(sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT * FROM leads")) return rows((options.lead === undefined ? [lead] : options.lead ? [options.lead] : []) as T[]);
    if (sql.includes("event = 'whatsapp.handoff.after'")) return rows([{ exists: options.sent ?? false }] as T[]);
    if (sql.startsWith("SELECT direction")) return rows([{ direction: "outbound", body: "Olá Ana", sent_at: new Date() }, { direction: "inbound", body: "Tenho interesse", sent_at: new Date() }] as T[]);
    return rows([] as T[]);
  };
  const handler = createHandoffHandler({
    query: query as never,
    getCampaignConfig: async () => ({ ...campaign, whatsapp_number: options.number ?? campaign.whatsapp_number }),
    blockDisabledExternalAction: async () => options.disabled as never ?? null,
    assertHandoffChannel: () => { asserted += 1; },
    sendWhatsApp: async (...args) => { whatsapps.push(args); },
  });
  return { handler, calls, whatsapps, asserted: () => asserted };
}

test("handoff encerra lead ausente e recupera envio já auditado", async () => {
  const missing = setup({ lead: null });
  assert.deepEqual(await missing.handler(job), { action: "complete" });

  const duplicate = setup({ sent: true });
  assert.deepEqual(await duplicate.handler(job), { action: "complete" });
  assert.equal(duplicate.calls.some((call) => call.sql.startsWith("UPDATE leads")), true);

  const optedOut = setup({ lead: { ...lead, do_not_contact: true } });
  assert.deepEqual(await optedOut.handler(job), { action: "complete" });

  const alreadyHandedOff = setup({ lead: { ...lead, status: "handed_off" } });
  assert.deepEqual(await alreadyHandedOff.handler(job), { action: "complete" });
});

test("handoff exige destinatário fixo e respeita a trava externa", async () => {
  const invalid = setup({ number: "5511999999999" });
  await assert.rejects(() => invalid.handler(job), /5554981133456/);

  const blocked = setup({ disabled: { action: "reschedule", runAfter: new Date(), reason: "desativada" } });
  assert.equal((await blocked.handler(job)).action, "reschedule");
  assert.equal(blocked.asserted(), 0);
});

test("handoff envia para Ricardo pela instância validada com todos os campos", async () => {
  const { handler, whatsapps, calls, asserted } = setup();
  assert.deepEqual(await handler(job), { action: "complete" });
  assert.equal(asserted(), 1);
  assert.equal(whatsapps.length, 1);
  assert.equal(whatsapps[0][0], "5554981133456");
  const body = String(whatsapps[0][1]);
  for (const expected of ["Nome: Ana Silva", "Instagram: @ana.psi", "Score: 91/100", "https://instagram.com/ana.psi", "Resumo da conversa:", "Lead: Tenho interesse"]) assert.match(body, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(calls.some((call) => call.sql.startsWith("UPDATE leads")), true);
});

test("formata fallback de perfil e resumo vazio", () => {
  const text = buildHandoffMessage({ ...lead, full_name: null, score_reason: null, ig_profile_url: "" }, "");
  assert.match(text, /Perfil: https:\/\/instagram.com\/ana.psi/);
  assert.match(text, /Sem mensagens registradas/);
  assert.match(text, /Nome: Não informado/);
  assert.match(text, /sem justificativa/);
});
