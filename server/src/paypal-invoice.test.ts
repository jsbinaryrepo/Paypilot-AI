import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PayPal } from "./services/paypal.js";
import { PayPalInvoiceService, PayPalInvoiceError } from "./services/paypal-invoice.js";
import { daysOverdue, refreshOverdue } from "./overdue.js";

test("PayPal invoicing sends once and only verifies a matching paid transaction", async () => {
  const folder = await mkdtemp(join(tmpdir(), "paypilot-invoicing-"));
  const file = join(folder, "db.sqlite");
  await writeFile(file, "");
  const url = `file:${file.replaceAll("\\", "/")}`;
  let db: PrismaClient | undefined;
  try {
    await promisify(execFile)(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url }, timeout: 60000,
    });
    db = new PrismaClient({ datasourceUrl: url });
    const owner = await db.user.create({ data: { email: "invoicer@example.test" } });
    const other = await db.user.create({ data: { email: "other-invoicer@example.test" } });
    const invoice = await db.invoice.create({ data: {
      userId: owner.id, clientName: "Rahul", clientEmail: "rahul@example.test", description: "Landing page design",
      amountMinor: 15000, currency: "USD", dueDate: new Date("2026-11-01T00:00:00Z"),
    } });
    const unsent = await db.invoice.create({ data: {
      userId: owner.id, clientName: "Unsent", clientEmail: "unsent@example.test", description: "Draft",
      amountMinor: 1000, currency: "USD", dueDate: new Date("2026-11-01T00:00:00Z"),
    } });
    let remoteState = "DRAFT";
    let createCalls = 0;
    let sendCalls = 0;
    let number = "";
    let amount = "150.00";
    let reference = invoice.id;
    let paymentDate = "2026-11-10T10:00:00Z";
    let signatureValid = true;
    const remote = () => ({
      id: "INV2-TEST-1234", status: remoteState,
      detail: { invoice_number: number, currency_code: "USD", reference, metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/test" } },
      primary_recipients: [{ billing_info: { email_address: "rahul@example.test" } }],
      amount: { currency_code: "USD", value: amount },
      ...(remoteState === "PAID" ? { due_amount: { currency_code: "USD", value: "0.00" }, payments: {
        paid_amount: { currency_code: "USD", value: amount }, transactions: [{
          type: "PAYPAL", method: "PAYPAL", payment_id: "CAPTURE123", payment_date_time: paymentDate,
          amount: { currency_code: "USD", value: amount },
        }],
      } } : {}),
    });
    const paypal = new PayPal(db, { clientId: "test", secret: "test", webhookId: "WH-TEST", origin: "http://127.0.0.1:3001", fetch: async (resource, init) => {
      const path = String(resource);
      if (path.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 3600 });
      if (path.endsWith("/v1/notifications/verify-webhook-signature")) return Response.json({ verification_status: signatureValid ? "SUCCESS" : "FAILURE" });
      if (path.endsWith("/v2/invoicing/invoices") && init?.method === "POST") {
        createCalls++;
        const body = JSON.parse(String(init.body)) as { detail: { invoice_number: string; currency_code: string }; primary_recipients: { billing_info: { email_address: string } }[]; items: { unit_amount: { value: string } }[] };
        number = body.detail.invoice_number;
        assert.equal(body.detail.currency_code, "USD");
        assert.equal(body.primary_recipients[0].billing_info.email_address, "rahul@example.test");
        assert.equal(body.items[0].unit_amount.value, "150.00");
        return Response.json({ href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-1234" }, { status: 201 });
      }
      if (path.endsWith("/INV2-TEST-1234/send")) { sendCalls++; remoteState = "UNPAID"; return new Response(null, { status: 202 }); }
      if (path.endsWith("/INV2-TEST-1234")) return Response.json(remote());
      throw new Error(`Unexpected provider request ${path}`);
    } });
    const service = new PayPalInvoiceService(db, paypal, "Test Studio");
    await assert.rejects(service.send(invoice.id, other.id, 1), (error) => error instanceof PayPalInvoiceError && error.status === 404);
    const sent = await service.send(invoice.id, owner.id, 1);
    assert.equal(sent.status, "UNPAID");
    assert.equal(sent.paypalInvoiceId, "INV2-TEST-1234");
    assert.equal(createCalls, 1);
    assert.equal(sendCalls, 1);
    assert.equal((await service.send(invoice.id, owner.id, 1)).status, "UNPAID");
    assert.equal(createCalls, 1);
    assert.equal(sendCalls, 1);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "ISSUED");
    assert.equal(daysOverdue(invoice.dueDate, new Date("2026-11-10T12:00:00Z")), 9);
    await refreshOverdue(db, owner.id, new Date("2026-11-10T12:00:00Z"));
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "OVERDUE");
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: unsent.id } })).status, "DRAFT");
    remoteState = "PAID";
    reference = "another-invoice";
    await assert.rejects(service.check(invoice.id, owner.id), (error) => error instanceof PayPalInvoiceError && error.status === 409);
    reference = invoice.id;
    amount = "149.00";
    await assert.rejects(service.check(invoice.id, owner.id), (error) => error instanceof PayPalInvoiceError && error.status === 409);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "OVERDUE");
    amount = "150.00";
    paymentDate = "invalid";
    await assert.rejects(service.check(invoice.id, owner.id), (error) => error instanceof PayPalInvoiceError && error.status === 409);
    paymentDate = "2026-11-10T10:00:00Z";
    const webhook = { id: "WH-EVENT-1", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-TEST-1234" } };
    const headers = Object.fromEntries(["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"].map((key) => [key, "test"]));
    signatureValid = false;
    await assert.rejects(paypal.webhook(headers, webhook));
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "OVERDUE");
    signatureValid = true;
    const verified = await paypal.webhook(headers, webhook);
    assert.equal(verified?.invoicingId, "INV2-TEST-1234");
    await service.reconcileProvider(verified!.invoicingId);
    await service.reconcileProvider(verified!.invoicingId);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "PAID");
    assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), 1);
    await refreshOverdue(db, owner.id, new Date("2026-11-11T12:00:00Z"));
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "PAID");
  } finally {
    if (db) await db.$disconnect();
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
