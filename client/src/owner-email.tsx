import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { api } from "./api";
import type { DemoInvoice } from "./demo";

interface EmailStatus {
  configured: boolean;
  status: "NOT_SENT" | "PENDING" | "ACCEPTED";
  recipient: string;
  acceptedAt: string | null;
}

export function OwnerEmailSend({ invoice }: { invoice: DemoInvoice }) {
  const [state, setState] = useState<EmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<EmailStatus>(`/invoices/${invoice.id}/email`)
      .then(setState)
      .catch(() => setError("Unable to check invoice email status."));
  }, [invoice.id]);

  async function send() {
    if (
      !window.confirm(
        `Send invoice ${invoice.number} to ${invoice.email}? Review the saved amount and recipient first.`,
      )
    ) return;
    if (invoice.version === undefined) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<EmailStatus>(`/invoices/${invoice.id}/email/send`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, version: invoice.version }),
        signal: AbortSignal.timeout(30000),
      });
      setState(result);
      if (result.status === "ACCEPTED") window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send invoice email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface payment-unavailable">
      <span className="icon-tile purple"><Mail size={21} /></span>
      <h3>Email invoice</h3>
      <p>Send the saved invoice details to {invoice.email}. You must confirm before the provider is contacted.</p>
      {state?.status === "ACCEPTED" ? (
        <p role="status">Accepted by the email provider. Inbox delivery is not confirmed.</p>
      ) : (
        <>
          {state?.configured === false && <p role="status">Email is not configured. Set RESEND_API_KEY and EMAIL_FROM on the server.</p>}
          {state?.status === "PENDING" && <p role="status">A previous send may have succeeded. Check the provider before retrying.</p>}
          <button
            className="btn btn-primary"
            disabled={busy || !state?.configured || invoice.status === "paid" || invoice.status === "cancelled"}
            onClick={() => void send()}
          >
            {busy ? "Sending…" : state?.status === "PENDING" ? "Retry existing send" : "Send invoice email"}
          </button>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
