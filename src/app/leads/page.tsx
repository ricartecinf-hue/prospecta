import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { query } from "@/lib/db";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

function ContactLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return <a href={href} aria-label={label} title={label} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-base hover:border-blue-300 hover:bg-blue-50">{children}</a>;
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; niche?: string }> }) {
  const filters = await searchParams;
  const niches = await query<{ niche: string }>("SELECT DISTINCT niche FROM leads ORDER BY niche");

  // A visão padrão nunca mistura nichos: só quando o parâmetro "niche" está
  // ausente da URL (primeira entrada na página) é que escolhemos um nicho
  // sozinho. "Todos os nichos" continua existindo como escolha explícita —
  // selecioná-lo manda niche="" na URL, o que é diferente de "ausente".
  const niche = filters.niche !== undefined ? filters.niche : (niches.rows[0]?.niche ?? "");

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
        <select name="niche" defaultValue={niche} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Todos os nichos</option>{niches.rows.map(({ niche: value }) => <option key={value} value={value}>{value}</option>)}</select>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Filtrar</button>
      </form>
      <Card className="overflow-hidden"><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Lead</th><th className="px-5 py-3">Contatos</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Nicho</th><th className="px-5 py-3">Origem</th><th className="px-5 py-3">Score</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Descoberto</th></tr></thead><tbody>{result.rows.map((lead) => <tr key={lead.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="px-5 py-4"><Link href={`/leads/${lead.id}`} className="font-semibold text-blue-700 hover:underline">{lead.full_name || `@${lead.ig_username}`}</Link><span className="block text-xs text-slate-500">@{lead.ig_username}</span></td><td className="px-5 py-4"><div className="flex gap-2"><ContactLink href={lead.ig_profile_url || `https://instagram.com/${lead.ig_username}`} label={`Abrir @${lead.ig_username} no Instagram`}>◎</ContactLink>{lead.whatsapp && <ContactLink href={`https://wa.me/${lead.whatsapp}`} label={`Abrir WhatsApp de @${lead.ig_username}`}>◉</ContactLink>}</div></td><td className="px-5 py-4">{lead.email ? <a href={`mailto:${lead.email}`} className="text-blue-700 hover:underline">{lead.email}</a> : <span className="text-slate-400">—</span>}</td><td className="px-5 py-4">{lead.niche}</td><td className="px-5 py-4 text-slate-500">{lead.source}</td><td className="px-5 py-4 text-lg font-bold">{lead.score}</td><td className="px-5 py-4"><Badge variant={lead.status}>{lead.status}</Badge></td><td className="px-5 py-4 text-slate-500">{lead.discovered_at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td></tr>)}</tbody></table>{result.rows.length === 0 && <p className="p-8 text-center text-slate-500">Nenhum lead encontrado.</p>}</CardContent></Card>
    </div>
  );
}
