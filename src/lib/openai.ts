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
  // Sinais usados pelo nicho "medico" (evento presencial) — o Gemini sempre responde
  // todos os campos; o scorer de cada nicho só lê os que fazem sentido para ele.
  location_confirmed: z.boolean(),
  practice_ownership: z.boolean(),
  student_or_resident: z.boolean(),
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
          mental_health_content: { type: SchemaType.BOOLEAN, description: "Posts recentes tratam do tema do nicho (quando aplicável)" },
          professional_active: { type: SchemaType.BOOLEAN, description: "Bio profissional completa e posts regulares" },
          service_mentioned: { type: SchemaType.BOOLEAN, description: "Menciona atendimento, consultório ou sessão (quando aplicável)" },
          personal_profile: { type: SchemaType.BOOLEAN, description: "Perfil pessoal sem vínculo profissional" },
          location_confirmed: { type: SchemaType.BOOLEAN, description: "Localização-alvo confirmada na bio ou posts (quando aplicável)" },
          practice_ownership: { type: SchemaType.BOOLEAN, description: "Sinais de consultório/clínica própria ou empreendedorismo (quando aplicável)" },
          student_or_resident: { type: SchemaType.BOOLEAN, description: "Estudante ou residente sem consultório próprio (quando aplicável)" },
          evidence: { type: SchemaType.STRING, description: "Evidência objetiva em até duas frases" },
        },
        required: [
          "profession_confirmed",
          "mental_health_content",
          "professional_active",
          "service_mentioned",
          "personal_profile",
          "location_confirmed",
          "practice_ownership",
          "student_or_resident",
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

/** Bloco de regras que o prompt do Gemini usa para cada nicho — os critérios de pontuação são bem diferentes entre eles. */
const NICHE_PROMPT_RULES: Record<string, string> = {
  psicologo: `- profession_confirmed: true somente se nome ou bio identificar psicólogo(a), terapeuta ou psicanalista.
- mental_health_content: true somente se os posts recentes tratarem de saúde mental (ansiedade, terapia, autoconhecimento, etc.).
- professional_active: true somente se houver bio profissional completa e indícios de posts regulares.
- service_mentioned: true se houver atendimento, consultório, sessão, agendamento, pacientes, online ou presencial.
- personal_profile: true se não houver vínculo profissional identificável.
- location_confirmed, practice_ownership, student_or_resident: não se aplicam a este nicho — responda sempre false.
- Não presuma profissão a partir de "Dr." ou de conteúdo genérico.`,
  medico: `- profession_confirmed: true somente se nome ou bio identificar médico(a) — clínico(a) geral ou especialista (CRM, "Dr(a)." em contexto clínico, especialidade citada).
- location_confirmed: true somente se a bio OU os posts declararem explicitamente que o perfil atua em Florianópolis, São José, Palhoça, Biguaçu, Joinville, Blumenau ou Santa Catarina/SC. Sigla de entidade internacional (ex.: "ESC", "FESC" de European Society of Cardiology) NÃO é a sigla do estado; menção a outra cidade/estado brasileiro (ex.: "São Paulo") deve dar false, mesmo que o restante do perfil pareça promissor.
- practice_ownership: true somente se houver sinal explícito de consultório ou clínica própria — menção literal a "minha clínica", "meu consultório", sócio-fundador(a), expansão, unidades ou gestão do próprio negócio. Texto de certificado, prêmio ou legenda de foto sem essa menção direta deve dar false. Ser funcionário(a) de clínica de terceiros também é false.
- professional_active: true somente se houver bio profissional completa e indícios de posts regulares sobre medicina, procedimentos ou rotina de consultório.
- personal_profile: true se não houver vínculo profissional identificável.
- student_or_resident: true se o perfil se identificar como estudante de medicina, interno(a) ou residente (R1–R4) sem consultório próprio.
- mental_health_content, service_mentioned: não se aplicam a este nicho — responda sempre false.
- Não presuma profissão a partir de conteúdo genérico sobre bem-estar; exija indício real de formação médica.
- Antes de responder, confira se cada campo booleano está de fato sustentado pelo texto que você vai escrever em "evidence"; nunca marque true um critério que a própria evidência contradiz ou não menciona.`,
};

export async function qualifyProfile(
  profile: InstagramProfile,
  campaign: CampaignConfig,
): Promise<QualificationResult> {
  const config = env();
  await assertMonthlyBudget();
  const rules = NICHE_PROMPT_RULES[campaign.niche] ?? NICHE_PROMPT_RULES.psicologo;
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
${rules}`;

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
