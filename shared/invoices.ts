import { z } from "zod";

// Explicit initial support: each currency uses two decimal places.
export const currencies = ["USD", "EUR", "GBP", "INR"] as const;
export const statuses = ["DRAFT", "ISSUED", "PAID", "CANCELLED"] as const;
export const transitions: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["PAID", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};
export const invoiceDetailsSchema = z
  .object({
    company: z.string().trim().max(120),
    notes: z.string().max(2000),
    items: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(500),
            quantity: z.number().int().min(1).max(10000),
            rateMinor: z.number().int().positive().max(2_000_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const invoiceSchema = z
  .object({
    clientName: z.string().trim().min(1).max(120),
    clientEmail: z.email().max(254),
    description: z.string().trim().min(1).max(2000),
    amountMinor: z.number().int().positive().max(2_000_000_000),
    currency: z.enum(currencies),
    dueDate: z.iso.date(),
    details: invoiceDetailsSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.details ||
      value.details.items.reduce(
        (sum, item) => sum + item.quantity * item.rateMinor,
        0,
      ) === value.amountMinor,
    {
      message: "Line items must equal the invoice total.",
      path: ["amountMinor"],
    },
  );
export const editInvoiceSchema = invoiceSchema.safeExtend({
  version: z.number().int().positive(),
});
export const createInvoiceSchema = invoiceSchema.safeExtend({
  confirmed: z.literal(true),
});
export const statusSchema = z
  .object({
    status: z.enum(statuses),
    version: z.number().int().positive(),
  })
  .strict();
export const listSchema = z
  .object({
    status: z.enum(statuses).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type InvoiceStatus = (typeof statuses)[number];
export interface Payment {
  id: string;
  amountMinor: number;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  method: string;
  paidAt: string | null;
}
export interface Invoice extends Omit<InvoiceInput, "currency" | "details"> {
  id: string;
  currency: string;
  status: InvoiceStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  payments?: Payment[];
  details?: z.infer<typeof invoiceDetailsSchema> | null;
}
export interface InvoicePage {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Dashboard {
  total: number;
  byStatus: Record<InvoiceStatus, number>;
  overdue: number;
  totals: {
    currency: string;
    invoicedMinor: number;
    outstandingMinor: number;
    paidMinor: number;
  }[];
}
export function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function parseAmount(value: string): number | null {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor > 0 && minor <= 2_000_000_000 ? minor : null;
}
