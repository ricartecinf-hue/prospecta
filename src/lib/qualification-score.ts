import type { InstagramProfile } from "./types";

export const QUALIFICATION_WEIGHTS = {
  profession_confirmed: 35,
  mental_health_content: 25,
  followers_in_range: 15,
  professional_active: 15,
  service_mentioned: 10,
} as const;

export const MEDICO_QUALIFICATION_WEIGHTS = {
  profession_confirmed: 35,
  location_confirmed: 25,
  practice_ownership: 20,
  professional_active: 15,
  followers_in_range: 5,
} as const;

export interface QualificationSignals {
  profession_confirmed: boolean;
  mental_health_content: boolean;
  professional_active: boolean;
  service_mentioned: boolean;
  personal_profile: boolean;
  // Sinais usados pelo nicho "medico" (evento presencial) — ignorados nos demais nichos.
  location_confirmed: boolean;
  practice_ownership: boolean;
  student_or_resident: boolean;
  evidence: string;
}

export interface QualificationBreakdown {
  profession_confirmed: number;
  mental_health_content?: number;
  location_confirmed?: number;
  practice_ownership?: number;
  service_mentioned?: number;
  followers_in_range: number;
  professional_active: number;
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

function points(enabled: boolean, weight: number) {
  return enabled ? weight : 0;
}

function sumBreakdown(breakdown: QualificationBreakdown) {
  return Object.entries(breakdown)
    .filter(([key]) => key !== "subtotal" && key !== "automatic_block")
    .reduce((total, [, value]) => total + (Number(value) || 0), 0);
}

function explain(breakdown: QualificationBreakdown, cap: number, evidence: string) {
  const awarded = Object.entries(breakdown)
    .filter(([key, value]) => key !== "subtotal" && key !== "automatic_block" && Number(value) > 0)
    .map(([key, value]) => `${key} +${value}`);
  return [
    `Critérios: ${awarded.join(", ") || "nenhum ponto confirmado"}.`,
    breakdown.automatic_block ? `Bloqueio: ${breakdown.automatic_block}; teto ${cap}.` : null,
    evidence,
  ].filter(Boolean).join(" ").slice(0, 500);
}

// ============================================================
// Nicho: psicólogo — venda do Sinapsi (SaaS de gestão)
// ============================================================
const psicologoTargetProfession = /\b(psicolog[oa]|psicanalista|terapeuta|crp)\b/i;
const psicologoExcludedProfession = /\b(medic[oa]|nutricionista|nutri|fisioterapeuta|fisio|coach)\b/i;
const psicologoCompanyProfile = /\b(empresa|clinica|instituto|centro|equipe|multidisciplinar)\b/i;
const psicologoServiceTerms = /\b(atendimento|atendimentos|consultorio|consulta|sessao|sessoes|agendamento|agenda|psicoterapia|paciente|pacientes|online|presencial)\b/i;
const psicologoMentalHealthTerms = /\b(saude mental|psicologia|psicoterapia|terapia|ansiedade|depressao|autoestima|autoconhecimento|emocao|emocoes|trauma|luto|burnout|tcc|relacionamento)\b/i;

export function followerPoints(followers: number | null) {
  if (followers === null || followers < 500) return 0;
  if (followers <= 3_000) return 3;
  if (followers <= 5_000) return 6;
  if (followers <= 10_000) return 9;
  if (followers <= 20_000) return 12;
  return 15;
}

function scorePsicologo(profile: InstagramProfile, signals: QualificationSignals): StructuredQualification {
  const identityText = normalize(`${profile.fullName} ${profile.bio}`);
  const recentText = normalize(profile.recentPosts.join(" "));
  const evidenceText = normalize(signals.evidence);
  const allText = `${identityText} ${recentText} ${evidenceText}`;
  const professionConfirmed = psicologoTargetProfession.test(identityText) || signals.profession_confirmed;
  const mentalHealthContent = psicologoMentalHealthTerms.test(recentText) || signals.mental_health_content;
  const professionalActive = signals.professional_active;
  const serviceMentioned = psicologoServiceTerms.test(allText) || signals.service_mentioned;

  const breakdown: QualificationBreakdown = {
    profession_confirmed: points(professionConfirmed, QUALIFICATION_WEIGHTS.profession_confirmed),
    mental_health_content: points(mentalHealthContent, QUALIFICATION_WEIGHTS.mental_health_content),
    followers_in_range: followerPoints(profile.followersCount),
    professional_active: points(professionalActive, QUALIFICATION_WEIGHTS.professional_active),
    service_mentioned: points(serviceMentioned, QUALIFICATION_WEIGHTS.service_mentioned),
    subtotal: 0,
    automatic_block: null,
  };
  breakdown.subtotal = sumBreakdown(breakdown);

  if (!professionConfirmed && psicologoExcludedProfession.test(allText)) {
    breakdown.automatic_block = "profissão fora do ICP sem vínculo com psicologia";
  } else if (!professionConfirmed && psicologoCompanyProfile.test(allText)) {
    breakdown.automatic_block = "empresa ou clínica sem psicólogo identificado";
  } else if (!professionConfirmed && signals.personal_profile) {
    breakdown.automatic_block = "perfil pessoal sem vínculo profissional";
  }

  const cap = 40;
  const score = breakdown.automatic_block ? Math.min(cap, breakdown.subtotal) : breakdown.subtotal;

  return {
    score,
    reason: explain(breakdown, cap, signals.evidence),
    is_icp: professionConfirmed && !breakdown.automatic_block && score >= 65,
    breakdown,
  };
}

// ============================================================
// Nicho: médico — convite para evento presencial de vendas e
// estratégias em Florianópolis e região. Não é venda de SaaS:
// o que importa é profissão + localização + sinal de consultório
// ou clínica própria (perfil de médico empreendedor).
// ============================================================
const medicoTargetProfession = /\b(medic[oa]|doutor(?:a)?|\bdr\.?\b|\bdra\.?\b|clinico geral|crm)\b/i;
const medicoLocationTerms = /\b(florianopolis|floripa|sao jose|palhoca|biguacu|joinville|blumenau|santa catarina|\bsc\b)\b/i;
const medicoPracticeOwnershipTerms = /\b(clinica propria|consultorio proprio|minha clinica|meu consultorio|fundador|fundadora|proprietari[oa]|socio fundador|nossa clinica|nossa equipe|nossa unidade|unidades|expansao|nova unidade|gestao da clinica|gerencio|administro)\b/i;
const medicoStudentOrResidentTerms = /\b(estudante de medicina|academic[oa] de medicina|interno de medicina|internato|residente|residencia medica|\br[1234]\b)\b/i;

function medicoFollowerPoints(followers: number | null) {
  if (followers === null || followers < 1_000) return 0;
  if (followers < 10_000) return 1;
  if (followers < 30_000) return 2;
  if (followers < 60_000) return 3;
  if (followers < 100_000) return 4;
  return 5;
}

function scoreMedico(profile: InstagramProfile, signals: QualificationSignals): StructuredQualification {
  const identityText = normalize(`${profile.fullName} ${profile.bio}`);
  const recentText = normalize(profile.recentPosts.join(" "));
  const evidenceText = normalize(signals.evidence);
  const allText = `${identityText} ${recentText} ${evidenceText}`;

  const professionConfirmed = medicoTargetProfession.test(identityText) || signals.profession_confirmed;
  const locationConfirmed = medicoLocationTerms.test(allText) || signals.location_confirmed;
  const practiceOwnership = medicoPracticeOwnershipTerms.test(allText) || signals.practice_ownership;
  const professionalActive = signals.professional_active;
  const studentOrResident = medicoStudentOrResidentTerms.test(allText) || signals.student_or_resident;

  const breakdown: QualificationBreakdown = {
    profession_confirmed: points(professionConfirmed, MEDICO_QUALIFICATION_WEIGHTS.profession_confirmed),
    location_confirmed: points(locationConfirmed, MEDICO_QUALIFICATION_WEIGHTS.location_confirmed),
    practice_ownership: points(practiceOwnership, MEDICO_QUALIFICATION_WEIGHTS.practice_ownership),
    professional_active: points(professionalActive, MEDICO_QUALIFICATION_WEIGHTS.professional_active),
    followers_in_range: medicoFollowerPoints(profile.followersCount),
    subtotal: 0,
    automatic_block: null,
  };
  breakdown.subtotal = sumBreakdown(breakdown);

  // Estudante/residente sem consultório próprio não é o público do evento; perfil pessoal
  // sem nenhum vínculo profissional também não. Nos dois casos, teto de 30 pontos.
  if (studentOrResident && !practiceOwnership) {
    breakdown.automatic_block = "estudante de medicina ou residente sem consultório próprio";
  } else if (!professionConfirmed && signals.personal_profile) {
    breakdown.automatic_block = "perfil pessoal sem vínculo profissional";
  }

  const cap = 30;
  const score = breakdown.automatic_block ? Math.min(cap, breakdown.subtotal) : breakdown.subtotal;

  return {
    score,
    reason: explain(breakdown, cap, signals.evidence),
    is_icp: professionConfirmed && !breakdown.automatic_block && score >= 65,
    breakdown,
  };
}

const SCORERS: Record<string, (profile: InstagramProfile, signals: QualificationSignals) => StructuredQualification> = {
  psicologo: scorePsicologo,
  medico: scoreMedico,
};

/** Escolhe o algoritmo de pontuação pelo nicho do lead. Nicho sem scorer dedicado cai no de psicólogo. */
export function scoreQualification(
  profile: InstagramProfile,
  signals: QualificationSignals,
  niche = "psicologo",
): StructuredQualification {
  const scorer = SCORERS[niche] ?? scorePsicologo;
  return scorer(profile, signals);
}
