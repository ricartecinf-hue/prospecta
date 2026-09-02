import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";
import { audit, query } from "./db";
import { env } from "./env";
import type { CampaignConfig, InstagramProfile } from "./types";

const qualificationSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string().max(500),
  is_icp: z.boolean(),
});
export type QualificationResult = z.infer<typeof qualificationSchema>;

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
          score: { type: SchemaType.INTEGER, description: "Score de adequação ao ICP, de 0 a 100" },
          reason: { type: SchemaType.STRING, description: "Justificativa em no máximo duas frases" },
          is_icp: { type: SchemaType.BOOLEAN, description: "Se o perfil pertence ao ICP" },
        },
        required: ["score", "reason", "is_icp"],
      },
    },
  });
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

export async function qualifyProfile(
  profile: InstagramProfile,
  campaign: CampaignConfig,
): Promise<QualificationResult> {
  const config = env();
  await assertMonthlyBudget();
  const prompt = `Você é um qualificador de leads para ${campaign.product_name}.

ICP: ${campaign.icp_description}

Analise este perfil do Instagram e dê um score de 0 a 100.

Username: ${profile.username}
Nome: ${profile.fullName}
Bio: ${profile.bio}
Seguidores: ${profile.followersCount ?? "desconhecido"}
Posts: ${profile.postsCount ?? "desconhecido"}
Conteúdo recente: ${profile.recentPosts.join(" | ") || "não disponível"}

Score 0–40: claramente fora do ICP
Score 41–64: possível mas incerto
Score 65–84: bom lead
Score 85–100: lead ideal`;

  await audit("gemini.qualification.before", { username: profile.username, model: config.GEMINI_MODEL });
  const result = await model().generateContent(prompt);
  const raw = result.response.text();
  if (!raw) throw new Error("O Gemini retornou uma resposta vazia.");
  const parsed = qualificationSchema.parse(JSON.parse(raw));
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
    estimatedCost,
  });
  return parsed;
}
