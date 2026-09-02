import { audit } from "./db";
import { env } from "./env";

export async function sendWhatsApp(number: string, text: string, auditContext: Record<string, unknown> = {}) {
  const config = env();
  if (!config.EVOLUTION_API_URL || !config.EVOLUTION_API_KEY || !config.EVOLUTION_INSTANCE) {
    throw new Error("Evolution API não configurada.");
  }
  const endpoint = `${config.EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(config.EVOLUTION_INSTANCE)}`;
  await audit("whatsapp.handoff.before", { number, endpoint, ...auditContext });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.EVOLUTION_API_KEY },
    body: JSON.stringify({ number, text }),
    signal: AbortSignal.timeout(20_000),
  });
  const responseBody = await response.text();
  await audit("whatsapp.handoff.after", { number, ok: response.ok, status: response.status, response: responseBody.slice(0, 1000), ...auditContext });
  if (!response.ok) throw new Error(`Evolution API respondeu ${response.status}: ${responseBody.slice(0, 500)}`);
}
