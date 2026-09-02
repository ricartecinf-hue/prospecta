import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { audit } from "./db";
import { env } from "./env";
import { pauseAutomation } from "./circuit-breaker";

let browserPromise: Promise<Browser> | null = null;
let chromeQueue: Promise<void> = Promise.resolve();

export async function withChromeLock<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = chromeQueue;
  chromeQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export class InstagramSessionExpiredError extends Error {
  constructor() {
    super("A sessão do Instagram expirou. Faça login manualmente no Chrome e reative a automação.");
    this.name = "InstagramSessionExpiredError";
  }
}

export async function connectToChrome() {
  if (!browserPromise) {
    browserPromise = chromium.connectOverCDP(env().CHROME_CDP_URL).then((browser) => {
      browser.once("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    });
  }
  return browserPromise;
}

export async function getInstagramPage(): Promise<Page> {
  const browser = await connectToChrome();
  const context = browser.contexts()[0];
  if (!context) throw new Error("O Chrome conectado por CDP não possui um contexto aberto.");
  const pages = context.pages();
  const page = pages.find((candidate) => candidate.url().includes("instagram.com")) ?? pages[0];
  if (!page) throw new Error("Abra uma aba no Chrome antes de iniciar os workers; nenhuma nova janela será criada.");
  page.setDefaultTimeout(15_000);
  return page;
}

export async function assertInstagramSession(page: Page) {
  const loginUrl = /instagram\.com\/(accounts\/login|challenge)/i.test(page.url());
  const loginForm = await page.locator('input[name="username"], input[name="password"]').count();
  if (!loginUrl && loginForm === 0) return;

  await audit("instagram.session_expired", { url: page.url() });
  await pauseAutomation("Sessão do Instagram expirada; login manual necessário.");
  throw new InstagramSessionExpiredError();
}
