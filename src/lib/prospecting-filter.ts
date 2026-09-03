import type { InstagramProfile } from "./types";

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const psychologyProfession = /\b(psicolog[oa]|psicanalista|terapeuta|crp)\b/i;
const psiHandle = /(?:^|[._-])psi(?:$|[._-])|psi$/i;

// Além do termo genérico "médico(a)", muitos perfis só citam a especialidade
// na bio (ex.: "Cardiologista") — sem isso, ficam de fora da barreira antes
// mesmo de chegar ao Gemini.
export const medicoProfession = /\b(medic[oa]|doutor(?:a)?|\bdr\.?\b|\bdra\.?\b|clinico geral|crm|cardiolog\w*|dermatolog\w*|ginecolog\w*|obstetr\w*|ortoped\w*|neurolog\w*|oftalmolog\w*|psiquiatr\w*|urolog\w*|endocrinolog\w*|oncolog\w*|anestesist\w*|cirurgi[ãa]\w*|otorrino\w*|reumatolog\w*|nutrolog\w*|hematolog\w*|nefrolog\w*|geriatr\w*|mastolog\w*|infectolog\w*|pneumolog\w*|gastroenterolog\w*|hebiatr\w*)\b/i;
// "dr"/"dra" no username costuma vir colado ao nome (ex.: "drcassiooliveira"),
// não só separado por ponto/underline — aceitamos o prefixo solto e deixamos
// a qualificação por IA descartar falsos positivos (ex.: apelidos como "drika").
const medicoHandle = /^dra?(?:[._-]|[a-z]|$)/i;

export interface ProspectingFilterResult {
  accepted: boolean;
  reason: string;
}

/**
 * Barreira barata antes de persistir o perfil e gastar uma chamada do Gemini.
 * A profissão precisa estar na identidade do perfil; conteúdo sobre o nicho
 * sozinho não basta, pois pode pertencer a agências, outra profissão ou páginas gerais.
 */
export function filterPsychologyProspect(profile: InstagramProfile): ProspectingFilterResult {
  const identity = normalize(`${profile.fullName} ${profile.bio}`);
  const username = normalize(profile.username);
  if (psychologyProfession.test(identity) || psiHandle.test(username)) {
    return { accepted: true, reason: "profissão-alvo identificada no nome, bio ou @" };
  }
  return { accepted: false, reason: "profissão-alvo não identificada no nome, bio ou @" };
}

export function filterMedicoProspect(profile: InstagramProfile): ProspectingFilterResult {
  const identity = normalize(`${profile.fullName} ${profile.bio}`);
  const username = normalize(profile.username);
  if (medicoProfession.test(identity) || medicoHandle.test(username)) {
    return { accepted: true, reason: "profissão-alvo identificada no nome, bio ou @" };
  }
  return { accepted: false, reason: "profissão-alvo não identificada no nome, bio ou @" };
}

const filtersByNiche: Record<string, (profile: InstagramProfile) => ProspectingFilterResult> = {
  psicologo: filterPsychologyProspect,
  medico: filterMedicoProspect,
};

/**
 * Escolhe a barreira de profissão certa pelo nicho do job. Nicho sem filtro dedicado
 * cai no filtro de psicologia (comportamento anterior) para não quebrar campanhas antigas.
 */
export function filterProspectByNiche(niche: string, profile: InstagramProfile): ProspectingFilterResult {
  const filter = filtersByNiche[niche] ?? filterPsychologyProspect;
  return filter(profile);
}
