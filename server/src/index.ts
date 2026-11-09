import { PrismaClient } from "@prisma/client";
import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { PayPal } from "./services/paypal.js";
import { createInvoiceAi } from "./services/gemini-invoice.js";

const config = readConfig(process.env);
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
try {
  const owner = await db.user.upsert({
    where: { email: config.LOCAL_USER_EMAIL },
    update: {},
    create: { email: config.LOCAL_USER_EMAIL },
  });
  const app = createApp(
    db,
    owner.id,
    config.CLIENT_ORIGIN,
    createInvoiceAi({
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
      timeZone: config.INVOICE_TIMEZONE,
    }),
    new PayPal(db, {
      clientId: config.PAYPAL_CLIENT_ID,
      secret: config.PAYPAL_CLIENT_SECRET,
      merchantId: config.PAYPAL_MERCHANT_ID,
      webhookId: config.PAYPAL_WEBHOOK_ID,
      origin: config.CLIENT_ORIGIN,
    }),
  );
  app.use(express.static(resolve("dist/client")));
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`PayPilot API listening on ${config.HOST}:${config.PORT}`);
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
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
