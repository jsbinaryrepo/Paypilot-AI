import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { InvoiceEmail } from "./services/invoice-email.js";

test("verified accounts isolate invoice data and require a session", async () => {
  const folder = await mkdtemp(join(tmpdir(), "paypilot-accounts-"));
  const url = `file:${join(folder, "db.sqlite").replaceAll("\\", "/")}`;
  const origin = "http://127.0.0.1:5173";
  const tokens = new Map<string, string>();
  const deliveries: string[] = [];
  let rejectOnce = true;
  let db: PrismaClient | undefined;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    await writeFile(join(folder, "db.sqlite"), "");
    await promisify(execFile)(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url }, timeout: 60000,
    });
    db = new PrismaClient({ datasourceUrl: url });
    const email = new InvoiceEmail(db, { apiKey: "test", from: "sender@example.test", fetch: async (_resource, init) => {
      const recipient = (JSON.parse(String(init?.body)) as { to: string[] }).to[0];
      deliveries.push(recipient);
      if (recipient === "retry@example.test" && rejectOnce) { rejectOnce = false; return Response.json({ message: "Rejected" }, { status: 503 }); }
      return Response.json({ id: `email-${deliveries.length}` });
    } });
    server = createApp(db, "", origin, undefined, undefined, undefined, email, {
      origin, apiKey: "test", from: "sender@example.test",
      sendVerification: async (_key, _from, _origin, recipient, token) => { tokens.set(recipient, token); },
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const request = (path: string, body?: unknown, cookie?: string) => fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal((await request("/invoices")).status, 401);
    for (const email of ["one@example.test", "two@example.test"]) {
      assert.equal((await request("/auth/register", { email, password: "a sufficiently long password" })).status, 202);
      assert.ok(tokens.get(email));
      assert.equal((await request("/auth/verify", { token: tokens.get(email) })).status, 200);
    }
    const first = await request("/auth/login", { email: "one@example.test", password: "a sufficiently long password" });
    assert.equal(first.status, 200);
    const firstCookie = first.headers.get("set-cookie")?.split(";")[0];
    assert.ok(firstCookie);
    assert.equal((await request("/invoices", {
      confirmed: true, clientName: "No key", clientEmail: "client@example.test",
      description: "Design work", amountMinor: 12345, currency: "USD", dueDate: "2026-12-01",
    }, firstCookie)).status, 400);
    const created = await request("/invoices", {
      confirmed: true, clientName: "Test Client", clientEmail: "client@example.test",
      description: "Design work", amountMinor: 12345, currency: "USD", dueDate: "2026-12-01",
      details: { company: "Example Studio", notes: "Thanks", items: [{ description: "Design work", quantity: 1, rateMinor: 12345 }] },
      requestId: "dc539f54-209c-409e-99f8-3d99ae3fbc5d",
    }, firstCookie);
    assert.equal(created.status, 201);
    const invoice = await created.json() as { id: string; status: string };
    assert.equal(invoice.status, "ISSUED");
    assert.deepEqual(deliveries, ["client@example.test"]);
    const repeated = await request("/invoices", {
      confirmed: true, clientName: "Test Client", clientEmail: "client@example.test",
      description: "Design work", amountMinor: 12345, currency: "USD", dueDate: "2026-12-01",
      details: { company: "Example Studio", notes: "Thanks", items: [{ description: "Design work", quantity: 1, rateMinor: 12345 }] },
      requestId: "dc539f54-209c-409e-99f8-3d99ae3fbc5d",
    }, firstCookie);
    assert.equal((await repeated.json() as { id: string }).id, invoice.id);
    assert.equal(deliveries.length, 1);
    const changed = await request("/invoices", {
      confirmed: true, clientName: "Test Client", clientEmail: "another@example.test",
      description: "Design work", amountMinor: 12345, currency: "USD", dueDate: "2026-12-01",
      details: { company: "Example Studio", notes: "Thanks", items: [{ description: "Design work", quantity: 1, rateMinor: 12345 }] },
      requestId: "dc539f54-209c-409e-99f8-3d99ae3fbc5d",
    }, firstCookie);
    assert.equal(changed.status, 409);
    assert.equal(deliveries.length, 1);
    const failed = await request("/invoices", {
      confirmed: true, clientName: "Retry Client", clientEmail: "retry@example.test",
      description: "Design work", amountMinor: 5000, currency: "USD", dueDate: "2026-12-02",
      requestId: "df1250a0-c846-4c79-9590-257e2c079635",
    }, firstCookie);
    assert.equal(failed.status, 502);
    assert.match((await failed.json() as { error: string }).error, /Invoice saved, but the email was not accepted/);
    const retried = await request("/invoices", {
      confirmed: true, clientName: "Retry Client", clientEmail: "retry@example.test",
      description: "Design work", amountMinor: 5000, currency: "USD", dueDate: "2026-12-02",
      requestId: "df1250a0-c846-4c79-9590-257e2c079635",
    }, firstCookie);
    assert.equal(retried.status, 201);
    assert.equal((await retried.json() as { status: string }).status, "ISSUED");
    assert.equal(await db.invoice.count({ where: { userId: (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).userId } }), 2);
    const second = await request("/auth/login", { email: "two@example.test", password: "a sufficiently long password" });
    const secondCookie = second.headers.get("set-cookie")?.split(";")[0];
    assert.ok(secondCookie);
    assert.equal((await request(`/invoices/${invoice.id}`, undefined, secondCookie)).status, 404);
    const secondList = await (await request("/invoices", undefined, secondCookie)).json() as { total: number };
    assert.equal(secondList.total, 0);
    assert.equal((await request(`/invoices/${invoice.id}/email`, undefined, secondCookie)).status, 404);
    assert.equal((await request("/invoices", undefined, firstCookie)).status, 200);
    const noOrigin = await fetch(`${base}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: firstCookie }, body: "{}" });
    assert.equal(noOrigin.status, 403);
  } finally {
    if (server) { server.close(); server.closeAllConnections(); await once(server, "close"); }
    if (db) await db.$disconnect();
    await rm(folder, { recursive: true, force: true });
  }
});
