import {
  invoiceDetailsSchema,
  invoiceSchema,
  type Invoice,
  type InvoicePage,
} from "../../shared/invoices";
import { api } from "./api";
import { totalMinor, type DemoInvoice, type Status } from "./demo";
import { publicDemo } from "./public-demo";
import { z } from "zod";

const demoStorageKey = "paypilot-public-demo-invoices-v1";
const demoInvoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  client: z.string(),
  email: z.string(),
  company: z.string(),
  color: z.string(),
  status: z.literal("draft"),
  issued: z.string(),
  due: z.string(),
  currency: z.enum(["USD", "EUR", "GBP", "INR"]),
  version: z.number().int().positive(),
  items: z.array(z.object({ description: z.string(), quantity: z.number(), rateMinor: z.number() })),
  notes: z.string(),
});

function loadBrowserInvoices(): DemoInvoice[] {
  const stored = window.localStorage.getItem(demoStorageKey);
  if (!stored) return [];
  const parsed = z.array(demoInvoiceSchema).safeParse(JSON.parse(stored));
  if (!parsed.success) throw new Error("Browser demo invoices could not be read.");
  return parsed.data;
}

export function toView(invoice: Invoice): DemoInvoice {
  const details = invoiceDetailsSchema.safeParse(invoice.details);
  const statuses: Record<Invoice["status"], Status> = {
    DRAFT: "draft",
    ISSUED: "sent",
    OVERDUE: "overdue",
    PAID: "paid",
    CANCELLED: "cancelled",
  };
  const due = invoice.dueDate.slice(0, 10);
  return {
    id: invoice.id,
    version: invoice.version,
    paypalInvoiceId: invoice.paypalInvoiceId,
    paypalInvoiceState: invoice.paypalInvoiceState,
    number: `INV-${invoice.id.slice(-8).toUpperCase()}`,
    client: invoice.clientName,
    email: invoice.clientEmail,
    company: details.success ? details.data.company : "",
    currency: invoice.currency as DemoInvoice["currency"],
    color: "purple",
    status: statuses[invoice.status],
    issued: invoice.createdAt.slice(0, 10),
    due,
    items: details.success
      ? details.data.items
      : [
          {
            description: invoice.description,
            quantity: 1,
            rateMinor: invoice.amountMinor,
          },
        ],
    notes: details.success ? details.data.notes : "",
  };
}
export async function loadInvoices(): Promise<DemoInvoice[]> {
  if (publicDemo) return loadBrowserInvoices();
  const result: DemoInvoice[] = [];
  let page = 1;
  let total = 0;
  do {
    const batch = await api<InvoicePage>(
      `/invoices?page=${page++}&pageSize=100`,
    );
    total = batch.total;
    result.push(...batch.items.map(toView));
    if (!batch.items.length) break;
  } while (result.length < total);
  return result;
}
export async function saveInvoice(invoice: DemoInvoice): Promise<DemoInvoice> {
  if (publicDemo) {
    const current = loadBrowserInvoices();
    const saved: DemoInvoice = {
      ...invoice,
      status: "draft",
      version: (current.find((item) => item.id === invoice.id)?.version ?? 0) + 1,
    };
    window.localStorage.setItem(
      demoStorageKey,
      JSON.stringify([saved, ...current.filter((item) => item.id !== saved.id)]),
    );
    return saved;
  }
  const input = invoiceSchema.parse({
    clientName: invoice.client,
    clientEmail: invoice.email,
    description: invoice.items.map((item) => item.description).join("\n"),
    currency: invoice.currency,
    dueDate: invoice.due,
    amountMinor: totalMinor(invoice),
    details: {
      company: invoice.company,
      notes: invoice.notes,
      items: invoice.items,
    },
  });
  const existing = invoice.version !== undefined;
  return toView(
    await api<Invoice>(existing ? `/invoices/${invoice.id}` : "/invoices", {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({
        ...input,
        ...(existing ? { version: invoice.version } : { confirmed: true,
          requestId: invoice.id.startsWith("session-") ? invoice.id.slice(8) : undefined }),
      }),
    }),
  );
}
