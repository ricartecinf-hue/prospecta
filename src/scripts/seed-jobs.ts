import "dotenv/config";

import { audit, closeDatabase, getActiveCampaignConfigs, query } from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";

type ProspectSourceKind = "hashtag" | "followers" | "location";

async function enqueueProspect(
  sourceKind: ProspectSourceKind,
  value: string,
  niche: string,
  extra: Record<string, unknown> = {},
) {
  const existing = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM jobs WHERE kind = 'prospect' AND status IN ('pending','running')
     AND payload->>'sourceKind' = $1 AND payload->>'value' = $2 AND payload->>'niche' = $3) AS exists`,
    [sourceKind, value, niche],
  );
  if (!existing.rows[0].exists) await enqueueJob("prospect", { sourceKind, value, niche, limit: 20, ...extra });
}

async function main() {
  const campaigns = await getActiveCampaignConfigs();
  if (!campaigns.length) throw new Error("Nenhuma campanha ativa em campaign_config.");

  for (const campaign of campaigns) {
    for (const hashtag of campaign.icp_hashtags) await enqueueProspect("hashtag", hashtag, campaign.niche);
    for (const competitor of campaign.icp_competitors) await enqueueProspect("followers", competitor, campaign.niche);
    for (const location of campaign.icp_locations ?? []) {
      await enqueueProspect("location", location.id, campaign.niche, { locationName: location.name });
    }
    await audit("jobs.seeded", {
      niche: campaign.niche,
      sources: campaign.icp_hashtags.length + campaign.icp_competitors.length + (campaign.icp_locations?.length ?? 0),
    });
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
