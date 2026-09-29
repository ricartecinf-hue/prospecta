import type { JobKind, LeadStatus } from "./types";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  disqualified: "Desqualificado",
  dm_sent: "Mensagem enviada",
  replied: "Respondeu",
  handed_off: "Encaminhado",
  converted: "Convertido",
  do_not_contact: "Não contatar",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando",
  running: "Em execução",
  done: "Concluídos",
  failed: "Com falha",
  dead: "Interrompidos",
};

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  prospect: "Prospecção",
  qualify: "Qualificação",
  outreach: "Primeiro contato",
  followup: "Follow-up",
  inbox_poll: "Leitura do inbox",
  handoff: "Encaminhamento",
};

const EVENT_LABELS: Record<string, string> = {
  "system.paused_by_user": "Sistema pausado manualmente",
  "automation.paused": "Automação pausada por segurança",
  "automation.resumed": "Automação reativada",
  "instagram.reply_detected": "Resposta identificada no Instagram",
  "instagram.dm.after": "Mensagem processada no Instagram",
  "instagram.dm.text.after": "Texto enviado pelo Instagram",
  "whatsapp.handoff.after": "Lead encaminhado pelo WhatsApp",
  "dm.send_error": "Falha no envio de mensagem",
};

export function leadStatusLabel(status: LeadStatus) {
  return LEAD_STATUS_LABELS[status] ?? status;
}

export function jobStatusLabel(status: string) {
  return JOB_STATUS_LABELS[status] ?? status;
}

export function jobKindLabel(kind: string) {
  return JOB_KIND_LABELS[kind as JobKind] ?? kind;
}

export function eventLabel(event: string) {
  return EVENT_LABELS[event] ?? event.replaceAll(".", " · ");
}

export function conversionRate(value: number, previous: number) {
  if (previous <= 0) return 0;
  return Math.round((value / previous) * 1000) / 10;
}
