import "dotenv/config";

import OpenAI from "openai";
import { closeDatabase, query } from "@/lib/db";
import { env } from "@/lib/env";

type Check = { name: string; detail: string };

async function fetchChecked(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function checkDatabase(): Promise<Check> {
  const config = env();
  const result = await query<{
    current_schema: string;
    leads: string | null;
    conversations: string | null;
    jobs: string | null;
    campaign_config: string | null;
    audit_log: string | null;
    ai_usage: string | null;
    active_campaigns: number;
  }>(
    `SELECT current_schema(),
      to_regclass($1) AS leads,
      to_regclass($2) AS conversations,
      to_regclass($3) AS jobs,
      to_regclass($4) AS campaign_config,
      to_regclass($5) AS audit_log,
      to_regclass($6) AS ai_usage,
      (SELECT COUNT(*)::int FROM campaign_config WHERE active = true) AS active_campaigns`,
    [
      `${config.DATABASE_SCHEMA}.leads`,
      `${config.DATABASE_SCHEMA}.conversations`,
      `${config.DATABASE_SCHEMA}.jobs`,
      `${config.DATABASE_SCHEMA}.campaign_config`,
      `${config.DATABASE_SCHEMA}.audit_log`,
      `${config.DATABASE_SCHEMA}.ai_usage`,
    ],
  );
  const row = result.rows[0];
  const missing = ["leads", "conversations", "jobs", "campaign_config", "audit_log", "ai_usage"]
    .filter((table) => !row[table as keyof typeof row]);
  if (missing.length) throw new Error(`tabelas ausentes: ${missing.join(", ")}`);
  if (row.current_schema !== config.DATABASE_SCHEMA) {
    throw new Error(`schema ativo é ${row.current_schema}; esperado ${config.DATABASE_SCHEMA}`);
  }
  if (row.active_campaigns < 1) throw new Error("nenhuma campanha ativa em campaign_config");
  return { name: "Supabase", detail: `${config.DATABASE_SCHEMA}, ${row.active_campaigns} campanha(s) ativa(s)` };
}

async function checkChrome(): Promise<Check> {
  const base = env().CHROME_CDP_URL.replace(/\/$/, "");
  const version = await fetchChecked(`${base}/json/version`).then((response) => response.json()) as {
    Browser?: string;
    webSocketDebuggerUrl?: string;
  };
  if (!version.webSocketDebuggerUrl) throw new Error("CDP respondeu sem webSocketDebuggerUrl");

  const targets = await fetchChecked(`${base}/json/list`).then((response) => response.json()) as Array<{ url?: string }>;
  const instagramTab = targets.find((target) => target.url?.includes("instagram.com"));
  if (!instagramTab) throw new Error("abra e autentique uma aba do Instagram no Chrome dedicado");
  return { name: "Chrome/Instagram", detail: `${version.Browser ?? "Chrome"}; aba do Instagram encontrada` };
}

async function checkOpenAI(): Promise<Check> {
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");
  const model = await new OpenAI({ apiKey }).models.retrieve("gpt-4o-mini");
  return { name: "OpenAI", detail: `${model.id}; orçamento local US$ ${env().OPENAI_MONTHLY_BUDGET_USD}` };
}

function collectInstanceNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectInstanceNames(item, names);
    return names;
  }
  if (!value || typeof value !== "object") return names;
  for (const [key, item] of Object.entries(value)) {
    if (["instanceName", "instance_name", "name"].includes(key) && typeof item === "string") names.add(item);
    else collectInstanceNames(item, names);
  }
  return names;
}

async function checkEvolution(): Promise<Check> {
  const config = env();
  if (!config.EVOLUTION_API_URL) throw new Error("EVOLUTION_API_URL não configurada");
  if (!config.EVOLUTION_API_KEY) throw new Error("EVOLUTION_API_KEY não configurada");
  if (!config.EVOLUTION_INSTANCE) throw new Error("EVOLUTION_INSTANCE não configurada");

  const response = await fetchChecked(
    `${config.EVOLUTION_API_URL.replace(/\/$/, "")}/instance/fetchInstances`,
    { headers: { apikey: config.EVOLUTION_API_KEY } },
  );
  const names = collectInstanceNames(await response.json());
  if (names.size && !names.has(config.EVOLUTION_INSTANCE)) {
    throw new Error(`instância ${config.EVOLUTION_INSTANCE} não encontrada; disponíveis: ${[...names].join(", ")}`);
  }
  return { name: "Evolution API", detail: `instância ${config.EVOLUTION_INSTANCE} acessível` };
}

async function main() {
  const checks: Array<() => Promise<Check>> = [checkDatabase, checkChrome, checkOpenAI, checkEvolution];
  let failed = false;

  console.info("Prospecta — diagnóstico sem envios\n");
  for (const check of checks) {
    try {
      const result = await check();
      console.info(`✓ ${result.name}: ${result.detail}`);
    } catch (error) {
      failed = true;
      console.error(`✗ ${check.name.replace(/^check/, "")}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const config = env();
  console.info(`\nDMs Instagram: ${config.INSTAGRAM_DMS_ENABLED === "true" ? "ATIVADAS" : "BLOQUEADAS"}`);
  console.info(`Handoffs WhatsApp: ${config.WHATSAPP_HANDOFF_ENABLED === "true" ? "ATIVADOS" : "BLOQUEADOS"}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
