import "dotenv/config";

import { audit, closeDatabase, getCampaignConfig, query } from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";

const RUN_KEY = "overnight_run_2026_09_02";

async function ensureProspectJob(sourceKind: "hashtag" | "followers", value: string, niche: string) {
  const existing = await query<{ id: string }>(
    `SELECT id FROM jobs WHERE kind = 'prospect'
      AND payload->>'sourceKind' = $1 AND payload->>'value' = $2
      ORDER BY created_at DESC LIMIT 1`,
    [sourceKind, value],
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE jobs SET status = 'pending', attempts = 0, run_after = NOW(), last_error = NULL,
         payload = payload - 'usernames' - 'cursor', updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].id],
    );
  } else {
    await enqueueJob("prospect", { sourceKind, value, niche, limit: 20 });
  }
}

async function main() {
  const campaign = await getCampaignConfig("psicologo");
  const baseline = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM leads");
  const startedAt = new Date().toISOString();
  await query(
    `INSERT INTO agent_state (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [RUN_KEY, JSON.stringify({ started_at: startedAt, baseline_leads: baseline.rows[0]?.count ?? 0, target: 150 })],
  );
  for (const hashtag of campaign.icp_hashtags) await ensureProspectJob("hashtag", hashtag, campaign.niche);
  for (const competitor of campaign.icp_competitors) await ensureProspectJob("followers", competitor, campaign.niche);
  await audit("prospector.overnight_started", {
    runKey: RUN_KEY,
    startedAt,
    target: 150,
    sources: campaign.icp_hashtags.length + campaign.icp_competitors.length,
  });
  console.info(`Prospecção noturna iniciada: ${startedAt}; ${campaign.icp_hashtags.length + campaign.icp_competitors.length} fontes.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(closeDatabase);
