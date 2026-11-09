import { z } from "zod";
import { currencies } from "./invoices.js";

export const extractionRequestSchema = z
  .object({ prompt: z.string().trim().min(1).max(2000) })
  .strict();
// Required JSON keys with explicit nulls let the model express uncertainty.
export const extractionSchema = z
  .object({
    customerName: z.string().trim().min(1).max(120).nullable(),
    customerEmail: z.email().max(254).nullable(),
    amount: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/)
      .nullable(),
    currency: z.enum(currencies).nullable(),
    description: z.string().trim().min(1).max(500).nullable(),
    dueDate: z.iso.date().nullable(),
    dueInDays: z.number().int().min(0).max(3650).nullable(),
  })
  .strict();
export type ExtractedInvoice = Omit<
  z.infer<typeof extractionSchema>,
  "dueInDays"
>;
export const clarificationQuestions: Record<keyof ExtractedInvoice, string> = {
  customerName: "What is the customer’s name?",
  customerEmail: "What is the customer’s email address?",
  amount: "What is the invoice amount (positive, up to two decimal places)?",
  currency:
    "Which currency should be used: USD, EUR, GBP, or INR? A dollar sign alone is ambiguous.",
  description: "What work or service is this invoice for?",
  dueDate:
    "When is the invoice due? Provide a date or a number of days from today.",
};
export interface ExtractionResult {
  draft: ExtractedInvoice;
  clarifications: { field: keyof ExtractedInvoice; question: string }[];
  referenceDate: string;
  timeZone: string;
}
