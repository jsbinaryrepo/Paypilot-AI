import { formatMoney, totalMinor, type DemoInvoice } from "./demo";

export function invoiceEmailHref(invoice: DemoInvoice): string {
  const subject = `Invoice ${invoice.number}`;
  const lines = [
    `Hello ${invoice.client},`,
    "",
    `Here are the details for invoice ${invoice.number}:`,
    ...invoice.items.map(
      (item) =>
        `- ${item.description}: ${item.quantity} × ${formatMoney(item.rateMinor, invoice.currency)}`,
    ),
    `Total: ${formatMoney(totalMinor(invoice), invoice.currency)} ${invoice.currency}`,
    `Due date: ${invoice.due}`,
    ...(invoice.notes ? ["", invoice.notes] : []),
    "",
    "Please reply to this email if you have any questions.",
  ];
  return `mailto:${encodeURIComponent(invoice.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}
