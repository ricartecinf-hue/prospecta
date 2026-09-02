import { audit } from "./db";
import { env, type AppEnv } from "./env";
import type { HandlerResult } from "./job-queue";
import type { Job } from "./types";

export type ExternalAction = "instagram_dm" | "whatsapp_handoff";

type ActionConfig = Pick<AppEnv, "INSTAGRAM_DMS_ENABLED" | "WHATSAPP_HANDOFF_ENABLED">;

export function externalActionEnabled(action: ExternalAction, config: ActionConfig = env()) {
  return action === "instagram_dm"
    ? config.INSTAGRAM_DMS_ENABLED === "true"
    : config.WHATSAPP_HANDOFF_ENABLED === "true";
}

export async function blockDisabledExternalAction(
  job: Pick<Job<unknown>, "id" | "kind">,
  action: ExternalAction,
): Promise<HandlerResult | null> {
  if (externalActionEnabled(action)) return null;

  const runAfter = new Date(Date.now() + 60 * 60 * 1000);
  await audit("external_action.blocked", {
    jobId: job.id,
    kind: job.kind,
    action,
    runAfter: runAfter.toISOString(),
  });
  return {
    action: "reschedule",
    runAfter,
    reason: `${action} desativada por variável de ambiente`,
  };
}
