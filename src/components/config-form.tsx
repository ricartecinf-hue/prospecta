"use client";

import { useState, type FormEvent } from "react";
import type { CampaignConfig } from "@/lib/types";

export function ConfigForm({ campaign }: { campaign: CampaignConfig }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/config/${campaign.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icp_description: data.get("icp_description"),
        icp_hashtags: String(data.get("icp_hashtags") ?? "").split(/[\s,]+/).filter(Boolean),
        icp_competitors: String(data.get("icp_competitors") ?? "").split(/[\s,]+/).filter(Boolean),
        verified_claims: String(data.get("verified_claims") ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
        dm_template_1: data.get("dm_template_1"),
        dm_template_followup: data.get("dm_template_followup"),
        whatsapp_number: data.get("whatsapp_number"),
        max_dm_per_day: Number(data.get("max_dm_per_day")),
        window_start_hour: Number(data.get("window_start_hour")),
        window_end_hour: Number(data.get("window_end_hour")),
        min_score_to_dm: Number(data.get("min_score_to_dm")),
        followup_after_hours: Number(data.get("followup_after_hours")),
        active: data.get("active") === "on",
      }),
    });
    const result = await response.json();
    setSaving(false);
    setMessage(response.ok ? "Configuração salva." : result.error ?? "Falha ao salvar.");
  }

  const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  return (
    <form onSubmit={submit} className="space-y-6">
      <label className="block text-sm font-medium text-slate-700">Descrição do ICP
        <textarea name="icp_description" defaultValue={campaign.icp_description} rows={4} className={inputClass} required />
      </label>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">Hashtags
          <textarea name="icp_hashtags" defaultValue={campaign.icp_hashtags.join(" ")} rows={4} className={inputClass} required />
        </label>
        <label className="block text-sm font-medium text-slate-700">Concorrentes
          <textarea name="icp_competitors" defaultValue={campaign.icp_competitors.join(" ")} rows={4} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">Claims verificados — um por linha
        <textarea name="verified_claims" defaultValue={campaign.verified_claims.join("\n")} rows={5} className={inputClass} required />
      </label>
      <label className="block text-sm font-medium text-slate-700">DM inicial
        <textarea name="dm_template_1" defaultValue={campaign.dm_template_1} rows={5} className={inputClass} required />
        <span className="mt-1 block text-xs text-slate-500">Use apenas claims verificados e a variável {"{{first_name}}"}.</span>
      </label>
      <label className="block text-sm font-medium text-slate-700">Follow-up
        <textarea name="dm_template_followup" defaultValue={campaign.dm_template_followup ?? ""} rows={4} className={inputClass} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-medium text-slate-700">WhatsApp
          <input name="whatsapp_number" defaultValue={campaign.whatsapp_number} className={inputClass} required />
        </label>
        <label className="text-sm font-medium text-slate-700">DMs/dia
          <input type="number" name="max_dm_per_day" min="1" max="30" defaultValue={campaign.max_dm_per_day} className={inputClass} required />
        </label>
        <label className="text-sm font-medium text-slate-700">Início
          <input type="number" name="window_start_hour" min="9" max="19" defaultValue={campaign.window_start_hour} className={inputClass} required />
        </label>
        <label className="text-sm font-medium text-slate-700">Fim
          <input type="number" name="window_end_hour" min="10" max="20" defaultValue={campaign.window_end_hour} className={inputClass} required />
        </label>
        <label className="text-sm font-medium text-slate-700">Score mínimo
          <input type="number" name="min_score_to_dm" min="0" max="100" defaultValue={campaign.min_score_to_dm} className={inputClass} required />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <label className="text-sm font-medium text-slate-700">Follow-up após (h)
          <input type="number" name="followup_after_hours" min="1" max="720" defaultValue={campaign.followup_after_hours} className={`${inputClass} w-32`} required />
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" name="active" defaultChecked={campaign.active} /> Campanha ativa
        </label>
      </div>
      <div className="flex items-center gap-4">
        <button disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
          {saving ? "Salvando…" : "Salvar configuração"}
        </button>
        {message && <p className="text-sm text-slate-600">{message}</p>}
      </div>
    </form>
  );
}
