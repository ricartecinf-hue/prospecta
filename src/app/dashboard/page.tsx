import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ResumeButton } from "@/components/resume-button";
import { getCircuitState } from "@/lib/circuit-breaker";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Metrics {
  leads_today: number;
  dms_today: number;
  response_rate: string;
  handoffs_today: number;
  direct_contacts: number;
}

export default async function DashboardPage() {
  const [metricsResult, jobsResult, eventsResult, circuit] = await Promise.all([
    query<Metrics>(`SELECT
      (SELECT COUNT(*)::int FROM leads WHERE discovered_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS leads_today,
      (SELECT COUNT(*)::int FROM conversations WHERE direction = 'outbound' AND sent_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS dms_today,
      (SELECT COALESCE(ROUND(100.0 * COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'inbound') / NULLIF(COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'outbound'), 0), 1), 0)::text FROM conversations) AS response_rate,
      (SELECT COUNT(*)::int FROM leads WHERE status = 'handed_off' AND updated_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS handoffs_today,
      (SELECT COUNT(*)::int FROM leads WHERE whatsapp IS NOT NULL OR email IS NOT NULL) AS direct_contacts`),
    query<{ status: string; count: number }>("SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status ORDER BY status"),
    query<{ event: string; payload: Record<string, unknown>; created_at: Date }>("SELECT event, payload, created_at FROM audit_log ORDER BY created_at DESC LIMIT 8"),
    getCircuitState(),
  ]);
  const metrics = metricsResult.rows[0];
  const paused = Boolean(circuit.paused_until && new Date(circuit.paused_until).getTime() > Date.now());
  const cards = [
    ["Leads descobertos hoje", metrics.leads_today],
    ["DMs enviadas hoje", metrics.dms_today],
    ["Taxa de resposta", `${metrics.response_rate}%`],
    ["Handoffs hoje", metrics.handoffs_today],
    ["Leads com contato direto", metrics.direct_contacts],
  ];
  return (
    <div className="space-y-7">
      <div><p className="text-sm font-semibold text-blue-700">PROSPECTA</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Visão geral</h1></div>
      {paused && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950">
          <div><strong>Automação pausada</strong><p className="mt-1 text-sm">{circuit.reason} Pausa até {new Date(circuit.paused_until!).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p></div>
          <ResumeButton />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(([label, value]) => <Card key={String(label)}><CardContent><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></CardContent></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><h2 className="font-semibold">Fila de jobs</h2></CardHeader><CardContent className="space-y-3">{jobsResult.rows.map((row) => <div key={row.status} className="flex items-center justify-between"><Badge variant={row.status}>{row.status}</Badge><strong>{row.count}</strong></div>)}</CardContent></Card>
        <Card><CardHeader><h2 className="font-semibold">Atividade recente</h2></CardHeader><CardContent className="space-y-4">{eventsResult.rows.map((row, index) => <div key={`${row.created_at}-${index}`} className="border-b border-slate-100 pb-3 last:border-0"><p className="text-sm font-medium">{row.event}</p><p className="mt-1 text-xs text-slate-500">{row.created_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>)}</CardContent></Card>
      </div>
    </div>
  );
}
