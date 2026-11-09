import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createApp } from "./app.js";
import { PrismaClient, type Invoice } from "@prisma/client";
import { PayPal, PaymentError } from "./services/paypal.js";

let db: PrismaClient;
let folder: string;
let file: string;
let owner: string;
let invoice: Invoice;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "paypilot-paypal-"));
  file = join(folder, "test.db");
  await writeFile(file, "");
  const url = `file:${file.replaceAll("\\", "/")}`;
  await promisify(execFile)(
    process.execPath,
    [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url } },
  );
  db = new PrismaClient({ datasourceUrl: url });
  owner = (
    await db.user.create({ data: { email: "sandbox-test@example.test" } })
  ).id;
});
beforeEach(async () => {
  await db.payment.deleteMany();
  await db.checkout.deleteMany();
  await db.invoice.deleteMany();
  invoice = await db.invoice.create({
    data: {
      userId: owner,
      clientName: "Test",
      clientEmail: "client@example.test",
      description: "Design",
      amountMinor: 15000,
      currency: "USD",
      dueDate: new Date("2026-12-01"),
    },
  });
});
after(async () => {
  await db?.$disconnect();
  if (file) {
    for (const suffix of ["", "-journal", "-wal", "-shm"])
      await rm(file + suffix, { force: true });
    await rmdir(folder);
  }
});
function fixture() {
  const state = {
    orderId: 'ORDER1',
    status: "CREATED",
    captures: [] as {
      id: string;
      status: string;
      amount: { value: string; currency_code: string };
      final_capture: boolean;
    }[],
    amount: "150.00",
    currency: "USD",
    merchant: "MERCHANT",
    custom: "",
    creates: 0,
    captureCalls: 0,
    keys: [] as string[],
    timeout: false,
    signature: "SUCCESS",
    failCreate: false,
  };
  const snapshot = () => ({
    id: state.orderId,
    status: state.status,
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: state.custom || invoice.id,
        amount: { value: state.amount, currency_code: state.currency },
        payee: { merchant_id: state.merchant },
        payments: { captures: state.captures },
      },
    ],
    links: [
      {
        rel: "payer-action",
        href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1",
      },
    ],
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith("https://api-m.sandbox.paypal.com/"));
    if (url.endsWith("/token")) {
      assert.match(new Headers(init?.headers).get("Authorization")!, /^Basic /);
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    if (url.endsWith("/verify-webhook-signature")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.webhook_event.resource.supplementary_data.related_ids.payment_id, 'PAYMENTREF');
      return Response.json({ verification_status: state.signature });
    }
    if (init?.method === "POST")
      state.keys.push(new Headers(init.headers).get("PayPal-Request-Id")!);
    if (url.endsWith("/capture")) {
      state.captureCalls++;
      state.status = "COMPLETED";
      state.captures = [
        {
          id: "CAPTURE1",
          status: "COMPLETED",
          amount: { value: state.amount, currency_code: state.currency },
          final_capture: true,
        },
      ];
      if (state.timeout)
        throw new DOMException("private network info", "TimeoutError");
      return Response.json(snapshot());
    }
    if (init?.method === "POST") {
      state.creates++;
      if (state.status === 'VOIDED') { state.status = 'CREATED'; state.orderId = 'ORDER2'; }
      const body = JSON.parse(String(init.body));
      assert.equal(body.purchase_units[0].amount.value, "150.00");
      assert.equal(body.purchase_units[0].amount.currency_code, "USD");
      assert.equal(body.purchase_units[0].custom_id, invoice.id);
      if (state.failCreate) throw new Error("uncertain creation");
    }
    return Response.json(snapshot());
  };
  return {
    state,
    fetcher,
    paypal: new PayPal(db, {
      clientId: "client",
      secret: "secret",
      merchantId: "MERCHANT",
      webhookId: "HOOK",
      origin: "http://127.0.0.1:5173",
      fetch: fetcher,
    }),
  };
}
test("missing credentials and foreign invoice reject before any order", async () => {
  const disabled = new PayPal(db, { origin: "http://127.0.0.1:5173" });
  await assert.rejects(
    disabled.start(invoice.id, owner),
    (e) => e instanceof PaymentError && e.status === 503,
  );
  const { paypal, state } = fixture();
  await assert.rejects(
    paypal.start(invoice.id, "foreign"),
    (e) => e instanceof PaymentError && e.status === 404,
  );
  assert.equal(state.creates, 0);
});

test("a queued checkout reloads the order after acquiring its lease", async () => {
  const { paypal, state, fetcher } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "VOIDED";
  let resume!: () => void;
  let queued!: () => void;
  const waiting = new Promise<void>((resolve) => { queued = resolve; });
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  let paused = false;
  const delayedDb = db.$extends({ query: { checkout: {
    async updateMany({ args, query }) {
      if (!paused && args.data.busyUntil instanceof Date && args.data.busyUntil.getTime() > Date.now()) {
        paused = true;
        queued();
        await gate;
      }
      return query(args);
    },
  } } });
  const delayed = new PayPal(delayedDb as unknown as PrismaClient, {
    clientId: "client", secret: "secret", merchantId: "MERCHANT",
    origin: "http://127.0.0.1:5173", fetch: fetcher,
  });
  const pending = delayed.start(invoice.id, owner);
  await waiting;
  try {
    assert.equal((await paypal.start(invoice.id, owner)).orderId, "ORDER2");
  } finally { resume(); }
  assert.equal((await pending).orderId, "ORDER2");
  assert.equal(state.creates, 2);
});

test("malformed provider order responses are safe upstream failures", async () => {
  const paypal = new PayPal(db, {
    clientId: "client", secret: "secret", merchantId: "MERCHANT",
    origin: "http://127.0.0.1:5173",
    fetch: async (url) => Response.json(String(url).endsWith("/token")
      ? { access_token: "test-token", expires_in: 3600 }
      : { id: "ORDER1", private_provider_detail: "secret-sentinel" }),
  });
  await assert.rejects(paypal.start(invoice.id, owner), (error) =>
    error instanceof PaymentError && error.status === 502 && !error.message.includes("sentinel"));
  assert.equal(await db.payment.count(), 0);
  assert.notEqual((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "PAID");
});
test("database total is used and repeated initiation reuses one order", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  await paypal.start(invoice.id, owner);
  assert.equal(state.creates, 1);
  assert.equal(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    "ISSUED",
  );
  assert.equal(await db.payment.count(), 0);
});
test("capture is verified and repeated callbacks create one record and one capture", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "APPROVED";
  assert.deepEqual(await paypal.check(invoice.id, owner, "ORDER1", true), {
    status: "PAID",
  });
  await paypal.check(invoice.id, owner, "ORDER1", true);
  assert.equal(state.captureCalls, 1);
  assert.equal(await db.payment.count(), 1);
  assert.equal(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    "PAID",
  );
});
test("uncertain capture reconciles with GET without charging again", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "APPROVED";
  state.timeout = true;
  await assert.rejects(paypal.check(invoice.id, owner, "ORDER1", true));
  assert.equal(await db.payment.count(), 0);
  assert.deepEqual(await paypal.check(invoice.id, owner, "ORDER1", true), {
    status: "PAID",
  });
  assert.equal(state.captureCalls, 1);
  assert.equal(await db.payment.count(), 1);
});
test("amount, currency, merchant and invoice associations must all match", async () => {
  for (const [key, value] of [
    ["amount", "151.00"],
    ["currency", "EUR"],
    ["merchant", "FOREIGN"],
    ["custom", "foreign"],
  ] as const) {
    const { paypal, state } = fixture();
    await paypal.start(invoice.id, owner);
    state[key] = value;
    await assert.rejects(
      paypal.check(invoice.id, owner, "ORDER1", true),
      (e) => e instanceof PaymentError && e.status === 409,
    );
    assert.equal(state.captureCalls, 0);
    assert.equal(await db.payment.count(), 0);
  }
});
test("wrong order, unapproved return and pending capture never mark paid", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  await assert.rejects(paypal.check(invoice.id, owner, "OTHER", true));
  await paypal.check(invoice.id, owner, "ORDER1", true);
  assert.equal(state.captureCalls, 0);
  state.status = "COMPLETED";
  state.captures = [
    {
      id: "CAPTURE1",
      status: "PENDING",
      amount: { value: "150.00", currency_code: "USD" },
      final_capture: true,
    },
  ];
  assert.deepEqual(await paypal.check(invoice.id, owner, "ORDER1", true), {
    status: "PENDING_VERIFICATION",
  });
  assert.equal(await db.payment.count(), 0);
});
test("uncertain order creation reuses persisted idempotency key and expired retry is blocked", async () => {
  const { paypal, state } = fixture();
  state.failCreate = true;
  await assert.rejects(paypal.start(invoice.id, owner));
  state.failCreate = false;
  await paypal.start(invoice.id, owner);
  assert.equal(state.keys[0], state.keys[1]);
  await db.checkout.update({
    where: { invoiceId: invoice.id },
    data: { orderId: null, createdAt: new Date(Date.now() - 6 * 3600000) },
  });
  await assert.rejects(
    paypal.start(invoice.id, owner),
    (e) => e instanceof PaymentError && e.status === 409,
  );
  assert.equal(state.creates, 2);
});
test("database lease blocks concurrent mutation; paid and cancelled invoices cannot be restarted", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  await db.checkout.update({
    where: { invoiceId: invoice.id },
    data: { busyUntil: new Date(Date.now() + 60000) },
  });
  await assert.rejects(
    paypal.check(invoice.id, owner, "ORDER1", true),
    (e) => e instanceof PaymentError && e.status === 409,
  );
  assert.equal(state.captureCalls, 0);
  await db.checkout.update({
    where: { invoiceId: invoice.id },
    data: { busyUntil: new Date(0) },
  });
  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: "PAID" },
  });
  await assert.rejects(paypal.start(invoice.id, owner));
  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: "CANCELLED" },
  });
  await assert.rejects(paypal.start(invoice.id, owner));
});
test("verified webhook re-fetches order and duplicate deliveries are idempotent", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "APPROVED";
  await paypal.check(invoice.id, owner, "ORDER1", true);
  const event = {
    id: "EVENT1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { supplementary_data: { related_ids: { order_id: "ORDER1", payment_id: 'PAYMENTREF' } } },
  };
  const headers = Object.fromEntries(
    [
      "auth-algo",
      "cert-url",
      "transmission-id",
      "transmission-sig",
      "transmission-time",
    ].map((key) => [`paypal-${key}`, "test"]),
  );
  state.signature = "FAILURE";
  await assert.rejects(
    paypal.webhook(headers, event),
    (e) => e instanceof PaymentError && e.status === 403,
  );
  state.signature = "SUCCESS";
  await paypal.webhook(headers, event);
  await paypal.webhook(headers, event);
  assert.equal(await db.payment.count(), 1);
  assert.equal(state.captureCalls, 1);
});

test("HTTP routes reject frontend prices and manual paid bypass, then verify capture", async () => {
  const { paypal, state } = fixture();
  const server = createApp(
    db,
    owner,
    "http://127.0.0.1:5173",
    undefined,
    paypal,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/invoices/${invoice.id}`;
  const post = (path: string, body: unknown, method = "POST") =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post("/paypal/order", {
          confirmed: true,
          amount: 1,
          currency: "EUR",
        })
      ).status,
      400,
    );
    assert.equal(
      (await post("/paypal/order", { confirmed: true })).status,
      200,
    );
    assert.equal(
      (await post("/status", { status: "PAID", version: 2 }, "PATCH")).status,
      409,
    );
    state.status = "APPROVED";
    const paid = await post("/paypal/check", {
      orderId: "ORDER1",
      capture: true,
    });
    assert.equal(paid.status, 200);
    assert.equal((await paid.json()).status, "PAID");
    assert.equal(await db.payment.count(), 1);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});

test("captured amount mismatch is rejected even when order amount matches", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "COMPLETED";
  state.captures = [
    {
      id: "CAPTURE1",
      status: "COMPLETED",
      amount: { value: "1.00", currency_code: "USD" },
      final_capture: true,
    },
  ];
  await assert.rejects(
    paypal.check(invoice.id, owner, "ORDER1", false),
    (e) => e instanceof PaymentError && e.status === 409,
  );
  assert.equal(await db.payment.count(), 0);
});

test("foreign owners cannot check or capture an associated order", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "APPROVED";
  await assert.rejects(paypal.check(invoice.id, "foreign", "ORDER1", true),
    (error) => error instanceof PaymentError && error.status === 404);
  assert.equal(state.captureCalls, 0);
  assert.equal(await db.payment.count(), 0);
});

test("capture currency, precision, finality and count must verify before settlement", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  state.status = "COMPLETED";
  const valid = { id: "CAPTURE1", status: "COMPLETED", final_capture: true,
    amount: { value: "150.00", currency_code: "USD" } };
  for (const invalid of [
    { ...valid, amount: { value: "150.00", currency_code: "EUR" } },
    { ...valid, amount: { value: "150.001", currency_code: "USD" } },
    { ...valid, final_capture: false },
  ]) {
    state.captures = [invalid];
    await assert.rejects(paypal.check(invoice.id, owner, "ORDER1", true),
      (error) => error instanceof PaymentError && error.status === 409);
  }
  state.captures = [valid, { ...valid, id: "CAPTURE2" }];
  assert.deepEqual(await paypal.check(invoice.id, owner, "ORDER1", true), { status: "PENDING_VERIFICATION" });
  assert.equal(state.captureCalls, 0);
  assert.equal(await db.payment.count(), 0);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "ISSUED");
});

test("a database uniqueness failure rolls back settlement and subsequent GET recovers", async () => {
  const { paypal, state } = fixture();
  await paypal.start(invoice.id, owner);
  const other = await db.invoice.create({ data: {
    userId: owner, clientName: "Other", clientEmail: "other@example.test", description: "Other work",
    amountMinor: 15000, currency: "USD", dueDate: new Date("2026-12-01"),
  } });
  const conflict = await db.payment.create({ data: { invoiceId: other.id, reference: "CAPTURE1",
    amountMinor: 15000, currency: "USD", status: "FAILED" } });
  state.status = "APPROVED";
  await assert.rejects(paypal.check(invoice.id, owner, "ORDER1", true));
  assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), 0);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "ISSUED");
  await db.payment.delete({ where: { id: conflict.id } });
  assert.deepEqual(await paypal.check(invoice.id, owner, "ORDER1", true), { status: "PAID" });
  assert.equal(state.captureCalls, 1);
  assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), 1);
});

test('verified void with no captures permits a new order with new persisted keys', async () => {
  const {paypal,state}=fixture();await paypal.start(invoice.id,owner);
  const original=await db.checkout.findUniqueOrThrow({where:{invoiceId:invoice.id}});
  state.status='VOIDED';const next=await paypal.start(invoice.id,owner);
  assert.equal(next.orderId,'ORDER2');assert.equal(state.creates,2);
  const replaced=await db.checkout.findUniqueOrThrow({where:{invoiceId:invoice.id}});
  assert.notEqual(original.createKey,replaced.createKey);assert.notEqual(original.captureKey,replaced.captureKey);
  assert.equal(await db.payment.count(),0);
});
