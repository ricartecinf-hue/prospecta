import { z } from "zod";
import { audit, getCampaignConfig, query } from "@/lib/db";
import { discoverByHashtag, discoverFromFollowers, InstagramProtectionError, readProfile } from "@/lib/instagram";
import { enqueueJob } from "@/lib/job-queue";
import { filterProspectByNiche } from "@/lib/prospecting-filter";
import { getProspectingAvailability, pauseProspecting, reserveProspectingVisit } from "@/lib/prospecting-safety";
import { runWorker } from "@/lib/worker";

const payloadSchema = z.object({
  sourceKind: z.enum(["hashtag", "followers"]),
  value: z.string().min(1),
  niche: z.string().default("psicologo"),
  limit: z.number().int().min(1).max(100).default(20),
  usernames: z.array(z.string()).optional(),
  cursor: z.number().int().min(0).default(0),
});

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function saveContinuation(jobId: string, usernames: string[], cursor: number) {
  await query(
    `UPDATE jobs SET payload = payload || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [jobId, JSON.stringify({ usernames, cursor })],
  );
}

runWorker("prospect", async (job) => {
  const payload = payloadSchema.parse(job.payload);
  const campaign = await getCampaignConfig(payload.niche);
  if (!campaign.active) return { action: "complete" };

  const availability = await getProspectingAvailability();
  if (!availability.allowed) {
    return { action: "reschedule", runAfter: availability.runAfter, reason: availability.reason };
  }

  let usernames = payload.usernames;
  if (!usernames) {
    try {
      usernames = payload.sourceKind === "hashtag"
        ? await discoverByHashtag(payload.value, payload.limit)
        : await discoverFromFollowers(payload.value, payload.limit);
    } catch (error) {
      if (error instanceof InstagramProtectionError || /\b429\b|captcha/i.test(String(error))) {
        const runAfter = await pauseProspecting(String(error));
        return { action: "reschedule", runAfter, reason: "proteção do Instagram acionada" };
      }
      throw error;
    }
  }

  let inserted = 0;
  for (let cursor = payload.cursor; cursor < usernames.length; cursor += 1) {
    const username = usernames[cursor];
    let permit = await reserveProspectingVisit({ username, source: payload.value, jobId: job.id });
    if (!permit.allowed && permit.reason === "visit_interval") {
      await wait(Math.max(0, permit.runAfter.getTime() - Date.now()));
      permit = await reserveProspectingVisit({ username, source: payload.value, jobId: job.id });
    }
    if (!permit.allowed) {
      await saveContinuation(job.id, usernames, cursor);
      await audit("prospector.batch_deferred", { source: payload.value, cursor, reason: permit.reason, runAfter: permit.runAfter });
      return { action: "reschedule", runAfter: permit.runAfter, reason: permit.reason };
    }
    try {
      const profile = await readProfile(username);
      const candidate = filterProspectByNiche(campaign.niche, profile);
      if (!candidate.accepted) {
        await audit("prospector.profile_filtered", {
          username: profile.username,
          source: payload.value,
          reason: candidate.reason,
        });
        continue;
      }
      const result = await query<{ id: string; inserted: boolean }>(
        `INSERT INTO leads (
           ig_username, full_name, bio, followers_count, following_count, posts_count,
           profile_pic_url, whatsapp, email, ig_profile_url, recent_posts, niche, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (ig_username) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           bio = EXCLUDED.bio,
           followers_count = EXCLUDED.followers_count,
           following_count = EXCLUDED.following_count,
           posts_count = EXCLUDED.posts_count,
           profile_pic_url = EXCLUDED.profile_pic_url,
           whatsapp = COALESCE(EXCLUDED.whatsapp, leads.whatsapp),
           email = COALESCE(EXCLUDED.email, leads.email),
           ig_profile_url = EXCLUDED.ig_profile_url,
           recent_posts = EXCLUDED.recent_posts,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          profile.username, profile.fullName, profile.bio, profile.followersCount,
          profile.followingCount, profile.postsCount, profile.profilePicUrl,
          profile.whatsapp, profile.email, profile.igProfileUrl, profile.recentPosts,
          campaign.niche, `${payload.sourceKind}:${payload.value}`,
        ],
      );
      if (result.rows[0].inserted) {
        inserted += 1;
        await enqueueJob("qualify", { leadId: result.rows[0].id });
      }
    } catch (error) {
      if (error instanceof InstagramProtectionError || /\b429\b|captcha/i.test(String(error))) {
        const runAfter = await pauseProspecting(String(error));
        await saveContinuation(job.id, usernames, cursor);
        return { action: "reschedule", runAfter, reason: "proteção do Instagram acionada" };
      }
      await audit("prospector.profile_skipped", { username, source: payload.value, error: String(error) });
    }
  }

  await query("UPDATE jobs SET payload = payload - 'usernames' - 'cursor', updated_at = NOW() WHERE id = $1", [job.id]);
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
