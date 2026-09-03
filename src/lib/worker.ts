import "dotenv/config";

import { env } from "./env";
import { claimJob, completeJob, failJob, rescheduleJob, type HandlerResult } from "./job-queue";
import type { Job, JobKind } from "./types";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function runWorker<T>(kind: JobKind, handler: (job: Job<T>) => Promise<HandlerResult>) {
  let stopping = false;
  let consecutiveQueueErrors = 0;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.info(`[worker:${kind}] iniciado`);

  while (!stopping) {
    let job: Job<T> | null;
    try {
      job = await claimJob<T>(kind);
      consecutiveQueueErrors = 0;
    } catch (error) {
      consecutiveQueueErrors += 1;
      const retryMs = Math.min(60_000, 5_000 * 2 ** Math.min(3, consecutiveQueueErrors - 1));
      console.error(`[worker:${kind}] banco/fila indisponível; nova tentativa em ${retryMs}ms`, error);
      await wait(retryMs);
      continue;
    }
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
      try {
        await failJob(job, error);
      } catch (queueError) {
        console.error(`[worker:${kind}] não foi possível registrar a falha; a recuperação de stale jobs assumirá`, queueError);
        await wait(10_000);
      }
    }
  }
  console.info(`[worker:${kind}] encerrado`);
}
