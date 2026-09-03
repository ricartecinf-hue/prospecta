import type { Locator, Page } from "playwright";
import { assertInstagramSession, getInstagramPage, withChromeLock } from "./chrome";
import { audit } from "./db";
import { extractProfileContacts } from "./profile-contacts";
import type { InstagramProfile } from "./types";

const IG_ORIGIN = "https://www.instagram.com";

export class InstagramProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramProtectionError";
  }
}

function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").replace(/\/$/, "").toLowerCase();
}

export function parseCompactNumber(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s/g, "");
  const match = normalized.match(/([\d.,]+)(mil|k|mi|m)?/);
  if (!match) return null;
  const number = Number(match[2] ? match[1].replace(",", ".") : match[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(number)) return null;
  const multiplier = match[2] === "mil" || match[2] === "k" ? 1_000 : match[2] === "mi" || match[2] === "m" ? 1_000_000 : 1;
  return Math.round(number * multiplier);
}

async function text(locator: Locator) {
  return (await locator.first().textContent().catch(() => null))?.trim() ?? "";
}

async function gotoInstagram(page: Page, path: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.goto(`${IG_ORIGIN}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (response?.status() === 429) throw new InstagramProtectionError("Instagram respondeu HTTP 429.");
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const retryable = /ERR_ABORTED|frame.*detached|timeout|Target page.*closed/i.test(String(error));
      if (!retryable || attempt === 3 || page.isClosed()) throw error;
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  if (lastError) throw lastError;
  const protectionPage = /instagram\.com\/challenge/i.test(page.url())
    || await page.getByText(/captcha|confirme que você é humano|confirm you.re human/i).count() > 0;
  if (protectionPage) throw new InstagramProtectionError("Captcha ou desafio de segurança detectado no Instagram.");
  await assertInstagramSession(page);
  await page.waitForTimeout(1_200);
}

async function profileFromCurrentPage(page: Page, username: string): Promise<InstagramProfile> {
  const meta = await page.locator('meta[property="og:description"]').getAttribute("content").catch(() => null);
  const title = await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => null);
  const headerText = await text(page.locator("header"));
  const counts = meta?.match(/([\d.,]+[KkMm]?) Followers, ([\d.,]+[KkMm]?) Following, ([\d.,]+[KkMm]?) Posts/i);
  const metaPtCounts = meta?.match(/([\d.,]+\s*(?:mil|mi)?)\s+seguidores,\s+seguindo\s+([\d.,]+\s*(?:mil|mi)?),\s+([\d.,]+\s*(?:mil|mi)?)\s+posts/i);
  const ptCounts = headerText.match(/([\d.,]+\s*(?:mil|mi)?)\s+seguidores.*?([\d.,]+\s*(?:mil|mi)?)\s+seguindo/i);
  const postCount = headerText.match(/([\d.,]+\s*(?:mil|mi)?)\s+(?:publicaç|posts?)/i);
  const fullName = (title?.split("(")[0] ?? (await text(page.locator("header h1, header h2")))).trim();
  const bioCandidates = await page.locator("header section div[dir='auto'], header span[dir='auto']").allTextContents().catch(() => []);
  const profileLinks = await page.locator('header a[href]').evaluateAll((anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean),
  ).catch(() => [] as string[]);
  const bio = bioCandidates.filter((item) => item.trim() && !item.includes("seguidores")).slice(-4).join(" ").trim();
  const recentPosts = await page.locator('main a[href*="/p/"] img, main a[href*="/reel/"] img').evaluateAll((images) =>
    images.slice(0, 6).map((image) => image.getAttribute("alt") ?? "").filter(Boolean),
  ).catch(() => [] as string[]);

  const cleanUsername = normalizeUsername(username);
  const contacts = extractProfileContacts(bio, profileLinks, cleanUsername);
  return {
    username: cleanUsername,
    fullName,
    bio,
    followersCount: parseCompactNumber(counts?.[1] ?? metaPtCounts?.[1] ?? ptCounts?.[1] ?? null),
    followingCount: parseCompactNumber(counts?.[2] ?? metaPtCounts?.[2] ?? ptCounts?.[2] ?? null),
    postsCount: parseCompactNumber(counts?.[3] ?? metaPtCounts?.[3] ?? postCount?.[1] ?? null),
    profilePicUrl: await page.locator("header img").first().getAttribute("src").catch(() => null),
    recentPosts,
    ...contacts,
  };
}

async function readProfileUnlocked(username: string) {
  const clean = normalizeUsername(username);
  const page = await getInstagramPage();
  await audit("instagram.profile_fetch.before", { username: clean });
  try {
    await gotoInstagram(page, `/${clean}/`);
    if (await page.getByText(/página não está disponível|page isn't available/i).count()) {
      throw new Error(`Perfil @${clean} indisponível.`);
    }
    const profile = await profileFromCurrentPage(page, clean);
    await audit("instagram.profile_fetch.after", { username: clean, ok: true });
    return profile;
  } catch (error) {
    await audit("instagram.profile_fetch.after", { username: clean, ok: false, error: String(error) });
    throw error;
  }
}

async function usernamesFromPostLinks(page: Page, links: string[], limit: number) {
  const usernames = new Set<string>();
  for (const link of links) {
    if (usernames.size >= limit) break;
    await gotoInstagram(page, new URL(link, IG_ORIGIN).pathname);
    const href = await page.locator('main a[href^="/"]').evaluateAll((anchors) => {
      for (const anchor of anchors) {
        const candidate = anchor.getAttribute("href") ?? "";
        if (/^\/[A-Za-z0-9._]+\/$/.test(candidate)) return candidate;
      }
      return null;
    }).catch(() => null);
    const username = href?.split("/").filter(Boolean)[0];
    if (username && !["explore", "accounts", "direct"].includes(username)) usernames.add(normalizeUsername(username));
  }
  return [...usernames];
}

async function discoverByHashtagUnlocked(hashtag: string, limit = 20) {
  const clean = hashtag.replace(/^#/, "");
  const page = await getInstagramPage();
  await audit("instagram.hashtag_fetch.before", { hashtag: clean, limit });
  try {
    await gotoInstagram(page, `/explore/tags/${encodeURIComponent(clean)}/`);
    const links = await page.locator('a[href*="/p/"], a[href*="/reel/"]').evaluateAll((anchors) =>
      [...new Set(anchors.map((anchor) => (anchor as HTMLAnchorElement).href))],
    );
    const usernames = await usernamesFromPostLinks(page, links, limit);
    await audit("instagram.hashtag_fetch.after", { hashtag: clean, found: usernames.length });
    return usernames;
  } catch (error) {
    await audit("instagram.hashtag_fetch.after", { hashtag: clean, ok: false, error: String(error) });
    throw error;
  }
}

async function discoverFromFollowersUnlocked(username: string, limit = 20) {
  const clean = normalizeUsername(username);
  const page = await getInstagramPage();
  await audit("instagram.followers_fetch.before", { username: clean, limit });
  try {
    await gotoInstagram(page, `/${clean}/`);
    const link = page.getByRole("link", { name: /seguidores|followers/i }).first();
    await link.click();
    const dialog = page.locator('div[role="dialog"]').last();
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('a[href^="/"]').first().waitFor({ state: "visible" });
    const usernames = new Set<string>();
    for (let attempt = 0; attempt < 20 && usernames.size < limit; attempt += 1) {
      const hrefs = await dialog.locator('a[href^="/"]').evaluateAll((anchors) =>
        anchors.map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
      for (const href of hrefs) {
        const candidate = href.split("/").filter(Boolean)[0];
        if (candidate && candidate !== clean) usernames.add(normalizeUsername(candidate));
        if (usernames.size >= limit) break;
      }
      await dialog.evaluate((element) => {
        const candidates = [element, ...element.querySelectorAll("div")];
        const scrollable = candidates.find((candidate) => candidate.scrollHeight > candidate.clientHeight + 20);
        scrollable?.scrollTo(0, scrollable.scrollHeight);
      });
      await page.waitForTimeout(800);
    }
    const found = [...usernames].slice(0, limit);
    await audit("instagram.followers_fetch.after", { username: clean, found: found.length });
    return found;
  } catch (error) {
    await audit("instagram.followers_fetch.after", { username: clean, ok: false, error: String(error) });
    throw error;
  }
}

async function sendDirectMessageUnlocked(username: string, body: string, auditContext: Record<string, unknown> = {}) {
  const clean = normalizeUsername(username);
  const page = await getInstagramPage();
  await audit("instagram.dm.before", { username: clean, body, ...auditContext });
  try {
    await gotoInstagram(page, `/${clean}/`);
    const messageButton = page.getByRole("button", { name: /mensagem|message/i }).first();
    await messageButton.click();
    await assertInstagramSession(page);
    const composer = page.locator('textarea[placeholder], div[contenteditable="true"][role="textbox"]').last();
    await composer.waitFor({ state: "visible" });
    await composer.fill(body).catch(async () => {
      await composer.click();
      await page.keyboard.type(body);
    });
    await page.keyboard.press("Enter");
    await audit("instagram.dm.after", { username: clean, ok: true, ...auditContext });
  } catch (error) {
    await audit("instagram.dm.after", { username: clean, ok: false, error: String(error), ...auditContext });
    throw error;
  }
}

export interface InboxReply {
  username: string;
  body: string;
}

async function readInboxRepliesUnlocked(limit = 30): Promise<InboxReply[]> {
  const page = await getInstagramPage();
  await audit("instagram.inbox_poll.before", { limit });
  try {
    await gotoInstagram(page, "/direct/inbox/");
    const threadLinks = await page.locator('a[href^="/direct/t/"]').evaluateAll((anchors, max) =>
      [...new Set(anchors.map((anchor) => (anchor as HTMLAnchorElement).href))].slice(0, Number(max)), limit,
    );
    const replies: InboxReply[] = [];
    for (const thread of threadLinks) {
      await gotoInstagram(page, new URL(thread).pathname);
      const profileHref = await page.locator('header a[href^="/"]:not([href^="/direct/"])').first().getAttribute("href").catch(() => null);
      const username = normalizeUsername(profileHref?.split("/").filter(Boolean)[0] ?? await text(page.locator("header h2, header a").first()));
      const incoming = page.locator('div[role="row"]:has(img) div[dir="auto"]');
      const body = (await incoming.last().textContent().catch(() => null))?.trim();
      if (username && body) replies.push({ username, body });
    }
    await audit("instagram.inbox_poll.after", { found: replies.length });
    return replies;
  } catch (error) {
    await audit("instagram.inbox_poll.after", { ok: false, error: String(error) });
    throw error;
  }
}

export const readProfile = (username: string) => withChromeLock(() => readProfileUnlocked(username));

export const discoverByHashtag = (hashtag: string, limit = 20) =>
  withChromeLock(() => discoverByHashtagUnlocked(hashtag, limit));

export const discoverFromFollowers = (username: string, limit = 20) =>
  withChromeLock(() => discoverFromFollowersUnlocked(username, limit));

export const sendDirectMessage = (username: string, body: string, auditContext: Record<string, unknown> = {}) =>
  withChromeLock(() => sendDirectMessageUnlocked(username, body, auditContext));

export const readInboxReplies = (limit = 30) =>
  withChromeLock(() => readInboxRepliesUnlocked(limit));
