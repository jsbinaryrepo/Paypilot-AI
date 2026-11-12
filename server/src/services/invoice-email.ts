import { randomUUID } from "node:crypto";
import type { Invoice, PrismaClient } from "@prisma/client";
import { invoiceDetailsSchema, money } from "../../../shared/invoices.js";
import { emailRequest, emailResponseId, type EmailProvider } from "./email-provider.js";

const retryWindowMs = 23 * 60 * 60 * 1000; // Provider keys expire after 24 hours.
const brevoRetryWindowMs = 10 * 60 * 1000; // Conservative window; Brevo docs have cited a 15-minute TTL.
const leaseMs = 60 * 1000;

export class InvoiceEmailError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Options {
  provider?: EmailProvider;
  apiKey?: string;
  from?: string;
  fetch?: typeof fetch;
}

function messageFor(invoice: Invoice): { subject: string; body: string } {
  const details = invoiceDetailsSchema.safeParse(invoice.details);
  const items = details.success
    ? details.data.items.map(
        (item) =>
          `- ${item.description}: ${item.quantity} × ${money(item.rateMinor, invoice.currency)}`,
      )
    : [`- ${invoice.description}: ${money(invoice.amountMinor, invoice.currency)}`];
  return {
    subject: `Invoice INV-${invoice.id.slice(-8).toUpperCase()}`,
    body: [
      `Hello ${invoice.clientName},`,
      "",
      "Here are your invoice details:",
      ...items,
      `Total: ${money(invoice.amountMinor, invoice.currency)} ${invoice.currency}`,
      `Due date: ${invoice.dueDate.toISOString().slice(0, 10)}`,
      ...(details.success && details.data.notes ? ["", details.data.notes] : []),
      "",
      "Please reply to this email if you have any questions.",
    ].join("\n"),
  };
}

export class InvoiceEmail {
  readonly configured: boolean;
  private fetcher: typeof fetch;

  constructor(private db: PrismaClient, private options: Options) {
    this.configured = Boolean(options.apiKey && options.from);
    this.fetcher = options.fetch ?? fetch;
  }

  async status(invoiceId: string, userId: string) {
    const invoice = await this.db.invoice.findFirst({
      where: { id: invoiceId, userId },
      include: { delivery: true },
    });
    if (!invoice) throw new InvoiceEmailError(404, "Invoice not found.");
    return {
      configured: this.configured,
      status: invoice.delivery?.status ?? "NOT_SENT",
      recipient: invoice.delivery?.recipient ?? invoice.clientEmail,
      acceptedAt: invoice.delivery?.acceptedAt ?? null,
    };
  }

  async send(invoiceId: string, userId: string, version: number) {
    if (!this.configured)
      throw new InvoiceEmailError(
        503,
        "Invoice email is not configured. Set EMAIL_FROM and the selected provider API key on the server.",
      );
    const now = new Date();
    const delivery = await this.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, userId },
        include: { delivery: true, checkout: true },
      });
      if (!invoice) throw new InvoiceEmailError(404, "Invoice not found.");
      if (invoice.delivery?.status === "ACCEPTED") return invoice.delivery;
      if (invoice.checkout)
        throw new InvoiceEmailError(409, "Reconcile the existing checkout before emailing this invoice.");
      if (!["DRAFT", "ISSUED"].includes(invoice.status))
        throw new InvoiceEmailError(409, "This invoice cannot be emailed.");
      if (!invoice.delivery) {
        if (invoice.version !== version)
          throw new InvoiceEmailError(409, "Invoice changed. Reload before sending.");
        const { subject, body } = messageFor(invoice);
        return tx.invoiceDelivery.create({
          data: {
            invoiceId,
            idempotencyKey: randomUUID(),
            sender: this.options.from!,
            recipient: invoice.clientEmail,
            subject,
            body,
            startedAt: now,
            busyUntil: new Date(now.getTime() + leaseMs),
          },
        });
      }
      if (now.getTime() - invoice.delivery.startedAt.getTime() > (this.options.provider === "brevo" ? brevoRetryWindowMs : retryWindowMs))
        throw new InvoiceEmailError(
          409,
          "Email outcome is uncertain. Check the email provider before trying again.",
        );
      const lease = await tx.invoiceDelivery.updateMany({
        where: {
          id: invoice.delivery.id,
          status: "PENDING",
          busyUntil: { lte: now },
        },
        data: { busyUntil: new Date(now.getTime() + leaseMs) },
      });
      if (!lease.count)
        throw new InvoiceEmailError(409, "Email send is already in progress. Check again shortly.");
      return invoice.delivery;
    });
    if (delivery.status === "ACCEPTED") return this.status(invoiceId, userId);

    let providerId: string;
    try {
      const provider = this.options.provider ?? "resend";
      const request = emailRequest(provider, this.options.apiKey!, {
        from: delivery.sender, to: delivery.recipient, subject: delivery.subject,
        text: delivery.body, idempotencyKey: delivery.idempotencyKey,
      });
      const response = await this.fetcher(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok)
        throw new InvoiceEmailError(
          response.status === 429 ? 429 : 502,
          "Email provider rejected the request. Check its account, verified sender and quota before retrying.",
        );
      const parsed = emailResponseId(provider, await response.json());
      if (!parsed)
        throw new InvoiceEmailError(502, "Email provider returned an invalid response. Check provider logs before retrying.");
      providerId = parsed;
    } catch (error) {
      await this.db.invoiceDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: { busyUntil: new Date() },
      });
      if (error instanceof InvoiceEmailError) throw error;
      throw new InvoiceEmailError(502, "Email outcome is uncertain. Check the provider before retrying.");
    }

    await this.db.$transaction(async (tx) => {
      const current = await tx.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      if (current.status === "ACCEPTED") return;
      await tx.invoiceDelivery.update({
        where: { id: delivery.id },
        data: { status: "ACCEPTED", providerId, acceptedAt: new Date(), busyUntil: new Date() },
      });
      await tx.invoice.updateMany({
        where: { id: invoiceId, userId, status: "DRAFT" },
        data: { status: "ISSUED", version: { increment: 1 } },
      });
    });
    return this.status(invoiceId, userId);
  }
}
