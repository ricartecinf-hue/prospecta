import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDatabase, query } from "@/lib/db";

const RUN_KEY = "overnight_run_2026_09_02";

async function main() {
  const state = await query<{ value: { started_at: string; baseline_leads: number; target: number; ended_at?: string; outcome?: string } }>(
    "SELECT value FROM agent_state WHERE key = $1",
    [RUN_KEY],
  );
  if (!state.rows[0]) throw new Error("A execução noturna ainda não foi iniciada.");
  const run = state.rows[0].value;
  const [metrics, jobs, safety, top] = await Promise.all([
    query<{ discovered: number; qualified: number; direct_contacts: number; visits: number; protections: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM leads WHERE discovered_at >= $1) AS discovered,
        (SELECT COUNT(*)::int FROM leads WHERE discovered_at >= $1 AND qualified_at IS NOT NULL) AS qualified,
        (SELECT COUNT(*)::int FROM leads WHERE discovered_at >= $1 AND (whatsapp IS NOT NULL OR email IS NOT NULL)) AS direct_contacts,
        (SELECT COUNT(*)::int FROM audit_log WHERE event = 'prospector.profile_visit' AND created_at >= $1) AS visits,
        (SELECT COUNT(*)::int FROM audit_log WHERE event = 'prospector.protection_paused' AND created_at >= $1) AS protections`,
      [run.started_at],
    ),
    query<{ kind: string; status: string; count: number }>(
      `SELECT kind, status, COUNT(*)::int AS count FROM jobs
        WHERE kind IN ('prospect', 'qualify') GROUP BY kind, status ORDER BY kind, status`,
    ),
    query<{ value: { paused_until: string | null; reason: string | null } }>(
      "SELECT value FROM agent_state WHERE key = 'prospecting_safety'",
    ),
    query<{ ig_username: string; score: number; status: string; whatsapp: string | null; email: string | null }>(
      `SELECT ig_username, score, status, whatsapp, email FROM leads
        WHERE discovered_at >= $1 ORDER BY score DESC, discovered_at DESC LIMIT 20`,
      [run.started_at],
    ),
  ]);
  const value = metrics.rows[0];
  const paused = safety.rows[0]?.value;
  const lines = [
    "# Prospecta — resumo da prospecção noturna",
    "",
    `- Início: ${new Date(run.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `- Atualização: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    run.ended_at ? `- Encerramento: ${new Date(run.ended_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "",
    run.outcome ? `- Resultado: ${run.outcome}` : "",
    `- Meta: ${run.target} leads descobertos e qualificados`,
    `- Leads descobertos: ${value.discovered}`,
    `- Leads qualificados: ${value.qualified}`,
    `- Contatos diretos encontrados: ${value.direct_contacts}`,
    `- Visitas reservadas: ${value.visits}/150`,
    `- Pausas por 429/captcha: ${value.protections}`,
    `- Proteção pausada até: ${paused?.paused_until ? new Date(paused.paused_until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "não"}`,
    paused?.reason ? `- Motivo da pausa: ${paused.reason}` : "",
    "",
    "## Fila",
    "",
    "| Tipo | Status | Quantidade |",
    "|---|---|---:|",
    ...jobs.rows.map((row) => `| ${row.kind} | ${row.status} | ${row.count} |`),
    "",
    "## Melhores leads novos",
    "",
    "| Instagram | Score | Status | WhatsApp | Email |",
    "|---|---:|---|:---:|:---:|",
    ...top.rows.map((row) => `| [@${row.ig_username}](https://instagram.com/${row.ig_username}) | ${row.score} | ${row.status} | ${row.whatsapp ? "sim" : "não"} | ${row.email ? "sim" : "não"} |`),
    "",
  ];
  const output = path.resolve(".logs/overnight-2026-09-02.md");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, lines.join("\n"), "utf8");
  console.info(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(closeDatabase);
