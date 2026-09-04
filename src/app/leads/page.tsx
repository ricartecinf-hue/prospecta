import { LeadRow } from "@/components/lead-row";
import { Card, CardContent } from "@/components/ui/card";
import { getCampaignConfigs, query } from "@/lib/db";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

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
              {result.rows.map((lead) => <LeadRow key={lead.id} lead={lead} />)}
            </tbody>
          </table>
          {result.rows.length === 0 && <p className="p-8 text-center text-slate-500">Nenhum lead encontrado.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
