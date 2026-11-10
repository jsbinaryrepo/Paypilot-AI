import assert from "node:assert/strict";
import test from "node:test";
import { invoiceEmailHref } from "../../client/src/invoice-email.js";
import type { DemoInvoice } from "../../client/src/demo.js";

test("invoice email draft addresses the customer and contains reviewed totals", () => {
  const invoice: DemoInvoice = {
    id: "demo-1",
    number: "INV-1",
    client: "Rahul",
    email: "rahul@example.test",
    company: "",
    color: "purple",
    status: "draft",
    issued: "2026-11-10",
    due: "2026-11-15",
    currency: "USD",
    items: [
      { description: "Landing page design & review", quantity: 2, rateMinor: 7500 },
    ],
    notes: "Thank you!",
  };
  const url = new URL(invoiceEmailHref(invoice));
  assert.equal(url.protocol, "mailto:");
  assert.equal(decodeURIComponent(url.pathname), invoice.email);
  assert.equal(url.searchParams.get("subject"), "Invoice INV-1");
  const body = url.searchParams.get("body") ?? "";
  assert.match(body, /Landing page design & review/);
  assert.match(body, /Total: \$150\.00 USD/);
  assert.match(body, /Due date: 2026-11-15/);
  assert.match(body, /Thank you!/);
});
