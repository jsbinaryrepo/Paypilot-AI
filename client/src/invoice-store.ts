import {
  invoiceDetailsSchema,
  invoiceSchema,
  type Invoice,
  type InvoicePage,
} from "../../shared/invoices";
import { api } from "./api";
import { totalMinor, type DemoInvoice, type Status } from "./demo";

export function toView(invoice: Invoice): DemoInvoice {
  const details = invoiceDetailsSchema.safeParse(invoice.details);
  const statuses: Record<Invoice["status"], Status> = {
    DRAFT: "draft",
    ISSUED: "sent",
    PAID: "paid",
    CANCELLED: "cancelled",
  };
  const due = invoice.dueDate.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: invoice.id,
    version: invoice.version,
    number: `INV-${invoice.id.slice(-8).toUpperCase()}`,
    client: invoice.clientName,
    email: invoice.clientEmail,
    company: details.success ? details.data.company : "",
    currency: invoice.currency as DemoInvoice["currency"],
    color: "purple",
    status:
      invoice.status === "ISSUED" && due < today
        ? "overdue"
        : statuses[invoice.status],
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
        ...(existing ? { version: invoice.version } : { confirmed: true }),
      }),
    }),
  );
}
