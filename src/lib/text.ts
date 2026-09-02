export function firstName(fullName: string | null, username: string) {
  const parts = (fullName ?? "").trim().split(/\s+/).map((part) => part.replace(/[^\p{L}'-]/gu, "")).filter(Boolean);
  const titles = /^(dr|dra|psicologo|psicologa|psi)$/iu;
  const candidate = parts.find((part) => !titles.test(part));
  return candidate || username.replace(/[._-].*$/, "");
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
