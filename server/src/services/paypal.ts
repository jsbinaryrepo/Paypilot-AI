import { randomUUID } from "node:crypto";
import type { PrismaClient, Invoice, Checkout } from "@prisma/client";
import { z } from "zod";
import { parseAmount } from "../../../shared/invoices.js";

const BASE = "https://api-m.sandbox.paypal.com";
const amount = z.object({ value: z.string(), currency_code: z.string() });
const capture = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount,
  final_capture: z.boolean().optional(),
});
const orderSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Z0-9]+$/)
    .max(64),
  status: z.string(),
  intent: z.literal("CAPTURE"),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string(),
        amount,
        payee: z.object({ merchant_id: z.string() }),
        payments: z
          .object({ captures: z.array(capture).optional() })
          .optional(),
      }),
    )
    .length(1),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
type Order = z.infer<typeof orderSchema>;
export class PaymentError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function readOrder(payload: unknown): Order {
  const result = orderSchema.safeParse(payload);
  if (!result.success)
    throw new PaymentError(
      502,
      "PayPal returned an invalid order response. Check the existing payment again; no payment success is assumed.",
    );
  return result.data;
}
interface Options {
  clientId?: string;
  secret?: string;
  merchantId?: string;
  origin: string;
  webhookId?: string;
  fetch?: typeof fetch;
}
export class PayPal {
  readonly configured: boolean;
  private token = "";
  private expires = 0;
  private fetcher: typeof fetch;
  constructor(
    private db: PrismaClient,
    private options: Options,
  ) {
    this.configured = Boolean(
      options.clientId && options.secret && options.merchantId,
    );
    this.fetcher = options.fetch ?? fetch;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    if (!this.configured)
      throw new PaymentError(
        503,
        "PayPal Sandbox is not configured. Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MERCHANT_ID on the server.",
      );
    try {
      if (Date.now() >= this.expires) {
        const response = await this.fetcher(`${BASE}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.secret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!response.ok)
          throw new PaymentError(
            503,
            "PayPal authentication failed. Check Sandbox credentials.",
          );
        const token = z
          .object({
            access_token: z.string().min(1),
            expires_in: z.number().positive(),
          })
          .parse(await response.json());
        this.token = token.access_token;
        this.expires = Date.now() + Math.max(0, token.expires_in - 60) * 1000;
      }
      const response = await this.fetcher(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...(key
            ? { "PayPal-Request-Id": key, Prefer: "return=representation" }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!response.ok) {
        if (response.status === 401) this.expires = 0;
        throw new PaymentError(
          502,
          "PayPal could not complete this request. Use Check payment / Retry to reconcile the existing order; do not start a separate payment.",
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError(
        502,
        "PayPal response is unavailable or uncertain. No payment success is assumed. Check payment again to reconcile.",
      );
    }
  }
  private verify(order: Order, invoice: Invoice, orderId: string) {
    const unit = order.purchase_units[0];
    if (
      order.id !== orderId ||
      unit.custom_id !== invoice.id ||
      unit.payee.merchant_id !== this.options.merchantId ||
      unit.amount.currency_code !== invoice.currency ||
      parseAmount(unit.amount.value) !== invoice.amountMinor
    )
      throw new PaymentError(
        409,
        "PayPal order verification failed. Do not retry payment; contact the workspace owner.",
      );
    return unit;
  }
  private async settle(order: Order, invoice: Invoice, orderId: string) {
    const unit = this.verify(order, invoice, orderId);
    const captures = unit.payments?.captures ?? [];
    if (
      order.status !== "COMPLETED" ||
      captures.length !== 1 ||
      captures[0].status !== "COMPLETED"
    )
      return false;
    const paid = captures[0];
    if (
      paid.final_capture !== true ||
      paid.amount.currency_code !== invoice.currency ||
      parseAmount(paid.amount.value) !== invoice.amountMinor
    )
      throw new PaymentError(
        409,
        "Captured amount or currency failed verification. Contact the workspace owner.",
      );
    await this.db.$transaction(async (tx) => {
      const current = await tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      if (
        current.amountMinor !== invoice.amountMinor ||
        current.currency !== invoice.currency ||
        !["ISSUED", "PAID"].includes(current.status)
      )
        throw new PaymentError(
          409,
          "Invoice changed during payment. Manual reconciliation required.",
        );
      const existing = await tx.payment.findUnique({
        where: { paypalInvoiceId: invoice.id },
      });
      if (existing && existing.reference !== paid.id)
        throw new PaymentError(
          409,
          "A different capture is already recorded. Manual reconciliation required.",
        );
      if (!existing)
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            paypalInvoiceId: invoice.id,
            reference: paid.id,
            amountMinor: invoice.amountMinor,
            currency: invoice.currency,
            status: "COMPLETED",
            method: "PAYPAL_SANDBOX",
            paidAt: new Date(),
          },
        });
      if (current.status !== "PAID")
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: "PAID", version: { increment: 1 } },
        });
    });
    return true;
  }
  private async locked<T>(
    invoiceId: string,
    userId: string,
    action: (invoice: Invoice, checkout: Checkout) => Promise<T>,
  ): Promise<T> {
    const invoice = await this.db.invoice.findFirst({
      where: { id: invoiceId, userId },
    });
    if (!invoice) throw new PaymentError(404, "Invoice not found.");
    if (!this.configured) await this.request("/");
    const checkout = await this.db.$transaction(async (tx) => {
      const current = await tx.invoice.findFirstOrThrow({
        where: { id: invoiceId, userId },
      });
      if (current.status === "CANCELLED")
        throw new PaymentError(409, "Cancelled invoices cannot be paid.");
      if (current.status === "DRAFT")
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: "ISSUED", version: { increment: 1 } },
        });
      return tx.checkout.upsert({
        where: { invoiceId },
        update: {},
        create: {
          invoiceId,
          createKey: randomUUID(),
          captureKey: randomUUID(),
          busyUntil: new Date(0),
        },
      });
    });
    const lease = new Date(Date.now() + 120000);
    const claimed = await this.db.checkout.updateMany({
      where: { id: checkout.id, busyUntil: { lt: new Date() } },
      data: { busyUntil: lease },
    });
    if (!claimed.count)
      throw new PaymentError(409, "Payment is being checked. Wait and retry.");
    try {
      return await action(
        await this.db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
        // Another request may have replaced a voided order before this lease was acquired.
        await this.db.checkout.findUniqueOrThrow({ where: { id: checkout.id } }),
      );
    } finally {
      await this.db.checkout.updateMany({
        where: { id: checkout.id, busyUntil: lease },
        data: { busyUntil: new Date(0) },
      });
    }
  }
  async start(invoiceId: string, userId: string) {
    return this.locked(invoiceId, userId, async (invoice, checkout) => {
      if (invoice.status === "PAID")
        throw new PaymentError(409, "Invoice is already paid.");
      if (checkout.orderId) {
        const order = readOrder(
          await this.request(`/v2/checkout/orders/${checkout.orderId}`),
        );
        this.verify(order, invoice, checkout.orderId);
        if (await this.settle(order, invoice, checkout.orderId))
          return { orderId: order.id, status: "COMPLETED" };
        if (order.status !== "VOIDED") return this.checkoutResult(order);
        // Only a provider-confirmed void with no captures permits replacement.
        if (order.purchase_units[0].payments?.captures?.length)
          throw new PaymentError(409, "Order requires manual reconciliation.");
        checkout = await this.db.checkout.update({
          where: { id: checkout.id },
          data: {
            orderId: null,
            createKey: randomUUID(),
            captureKey: randomUUID(),
            createdAt: new Date(),
          },
        });
      }
      // PayPal's default POST idempotency retention is six hours. Never recreate an uncertain old order.
      if (Date.now() - checkout.createdAt.getTime() > 5 * 3600000)
        throw new PaymentError(
          409,
          "Order creation outcome needs manual reconciliation before another payment can be started.",
        );
      const returnUrl = `${this.options.origin}/?invoice=${invoice.id}`;
      const order = readOrder(
        await this.request(
          "/v2/checkout/orders",
          "POST",
          {
            intent: "CAPTURE",
            purchase_units: [
              {
                custom_id: invoice.id,
                amount: {
                  currency_code: invoice.currency,
                  value: (invoice.amountMinor / 100).toFixed(2),
                },
                payee: { merchant_id: this.options.merchantId },
              },
            ],
            payment_source: {
              paypal: {
                experience_context: {
                  user_action: "PAY_NOW",
                  shipping_preference: "NO_SHIPPING",
                  return_url: `${returnUrl}#/payment/success`,
                  cancel_url: `${returnUrl}#/payment/cancel`,
                },
              },
            },
          },
          checkout.createKey,
        ),
      );
      this.verify(order, invoice, order.id);
      await this.db.checkout.update({
        where: { id: checkout.id },
        data: { orderId: order.id },
      });
      return this.checkoutResult(order);
    });
  }
  private checkoutResult(order: Order) {
    const approvalUrl = order.links?.find((link) =>
      ["payer-action", "approve"].includes(link.rel),
    )?.href;
    if (approvalUrl) {
      const url = new URL(approvalUrl);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.sandbox.paypal.com"
      )
        throw new PaymentError(502, "PayPal approval URL failed validation.");
    }
    return { orderId: order.id, status: order.status, approvalUrl };
  }
  async check(
    invoiceId: string,
    userId: string,
    orderId: string,
    shouldCapture: boolean,
  ) {
    const association = await this.db.checkout.findFirst({
      where: { invoiceId, orderId, invoice: { userId } },
    });
    if (!association)
      throw new PaymentError(404, "Order does not belong to this invoice.");
    return this.locked(invoiceId, userId, async (invoice, checkout) => {
      if (checkout.orderId !== orderId)
        throw new PaymentError(404, "Order does not belong to this invoice.");
      let order = readOrder(
        await this.request(
          `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        ),
      );
      this.verify(order, invoice, orderId);
      if (await this.settle(order, invoice, orderId)) return { status: "PAID" };
      if (
        shouldCapture &&
        order.status === "APPROVED" &&
        !order.purchase_units[0].payments?.captures?.length
      ) {
        if (Date.now() - checkout.createdAt.getTime() > 5 * 3600000)
          throw new PaymentError(
            409,
            "This approval requires manual reconciliation. Capture retry window has elapsed.",
          );
        // Persisted key, same order, no automatic retry. A subsequent check always GETs first.
        await this.request(
          `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
          "POST",
          {},
          checkout.captureKey,
        );
        order = readOrder(
          await this.request(
            `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
          ),
        );
        if (await this.settle(order, invoice, orderId))
          return { status: "PAID" };
      }
      return {
        status:
          order.status === "COMPLETED" ? "PENDING_VERIFICATION" : order.status,
      };
    });
  }
  async webhook(
    headers: Record<string, string | string[] | undefined>,
    event: unknown,
  ) {
    if (!this.options.webhookId)
      throw new PaymentError(503, "PayPal webhook ID is not configured.");
    const header = (name: string) =>
      z.string().min(1).max(4000).parse(headers[name]);
    const payload = z
      .object({
        id: z.string(),
        event_type: z.string(),
        resource: z
          .object({
            supplementary_data: z
              .object({
                related_ids: z.object({
                  order_id: z.string().regex(/^[A-Z0-9]+$/),
                }),
              })
              .optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(event);
    const result = z.object({ verification_status: z.string() }).parse(
      await this.request("/v1/notifications/verify-webhook-signature", "POST", {
        auth_algo: header("paypal-auth-algo"),
        cert_url: header("paypal-cert-url"),
        transmission_id: header("paypal-transmission-id"),
        transmission_sig: header("paypal-transmission-sig"),
        transmission_time: header("paypal-transmission-time"),
        webhook_id: this.options.webhookId,
        webhook_event: event, // Verify the original event, not Zod's projected copy.
      }),
    );
    if (result.verification_status !== "SUCCESS")
      throw new PaymentError(403, "Webhook signature verification failed.");
    if (payload.event_type !== "PAYMENT.CAPTURE.COMPLETED") return;
    const orderId = payload.resource.supplementary_data?.related_ids.order_id;
    if (!orderId)
      throw new PaymentError(400, "Capture webhook lacks an order ID.");
    const checkout = await this.db.checkout.findUnique({
      where: { orderId },
      include: { invoice: true },
    });
    if (!checkout) return;
    // Never trust webhook amount/status: retrieve and verify the associated order again.
    await this.check(
      checkout.invoiceId,
      checkout.invoice.userId,
      orderId,
      false,
    );
  }
}
