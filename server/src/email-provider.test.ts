import assert from "node:assert/strict";
import test from "node:test";
import { emailRequest, emailResponseId } from "./services/email-provider.js";

test("Brevo request keeps the key in server headers and parses acceptance", () => {
  const request = emailRequest("brevo", "private-key", {
    from: "sender@example.test", to: "client@example.test", subject: "Invoice",
    text: "Invoice details", idempotencyKey: "ee09190e-f279-4e16-a50c-e2ea11d7cafb",
  });
  assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(request.headers["api-key"], "private-key");
  assert.equal(request.body.includes("private-key"), false);
  assert.deepEqual(JSON.parse(request.body), {
    sender: { email: "sender@example.test" }, to: [{ email: "client@example.test" }],
    subject: "Invoice", textContent: "Invoice details",
    headers: { IdempotencyKey: "ee09190e-f279-4e16-a50c-e2ea11d7cafb" },
  });
  assert.equal(emailResponseId("brevo", { messageId: "message-123" }), "message-123");
  assert.equal(emailResponseId("brevo", { id: "wrong-provider" }), null);
});

test("Resend remains the default request format", () => {
  const request = emailRequest("resend", "private-key", {
    from: "sender@example.test", to: "client@example.test", subject: "Invoice", text: "Details",
  });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.headers.Authorization, "Bearer private-key");
  assert.equal(emailResponseId("resend", { id: "email-123" }), "email-123");
});
