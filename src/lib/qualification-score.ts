import type { InstagramProfile } from "./types";

export const QUALIFICATION_WEIGHTS = {
  profession_confirmed: 35,
  mental_health_content: 25,
  followers_in_range: 15,
  professional_active: 15,
  service_mentioned: 10,
} as const;

export interface QualificationSignals {
  profession_confirmed: boolean;
  mental_health_content: boolean;
  professional_active: boolean;
  service_mentioned: boolean;
  personal_profile: boolean;
  evidence: string;
}

export interface QualificationBreakdown {
  profession_confirmed: number;
  mental_health_content: number;
  followers_in_range: number;
  professional_active: number;
  service_mentioned: number;
  subtotal: number;
  automatic_block: string | null;
}

export interface StructuredQualification {
  score: number;
  reason: string;
  is_icp: boolean;
  breakdown: QualificationBreakdown;
}

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const companyProfile = /\b(empresa|clinica|instituto|centro|equipe|multidisciplinar)\b/i;
const serviceTerms = /\b(atendimento|atendimentos|consultorio|consulta|sessao|sessoes|agendamento|agenda|psicoterapia|paciente|pacientes|online|presencial)\b/i;

/** Regras por nicho: quem \u00e9 o profissional-alvo, quem fica de fora e o que conta como conte\u00fado do tema. */
interface NicheKeywords {
  targetProfession: RegExp;
  excludedProfession: RegExp;
  topicContent: RegExp;
}

const NICHE_KEYWORDS: Record<string, NicheKeywords> = {
  psicologo: {
    targetProfession: /\b(psicolog[oa]|psicanalista|terapeuta|crp)\b/i,
    excludedProfession: /\b(medic[oa]|nutricionista|nutri|fisioterapeuta|fisio|coach)\b/i,
    topicContent: /\b(saude mental|psicologia|psicoterapia|terapia|ansiedade|depressao|autoestima|autoconhecimento|emocao|emocoes|trauma|luto|burnout|tcc|relacionamento)\b/i,
  },
  medico: {
    targetProfession: /\b(medic[oa]|doutor(?:a)?|\bdr\.?\b|\bdra\.?\b|clinico geral|crm)\b/i,
    excludedProfession: /\b(psicolog[oa]|nutricionista|nutri|fisioterapeuta|fisio|coach|dentista|personal trainer)\b/i,
    topicContent: /\b(medicina|saude|procedimento|procedimentos|cirurgia|diagnostico|tratamento|especialidade|prevencao|consultorio|plantao|convenio|exame|exames)\b/i,
  },
};

function keywordsFor(niche: string): NicheKeywords {
  return NICHE_KEYWORDS[niche] ?? NICHE_KEYWORDS.psicologo;
}

function points(enabled: boolean, weight: number) {
  return enabled ? weight : 0;
}

export function followerPoints(followers: number | null) {
  if (followers === null || followers < 500) return 0;
  if (followers <= 3_000) return 3;
  if (followers <= 5_000) return 6;
  if (followers <= 10_000) return 9;
  if (followers <= 20_000) return 12;
  return 15;
}

export function scoreQualification(
  profile: InstagramProfile,
  signals: QualificationSignals,
  niche = "psicologo",
): StructuredQualification {
  const { targetProfession, excludedProfession, topicContent } = keywordsFor(niche);
  const identityText = normalize(`${profile.fullName} ${profile.bio}`);
  const recentText = normalize(profile.recentPosts.join(" "));
  const evidenceText = normalize(signals.evidence);
  const allText = `${identityText} ${recentText} ${evidenceText}`;
  const professionConfirmed = targetProfession.test(identityText) || signals.profession_confirmed;
  const mentalHealthContent = topicContent.test(recentText) || signals.mental_health_content;
  const professionalActive = signals.professional_active;
  const serviceMentioned = serviceTerms.test(allText) || signals.service_mentioned;

  const breakdown: QualificationBreakdown = {
    profession_confirmed: points(professionConfirmed, QUALIFICATION_WEIGHTS.profession_confirmed),
    mental_health_content: points(mentalHealthContent, QUALIFICATION_WEIGHTS.mental_health_content),
    followers_in_range: followerPoints(profile.followersCount),
    professional_active: points(professionalActive, QUALIFICATION_WEIGHTS.professional_active),
    service_mentioned: points(serviceMentioned, QUALIFICATION_WEIGHTS.service_mentioned),
    subtotal: 0,
    automatic_block: null,
  };
  breakdown.subtotal = breakdown.profession_confirmed
    + breakdown.mental_health_content
    + breakdown.followers_in_range
    + breakdown.professional_active
    + breakdown.service_mentioned;

  if (!professionConfirmed && excludedProfession.test(allText)) {
    breakdown.automatic_block = `profissão fora do ICP sem vínculo com o nicho ${niche}`;
  } else if (!professionConfirmed && companyProfile.test(allText)) {
    breakdown.automatic_block = "empresa ou clínica sem psicólogo identificado";
  } else if (!professionConfirmed && signals.personal_profile) {
    breakdown.automatic_block = "perfil pessoal sem vínculo profissional";
  }

  const score = breakdown.automatic_block ? Math.min(40, breakdown.subtotal) : breakdown.subtotal;
  const awarded = Object.entries(breakdown)
    .filter(([key, value]) => key !== "subtotal" && key !== "automatic_block" && Number(value) > 0)
    .map(([key, value]) => `${key} +${value}`);
  const reason = [
    `Critérios: ${awarded.join(", ") || "nenhum ponto confirmado"}.`,
    breakdown.automatic_block ? `Bloqueio: ${breakdown.automatic_block}; teto 40.` : null,
    signals.evidence,
  ].filter(Boolean).join(" ").slice(0, 500);

  return {
    score,
    reason,
    is_icp: professionConfirmed && !breakdown.automatic_block && score >= 65,
    breakdown,
  };
}
