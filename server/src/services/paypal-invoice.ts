import type { Invoice, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { invoiceDetailsSchema, parseAmount } from "../../../shared/invoices.js";
import { PayPal, PaymentError } from "./paypal.js";

const providerId = z.string().regex(/^INV2-[A-Z0-9-]{8,40}$/);
const money = z.object({ currency_code: z.string(), value: z.string() });
const providerInvoice = z.object({
  id: providerId,
  status: z.string(),
  detail: z.object({ invoice_number: z.string(), currency_code: z.string(), reference: z.string(), metadata: z.object({ recipient_view_url: z.string().optional() }).optional() }),
  primary_recipients: z.array(z.object({ billing_info: z.object({ email_address: z.string() }) })).min(1),
  amount: money,
  due_amount: money.optional(),
  payments: z.object({ paid_amount: money.optional(), transactions: z.array(z.object({
    type: z.string(), payment_id: z.string().optional(), payment_date_time: z.string().optional(), payment_date: z.string().optional(), amount: money,
  })).optional() }).optional(),
});
type ProviderInvoice = z.infer<typeof providerInvoice>;

export class PayPalInvoiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class PayPalInvoiceService {
  constructor(private db: PrismaClient, private paypal: PayPal, private businessName?: string) {}
  get configured() { return this.paypal.invoicingConfigured && Boolean(this.businessName); }

  private number(invoiceId: string) { return `PP-${invoiceId.slice(-20).toUpperCase()}`; }
  private response(invoice: Invoice, state = invoice.paypalInvoiceState) {
    return {
      configured: this.configured, status: state ?? "NOT_SENT", paypalInvoiceId: invoice.paypalInvoiceId,
      sentAt: invoice.paypalInvoiceSentAt, lastError: invoice.paypalInvoiceLastError,
      paymentUrl: invoice.paypalInvoicePaymentUrl,
    };
  }
  async status(invoiceId: string, userId: string) {
    const invoice = await this.db.invoice.findFirst({ where: { id: invoiceId, userId } });
    if (!invoice) throw new PayPalInvoiceError(404, "Invoice not found.");
    return this.response(invoice);
  }
  private verify(remote: ProviderInvoice, invoice: Invoice) {
    const total = remote.amount;
    if (remote.id !== invoice.paypalInvoiceId || remote.detail.invoice_number !== invoice.paypalInvoiceNumber ||
        remote.detail.reference !== invoice.id ||
        remote.detail.currency_code !== invoice.currency || total.currency_code !== invoice.currency ||
        parseAmount(total.value) !== invoice.amountMinor ||
        remote.primary_recipients.length !== 1 ||
        remote.primary_recipients[0].billing_info.email_address.toLowerCase() !== invoice.clientEmail.toLowerCase())
      throw new PayPalInvoiceError(409, "PayPal invoice details do not match the saved invoice. Manual reconciliation is required.");
  }
  private async fetchRemote(invoice: Invoice) {
    const remote = providerInvoice.safeParse(await this.paypal.request(`/v2/invoicing/invoices/${encodeURIComponent(invoice.paypalInvoiceId!)}`));
    if (!remote.success) throw new PayPalInvoiceError(502, "PayPal returned an invalid invoice. No status change was made.");
    this.verify(remote.data, invoice);
    return remote.data;
  }
  private async recover(invoice: Invoice) {
    if (!invoice.paypalInvoiceNumber) return invoice;
    const result = z.object({ items: z.array(z.object({ id: providerId, detail: z.object({ invoice_number: z.string() }) })).default([]) })
      .safeParse(await this.paypal.request("/v2/invoicing/search-invoices?page=1&page_size=2", "POST", {
        invoice_number: invoice.paypalInvoiceNumber, recipient_email: invoice.clientEmail,
        reference: invoice.id, currency_code: invoice.currency,
      }));
    if (!result.success || result.data.items.length !== 1 || result.data.items[0].detail.invoice_number !== invoice.paypalInvoiceNumber)
      throw new PayPalInvoiceError(409, "PayPal draft creation is uncertain. Reconcile the invoice in PayPal before retrying.");
    const id = result.data.items[0].id;
    await this.db.invoice.updateMany({ where: { id: invoice.id, paypalInvoiceId: null, paypalInvoiceState: "CREATING" },
      data: { paypalInvoiceId: id, paypalInvoiceState: "DRAFT" } });
    return this.db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  }
  private async settle(invoice: Invoice, remote: ProviderInvoice) {
    if (remote.status !== "PAID") return false;
    const transactions = remote.payments?.transactions ?? [];
    const paypalPayments = transactions.filter((item) => item.type === "PAYPAL" && item.payment_id);
    const total = paypalPayments.reduce((sum, item) => sum + (parseAmount(item.amount.value) ?? 0), 0);
    if (!paypalPayments.length || total !== invoice.amountMinor ||
        paypalPayments.some((item) => !item.payment_date_time || Number.isNaN(Date.parse(item.payment_date_time))) ||
        paypalPayments.some((item) => item.amount.currency_code !== invoice.currency) ||
        remote.payments?.paid_amount?.currency_code !== invoice.currency ||
        parseAmount(remote.payments.paid_amount.value) !== invoice.amountMinor ||
        remote.due_amount?.currency_code !== invoice.currency || !/^0(?:\.0+)?$/.test(remote.due_amount.value))
      throw new PayPalInvoiceError(409, "PayPal payment details require manual reconciliation; invoice was not marked paid.");
    await this.db.$transaction(async (tx) => {
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      if (current.paypalInvoiceId !== remote.id || current.amountMinor !== invoice.amountMinor || current.currency !== invoice.currency)
        throw new PayPalInvoiceError(409, "Invoice changed during payment verification.");
      for (const item of paypalPayments) {
        const reference = item.payment_id!;
        const existing = await tx.payment.findUnique({ where: { reference } });
        if (existing && existing.invoiceId !== invoice.id) throw new PayPalInvoiceError(409, "Payment reference belongs to another invoice.");
        if (!existing) await tx.payment.create({ data: {
          invoiceId: invoice.id, reference, amountMinor: parseAmount(item.amount.value)!, currency: invoice.currency,
          status: "COMPLETED", method: "PAYPAL_INVOICE_SANDBOX", paidAt: new Date(item.payment_date_time!),
        } });
      }
      if (current.status !== "PAID") await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", version: { increment: 1 }, paypalInvoiceState: "PAID" } });
    });
    return true;
  }
  private async synchronize(invoice: Invoice, remote: ProviderInvoice) {
    if (await this.settle(invoice, remote)) return "PAID";
    if (["UNPAID", "SENT", "PAYMENT_PENDING", "PARTIALLY_PAID"].includes(remote.status)) {
      await this.db.invoice.updateMany({ where: { id: invoice.id, paypalInvoiceId: remote.id, status: { in: ["DRAFT", "ISSUED", "OVERDUE"] } }, data: {
        status: invoice.status === "OVERDUE" ? "OVERDUE" : "ISSUED", paypalInvoiceState: remote.status, paypalInvoiceSentAt: invoice.paypalInvoiceSentAt ?? new Date(),
        paypalInvoiceLastError: null, paypalInvoicePaymentUrl: this.paymentUrl(remote),
        version: invoice.status === "DRAFT" ? { increment: 1 } : undefined,
      } });
      return remote.status;
    }
    if (remote.status === "CANCELLED") {
      await this.db.invoice.updateMany({ where: { id: invoice.id, paypalInvoiceId: remote.id, status: { in: ["DRAFT", "ISSUED", "OVERDUE"] } }, data: { status: "CANCELLED", paypalInvoiceState: "CANCELLED", version: { increment: 1 } } });
    }
    return remote.status;
  }
  private paymentUrl(remote: ProviderInvoice) {
    const href = remote.detail.metadata?.recipient_view_url;
    if (!href) return null;
    try { const url = new URL(href); return url.protocol === "https:" && url.hostname === "www.sandbox.paypal.com" ? href : null; }
    catch { return null; }
  }
  async check(invoiceId: string, userId: string) {
    let invoice = await this.db.invoice.findFirst({ where: { id: invoiceId, userId } });
    if (!invoice) throw new PayPalInvoiceError(404, "Invoice not found.");
    if (!invoice.paypalInvoiceId && invoice.paypalInvoiceState === "CREATING") invoice = await this.recover(invoice);
    if (!invoice.paypalInvoiceId) return this.response(invoice);
    const remote = await this.fetchRemote(invoice);
    const status = await this.synchronize(invoice, remote);
    return { ...this.response(await this.db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }), status), paymentUrl: this.paymentUrl(remote) };
  }
  async reconcileProvider(providerInvoiceId: string) {
    const id = providerId.parse(providerInvoiceId);
    const invoice = await this.db.invoice.findUnique({ where: { paypalInvoiceId: id } });
    if (!invoice) return;
    await this.check(invoice.id, invoice.userId);
  }
  async send(invoiceId: string, userId: string, version: number) {
    if (!this.configured) throw new PayPalInvoiceError(503, "PayPal Invoicing requires Sandbox client ID, secret and PAYPAL_BUSINESS_NAME.");
    const invoice = await this.db.invoice.findFirst({ where: { id: invoiceId, userId }, include: { checkout: true, delivery: true } });
    if (!invoice) throw new PayPalInvoiceError(404, "Invoice not found.");
    if (invoice.status === "PAID" || invoice.status === "CANCELLED" || invoice.checkout || invoice.delivery)
      throw new PayPalInvoiceError(409, "This invoice cannot start a second payment or delivery flow.");
    if (!z.email().safeParse(invoice.clientEmail).success || invoice.amountMinor <= 0 || !["USD", "EUR", "GBP", "INR"].includes(invoice.currency))
      throw new PayPalInvoiceError(400, "Saved recipient, amount or currency is invalid.");
    if (!invoice.paypalInvoiceState && invoice.version !== version)
      throw new PayPalInvoiceError(409, "Invoice changed. Reload before sending.");
    const fresh = !invoice.paypalInvoiceState;
    if (fresh) {
      const reserved = await this.db.invoice.updateMany({ where: { id: invoiceId, userId, version, paypalInvoiceState: null }, data: {
        paypalInvoiceState: "CREATING", paypalInvoiceNumber: this.number(invoiceId), paypalInvoiceStartedAt: new Date(),
        paypalInvoiceBusyUntil: new Date(0), paypalInvoiceLastError: null,
      } });
      if (!reserved.count) throw new PayPalInvoiceError(409, "Invoice send is already in progress. Reload its status.");
    }
    const lease = new Date(Date.now() + 120000);
    const claimed = await this.db.invoice.updateMany({ where: { id: invoiceId, userId, paypalInvoiceBusyUntil: { lt: new Date() } }, data: { paypalInvoiceBusyUntil: lease } });
    if (!claimed.count) throw new PayPalInvoiceError(409, "Invoice send is in progress. Check again shortly.");
    try {
      let current = await this.db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!current.paypalInvoiceId) {
        if (!fresh) current = await this.recover(current);
      }
      if (!current.paypalInvoiceId) {
        const details = invoiceDetailsSchema.safeParse(current.details);
        const items = details.success ? details.data.items : [{ description: current.description, quantity: 1, rateMinor: current.amountMinor }];
        const created = await this.paypal.request("/v2/invoicing/invoices", "POST", {
          detail: { invoice_number: current.paypalInvoiceNumber, currency_code: current.currency,
            reference: current.id, payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: current.dueDate.toISOString().slice(0, 10) } },
          invoicer: { business_name: this.businessName },
          primary_recipients: [{ billing_info: { email_address: current.clientEmail, name: { full_name: current.clientName } } }],
          items: items.map((item) => ({ name: item.description.slice(0, 200), quantity: String(item.quantity),
            unit_amount: { currency_code: current.currency, value: (item.rateMinor / 100).toFixed(2) } })),
          configuration: { partial_payment: { allow_partial_payment: false }, allow_tip: false },
        });
        const response = z.union([z.object({ id: providerId }), z.object({ href: z.string() }), z.object({ links: z.array(z.object({ href: z.string() })).min(1) }), z.array(z.object({ href: z.string() }))]).safeParse(created);
        const rawId = response.success ? Array.isArray(response.data) ? response.data[0]?.href.split("/").pop() : "id" in response.data ? response.data.id : "links" in response.data ? response.data.links[0].href.split("/").pop() : response.data.href.split("/").pop() : null;
        const id = providerId.safeParse(rawId);
        if (!id.success) throw new PayPalInvoiceError(502, "PayPal draft response lacks a valid invoice ID. Reconcile it in PayPal before retrying.");
        await this.db.invoice.update({ where: { id: invoiceId }, data: { paypalInvoiceId: id.data, paypalInvoiceState: "DRAFT" } });
        current = await this.db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      }
      let remote = await this.fetchRemote(current);
      if (remote.status === "DRAFT") {
        await this.db.invoice.update({ where: { id: invoiceId }, data: { paypalInvoiceState: "SENDING" } });
        await this.paypal.request(`/v2/invoicing/invoices/${encodeURIComponent(current.paypalInvoiceId!)}/send`, "POST", { send_to_recipient: true, send_to_invoicer: false });
        remote = await this.fetchRemote(current);
      }
      const status = await this.synchronize(current, remote);
      if (["DRAFT", "SENDING", "SCHEDULED"].includes(status)) throw new PayPalInvoiceError(502, "PayPal has not confirmed the invoice was sent. Check its status before retrying.");
      return { ...this.response(await this.db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }), status), paymentUrl: this.paymentUrl(remote) };
    } catch (error) {
      const message = error instanceof PayPalInvoiceError || error instanceof PaymentError ? error.message : "PayPal invoice outcome is uncertain. Check PayPal before retrying.";
      await this.db.invoice.updateMany({ where: { id: invoiceId }, data: { paypalInvoiceLastError: message } });
      throw error;
    } finally {
      await this.db.invoice.updateMany({ where: { id: invoiceId, paypalInvoiceBusyUntil: lease }, data: { paypalInvoiceBusyUntil: new Date(0) } });
    }
  }
}
