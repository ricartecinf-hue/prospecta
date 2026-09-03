import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getCampaignConfigs, query } from "@/lib/db";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

function ContactLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      target="_blank"
      rel="noreferrer"
      className="relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-base hover:border-blue-300 hover:bg-blue-50"
    >
      {children}
    </a>
  );
}

function scoreBadgeClass(score: number) {
  if (score >= 90) return "bg-green-100 text-green-800";
  if (score >= 70) return "bg-blue-100 text-blue-800";
  if (score >= 50) return "bg-yellow-100 text-yellow-800";
  return "bg-slate-100 text-slate-500";
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; niche?: string }> }) {
  const filters = await searchParams;
  // Lista fixa a partir das campanhas cadastradas — não da presença de leads —
  // para que um nicho recém-ativado (ainda sem leads) já apareça no seletor.
  const campaigns = await getCampaignConfigs();
  const nicheOptions = campaigns.map((campaign) => campaign.niche);

  // A visão padrão nunca mistura nichos: só quando o parâmetro "niche" está
  // ausente da URL (primeira entrada na página) é que escolhemos um nicho
  // sozinho. "Todos os nichos" continua existindo como escolha explícita —
  // selecioná-lo manda niche="" na URL, o que é diferente de "ausente".
  const niche = filters.niche !== undefined ? filters.niche : (nicheOptions[0] ?? "");

  const values: unknown[] = [];
  const where: string[] = [];
  if (filters.status) { values.push(filters.status); where.push(`status = $${values.length}`); }
  if (niche) { values.push(niche); where.push(`niche = $${values.length}`); }
  const result = await query<Lead>(`SELECT * FROM leads ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY score DESC, discovered_at DESC LIMIT 500`, values);
  return (
    <div className="space-y-6">
      <div><p className="text-sm font-semibold text-blue-700">PIPELINE</p><h1 className="mt-1 text-3xl font-bold">Leads</h1></div>
      <form className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Todos os status</option>{["discovered","qualified","disqualified","dm_sent","replied","handed_off","converted","do_not_contact"].map((status) => <option key={status} value={status}>{status}</option>)}</select>
        <select name="niche" defaultValue={niche} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Todos os nichos</option>{nicheOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Filtrar</button>
      </form>
      <Card className="overflow-hidden">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Lead</th>
                <th className="px-5 py-3">Contatos</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Nicho</th>
                <th className="px-5 py-3">Score</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Descoberto</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((lead) => (
                <tr key={lead.id} className="relative border-b border-slate-200 even:bg-slate-50/60 hover:bg-blue-50/60">
                  <td className="px-5 py-5">
                    {/* Cobre a linha inteira e navega para o detalhe; os links de contato abaixo
                        ficam com z-10 para continuar clicáveis por cima dela. */}
                    <Link href={`/leads/${lead.id}`} aria-hidden="true" tabIndex={-1} className="absolute inset-0" />
                    <span className="relative block font-semibold text-slate-900">{lead.full_name || `@${lead.ig_username}`}</span>
                    <span className="relative block text-xs text-slate-500">@{lead.ig_username}</span>
                  </td>
                  <td className="px-5 py-5">
                    <div className="flex gap-2">
                      <ContactLink href={lead.ig_profile_url || `https://instagram.com/${lead.ig_username}`} label={`Abrir @${lead.ig_username} no Instagram`}>◎</ContactLink>
                      {lead.whatsapp && <ContactLink href={`https://wa.me/${lead.whatsapp}`} label={`Abrir WhatsApp de @${lead.ig_username}`}>◉</ContactLink>}
                    </div>
                  </td>
                  <td className="px-5 py-5">
                    {lead.email ? <a href={`mailto:${lead.email}`} className="relative z-10 text-blue-700 hover:underline">{lead.email}</a> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-5 py-5">{lead.niche}</td>
                  <td className="px-5 py-5">
                    <span className={`inline-flex min-w-[2.5rem] justify-center rounded-full px-2.5 py-1 text-sm font-bold ${scoreBadgeClass(lead.score)}`}>{lead.score}</span>
                  </td>
                  <td className="px-5 py-5"><Badge variant={lead.status}>{lead.status}</Badge></td>
                  <td className="px-5 py-5 text-slate-500">{lead.discovered_at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 && <p className="p-8 text-center text-slate-500">Nenhum lead encontrado.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
