import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).default("true"),
  DATABASE_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default("prospecta"),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  GEMINI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),
  GEMINI_INPUT_USD_PER_1M: z.coerce.number().nonnegative().default(0.25),
  GEMINI_OUTPUT_USD_PER_1M: z.coerce.number().nonnegative().default(1.5),
  CHROME_CDP_URL: z.string().url().default("http://localhost:9222"),
  EVOLUTION_API_URL: optionalUrl,
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_INSTANCE: z.string().optional(),
  INSTAGRAM_DMS_ENABLED: z.enum(["true", "false"]).default("false"),
  WHATSAPP_HANDOFF_ENABLED: z.enum(["true", "false"]).default("false"),
  TZ: z.string().default("America/Sao_Paulo"),
  WORKER_IDLE_MS: z.coerce.number().int().positive().default(5000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

export function env(): AppEnv {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
