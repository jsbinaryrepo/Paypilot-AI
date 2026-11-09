import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import {
  AiError,
  createInvoiceAi,
  googleJsonGenerator,
} from "./services/gemini-invoice.js";
import { toView } from "../../client/src/invoice-store.js";
import type { Invoice } from "../../shared/invoices.js";

const prompt =
  "Create an invoice for Rahul (rahul@example.test) for USD 150 for landing page design, due in 5 days.";
const partial = {
  customerName: "Rahul",
  customerEmail: null,
  amount: "150",
  currency: "USD",
  description: "Landing page design",
  dueDate: null,
  dueInDays: 5,
};
const now = () => new Date("2026-11-09T20:00:00Z"); // Nov 10 in India.
const service = (value: unknown) =>
  createInvoiceAi({ generate: async () => JSON.stringify(value), now });

test("partial extraction asks for missing email and calculates relative dates in the configured timezone", async () => {
  const result = await service(partial).extract(prompt);
  assert.equal(result.draft.customerName, "Rahul");
  assert.equal(result.draft.customerEmail, null);
  assert.equal(result.referenceDate, "2026-11-10");
  assert.equal(result.draft.dueDate, "2026-11-15");
  assert.deepEqual(
    result.clarifications.map((item) => item.field),
    ["customerEmail"],
  );
});

test("complete structured output is editable data and contains no creation instruction", async () => {
  const result = await service({
    ...partial,
    customerEmail: "rahul@example.test",
  }).extract(prompt);
  assert.equal(result.draft.amount, "150");
  assert.deepEqual(result.clarifications, []);
  assert.equal("confirmed" in result, false);
  assert.equal("invoiceId" in result, false);
});

test("invented customer names and email addresses are discarded and require clarification", async () => {
  const result = await service({
    ...partial,
    customerName: "Imaginary Customer",
    customerEmail: "invented@example.test",
  }).extract(prompt);
  assert.equal(result.draft.customerName, null);
  assert.equal(result.draft.customerEmail, null);
  assert.deepEqual(
    result.clarifications.map((item) => item.field),
    ["customerName", "customerEmail"],
  );
});

test("missing/ambiguous fields remain null rather than taking defaults", async () => {
  const result = await service({
    customerName: "Rahul",
    customerEmail: null,
    amount: null,
    currency: null,
    description: null,
    dueDate: null,
    dueInDays: null,
  }).extract("Invoice Rahul");
  assert.equal(result.clarifications.length, 5);
  assert.equal(result.draft.currency, null);
  assert.equal(result.draft.dueDate, null);
});

test("invalid JSON, unknown fields, invalid dates, negative and excessive precision amounts fail safely", async () => {
  const invalidJson = createInvoiceAi({ generate: async () => "not JSON" });
  await assert.rejects(
    invalidJson.extract(prompt),
    (error) => error instanceof AiError && error.status === 502,
  );
  for (const delta of [
    { status: "PAID" },
    { currency: "XYZ" },
    { customerEmail: "bad" },
    { dueDate: "2026-02-30" },
    { amount: "-2" },
    { amount: "1.001" },
  ]) {
    await assert.rejects(
      service({ ...partial, ...delta }).extract(prompt),
      (error) => error instanceof AiError && error.status === 502,
    );
  }
  const zero = await service({ ...partial, amount: "0" }).extract(prompt);
  assert.equal(zero.draft.amount, null);
});

test("conflicting dates require clarification and explicit dates are preserved", async () => {
  const conflict = await service({ ...partial, dueDate: "2026-11-20" }).extract(
    prompt,
  );
  assert.equal(conflict.draft.dueDate, null);
  const explicit = await service({
    ...partial,
    dueDate: "2026-11-20",
    dueInDays: null,
  }).extract(prompt);
  assert.equal(explicit.draft.dueDate, "2026-11-20");
});

test("missing credentials and invalid/oversized prompts never call a provider", async () => {
  const disabled = createInvoiceAi();
  assert.equal(disabled.configured, false);
  await assert.rejects(
    disabled.extract(prompt),
    (error) => error instanceof AiError && error.status === 503,
  );
  let calls = 0;
  const ai = createInvoiceAi({
    generate: async () => {
      calls++;
      return JSON.stringify(partial);
    },
  });
  await assert.rejects(ai.extract(""));
  await assert.rejects(ai.extract("x".repeat(2001)));
  assert.equal(calls, 0);
});

test("provider errors and timeouts are safe and do not echo secrets", async () => {
  for (const [status, expected] of [
    [403, 503],
    [404, 503],
    [429, 429],
    [500, 502],
  ]) {
    const ai = createInvoiceAi({
      generate: async () => {
        throw new ApiError({ status, message: "secret-key-and-prompt" });
      },
    });
    await assert.rejects(
      ai.extract(prompt),
      (error) =>
        error instanceof AiError &&
        error.status === expected &&
        !error.message.includes("secret"),
    );
  }
  const timeout = createInvoiceAi({
    generate: async () => {
      throw new DOMException("private details", "TimeoutError");
    },
  });
  await assert.rejects(
    timeout.extract(prompt),
    (error) => error instanceof AiError && error.status === 504,
  );
});

test("AI calls are bounded and concurrent requests cannot trigger duplicate provider calls", async () => {
  let release!: (value: string) => void;
  const waiting = createInvoiceAi({
    generate: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const first = waiting.extract(prompt);
  await assert.rejects(
    waiting.extract(prompt),
    (error) => error instanceof AiError && error.status === 429,
  );
  release(JSON.stringify(partial));
  await first;
  const bounded = service(partial);
  for (let i = 0; i < 6; i++) await bounded.extract(prompt);
  await assert.rejects(
    bounded.extract(prompt),
    (error) => error instanceof AiError && error.status === 429,
  );
});

test("official SDK sends structured JSON configuration through a fake transport (no network)", async () => {
  let body: Record<string, unknown> = {};
  let calls = 0;
  const generate = googleJsonGenerator(
    "test-key",
    "test-model",
    async (input, init) => {
      calls++;
      body = (await new Request(input, init).json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: [{ text: JSON.stringify(partial) }],
              },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );
  assert.deepEqual(JSON.parse(await generate("Extract only", prompt)), partial);
  assert.equal(calls, 1);
  const config = body.generationConfig as Record<string, unknown>;
  assert.equal(config.responseMimeType, "application/json");
  assert.ok(config.responseJsonSchema);
  assert.ok(body.systemInstruction);
});

test("database-to-existing-UI adapter preserves currency, line items, notes and draft version", () => {
  const invoice: Invoice = {
    id: "saved",
    version: 2,
    clientName: "Rahul",
    clientEmail: "rahul@example.test",
    description: "Design",
    amountMinor: 15000,
    currency: "INR",
    dueDate: "2026-11-30T00:00:00Z",
    status: "DRAFT",
    createdAt: "2026-11-09T00:00:00Z",
    updatedAt: "2026-11-09T00:00:00Z",
    details: {
      company: "Studio",
      notes: "Terms",
      items: [{ description: "Design", quantity: 2, rateMinor: 7500 }],
    },
  };
  const view = toView(invoice);
  assert.equal(view.currency, "INR");
  assert.equal(view.version, 2);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].quantity, 2);
  assert.equal(view.notes, "Terms");
});
