const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const WA_LINK_PATTERN = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{10,15})/i;
const PHONE_PATTERN = /(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}/;

function normalizeBrazilianWhatsapp(value: string | null) {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}

export function extractProfileContacts(bio: string, links: string[], username: string) {
  const combined = `${bio} ${links.join(" ")}`;
  const waLink = links.join(" ").match(WA_LINK_PATTERN)?.[1] ?? null;
  const phone = combined.match(PHONE_PATTERN)?.[0] ?? null;
  return {
    whatsapp: normalizeBrazilianWhatsapp(waLink ?? phone),
    email: combined.match(EMAIL_PATTERN)?.[0]?.toLowerCase() ?? null,
    igProfileUrl: `https://instagram.com/${username.replace(/^@/, "")}`,
  };
}
