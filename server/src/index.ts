import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { PayPal } from "./services/paypal.js";
import { createInvoiceAi } from "./services/gemini-invoice.js";
import { InvoiceEmail } from "./services/invoice-email.js";
import { PayPalInvoiceService } from "./services/paypal-invoice.js";
import { refreshOverdue } from "./overdue.js";

const config = readConfig(process.env);
const accounts = config.ACCOUNTS_ENABLED === "true";
const guests = config.PUBLIC_GUEST_ACCESS === "true";
const db = accounts
  ? new PrismaClient({ adapter: new PrismaLibSQL({ url: config.TURSO_DATABASE_URL!, authToken: config.TURSO_AUTH_TOKEN! }) })
  : new PrismaClient({ datasourceUrl: config.DATABASE_URL });
try {
  const owner = accounts || guests ? null : await db.user.upsert({
    where: { email: config.LOCAL_USER_EMAIL },
    update: {},
    create: { email: config.LOCAL_USER_EMAIL },
  });
  const paypal = new PayPal(db, {
    clientId: config.PAYPAL_CLIENT_ID,
    secret: config.PAYPAL_CLIENT_SECRET,
    merchantId: config.PAYPAL_MERCHANT_ID,
    webhookId: config.PAYPAL_WEBHOOK_ID,
    origin: accounts ? `${config.CLIENT_ORIGIN}/app` : config.CLIENT_ORIGIN,
  });
  const app = createApp(
    db,
    owner?.id ?? "",
    config.CLIENT_ORIGIN,
    createInvoiceAi({
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
      timeZone: config.INVOICE_TIMEZONE,
    }),
    paypal,
    guests,
    new InvoiceEmail(db, {
      apiKey: config.RESEND_API_KEY,
      from: config.EMAIL_FROM,
    }),
    accounts ? { origin: config.CLIENT_ORIGIN, apiKey: config.RESEND_API_KEY!, from: config.EMAIL_FROM! } : undefined,
    new PayPalInvoiceService(db, paypal, config.PAYPAL_BUSINESS_NAME),
  );
  if (accounts) app.use("/app", express.static(resolve("dist/account-client")));
  app.use(express.static(resolve("dist/client")));
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`PayPilot API listening on ${config.HOST}:${config.PORT}`);
  });
  const overdueTimer = setInterval(() => { void refreshOverdue(db).catch(() => console.error("Overdue refresh failed.")); }, 60 * 60 * 1000);
  overdueTimer.unref();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(overdueTimer);
    server.close(() => {
      void db.$disconnect();
    });
    server.closeIdleConnections();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch {
  await db.$disconnect();
  console.error(
    "Startup failed. Check configuration and run npm run db:migrate.",
  );
  process.exitCode = 1;
}
