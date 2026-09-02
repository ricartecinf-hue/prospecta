import { z } from "zod";
import { getCampaignConfig, query } from "@/lib/db";
import { readProfile } from "@/lib/instagram";
import { enqueueJob } from "@/lib/job-queue";
import { qualifyProfile } from "@/lib/openai";
import type { Lead } from "@/lib/types";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({ leadId: z.string().uuid() });

runWorker("qualify", async (job) => {
  const { leadId } = payloadSchema.parse(job.payload);
  const result = await query<Lead>("SELECT * FROM leads WHERE id = $1", [leadId]);
  const lead = result.rows[0];
  if (!lead || lead.do_not_contact || lead.status === "do_not_contact") return { action: "complete" };

  const campaign = await getCampaignConfig(lead.niche);
  const profile = await readProfile(lead.ig_username);
  const qualification = await qualifyProfile(profile, campaign);
  const qualified = qualification.is_icp && qualification.score >= campaign.min_score_to_dm;

  await query(
    `UPDATE leads SET score = $2, score_reason = $3, qualified_at = NOW(),
       status = $4, updated_at = NOW() WHERE id = $1`,
    [lead.id, qualification.score, qualification.reason, qualified ? "qualified" : "disqualified"],
  );
  if (qualified) await enqueueJob("outreach", { leadId: lead.id });
  return { action: "complete" };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
