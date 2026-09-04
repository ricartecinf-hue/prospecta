const PROFESSIONAL_LABEL = /^(dr|dra|psi|psicologo|psicologa|psicanalista|terapeuta|neuropsicologo|neuropsicologa|crp)$/iu;

function isProfessionalLabel(value: string) {
  return PROFESSIONAL_LABEL.test(value.normalize("NFD").replace(/\p{M}/gu, ""));
}

function nameTokens(value: string) {
  return value
    .normalize("NFC")
    .split(/[\s._|/\\-]+/u)
    .map((part) => part.replace(/[^\p{L}'’-]/gu, ""))
    .filter(Boolean);
}

function displayName(value: string) {
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1).toLocaleLowerCase("pt-BR");
}

export function firstName(fullName: string | null, username: string) {
  const profileParts = nameTokens(fullName ?? "");
  const profileCandidate = profileParts.find((part) => !isProfessionalLabel(part) && !/^\p{Lu}{2,}$/u.test(part));
  if (profileCandidate) return displayName(profileCandidate);

  const usernameCandidate = nameTokens(username).find((part) => !isProfessionalLabel(part));
  return displayName(usernameCandidate || username);
}

export function renderDmTemplate(template: string, fullName: string | null, username: string) {
  return template.replaceAll("{{first_name}}", firstName(fullName, username)).trim();
}

const OPT_OUT = /\b(para|pare|parar|não quero|nao quero|não tenho interesse|nao tenho interesse|sair|remova|não me mande|nao me mande|stop)\b/iu;
const INTEREST = /\b(tenho interesse|quero conhecer|quero ver|me mostra|pode mostrar|como funciona|manda o link|qual o valor|vamos conversar|sim[,! ]|claro|gostaria)\b/iu;

export function isOptOut(message: string) {
  return OPT_OUT.test(message.normalize("NFC"));
}

export function showsInterest(message: string) {
  return INTEREST.test(message.normalize("NFC"));
}
