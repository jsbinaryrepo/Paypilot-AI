import { useEffect, useState } from "react";
import { Clock3, ShieldCheck } from "lucide-react";
import { ButtonLink } from "../components";
import { api } from "../api";
import { startCheckout } from "../paypal";
import { publicDemo } from "../public-demo";

export function PaymentPage({ cancelled }: { cancelled: boolean }) {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.split("?")[1]);
  const invoice = search.get("invoice") ?? hash.get("invoice");
  const orderId = search.get("token") ?? hash.get("token");
  const [status, setStatus] = useState("UNVERIFIED");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function verify(capture: boolean) {
    if (!invoice || !orderId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ status: string }>(
        `/invoices/${encodeURIComponent(invoice)}/paypal/check`,
        {
          method: "POST",
          body: JSON.stringify({ orderId, capture }),
          signal: AbortSignal.timeout(60000),
        },
      );
      setStatus(result.status);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to verify payment.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!publicDemo && invoice && orderId) void verify(false);
  }, [invoice, orderId]);
  async function retry() {
    if (!invoice) return;
    setBusy(true);
    setError("");
    try {
      await startCheckout(invoice);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to resume checkout.",
      );
    } finally {
      setBusy(false);
    }
  }
  const paid = status === "PAID";
  if (publicDemo)
    return (
      <div className="payment-page">
        <section className="payment-state surface">
          <h1>Payments are unavailable in this browser demo.</h1>
          <p>No PayPal order or payment is created here.</p>
          <ButtonLink href="#/invoices">Back to invoices</ButtonLink>
        </section>
      </div>
    );
  return (
    <div className="payment-page">
      <div className="payment-route-label">
        PAYPAL SANDBOX · SERVER VERIFICATION
      </div>
      <section className="payment-state surface">
        <div className="payment-state-symbol">
          <Clock3 size={34} />
        </div>
        <span className="subtle-tag">{status}</span>
        <h1>
          {paid
            ? "Sandbox payment verified."
            : cancelled
              ? "Checkout was cancelled."
              : "Verify and complete your payment."}
        </h1>
        <p className="payment-description">
          {paid
            ? "The server verified the PayPal capture amount, currency and invoice association. Your payment is recorded and the invoice is paid."
            : "A return URL does not prove payment. Check the existing order before retrying. Cancellation does not mark an invoice paid."}
        </p>
        {!invoice || !orderId ? (
          <p className="form-error">
            No complete checkout reference was supplied. Open the invoice to
            start or resume checkout.
          </p>
        ) : (
          <>
            <p className="text-muted">Invoice reference: {invoice}</p>
            <div className="payment-actions">
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void verify(false)}
              >
                Check payment
              </button>
              {!paid && (
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void verify(true)}
                >
                  {busy ? "Verifying…" : "Verify and capture approved payment"}
                </button>
              )}
            </div>
          </>
        )}
        {invoice && !paid && (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void retry()}
          >
            Retry / resume existing checkout
          </button>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="payment-actions">
          <ButtonLink href={invoice ? `#/invoices/${invoice}` : "#/invoices"}>
            Back to invoice
          </ButtonLink>
          <ButtonLink href="#/dashboard" variant="secondary">
            Overview
          </ButtonLink>
        </div>
        <p className="payment-trust">
          <ShieldCheck size={14} /> Sandbox only. Success appears only after
          server verification.
        </p>
      </section>
    </div>
  );
}
