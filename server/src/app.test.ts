import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createInvoiceAi } from "./services/gemini-invoice.js";
import {
  parseAmount,
  type Dashboard,
  type Invoice,
  type InvoicePage,
} from "../../shared/invoices.js";

let db: PrismaClient;
let server: Server;
let base: string;
let folder: string;
let file: string;
let ownerId: string;
let otherId: string;
const draft = {
  clientName: "Test Client",
  clientEmail: "client@example.test",
  description: "Design work",
  amountMinor: 12345,
  currency: "USD",
  dueDate: "2020-01-01",
};

before(async () => {
  folder = await mkdtemp(join(tmpdir(), "paypilot-test-"));
  file = join(folder, "test.db");
  await writeFile(file, "");
  const url = `file:${file.replaceAll("\\", "/")}`;
  await promisify(execFile)(
    process.execPath,
    [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: url },
      timeout: 60000,
    },
  );
  db = new PrismaClient({ datasourceUrl: url });
  ownerId = (await db.user.create({ data: { email: "owner@example.test" } }))
    .id;
  otherId = (await db.user.create({ data: { email: "other@example.test" } }))
    .id;
  server = createApp(db, ownerId).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});
beforeEach(async () => {
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
});
after(async () => {
  if (server) {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
  if (db) await db.$disconnect();
  // Remove only the exact files in the directory created by this test.
  if (file) {
    for (const suffix of ["", "-journal", "-wal", "-shm"])
      await rm(`${file}${suffix}`, { force: true });
    await rmdir(folder);
  }
});

async function request(path: string, method = "GET", body?: unknown) {
  if (
    path === "/invoices" &&
    method === "POST" &&
    typeof body === "object" &&
    body !== null
  )
    body = { ...body, confirmed: true };
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function create(input = draft): Promise<Invoice> {
  const response = await request("/invoices", "POST", input);
  assert.equal(response.status, 201);
  return response.json() as Promise<Invoice>;
}

test("invoice creation requires confirmation and extraction without credentials writes nothing", async () => {
  const unconfirmed = await fetch(`${base}/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  assert.equal(unconfirmed.status, 400);
  assert.deepEqual(await (await request("/ai/status")).json(), {
    configured: false,
  });
  const response = await request("/ai/invoice-draft", "POST", {
    prompt: "Invoice Rahul USD 150 for design, due in 5 days.",
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /GEMINI_API_KEY/);
  assert.equal(await db.invoice.count(), 0);
  assert.equal(
    (await request("/ai/invoice-draft", "POST", { prompt: "x".repeat(2001) }))
      .status,
    400,
  );
});

test("health and empty dashboard read the migrated database", async () => {
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).database, "connected");
  const stats: Dashboard = await (await request("/dashboard")).json();
  assert.equal(stats.total, 0);
  assert.deepEqual(stats.totals, []);
});

test("create, list, view, and edit draft persist data and enforce versions", async () => {
  const invoice = await create();
  assert.equal(invoice.status, "DRAFT");
  assert.equal(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
      .amountMinor,
    12345,
  );
  const list: InvoicePage = await (await request("/invoices")).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, invoice.id);
  const detail: Invoice = await (
    await request(`/invoices/${invoice.id}`)
  ).json();
  assert.deepEqual(detail.payments, []);
  const edited = await request(`/invoices/${invoice.id}`, "PATCH", {
    ...draft,
    amountMinor: 400,
    version: invoice.version,
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).version, 2);
  assert.equal(
    (
      await request(`/invoices/${invoice.id}`, "PATCH", {
        ...draft,
        version: 1,
      })
    ).status,
    409,
  );
});

test("validation rejects unsafe amounts, unknown fields, invalid dates, currency and pagination", async () => {
  for (const changes of [
    { amountMinor: -1 },
    { amountMinor: 1.5 },
    { amountMinor: 0 },
    { amountMinor: 2147483648 },
    { clientEmail: "invalid" },
    { dueDate: "2026-02-30" },
    { currency: "ZZZ" },
    { status: "PAID" },
    { userId: otherId },
  ]) {
    assert.equal(
      (await request("/invoices", "POST", { ...draft, ...changes })).status,
      400,
    );
  }
  assert.equal((await request("/invoices?page=0")).status, 400);
  assert.equal((await request("/invoices?pageSize=101")).status, 400);
  assert.equal((await request("/invoices/not-an-id")).status, 400);
  assert.equal(await db.invoice.count(), 0);
});

test("status transitions lock edits and atomically record one manual payment", async () => {
  const invoice = await create();
  const url = `/invoices/${invoice.id}`;
  assert.equal(
    (await request(`${url}/status`, "PATCH", { status: "PAID", version: 1 }))
      .status,
    409,
  );
  assert.equal(
    (await request(`${url}/status`, "PATCH", { status: "ISSUED", version: 1 }))
      .status,
    200,
  );
  assert.equal(
    (await request(url, "PATCH", { ...draft, version: 2 })).status,
    409,
  );
  assert.equal(
    (await request(`${url}/status`, "PATCH", { status: "PAID", version: 1 }))
      .status,
    409,
  );
  assert.equal(
    (await request(`${url}/status`, "PATCH", { status: "PAID", version: 2 }))
      .status,
    200,
  );
  assert.equal(
    (await request(`${url}/status`, "PATCH", { status: "PAID", version: 2 }))
      .status,
    409,
  );
  assert.equal(
    (
      await request(`${url}/status`, "PATCH", {
        status: "CANCELLED",
        version: 3,
      })
    ).status,
    409,
  );
  const payments = await db.payment.findMany({
    where: { invoiceId: invoice.id },
  });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].method, "MANUAL");
  assert.equal(payments[0].status, "COMPLETED");
  assert.equal(payments[0].amountMinor, draft.amountMinor);
});

test("cancelled invoices are terminal and do not create payments", async () => {
  const invoice = await create();
  assert.equal(
    (
      await request(`/invoices/${invoice.id}/status`, "PATCH", {
        status: "CANCELLED",
        version: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/invoices/${invoice.id}/status`, "PATCH", {
        status: "DRAFT",
        version: 2,
      })
    ).status,
    409,
  );
  assert.equal(await db.payment.count(), 0);
  assert.equal(
    (await (await request("/invoices?status=CANCELLED")).json()).total,
    1,
  );
});

test("ownership isolation covers detail, edit, status, listing and statistics", async () => {
  const foreign = await db.invoice.create({
    data: { ...draft, userId: otherId, dueDate: new Date("2020-01-01") },
  });
  assert.equal((await request(`/invoices/${foreign.id}`)).status, 404);
  assert.equal(
    (
      await request(`/invoices/${foreign.id}`, "PATCH", {
        ...draft,
        version: 1,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/invoices/${foreign.id}/status`, "PATCH", {
        status: "ISSUED",
        version: 1,
      })
    ).status,
    404,
  );
  assert.equal((await (await request("/invoices")).json()).total, 0);
  assert.equal((await (await request("/dashboard")).json()).total, 0);
});

test("statistics separate currencies and exclude drafts/cancellations from money totals", async () => {
  await db.invoice.createMany({
    data: [
      {
        ...draft,
        userId: ownerId,
        dueDate: new Date("2020-01-01"),
        status: "ISSUED",
        amountMinor: 500,
      },
      {
        ...draft,
        userId: ownerId,
        dueDate: new Date("2020-01-01"),
        status: "PAID",
        amountMinor: 300,
      },
      {
        ...draft,
        userId: ownerId,
        dueDate: new Date("2020-01-01"),
        status: "CANCELLED",
        amountMinor: 900,
      },
      {
        ...draft,
        userId: ownerId,
        dueDate: new Date("2020-01-01"),
        status: "DRAFT",
        amountMinor: 800,
      },
      {
        ...draft,
        userId: ownerId,
        dueDate: new Date("2099-01-01"),
        status: "ISSUED",
        amountMinor: 700,
        currency: "INR",
      },
    ],
  });
  const stats: Dashboard = await (await request("/dashboard")).json();
  assert.equal(stats.total, 5);
  assert.equal(stats.overdue, 1);
  assert.deepEqual(stats.byStatus, {
    DRAFT: 1,
    ISSUED: 2,
    PAID: 1,
    CANCELLED: 1,
  });
  assert.deepEqual(stats.totals, [
    {
      currency: "INR",
      invoicedMinor: 700,
      outstandingMinor: 700,
      paidMinor: 0,
    },
    {
      currency: "USD",
      invoicedMinor: 800,
      outstandingMinor: 500,
      paidMinor: 300,
    },
  ]);
  const list: InvoicePage = await (
    await request("/invoices?page=2&pageSize=2")
  ).json();
  assert.equal(list.items.length, 2);
  assert.equal(list.total, 5);
});

test("safe JSON errors, unknown API routes, origin checks and request limits", async () => {
  const invalid = await fetch(`${base}/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid JSON." });
  assert.equal((await request("/unknown")).status, 404);
  assert.equal(
    (
      await fetch(`${base}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "test",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(`${base}/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.test",
        },
        body: JSON.stringify(draft),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/invoices", "POST", {
        ...draft,
        description: "x".repeat(20000),
      })
    ).status,
    413,
  );
});

test("configuration fails safely and decimal amounts convert exactly", () => {
  assert.equal(readConfig({ DATABASE_URL: "file:./test.db" }).PORT, 3001);
  assert.equal(readConfig({ DATABASE_URL: "file:./test.db" }).HOST, "127.0.0.1");
  assert.equal(readConfig({ DATABASE_URL: "file:/var/data/paypilot.db", HOST: "0.0.0.0" }).HOST, "0.0.0.0");
  assert.throws(
    () => readConfig({ DATABASE_URL: "file:./dev.db", CLIENT_ORIGIN: "https://paypilot-ai-3sho.onrender.com" }),
    /^Error: Invalid configuration: DEMO_PASSWORD$/,
  );
  assert.equal(
    readConfig({ DATABASE_URL: "file:./dev.db", CLIENT_ORIGIN: "https://paypilot-ai-3sho.onrender.com", DEMO_PASSWORD: "a".repeat(32) }).DEMO_PASSWORD,
    "a".repeat(32),
  );
  assert.throws(() => readConfig({ DATABASE_URL: "file:./test.db", HOST: "public.example" }));
  assert.throws(
    () => readConfig({ DATABASE_URL: "secret-invalid-url" }),
    /^Error: Invalid configuration: DATABASE_URL$/,
  );
  assert.throws(() =>
    readConfig({ DATABASE_URL: "file:./test.db", PORT: "invalid" }),
  );
  assert.equal(parseAmount("10.29"), 1029);
  assert.equal(parseAmount("0.01"), 1);
  assert.equal(parseAmount("2.999"), null);
  assert.equal(parseAmount("-1"), null);
});

test("public demo requires Basic access before serving API data", async () => {
  const password = "b".repeat(32);
  const demo = createApp(
    db, ownerId, "https://paypilot-ai-3sho.onrender.com", undefined, undefined, password,
  ).listen(0, "127.0.0.1");
  await once(demo, "listening");
  const address = demo.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/health`;
  try {
    const denied = await fetch(url);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate") ?? "", /Basic/);
    assert.equal((await fetch(url.replace("/api/health", "/"))).status, 404);
    assert.equal((await fetch(url, { headers: { Authorization: "Basic " + Buffer.from("paypilot:wrong").toString("base64") } })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: "Basic " + Buffer.from(`paypilot:${password}`).toString("base64") } })).status, 200);
  } finally {
    demo.close();
    demo.closeAllConnections();
    await once(demo, "close");
  }
});

test("existing editor details persist and mismatched totals are rejected", async () => {
  const details = {
    company: "Client Studio",
    notes: "A note",
    items: [{ description: "Design", quantity: 3, rateMinor: 4115 }],
  };
  const response = await request("/invoices", "POST", { ...draft, details });
  assert.equal(response.status, 201);
  const invoice: Invoice = await response.json();
  const loaded: Invoice = await (
    await request(`/invoices/${invoice.id}`)
  ).json();
  assert.deepEqual(loaded.details, details);
  assert.equal(
    (await request("/invoices", "POST", { ...draft, amountMinor: 1, details }))
      .status,
    400,
  );
});

test("AI route returns clarification without writing; reviewed confirmed values create a draft", async () => {
  const ai = createInvoiceAi({
    now: () => new Date("2026-11-09T08:00:00Z"),
    generate: async () =>
      JSON.stringify({
        customerName: "Rahul",
        customerEmail: null,
        amount: "150",
        currency: "USD",
        description: "Landing page design",
        dueDate: null,
        dueInDays: 5,
      }),
  });
  const local = createApp(db, ownerId, "http://127.0.0.1:5173", ai).listen(
    0,
    "127.0.0.1",
  );
  await once(local, "listening");
  const address = local.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api`;
  try {
    const response = await fetch(`${url}/ai/invoice-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Invoice Rahul USD 150 for landing page design, due in 5 days.",
      }),
    });
    assert.equal(response.status, 200);
    const extracted = await response.json();
    assert.equal(extracted.draft.customerEmail, null);
    assert.equal(extracted.draft.dueDate, "2026-11-14");
    assert.equal(extracted.clarifications[0].field, "customerEmail");
    assert.equal(await db.invoice.count(), 0);
    const created = await fetch(`${url}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: extracted.draft.customerName,
        clientEmail: "rahul@example.test",
        amountMinor: 17500,
        currency: "USD",
        description: "Reviewed design work",
        dueDate: extracted.draft.dueDate,
        confirmed: true,
      }),
    });
    assert.equal(created.status, 201);
    const invoice: Invoice = await created.json();
    assert.equal(invoice.amountMinor, 17500); // User edits take precedence over extraction.
    assert.equal(invoice.status, "DRAFT");
    assert.equal(await db.invoice.count(), 1);
    assert.equal(await db.payment.count(), 0);
  } finally {
    local.close();
    local.closeAllConnections();
    await once(local, "close");
  }
});
