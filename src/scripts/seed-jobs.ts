import "dotenv/config";

import { audit, getCampaignConfig, query } from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";

async function enqueueProspect(sourceKind: "hashtag" | "followers", value: string, niche: string) {
  const existing = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'prospect' AND status IN ('pending','running')
     AND payload->>'sourceKind' = $1 AND payload->>'value' = $2) AS exists`,
    [sourceKind, value],
  );
  if (!existing.rows[0].exists) await enqueueJob("prospect", { sourceKind, value, niche, limit: 20 });
}

async function main() {
  const campaign = await getCampaignConfig();
  for (const hashtag of campaign.icp_hashtags) await enqueueProspect("hashtag", hashtag, campaign.niche);
  for (const competitor of campaign.icp_competitors) await enqueueProspect("followers", competitor, campaign.niche);

  const poller = await query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'inbox_poll' AND status IN ('pending','running')) AS exists",
  );
  if (!poller.rows[0].exists) await enqueueJob("inbox_poll", {});
  await audit("jobs.seeded", { niche: campaign.niche });
  console.info("Jobs iniciais criados.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
