import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { InvoiceEmail, InvoiceEmailError } from "./services/invoice-email.js";

test("server email uses saved invoice, provider idempotency and one accepted record", async () => {
  const folder = await mkdtemp(join(tmpdir(), "paypilot-email-"));
  const file = join(folder, "test.db");
  await writeFile(file, "");
  const url = `file:${file.replaceAll("\\", "/")}`;
  let db: PrismaClient | undefined;
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url }, timeout: 60000 },
    );
    db = new PrismaClient({ datasourceUrl: url });
    const owner = await db.user.create({ data: { email: "owner@example.test" } });
    const other = await db.user.create({ data: { email: "other@example.test" } });
    const invoice = await db.invoice.create({
      data: {
        userId: owner.id,
        clientName: "Rahul",
        clientEmail: "rahul@example.test",
        description: "Design work",
        amountMinor: 15000,
        currency: "USD",
        dueDate: new Date("2026-11-17T00:00:00.000Z"),
      },
    });
    const calls: { key: string; body: Record<string, unknown> }[] = [];
    let failOnce = true;
    const email = new InvoiceEmail(db, {
      apiKey: "test-key",
      from: "sender@example.test",
      fetch: async (_url, init) => {
        calls.push({
          key: new Headers(init?.headers).get("Idempotency-Key") ?? "",
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        if (failOnce) {
          failOnce = false;
          throw new Error("network timeout");
        }
        return Response.json({ id: "email-123" });
      },
    });
    await assert.rejects(email.send(invoice.id, other.id, 1), (error) =>
      error instanceof InvoiceEmailError && error.status === 404,
    );
    assert.equal(calls.length, 0);
    await assert.rejects(email.send(invoice.id, owner.id, 2), (error) =>
      error instanceof InvoiceEmailError && error.status === 409,
    );
    await assert.rejects(email.send(invoice.id, owner.id, 1), (error) =>
      error instanceof InvoiceEmailError && error.status === 502,
    );
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "DRAFT");
    const result = await email.send(invoice.id, owner.id, 1);
    assert.equal(result.status, "ACCEPTED");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].key, calls[1].key);
    assert.deepEqual(calls[0].body, calls[1].body);
    assert.deepEqual(calls[1].body.to, ["rahul@example.test"]);
    assert.match(String(calls[1].body.text), /Total: \$150\.00 USD/);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "ISSUED");
    await email.send(invoice.id, owner.id, 1);
    assert.equal(calls.length, 2);
    assert.equal(await db.invoiceDelivery.count({ where: { invoiceId: invoice.id } }), 1);

    const second = await db.invoice.create({
      data: {
        userId: owner.id,
        clientName: "Second client",
        clientEmail: "second@example.test",
        description: "Another design",
        amountMinor: 2000,
        currency: "USD",
        dueDate: new Date("2026-11-18T00:00:00.000Z"),
      },
    });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const concurrent = new InvoiceEmail(db, {
      apiKey: "test-key",
      from: "sender@example.test",
      fetch: async () => {
        enter();
        await hold;
        return Response.json({ id: "email-456" });
      },
    });
    const firstSend = concurrent.send(second.id, owner.id, 1);
    await entered;
    await assert.rejects(concurrent.send(second.id, owner.id, 1), (error) =>
      error instanceof InvoiceEmailError && error.status === 409,
    );
    release();
    assert.equal((await firstSend).status, "ACCEPTED");
    assert.equal(await db.invoiceDelivery.count({ where: { invoiceId: second.id } }), 1);

    const brevoInvoice = await db.invoice.create({
      data: {
        userId: owner.id, clientName: "Brevo client", clientEmail: "brevo@example.test",
        description: "Design work", amountMinor: 5000, currency: "USD",
        dueDate: new Date("2026-11-19T00:00:00.000Z"),
      },
    });
    let brevoCalls = 0;
    const brevo = new InvoiceEmail(db, {
      provider: "brevo", apiKey: "private-key", from: "sender@example.test",
      fetch: async (url, init) => {
        brevoCalls++;
        assert.equal(url, "https://api.brevo.com/v3/smtp/email");
        assert.equal(new Headers(init?.headers).get("api-key"), "private-key");
        assert.equal((JSON.parse(String(init?.body)) as { to: { email: string }[] }).to[0].email, "brevo@example.test");
        return Response.json({ messageId: "brevo-message-123" });
      },
    });
    assert.equal((await brevo.send(brevoInvoice.id, owner.id, 1)).status, "ACCEPTED");
    assert.equal((await db.invoiceDelivery.findUniqueOrThrow({ where: { invoiceId: brevoInvoice.id } })).providerId, "brevo-message-123");
    await brevo.send(brevoInvoice.id, owner.id, 1);
    assert.equal(brevoCalls, 1);
  } finally {
    await db?.$disconnect();
    for (const suffix of ["", "-journal", "-wal", "-shm"])
      await rm(`${file}${suffix}`, { force: true });
    await rmdir(folder);
  }
});
