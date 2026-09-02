import { env } from "./env";
import { claimJob, completeJob, failJob, rescheduleJob, type HandlerResult } from "./job-queue";
import type { Job, JobKind } from "./types";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function runWorker<T>(kind: JobKind, handler: (job: Job<T>) => Promise<HandlerResult>) {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.info(`[worker:${kind}] iniciado`);

  while (!stopping) {
    const job = await claimJob<T>(kind);
    if (!job) {
      await wait(env().WORKER_IDLE_MS);
      continue;
    }
    try {
      const result = await handler(job);
      if (result.action === "reschedule") await rescheduleJob(job, result.runAfter, result.reason);
      else await completeJob(job);
    } catch (error) {
      console.error(`[worker:${kind}] job ${job.id} falhou`, error);
      await failJob(job, error);
    }
  }
  console.info(`[worker:${kind}] encerrado`);
}
