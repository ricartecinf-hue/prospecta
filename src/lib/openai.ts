import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";
import { audit, query } from "./db";
import { env } from "./env";
import { scoreQualification, type StructuredQualification } from "./qualification-score";
import type { CampaignConfig, InstagramProfile } from "./types";

const signalSchema = z.object({
  profession_confirmed: z.boolean(),
  mental_health_content: z.boolean(),
  professional_active: z.boolean(),
  service_mentioned: z.boolean(),
  personal_profile: z.boolean(),
  evidence: z.string().max(300),
});
export type QualificationResult = StructuredQualification;

function model() {
  const config = env();
  if (!config.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY não configurada.");
  return new GoogleGenerativeAI(config.GOOGLE_API_KEY).getGenerativeModel({
    model: config.GEMINI_MODEL,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          profession_confirmed: { type: SchemaType.BOOLEAN, description: "Profissão-alvo explícita no nome ou bio" },
          mental_health_content: { type: SchemaType.BOOLEAN, description: "Posts recentes tratam de saúde mental" },
          professional_active: { type: SchemaType.BOOLEAN, description: "Bio profissional completa e posts regulares" },
          service_mentioned: { type: SchemaType.BOOLEAN, description: "Menciona atendimento, consultório ou sessão" },
          personal_profile: { type: SchemaType.BOOLEAN, description: "Perfil pessoal sem vínculo profissional" },
          evidence: { type: SchemaType.STRING, description: "Evidência objetiva em até duas frases" },
        },
        required: [
          "profession_confirmed",
          "mental_health_content",
          "professional_active",
          "service_mentioned",
          "personal_profile",
          "evidence",
        ],
      },
    },
  }, { timeout: 30_000 });
}

export function geminiRetryReason(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: number; statusText?: string; message?: string; errorDetails?: unknown };
  const detail = `${candidate.statusText ?? ""} ${candidate.message ?? ""} ${JSON.stringify(candidate.errorDetails ?? "")}`;
  if (candidate.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(detail)) {
    return "cota ou limite temporário do Gemini";
  }
  if (candidate.status === 503 || /UNAVAILABLE|overloaded/i.test(detail)) {
    return "Gemini temporariamente indisponível";
  }
  if (/fetch failed|timeout|aborted/i.test(detail)) {
    return "conexão temporária com o Gemini indisponível";
  }
  return null;
}

async function assertMonthlyBudget() {
  const config = env();
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total FROM ai_usage
     WHERE model = $1
       AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
    [config.GEMINI_MODEL],
  );
  const spent = Number(result.rows[0]?.total ?? 0);
  if (spent >= config.GEMINI_MONTHLY_BUDGET_USD) {
    throw new Error(`Orçamento mensal do Gemini atingido (US$ ${spent.toFixed(2)}).`);
  }
}

/** Rótulos que o prompt do Gemini usa para descrever a profissão-alvo e o conteúdo esperado de cada nicho. */
const NICHE_PROMPT_LABELS: Record<string, { profession: string; topic: string; dontAssume: string }> = {
  psicologo: {
    profession: "psicólogo(a), terapeuta ou psicanalista",
    topic: "saúde mental (ansiedade, terapia, autoconhecimento, etc.)",
    dontAssume: "Não presuma profissão a partir de \"Dr.\" ou de conteúdo genérico.",
  },
  medico: {
    profession: "médico(a) — clínico(a) geral ou especialista",
    topic: "medicina, saúde, procedimentos, exames ou a rotina do consultório",
    dontAssume: "Não presuma profissão a partir de conteúdo genérico sobre bem-estar; exija indício de formação médica (CRM, \"Dr(a).\" junto de contexto clínico, especialidade citada).",
  },
};

export async function qualifyProfile(
  profile: InstagramProfile,
  campaign: CampaignConfig,
): Promise<QualificationResult> {
  const config = env();
  await assertMonthlyBudget();
  const labels = NICHE_PROMPT_LABELS[campaign.niche] ?? NICHE_PROMPT_LABELS.psicologo;
  const prompt = `Você é um qualificador de leads para ${campaign.product_name}.

ICP: ${campaign.icp_description}

Classifique somente os sinais objetivos abaixo. Não dê uma nota; a pontuação será calculada pelo sistema.

Username: ${profile.username}
Nome: ${profile.fullName}
Bio: ${profile.bio}
Seguidores: ${profile.followersCount ?? "desconhecido"}
Posts: ${profile.postsCount ?? "desconhecido"}
Conteúdo recente: ${profile.recentPosts.join(" | ") || "não disponível"}

Regras:
- profession_confirmed: true somente se nome ou bio identificar ${labels.profession}.
- mental_health_content: true somente se os posts recentes tratarem de ${labels.topic}.
- professional_active: true somente se houver bio profissional completa e indícios de posts regulares.
- service_mentioned: true se houver atendimento, consultório, sessão, agendamento, pacientes, online ou presencial.
- personal_profile: true se não houver vínculo profissional identificável.
- ${labels.dontAssume}`;

  await audit("gemini.qualification.before", { username: profile.username, model: config.GEMINI_MODEL });
  const result = await model().generateContent(prompt);
  const raw = result.response.text();
  if (!raw) throw new Error("O Gemini retornou uma resposta vazia.");
  const signals = signalSchema.parse(JSON.parse(raw));
  const parsed = scoreQualification(profile, signals, campaign.niche);
  const inputTokens = result.response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = result.response.usageMetadata
    ? result.response.usageMetadata.totalTokenCount - result.response.usageMetadata.promptTokenCount
    : 0;
  const estimatedCost = (
    inputTokens * config.GEMINI_INPUT_USD_PER_1M
    + outputTokens * config.GEMINI_OUTPUT_USD_PER_1M
  ) / 1_000_000;
  await query(
    `INSERT INTO ai_usage (model, input_tokens, output_tokens, estimated_cost_usd) VALUES ($1, $2, $3, $4)`,
    [config.GEMINI_MODEL, inputTokens, outputTokens, estimatedCost],
  );
  await audit("gemini.qualification.after", {
    username: profile.username,
    score: parsed.score,
    reason: parsed.reason,
    is_icp: parsed.is_icp,
    breakdown: parsed.breakdown,
    estimatedCost,
  });
  return parsed;
}
