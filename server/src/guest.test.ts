import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";

test("public guest workspace has no Basic prompt and isolates saved invoices", async () => {
  const folder = await mkdtemp(join(tmpdir(), "paypilot-guest-"));
  const file = join(folder, "db.sqlite");
  const databaseUrl = `file:${file.replaceAll("\\", "/")}`;
  const origin = "http://127.0.0.1:5173";
  let db: PrismaClient | undefined;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    await writeFile(file, "");
    await promisify(execFile)(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 60000,
    });
    db = new PrismaClient({ datasourceUrl: databaseUrl });
    server = createApp(db, "", origin, undefined, undefined, true).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const first = await fetch(`${base}/dashboard`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("www-authenticate"), null);
    const firstCookie = first.headers.get("set-cookie")?.split(";")[0];
    assert.ok(firstCookie?.startsWith("paypilot_guest="));
    assert.match(first.headers.get("set-cookie") ?? "", /HttpOnly/);
    const second = await fetch(`${base}/dashboard`);
    const secondCookie = second.headers.get("set-cookie")?.split(";")[0];
    assert.ok(secondCookie && secondCookie !== firstCookie);
    assert.equal((await fetch(`${base}/ai/status`, { headers: { Cookie: firstCookie } })).status, 200);
    assert.equal((await fetch(`${base}/paypal/status`, { headers: { Cookie: firstCookie } })).status, 200);
    const body = JSON.stringify({ confirmed: true, clientName: "Test Client", clientEmail: "client@example.test",
      description: "Design work", amountMinor: 15000, currency: "USD", dueDate: "2026-12-01" });
    assert.equal((await fetch(`${base}/invoices`, { method: "POST", headers: { Cookie: firstCookie, "Content-Type": "application/json" }, body })).status, 403);
    const created = await fetch(`${base}/invoices`, { method: "POST", headers: { Origin: origin, Cookie: firstCookie, "Content-Type": "application/json" }, body });
    assert.equal(created.status, 201);
    const invoice = await created.json() as { id: string };
    const firstList = await (await fetch(`${base}/invoices`, { headers: { Cookie: firstCookie } })).json() as { total: number };
    const secondList = await (await fetch(`${base}/invoices`, { headers: { Cookie: secondCookie } })).json() as { total: number };
    assert.equal(firstList.total, 1);
    assert.equal(secondList.total, 0);
    assert.equal((await fetch(`${base}/invoices/${invoice.id}`, { headers: { Cookie: secondCookie } })).status, 404);
    const webhook = await fetch(`${base}/paypal/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(webhook.status, 503);
    assert.equal(webhook.headers.get("www-authenticate"), null);
    assert.equal(await db.session.count(), 2);
  } finally {
    if (server) { server.close(); server.closeAllConnections(); await once(server, "close"); }
    await db?.$disconnect();
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
