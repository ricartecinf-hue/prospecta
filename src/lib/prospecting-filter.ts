import type { InstagramProfile } from "./types";

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const targetProfession = /\b(psicolog[oa]|psicanalista|terapeuta|crp)\b/i;
const psiHandle = /(?:^|[._-])psi(?:$|[._-])|psi$/i;

export interface ProspectingFilterResult {
  accepted: boolean;
  reason: string;
}

/**
 * Barreira barata antes de persistir o perfil e gastar uma chamada do Gemini.
 * A profissão precisa estar na identidade do perfil; conteúdo sobre psicologia
 * sozinho não basta, pois pode pertencer a agências, médicos ou páginas gerais.
 */
export function filterPsychologyProspect(profile: InstagramProfile): ProspectingFilterResult {
  const identity = normalize(`${profile.fullName} ${profile.bio}`);
  const username = normalize(profile.username);
  if (targetProfession.test(identity) || psiHandle.test(username)) {
    return { accepted: true, reason: "profissão-alvo identificada no nome, bio ou @" };
  }
  return { accepted: false, reason: "profissão-alvo não identificada no nome, bio ou @" };
}
