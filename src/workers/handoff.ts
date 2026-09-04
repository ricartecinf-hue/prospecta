import { runWorker } from "@/lib/worker";
import { createHandoffHandler } from "./handoff-handler";

export { buildHandoffMessage, createHandoffHandler } from "./handoff-handler";

if (process.env.PROSPECTA_DISABLE_WORKERS !== "true") {
  runWorker("handoff", createHandoffHandler()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
