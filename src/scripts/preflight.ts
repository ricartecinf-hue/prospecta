import "dotenv/config";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { closeDatabase, query } from "@/lib/db";
import { env } from "@/lib/env";
import { geminiRetryReason } from "@/lib/openai";

type Check = { name: string; detail: string };

async function fetchChecked(url: string, init?: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw lastError instanceof Error ? lastError : new Error("falha de conexão");
}

async function inspectInstagramTarget(webSocketDebuggerUrl: string) {
  return new Promise<{ url: string; hasLoginForm: boolean }>((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timeout ao validar a sessão do Instagram"));
    }, 10_000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `({
            url: location.href,
            hasLoginForm: Boolean(document.querySelector('input[name="username"], input[name="password"]'))
          })`,
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as {
        id?: number;
        result?: { result?: { value?: { url: string; hasLoginForm: boolean } } };
        error?: { message?: string };
      };
      if (response.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      const value = response.result?.result?.value;
      if (!value) reject(new Error(response.error?.message || "CDP não retornou o estado da aba"));
      else resolve(value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("falha ao inspecionar a aba do Instagram via CDP"));
    });
  });
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

  const targets = await fetchChecked(`${base}/json/list`).then((response) => response.json()) as Array<{
    url?: string;
    webSocketDebuggerUrl?: string;
  }>;
  const instagramTab = targets.find((target) => target.url?.includes("instagram.com"));
  if (!instagramTab) throw new Error("abra e autentique uma aba do Instagram no Chrome dedicado");
  if (!instagramTab.webSocketDebuggerUrl) throw new Error("a aba do Instagram não expôs um endpoint CDP");
  const session = await inspectInstagramTarget(instagramTab.webSocketDebuggerUrl);
  const loginRequired = session.hasLoginForm || /instagram\.com\/(accounts\/login|challenge)/i.test(session.url);
  if (loginRequired) throw new Error("faça login manualmente no Instagram no Chrome dedicado");
  return { name: "Chrome/Instagram", detail: `${version.Browser ?? "Chrome"}; aba do Instagram encontrada` };
}

async function checkGemini(): Promise<Check> {
  const config = env();
  if (!config.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY não configurada");
  const model = new GoogleGenerativeAI(config.GOOGLE_API_KEY).getGenerativeModel({ model: config.GEMINI_MODEL });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await model.generateContent("Responda somente: OK");
      if (!result.response.text().trim()) throw new Error("Gemini retornou uma resposta vazia");
      return { name: "Gemini", detail: `${config.GEMINI_MODEL}; orçamento local US$ ${config.GEMINI_MONTHLY_BUDGET_USD}` };
    } catch (error) {
      lastError = error;
      if (!geminiRetryReason(error) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("falha ao validar o Gemini");
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
  const checks: Array<() => Promise<Check>> = [checkDatabase, checkChrome, checkGemini, checkEvolution];
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
  if (failed) throw new Error("uma ou mais conexões falharam");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
