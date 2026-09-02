import OpenAI from "openai";
import { z } from "zod";
import { audit, query } from "./db";
import { env } from "./env";
import type { CampaignConfig, InstagramProfile } from "./types";

const MODEL = "gpt-4o-mini";
const qualificationSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string().max(500),
  is_icp: z.boolean(),
});

function client() {
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");
  return new OpenAI({ apiKey });
}

async function assertMonthlyBudget() {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total FROM ai_usage
     WHERE created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
  );
  const spent = Number(result.rows[0]?.total ?? 0);
  if (spent >= env().OPENAI_MONTHLY_BUDGET_USD) {
    throw new Error(`Orçamento mensal da OpenAI atingido (US$ ${spent.toFixed(2)}).`);
  }
}

export async function qualifyProfile(profile: InstagramProfile, campaign: CampaignConfig) {
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

Responda SOMENTE em JSON:
{"score": <0-100>, "reason": "<máximo 2 frases explicando o score>", "is_icp": <true|false>}

Score 0–40: claramente fora do ICP
Score 41–64: possível mas incerto
Score 65–84: bom lead
Score 85–100: lead ideal`;

  await audit("openai.qualification.before", { username: profile.username, model: MODEL });
  const completion = await client().chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });
  const raw = completion.choices[0]?.message.content;
  if (!raw) throw new Error("A OpenAI retornou uma resposta vazia.");
  const parsed = qualificationSchema.parse(JSON.parse(raw));
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const costs = env();
  const estimatedCost = (inputTokens * costs.OPENAI_INPUT_USD_PER_1M + outputTokens * costs.OPENAI_OUTPUT_USD_PER_1M) / 1_000_000;
  await query(
    `INSERT INTO ai_usage (model, input_tokens, output_tokens, estimated_cost_usd) VALUES ($1, $2, $3, $4)`,
    [MODEL, inputTokens, outputTokens, estimatedCost],
  );
  await audit("openai.qualification.after", { username: profile.username, score: parsed.score, estimatedCost });
  return parsed;
}
