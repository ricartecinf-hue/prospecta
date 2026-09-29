import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ResumeButton } from "@/components/resume-button";
import { getCircuitState } from "@/lib/circuit-breaker";
import { query } from "@/lib/db";
import { conversionRate, eventLabel, jobKindLabel, jobStatusLabel } from "@/lib/display";

export const dynamic = "force-dynamic";

interface DashboardMetrics {
  leads_today: number;
  dms_today: number;
  total_leads: number;
  qualified_leads: number;
  contacted_leads: number;
  replied_leads: number;
  handed_off_leads: number;
  outbound_messages: number;
  direct_contacts: number;
  average_score: number | null;
  last_outbound: Date | null;
  last_inbound: Date | null;
}

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

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatDate(value: Date | null) {
  if (!value) return "Nenhuma registrada";
  return value.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const [metricsResult, campaignsResult, jobsResult, jobsByKindResult, eventsResult, circuit] = await Promise.all([
    query<DashboardMetrics>(`SELECT
      (SELECT COUNT(*)::int FROM leads WHERE discovered_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS leads_today,
      (SELECT COUNT(*)::int FROM conversations WHERE direction = 'outbound' AND sent_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS dms_today,
      (SELECT COUNT(*)::int FROM leads) AS total_leads,
      (SELECT COUNT(*)::int FROM leads WHERE status IN ('qualified', 'dm_sent', 'replied', 'handed_off', 'converted')) AS qualified_leads,
      (SELECT COUNT(DISTINCT lead_id)::int FROM conversations WHERE direction = 'outbound') AS contacted_leads,
      (SELECT COUNT(DISTINCT lead_id)::int FROM conversations WHERE direction = 'inbound') AS replied_leads,
      (SELECT COUNT(*)::int FROM leads WHERE status IN ('handed_off', 'converted')) AS handed_off_leads,
      (SELECT COUNT(*)::int FROM conversations WHERE direction = 'outbound') AS outbound_messages,
      (SELECT COUNT(*)::int FROM leads WHERE whatsapp IS NOT NULL OR email IS NOT NULL) AS direct_contacts,
      (SELECT ROUND(AVG(score), 1)::float8 FROM leads WHERE status IN ('qualified', 'dm_sent', 'replied', 'handed_off', 'converted')) AS average_score,
      (SELECT MAX(sent_at) FROM conversations WHERE direction = 'outbound') AS last_outbound,
      (SELECT MAX(sent_at) FROM conversations WHERE direction = 'inbound') AS last_inbound`),
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
    query<RecentEvent>("SELECT event, created_at FROM audit_log ORDER BY created_at DESC LIMIT 8"),
    getCircuitState(),
  ]);

  const metrics = metricsResult.rows[0];
  const campaigns = campaignsResult.rows[0];
  const circuitPaused = Boolean(circuit.paused_until && new Date(circuit.paused_until).getTime() > Date.now());
  const campaignPaused = campaigns.active_campaigns === 0;
  const followups = Math.max(0, metrics.outbound_messages - metrics.contacted_leads);
  const responseRate = conversionRate(metrics.replied_leads, metrics.contacted_leads);
  const deadInboxJobs = jobsByKindResult.rows.find((row) => row.kind === "inbox_poll")?.dead ?? 0;

  const funnel = [
    { label: "Leads encontrados", value: metrics.total_leads, rate: null, description: "Base total" },
    { label: "Qualificados", value: metrics.qualified_leads, rate: conversionRate(metrics.qualified_leads, metrics.total_leads), description: "dos encontrados" },
    { label: "Contatados", value: metrics.contacted_leads, rate: conversionRate(metrics.contacted_leads, metrics.qualified_leads), description: "dos qualificados" },
    { label: "Responderam", value: metrics.replied_leads, rate: responseRate, description: "dos contatados" },
    { label: "Encaminhados", value: metrics.handed_off_leads, rate: conversionRate(metrics.handed_off_leads, metrics.replied_leads), description: "das respostas" },
  ];

  const statusTotals = Object.fromEntries(jobsResult.rows.map((row) => [row.status, row.count]));
  const banner = circuitPaused
    ? {
        title: "Automação pausada por segurança",
        description: `${circuit.reason ?? "O circuit breaker interrompeu os envios."} Pausa até ${formatDate(new Date(circuit.paused_until!))}.`,
        className: "border-red-200 bg-red-50 text-red-950",
        dotClassName: "bg-red-500",
      }
    : campaignPaused
      ? {
          title: "Sistema pausado",
          description: `As ${campaigns.total_campaigns} campanhas estão inativas. A fila permanece preservada e nenhuma campanha deve avançar até ser reativada.`,
          className: "border-amber-200 bg-amber-50 text-amber-950",
          dotClassName: "bg-amber-500",
        }
      : {
          title: "Campanhas ativas",
          description: `${campaigns.active_campaigns} de ${campaigns.total_campaigns} campanhas estão habilitadas no banco.`,
          className: "border-emerald-200 bg-emerald-50 text-emerald-950",
          dotClassName: "bg-emerald-500",
        };

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700">PROSPECTA</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Visão geral</h1>
          <p className="mt-2 text-sm text-slate-500">Saúde da operação, resultados e próximos pontos de atenção.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/leads" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">Ver leads</Link>
          <Link href="/config" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Configurar campanhas</Link>
        </div>
      </div>

      <section className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${banner.className}`} aria-live="polite">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${banner.dotClassName}`} aria-hidden="true" />
            <h2 className="font-semibold">{banner.title}</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 opacity-80">{banner.description}</p>
        </div>
        {circuitPaused ? <ResumeButton /> : campaignPaused ? <Link href="/config" className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">Revisar campanhas</Link> : null}
      </section>

      {metrics.contacted_leads > 0 && metrics.replied_leads === 0 && (
        <section className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-orange-950">
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">Atenção à medição</p>
          <h2 className="mt-1 text-lg font-semibold">Nenhuma resposta foi registrada após {metrics.contacted_leads} leads contatados.</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-orange-900/80">
            {deadInboxJobs > 0
              ? `Existem ${deadInboxJobs} jobs interrompidos na leitura do inbox. Confira o Direct manualmente antes de avaliar a mensagem ou reativar a campanha.`
              : "Confira o Direct manualmente e valide se a leitura de respostas está funcionando antes de reativar a campanha."}
          </p>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Leads hoje" value={numberFormatter.format(metrics.leads_today)} detail={`${numberFormatter.format(metrics.total_leads)} armazenados no total`} />
        <MetricCard label="DMs hoje" value={numberFormatter.format(metrics.dms_today)} detail={`${numberFormatter.format(metrics.outbound_messages)} mensagens no histórico`} />
        <MetricCard label="Contatados" value={numberFormatter.format(metrics.contacted_leads)} detail={`${numberFormatter.format(followups)} follow-ups enviados`} />
        <MetricCard label="Taxa de resposta" value={`${responseRate.toLocaleString("pt-BR")}%`} detail={`${numberFormatter.format(metrics.replied_leads)} pessoas responderam`} />
        <MetricCard label="Encaminhados" value={numberFormatter.format(metrics.handed_off_leads)} detail={`${numberFormatter.format(metrics.direct_contacts)} leads têm contato direto`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-semibold">Funil acumulado</h2><p className="mt-1 text-sm text-slate-500">Conversão real entre cada etapa.</p></div>
              <span className="text-sm text-slate-500">Score médio qualificado: <strong className="text-slate-900">{metrics.average_score?.toLocaleString("pt-BR") ?? "—"}</strong></span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {funnel.map((stage) => {
              const width = metrics.total_leads > 0 ? Math.round((stage.value / metrics.total_leads) * 100) : 0;
              return (
                <div key={stage.label}>
                  <div className="mb-2 flex items-end justify-between gap-4">
                    <div><p className="text-sm font-semibold text-slate-800">{stage.label}</p><p className="text-xs text-slate-500">{stage.rate === null ? stage.description : `${stage.rate.toLocaleString("pt-BR")}% ${stage.description}`}</p></div>
                    <strong className="text-lg text-slate-950">{numberFormatter.format(stage.value)}</strong>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={stage.label} aria-valuemin={0} aria-valuemax={metrics.total_leads} aria-valuenow={stage.value}>
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="font-semibold">Últimos sinais</h2><p className="mt-1 text-sm text-slate-500">Quando o sistema movimentou o funil.</p></CardHeader>
          <CardContent className="space-y-5">
            <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Última mensagem enviada</p><p className="mt-1 font-semibold text-slate-900">{formatDate(metrics.last_outbound)}</p></div>
            <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Última resposta registrada</p><p className="mt-1 font-semibold text-slate-900">{formatDate(metrics.last_inbound)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-medium text-slate-700">Leitura recomendada</p><p className="mt-1 text-sm leading-6 text-slate-500">O volume de qualificados é alto, mas o avanço após o contato é o principal gargalo.</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Saúde da fila</h2><p className="mt-1 text-sm text-slate-500">Trabalhos preservados e pontos que exigem correção.</p></div><div className="flex flex-wrap gap-2">{jobsResult.rows.map((row) => <Badge key={row.status} variant={row.status}>{jobStatusLabel(row.status)}: {row.count}</Badge>)}</div></div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {jobsByKindResult.rows.map((row) => (
                <div key={row.kind} className="grid grid-cols-[1fr_auto] items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div><p className="text-sm font-medium text-slate-800">{jobKindLabel(row.kind)}</p><p className="mt-0.5 text-xs text-slate-500">{row.pending} aguardando · {row.running} em execução</p></div>
                  {row.dead > 0 ? <Badge variant="dead">{row.dead} interrompido{row.dead === 1 ? "" : "s"}</Badge> : <span className="text-xs font-medium text-emerald-700">Sem bloqueios</span>}
                </div>
              ))}
              {jobsByKindResult.rows.length === 0 && <p className="text-sm text-slate-500">Nenhum job aguardando ou interrompido.</p>}
            </div>
            {(statusTotals.dead ?? 0) > 0 && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">Há {statusTotals.dead} jobs interrompidos. Corrija a causa antes de reativar a fila.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="font-semibold">Atividade recente</h2><p className="mt-1 text-sm text-slate-500">Eventos operacionais mais recentes.</p></CardHeader>
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
    </div>
  );
}
