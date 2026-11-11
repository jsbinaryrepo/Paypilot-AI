export type Status = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export interface LineItem {
  description: string;
  quantity: number;
  rateMinor: number;
}
export interface DemoInvoice {
  id: string;
  number: string;
  client: string;
  email: string;
  company: string;
  color: string;
  status: Status;
  issued: string;
  due: string;
  currency: "USD" | "EUR" | "GBP" | "INR";
  version?: number;
  paypalInvoiceId?: string | null;
  paypalInvoiceState?: string | null;
  items: LineItem[];
  notes: string;
}
// Illustrative frontend fixtures only. These are not real invoices or payments.
export const demoInvoices: DemoInvoice[] = [
  {
    id: "demo-1048",
    number: "INV-1048",
    client: "Olivia Rhye",
    email: "olivia@example.test",
    company: "Layers Studio",
    color: "purple",
    status: "sent",
    issued: "2026-11-02",
    due: "2026-11-16",
    currency: "USD",
    items: [
      {
        description: "Brand identity & visual direction",
        quantity: 1,
        rateMinor: 240000,
      },
    ],
    notes:
      "Thank you for the opportunity to collaborate. Payment is due within 14 days.",
  },
  {
    id: "demo-1047",
    number: "INV-1047",
    client: "Phoenix Baker",
    email: "phoenix@example.test",
    company: "Sisyphus",
    color: "blue",
    status: "paid",
    issued: "2026-10-28",
    due: "2026-11-11",
    currency: "USD",
    items: [
      { description: "Website development", quantity: 1, rateMinor: 380000 },
    ],
    notes: "Illustrative paid invoice. No actual payment was processed.",
  },
  {
    id: "demo-1046",
    number: "INV-1046",
    client: "Lana Steiner",
    email: "lana@example.test",
    company: "Catalog",
    color: "orange",
    status: "overdue",
    issued: "2026-10-20",
    due: "2026-11-03",
    currency: "USD",
    items: [
      {
        description: "Product design consultation",
        quantity: 10,
        rateMinor: 12500,
      },
    ],
    notes: "",
  },
  {
    id: "demo-1045",
    number: "INV-1045",
    client: "Demi Wilkinson",
    email: "demi@example.test",
    company: "Quotient",
    color: "pink",
    status: "draft",
    issued: "2026-11-08",
    due: "2026-11-22",
    currency: "USD",
    items: [
      {
        description: "Social media design package",
        quantity: 1,
        rateMinor: 85000,
      },
    ],
    notes: "",
  },
  {
    id: "demo-1044",
    number: "INV-1044",
    client: "Drew Cano",
    email: "drew@example.test",
    company: "Circooles",
    color: "green",
    status: "paid",
    issued: "2026-10-25",
    due: "2026-11-08",
    currency: "USD",
    items: [
      {
        description: "UX audit & recommendations",
        quantity: 1,
        rateMinor: 180000,
      },
    ],
    notes: "Illustrative paid invoice. No actual payment was processed.",
  },
  {
    id: "demo-1043",
    number: "INV-1043",
    client: "Natali Craig",
    email: "natali@example.test",
    company: "Hourglass",
    color: "purple",
    status: "cancelled",
    issued: "2026-10-18",
    due: "2026-11-01",
    currency: "USD",
    items: [
      { description: "Illustration concepts", quantity: 1, rateMinor: 65000 },
    ],
    notes: "Illustrative cancelled invoice.",
  },
];
export const totalMinor = (invoice: DemoInvoice) =>
  invoice.items.reduce((sum, item) => sum + item.quantity * item.rateMinor, 0);
export const formatMoney = (minor: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    minor / 100,
  );
export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
export const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("");
