import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).default("true"),
  DATABASE_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default("prospecta"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(50),
  OPENAI_INPUT_USD_PER_1M: z.coerce.number().nonnegative().default(0.15),
  OPENAI_OUTPUT_USD_PER_1M: z.coerce.number().nonnegative().default(0.6),
  CHROME_CDP_URL: z.string().url().default("http://localhost:9222"),
  EVOLUTION_API_URL: optionalUrl,
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_INSTANCE: z.string().optional(),
  TZ: z.string().default("America/Sao_Paulo"),
  WORKER_IDLE_MS: z.coerce.number().int().positive().default(5000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

export function env(): AppEnv {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
