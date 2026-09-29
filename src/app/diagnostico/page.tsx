import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ResumeButton } from "@/components/resume-button";
import { getCircuitState } from "@/lib/circuit-breaker";
import { query } from "@/lib/db";
import { eventLabel, jobKindLabel, jobStatusLabel } from "@/lib/display";

export const dynamic = "force-dynamic";

interface CampaignSummary {
  total_campaigns: number;
  active_campaigns: number;
}

interface JobSummary {
  status: string;
  count: number;
}

interface JobKindSummary {
  kind: string;
  pending: number;
  running: number;
  dead: number;
}

interface RecentEvent {
  event: string;
  created_at: Date;
}

interface DeadJob {
  id: string;
  kind: string;
  last_error: string | null;
  updated_at: Date;
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function SummaryCard({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "blue" | "red" | "amber" }) {
  const tones = {
    slate: "text-slate-950",
    blue: "text-blue-700",
    red: "text-red-700",
    amber: "text-amber-700",
  };
  return (
    <Card>
      <CardContent>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className={`mt-2 text-3xl font-bold ${tones[tone]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function DiagnosticsPage() {
  const [campaignsResult, jobsResult, jobsByKindResult, eventsResult, deadJobsResult, circuit] = await Promise.all([
    query<CampaignSummary>(`SELECT
      COUNT(*)::int AS total_campaigns,
      COUNT(*) FILTER (WHERE active)::int AS active_campaigns
      FROM campaign_config`),
    query<JobSummary>("SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status ORDER BY status"),
    query<JobKindSummary>(`SELECT kind,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'running')::int AS running,
      COUNT(*) FILTER (WHERE status = 'dead')::int AS dead
      FROM jobs
      WHERE status IN ('pending', 'running', 'dead')
      GROUP BY kind
      ORDER BY dead DESC, pending DESC, kind`),
    query<RecentEvent>("SELECT event, created_at FROM audit_log ORDER BY created_at DESC LIMIT 10"),
    query<DeadJob>("SELECT id, kind, last_error, updated_at FROM jobs WHERE status = 'dead' ORDER BY updated_at DESC LIMIT 8"),
    getCircuitState(),
  ]);

  const campaigns = campaignsResult.rows[0];
  const totals = Object.fromEntries(jobsResult.rows.map((row) => [row.status, row.count]));
  const circuitPaused = Boolean(circuit.paused_until && new Date(circuit.paused_until).getTime() > Date.now());

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700">OPERAÇÃO</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Diagnóstico</h1>
          <p className="mt-2 text-sm text-slate-500">Fila, bloqueios e eventos técnicos da automação.</p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">Voltar à visão geral</Link>
      </div>

      <section className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${circuitPaused ? "border-red-200 bg-red-50 text-red-950" : "border-slate-200 bg-white text-slate-950"}`}>
        <div>
          <h2 className="font-semibold">{circuitPaused ? "Proteção de envios acionada" : campaigns.active_campaigns > 0 ? "Campanhas habilitadas" : "Campanhas em pausa"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {circuitPaused
              ? circuit.reason ?? "O circuit breaker interrompeu os envios."
              : `${campaigns.active_campaigns} de ${campaigns.total_campaigns} campanhas estão ativas no banco.`}
          </p>
        </div>
        {circuitPaused ? <ResumeButton /> : <Link href="/config" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Abrir configuração</Link>}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Aguardando" value={totals.pending ?? 0} tone="amber" />
        <SummaryCard label="Em execução" value={totals.running ?? 0} tone="blue" />
        <SummaryCard label="Concluídos" value={totals.done ?? 0} />
        <SummaryCard label="Interrompidos" value={totals.dead ?? 0} tone="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-semibold">Fila por etapa</h2><p className="mt-1 text-sm text-slate-500">Distribuição dos trabalhos que ainda exigem atenção.</p></div>
              <div className="flex flex-wrap gap-2">{jobsResult.rows.map((row) => <Badge key={row.status} variant={row.status}>{jobStatusLabel(row.status)}: {row.count}</Badge>)}</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {jobsByKindResult.rows.map((row) => (
                <div key={row.kind} className="grid grid-cols-[1fr_auto] items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div><p className="text-sm font-medium text-slate-800">{jobKindLabel(row.kind)}</p><p className="mt-0.5 text-xs text-slate-500">{row.pending} aguardando · {row.running} em execução</p></div>
                  {row.dead > 0 ? <Badge variant="dead">{row.dead} interrompido{row.dead === 1 ? "" : "s"}</Badge> : <span className="text-xs font-medium text-emerald-700">Sem bloqueios</span>}
                </div>
              ))}
              {jobsByKindResult.rows.length === 0 && <p className="text-sm text-slate-500">Nenhum trabalho aguardando ou interrompido.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="font-semibold">Atividade técnica</h2><p className="mt-1 text-sm text-slate-500">Eventos operacionais mais recentes.</p></CardHeader>
          <CardContent className="space-y-1">
            {eventsResult.rows.map((row, index) => (
              <div key={`${row.created_at.toISOString()}-${index}`} className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 first:pt-0 last:border-0 last:pb-0">
                <p className="text-sm font-medium text-slate-700">{eventLabel(row.event)}</p>
                <time className="shrink-0 text-xs text-slate-500">{formatDate(row.created_at)}</time>
              </div>
            ))}
            {eventsResult.rows.length === 0 && <p className="text-sm text-slate-500">Nenhuma atividade registrada.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="font-semibold">Últimas interrupções</h2><p className="mt-1 text-sm text-slate-500">Erros preservados para investigação antes de um novo ciclo.</p></CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {deadJobsResult.rows.map((job) => (
              <div key={job.id} className="grid gap-2 py-4 first:pt-0 last:pb-0 md:grid-cols-[11rem_1fr_auto] md:items-start">
                <p className="text-sm font-semibold text-slate-800">{jobKindLabel(job.kind)}</p>
                <p className="break-words text-sm leading-6 text-slate-500">{job.last_error || "Erro não informado."}</p>
                <time className="text-xs text-slate-400">{formatDate(job.updated_at)}</time>
              </div>
            ))}
            {deadJobsResult.rows.length === 0 && <p className="text-sm text-slate-500">Nenhuma interrupção registrada.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
