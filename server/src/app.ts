import express, { type ErrorRequestHandler } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { extractionRequestSchema } from "../../shared/ai-invoice.js";
import { PayPal, PaymentError } from "./services/paypal.js";
import { InvoiceEmail, InvoiceEmailError } from "./services/invoice-email.js";
import type { EmailProvider } from "./services/email-provider.js";
import { accountRoutes, AccountError, sessionUser } from "./accounts.js";
import { guestSession } from "./guest.js";
import { PayPalInvoiceService, PayPalInvoiceError } from "./services/paypal-invoice.js";
import { daysOverdue, refreshOverdue } from "./overdue.js";
import {
  AiError,
  createInvoiceAi,
  type InvoiceAi,
} from "./services/gemini-invoice.js";
import {
  createInvoiceSchema,
  editInvoiceSchema,
  listSchema,
  statusSchema,
  transitions,
  type Dashboard,
} from "../../shared/invoices.js";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApp(
  db: PrismaClient,
  userId: string,
  clientOrigin = "http://127.0.0.1:5173",
  ai: InvoiceAi = createInvoiceAi(),
  paypal: PayPal = new PayPal(db, { origin: clientOrigin }),
  guestAccess = false,
  email: InvoiceEmail = new InvoiceEmail(db, {}),
  accounts?: { origin: string; apiKey: string; from: string; provider?: EmailProvider; sendVerification?: (apiKey: string, from: string, origin: string, recipient: string, token: string) => Promise<void> },
  invoicing: PayPalInvoiceService = new PayPalInvoiceService(db, paypal),
) {
  const app = express();
  app.disable("x-powered-by");
  // Restrict host, origin and content type before account routes or data access.
  app.use((req, res, next) => {
    const host = req.hostname;
    if (!["localhost", "127.0.0.1", new URL(clientOrigin).hostname].includes(host))
      return next(new HttpError(403, "Local access only."));
    if (
      req.headers.origin &&
      ![
        clientOrigin,
        "http://127.0.0.1:3001",
        "http://localhost:3001",
      ].includes(req.headers.origin)
    ) {
      return next(new HttpError(403, "Origin not allowed."));
    }
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
      !req.is("application/json")
    ) {
      return next(new HttpError(415, "Use application/json."));
    }
    if ((accounts || guestAccess) && ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
        req.path !== "/api/paypal/webhook" && req.headers.origin !== clientOrigin)
      return next(new HttpError(403, "Origin required."));
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  if (accounts) {
    app.use("/api/auth", accountRoutes(db, accounts));
    app.use("/api", async (req, res, next) => {
      if (req.path === "/health" || req.path === "/paypal/webhook") return next();
      const user = await sessionUser(db, req);
      if (user) res.locals.accountUserId = user.id;
      else if (!guestAccess) return next(new HttpError(401, "Sign in to continue."));
      next();
    });
  }
  if (guestAccess) app.use("/api", guestSession(db, clientOrigin.startsWith("https://")));
  const isAccount = (res: express.Response) => Boolean(res.locals.accountUserId);
  const identity = (res: express.Response) => res.locals.accountUserId as string | undefined
    ?? res.locals.visitorUserId as string | undefined ?? userId;
  const idSchema = z.string().cuid();
  app.get("/api/paypal/status", (_req, res) =>
    res.json({ configured: paypal.configured, environment: "sandbox" }),
  );
  app.get("/api/invoices/:id/paypal-invoice", async (req, res) => {
    const result = await invoicing.status(idSchema.parse(req.params.id), identity(res));
    res.json(isAccount(res) ? { ...result, configured: false } : result);
  });
  app.post("/api/invoices/:id/paypal-invoice/send", async (req, res) => {
    if (isAccount(res)) throw new PayPalInvoiceError(503, "A shared PayPal merchant account cannot send invoices for individual visitor accounts.");
    const { confirmed, version } = z.object({ confirmed: z.literal(true), version: z.number().int().positive() }).strict().parse(req.body);
    void confirmed;
    res.json(await invoicing.send(idSchema.parse(req.params.id), identity(res), version));
  });
  app.post("/api/invoices/:id/paypal-invoice/check", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(await invoicing.check(idSchema.parse(req.params.id), identity(res)));
  });
  app.post("/api/invoices/:id/paypal/order", async (req, res) => {
    if (isAccount(res)) throw new PaymentError(503, "Individual accounts need their own PayPal merchant connection before checkout is available.");
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(await paypal.start(idSchema.parse(req.params.id), identity(res)));
  });
  app.post("/api/invoices/:id/paypal/check", async (req, res) => {
    const body = z
      .object({
        orderId: z
          .string()
          .regex(/^[A-Z0-9]+$/)
          .max(64),
        capture: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    res.json(
      await paypal.check(
        idSchema.parse(req.params.id),
        identity(res),
        body.orderId,
        body.capture,
      ),
    );
  });
  app.post("/api/paypal/webhook", async (req, res) => {
    const event = await paypal.webhook(req.headers, req.body);
    if (event?.invoicingId) await invoicing.reconcileProvider(event.invoicingId);
    res.json({ received: true });
  });

  app.get("/api/ai/status", (_req, res) =>
    res.json({ configured: ai.configured }),
  );
  app.post("/api/ai/invoice-draft", async (req, res) => {
    const { prompt } = extractionRequestSchema.parse(req.body);
    // Extraction has no database write path. Creation uses the reviewed invoice API.
    res.json(await ai.extract(prompt));
  });

  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected", mode: "local" });
  });
  app.get("/api/invoices/:id/email", async (req, res) => {
    res.json(await email.status(idSchema.parse(req.params.id), identity(res)));
  });
  app.post("/api/invoices/:id/email/send", async (req, res) => {
    if (accounts && !isAccount(res)) throw new HttpError(403, "Sign in to send invoice email.");
    const { confirmed, version } = z.object({
      confirmed: z.literal(true),
      version: z.number().int().positive(),
    }).strict().parse(req.body);
    void confirmed;
    res.json(await email.send(idSchema.parse(req.params.id), identity(res), version));
  });
  app.post("/api/invoices", async (req, res) => {
    const { confirmed: _confirmed, requestId, ...input } = createInvoiceSchema.parse(
      req.body,
    );
    void _confirmed; // Validated confirmation is not a database column.
    const accountInvoice = isAccount(res);
    if (accountInvoice && !requestId)
      throw new HttpError(400, "A stable invoice request ID is required for automatic sending.");
    const userId = identity(res);
    const data = { ...input, dueDate: new Date(`${input.dueDate}T00:00:00.000Z`), userId,
      clientRequestId: accountInvoice ? requestId : undefined };
    const invoice = accountInvoice && requestId
      ? await db.invoice.upsert({ where: { userId_clientRequestId: { userId, clientRequestId: requestId } }, create: data, update: {} })
      : await db.invoice.create({ data });
    if (invoice.clientName !== input.clientName || invoice.clientEmail !== input.clientEmail ||
        invoice.description !== input.description || invoice.amountMinor !== input.amountMinor ||
        invoice.currency !== input.currency || invoice.dueDate.getTime() !== data.dueDate.getTime() ||
        JSON.stringify(invoice.details) !== JSON.stringify(input.details ?? null))
      throw new HttpError(409, "This invoice request ID belongs to different details. Review and create a new invoice.");
    if (accountInvoice) {
      try {
        await email.send(invoice.id, userId, invoice.version);
      } catch (error) {
        const message = error instanceof InvoiceEmailError ? error.message : "Email outcome is uncertain. Check the provider before retrying.";
        throw new HttpError(502, `Invoice saved, but the email was not accepted: ${message} Retry this confirmation or open the saved invoice.`);
      }
      return res.status(201).json(await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } }));
    }
    res.status(201).json(invoice);
  });
  app.get("/api/invoices", async (req, res) => {
    await refreshOverdue(db, identity(res));
    const { status, page, pageSize } = listSchema.parse(req.query);
    const where = { userId: identity(res), ...(status ? { status } : {}) };
    const [items, total] = await db.$transaction([
      db.invoice.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.invoice.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  });
  app.get("/api/invoices/:id", async (req, res) => {
    await refreshOverdue(db, identity(res));
    const id = idSchema.parse(req.params.id);
    const invoice = await db.invoice.findFirst({
      where: { id, userId: identity(res) },
      include: { payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!invoice) throw new HttpError(404, "Invoice not found.");
    res.json({ ...invoice, overdueDays: invoice.status === "OVERDUE" ? daysOverdue(invoice.dueDate) : 0 });
  });
  app.patch("/api/invoices/:id", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { version, ...input } = editInvoiceSchema.parse(req.body);
    const invoice = await db.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({ where: { id, userId: identity(res) } });
      if (!existing) throw new HttpError(404, "Invoice not found.");
      if (existing.status !== "DRAFT")
        throw new HttpError(409, "Only draft invoices can be edited.");
      if (await tx.invoiceDelivery.findUnique({ where: { invoiceId: id } }))
        throw new HttpError(409, "Invoice has an email send in progress. Check its status before editing.");
      if (existing.paypalInvoiceState)
        throw new HttpError(409, "Invoice is associated with a PayPal invoice and cannot be edited.");
      const updated = await tx.invoice.updateMany({
        where: { id, userId: identity(res), status: "DRAFT", version },
        data: {
          ...input,
          dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
          version: { increment: 1 },
        },
      });
      if (!updated.count)
        throw new HttpError(409, "Invoice changed. Reload before editing.");
      return tx.invoice.findUniqueOrThrow({ where: { id } });
    });
    res.json(invoice);
  });
  app.patch("/api/invoices/:id/status", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status, version } = statusSchema.parse(req.body);
    const invoice = await db.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({ where: { id, userId: identity(res) } });
      if (!existing) throw new HttpError(404, "Invoice not found.");
      if (await tx.checkout.findUnique({ where: { invoiceId: id } }))
        throw new HttpError(
          409,
          "Invoice is locked by a PayPal checkout. Reconcile the payment before changing it.",
        );
      if (existing.paypalInvoiceState)
        throw new HttpError(409, "Check the PayPal invoice before changing its status.");
      if ((await tx.invoiceDelivery.findUnique({ where: { invoiceId: id } }))?.status === "PENDING")
        throw new HttpError(409, "Invoice email outcome is pending. Check it before changing the invoice.");
      if (!transitions[existing.status].includes(status))
        throw new HttpError(409, "This status transition is not allowed.");
      const result = await tx.invoice.updateMany({
        where: { id, userId: identity(res), status: existing.status, version },
        data: { status, version: { increment: 1 } },
      });
      if (!result.count)
        throw new HttpError(
          409,
          "Invoice changed. Reload before updating its status.",
        );
      if (status === "PAID") {
        await tx.payment.create({
          data: {
            invoiceId: id,
            amountMinor: existing.amountMinor,
            currency: existing.currency,
            status: "COMPLETED",
            method: "MANUAL",
            paidAt: new Date(),
          },
        });
      }
      return tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { payments: true },
      });
    });
    res.json(invoice);
  });
  app.get("/api/dashboard", async (_req, res) => {
    await refreshOverdue(db, identity(res));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const grouped = db.invoice.groupBy({
      by: ["status", "currency"],
      orderBy: { currency: "asc" },
      where: { userId: identity(res) },
      _count: { _all: true },
      _sum: { amountMinor: true },
    });
    const [groups, overdue] = await db.$transaction([
      grouped,
      db.invoice.count({
      where: { userId: identity(res), status: "OVERDUE" },
      }),
    ]);
    const dashboard: Dashboard = {
      total: 0,
      byStatus: { DRAFT: 0, ISSUED: 0, OVERDUE: 0, PAID: 0, CANCELLED: 0 },
      overdue,
      totals: [],
    };
    const totals = new Map<string, Dashboard["totals"][number]>();
    for (const group of groups) {
      dashboard.total += group._count._all;
      dashboard.byStatus[group.status] += group._count._all;
      const row = totals.get(group.currency) ?? {
        currency: group.currency,
        invoicedMinor: 0,
        outstandingMinor: 0,
        paidMinor: 0,
      };
      const amount = group._sum.amountMinor ?? 0;
      if (group.status === "ISSUED" || group.status === "OVERDUE" || group.status === "PAID")
        row.invoicedMinor += amount;
      if (group.status === "ISSUED" || group.status === "OVERDUE") row.outstandingMinor += amount;
      if (group.status === "PAID") row.paidMinor += amount;
      totals.set(group.currency, row);
    }
    dashboard.totals = [...totals.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    );
    res.json(dashboard);
  });
  app.use("/api", (_req, _res, next) =>
    next(new HttpError(404, "API route not found.")),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid request.",
        issues: error.issues.map(({ path, message }) => ({
          path: path.join("."),
          message,
        })),
      });
    } else if (
      error instanceof AiError ||
      error instanceof HttpError ||
      error instanceof InvoiceEmailError ||
      error instanceof PayPalInvoiceError ||
      error instanceof AccountError ||
      error instanceof PaymentError
    ) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Invalid JSON." });
    } else if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      res.status(413).json({ error: "Request body too large." });
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P1008", "P2002", "P2028", "P2034"].includes(error.code)
    ) {
      res.status(409).json({ error: "Database busy. Reload and retry." });
    } else {
      console.error(
        "API request failed:",
        error instanceof Error ? error.name : "UnknownError",
      );
      res.status(500).json({ error: "Unable to complete request. Try again." });
    }
  };
  app.use(errors);
  return app;
}
