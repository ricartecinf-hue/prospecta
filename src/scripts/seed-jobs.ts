import "dotenv/config";

import { audit, closeDatabase, getActiveCampaignConfigs, query } from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";

async function enqueueProspect(sourceKind: "hashtag" | "followers", value: string, niche: string) {
  const existing = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'prospect' AND status IN ('pending','running')
     AND payload->>'sourceKind' = $1 AND payload->>'value' = $2 AND payload->>'niche' = $3) AS exists`,
    [sourceKind, value, niche],
  );
  if (!existing.rows[0].exists) await enqueueJob("prospect", { sourceKind, value, niche, limit: 20 });
}

async function main() {
  const campaigns = await getActiveCampaignConfigs();
  if (!campaigns.length) throw new Error("Nenhuma campanha ativa em campaign_config.");

  for (const campaign of campaigns) {
    for (const hashtag of campaign.icp_hashtags) await enqueueProspect("hashtag", hashtag, campaign.niche);
    for (const competitor of campaign.icp_competitors) await enqueueProspect("followers", competitor, campaign.niche);
    await audit("jobs.seeded", { niche: campaign.niche });
  }

  const poller = await query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'inbox_poll' AND status IN ('pending','running')) AS exists",
  );
  if (!poller.rows[0].exists) await enqueueJob("inbox_poll", {});
  console.info(`Jobs iniciais criados para ${campaigns.length} nicho(s): ${campaigns.map((c) => c.niche).join(", ")}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
