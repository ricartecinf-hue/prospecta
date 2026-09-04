import { runWorker } from "@/lib/worker";
import { createOutreachHandler } from "./outreach-handler";

export { createOutreachHandler, SINAPSI_FIRST_DM_TEXT } from "./outreach-handler";

if (process.env.PROSPECTA_DISABLE_WORKERS !== "true") {
  runWorker("outreach", createOutreachHandler()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
