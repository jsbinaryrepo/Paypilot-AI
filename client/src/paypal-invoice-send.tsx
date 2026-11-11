import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { api } from "./api";
import type { DemoInvoice } from "./demo";

interface InvoiceStatus {
  configured: boolean;
  status: string;
  paypalInvoiceId: string | null;
  paymentUrl: string | null;
  sentAt: string | null;
  lastError: string | null;
}

export function PayPalInvoiceSend({ invoice }: { invoice: DemoInvoice }) {
  const [state, setState] = useState<InvoiceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<InvoiceStatus>(`/invoices/${invoice.id}/paypal-invoice`).then(setState)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to check PayPal invoice status."));
  }, [invoice.id]);
  async function action(send: boolean) {
    if (send && !window.confirm(`Send invoice ${invoice.number} to ${invoice.email} through PayPal Sandbox?`)) return;
    setBusy(true); setError("");
    try {
      const result = await api<InvoiceStatus>(`/invoices/${invoice.id}/paypal-invoice/${send ? "send" : "check"}`, {
        method: "POST", body: JSON.stringify(send ? { confirmed: true, version: invoice.version } : {}),
        signal: AbortSignal.timeout(60000),
      });
      setState(result);
      if (result.status === "PAID" || ["SENT", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID"].includes(result.status))
        window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "PayPal invoice request failed."); }
    finally { setBusy(false); }
  }
  const sent = state && ["SENT", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID"].includes(state.status);
  return <section className="surface payment-unavailable">
    <span className="icon-tile purple"><Mail size={21} /></span>
    <h3>Send PayPal Sandbox invoice</h3>
    <p>PayPal creates the invoice and sends its payment request to {invoice.email}. No email app opens.</p>
    {state?.configured === false && <p role="status">Configure the Sandbox client ID, secret and PAYPAL_BUSINESS_NAME on the server.</p>}
    {sent && <p role="status">PayPal invoice {state.paypalInvoiceId}: {state.status}. PayPal accepted the send; inbox delivery is not confirmed.</p>}
    {state?.paymentUrl && <a className="btn btn-secondary" href={state.paymentUrl} target="_blank" rel="noopener noreferrer">Open Sandbox invoice</a>}
    {state?.lastError && !error && <p role="alert" className="form-error">{state.lastError}</p>}
    {!sent && <button className="btn btn-primary" disabled={busy || !state?.configured || invoice.status === "paid" || invoice.status === "cancelled"} onClick={() => void action(true)}>
      {busy ? "Checking PayPal…" : state?.paypalInvoiceId ? "Retry / send existing invoice" : "Send invoice"}
    </button>}
    {state && state.status !== "NOT_SENT" && <button className="btn btn-secondary" disabled={busy} onClick={() => void action(false)}>Check PayPal status</button>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
