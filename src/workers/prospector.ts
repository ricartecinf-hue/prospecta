import { z } from "zod";
import { audit, getCampaignConfig, query } from "@/lib/db";
import { discoverByHashtag, discoverFromFollowers, readProfile } from "@/lib/instagram";
import { enqueueJob } from "@/lib/job-queue";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({
  sourceKind: z.enum(["hashtag", "followers"]),
  value: z.string().min(1),
  niche: z.string().default("psicologo"),
  limit: z.number().int().min(1).max(100).default(20),
});

runWorker("prospect", async (job) => {
  const payload = payloadSchema.parse(job.payload);
  const campaign = await getCampaignConfig(payload.niche);
  if (!campaign.active) return { action: "complete" };

  const usernames = payload.sourceKind === "hashtag"
    ? await discoverByHashtag(payload.value, payload.limit)
    : await discoverFromFollowers(payload.value, payload.limit);

  let inserted = 0;
  for (const username of usernames) {
    try {
      const profile = await readProfile(username);
      const result = await query<{ id: string; inserted: boolean }>(
        `INSERT INTO leads (
           ig_username, full_name, bio, followers_count, following_count, posts_count,
           profile_pic_url, niche, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (ig_username) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           bio = EXCLUDED.bio,
           followers_count = EXCLUDED.followers_count,
           following_count = EXCLUDED.following_count,
           posts_count = EXCLUDED.posts_count,
           profile_pic_url = EXCLUDED.profile_pic_url,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          profile.username, profile.fullName, profile.bio, profile.followersCount,
          profile.followingCount, profile.postsCount, profile.profilePicUrl, campaign.niche,
          `${payload.sourceKind}:${payload.value}`,
        ],
      );
      if (result.rows[0].inserted) {
        inserted += 1;
        await enqueueJob("qualify", { leadId: result.rows[0].id });
      }
    } catch (error) {
      await audit("prospector.profile_skipped", { username, source: payload.value, error: String(error) });
    }
  }

  await audit("prospector.batch_completed", { source: payload.value, discovered: usernames.length, inserted });
  return {
    action: "reschedule",
    runAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    reason: "varredura diária",
  };
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
