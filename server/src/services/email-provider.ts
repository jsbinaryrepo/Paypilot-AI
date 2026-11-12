import { z } from "zod";

export type EmailProvider = "resend" | "brevo";

export function emailRequest(
  provider: EmailProvider,
  apiKey: string,
  message: { from: string; to: string; subject: string; text: string; idempotencyKey?: string },
): { url: string; headers: Record<string, string>; body: string } {
  if (provider === "brevo")
    return {
      url: "https://api.brevo.com/v3/smtp/email",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { email: message.from },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.idempotencyKey ? { headers: { IdempotencyKey: message.idempotencyKey } } : {}),
      }),
    };
  return {
    url: "https://api.resend.com/emails",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text }),
  };
}

export function emailResponseId(provider: EmailProvider, value: unknown) {
  if (provider === "brevo") {
    const parsed = z.object({ messageId: z.string().min(1).max(256) }).safeParse(value);
    return parsed.success ? parsed.data.messageId : null;
  }
  const parsed = z.object({ id: z.string().min(1).max(128) }).safeParse(value);
  return parsed.success ? parsed.data.id : null;
}
