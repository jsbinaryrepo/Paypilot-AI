import "dotenv/config";
import { z } from "zod";

export const configSchema = z.object({
  DATABASE_URL: z.string().regex(/^file:.+/),
  ACCOUNTS_ENABLED: z.enum(["true", "false"]).default("false"),
  TURSO_DATABASE_URL: z.string().regex(/^libsql:\/\//).optional().or(z.literal("")),
  TURSO_AUTH_TOKEN: z.string().min(1).optional().or(z.literal("")),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  CLIENT_ORIGIN: z
    .union([
      z.enum(["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:3001", "http://localhost:3001"]),
      z.string().regex(/^https:\/\/[a-z0-9-]+\.onrender\.com$/),
    ])
    .default("http://127.0.0.1:5173"),
  DEMO_PASSWORD: z.string().min(32).optional().or(z.literal("")),
  LOCAL_USER_EMAIL: z.email().default("owner@example.test"),
  PAYPAL_CLIENT_ID: z.string().trim().optional(),
  PAYPAL_CLIENT_SECRET: z.string().trim().optional(),
  PAYPAL_MERCHANT_ID: z.string().trim().optional(),
  PAYPAL_BUSINESS_NAME: z.string().trim().min(2).max(120).optional().or(z.literal("")),
  PAYPAL_WEBHOOK_ID: z.string().trim().optional(),
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  GEMINI_API_KEY: z.string().trim().optional(),
  RESEND_API_KEY: z.string().trim().optional(),
  EMAIL_FROM: z.email().optional().or(z.literal("")),
  GEMINI_MODEL: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional()
    .or(z.literal("")),
  INVOICE_TIMEZONE: z
    .string()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .default("Asia/Kolkata"),
});

export function readConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  if (result.data.CLIENT_ORIGIN.startsWith("https://") && !result.data.DEMO_PASSWORD)
    if (result.data.ACCOUNTS_ENABLED !== "true")
      throw new Error("Invalid configuration: DEMO_PASSWORD");
  if (result.data.ACCOUNTS_ENABLED === "true" &&
      (!result.data.TURSO_DATABASE_URL || !result.data.TURSO_AUTH_TOKEN ||
       !result.data.RESEND_API_KEY || !result.data.EMAIL_FROM))
    throw new Error("Invalid configuration: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, RESEND_API_KEY, EMAIL_FROM");
  return result.data;
}
