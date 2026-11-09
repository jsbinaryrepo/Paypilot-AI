import "dotenv/config";
import { z } from "zod";

export const configSchema = z.object({
  DATABASE_URL: z.string().regex(/^file:.+/),
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
  PAYPAL_WEBHOOK_ID: z.string().trim().optional(),
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  GEMINI_API_KEY: z.string().trim().optional(),
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
    throw new Error("Invalid configuration: DEMO_PASSWORD");
  return result.data;
}
