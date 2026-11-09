import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { api } from "./api";

export async function startCheckout(invoiceId: string) {
  const result = await api<{
    orderId: string;
    status: string;
    approvalUrl?: string;
  }>(`/invoices/${invoiceId}/paypal/order`, {
    method: "POST",
    body: JSON.stringify({ confirmed: true }),
    signal: AbortSignal.timeout(60000),
  });
  if (["APPROVED", "COMPLETED"].includes(result.status)) {
    window.location.assign(
      `/?invoice=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(result.orderId)}#/payment/success`,
    );
  } else if (
    result.approvalUrl &&
    new URL(result.approvalUrl).origin === "https://www.sandbox.paypal.com"
  )
    window.location.assign(result.approvalUrl);
  else
    throw new Error(
      `Order status: ${result.status}. Check the existing payment before retrying.`,
    );
}
export function PayPalCheckout({
  invoiceId,
  paid,
  cancelled,
}: {
  invoiceId: string;
  paid: boolean;
  cancelled: boolean;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ configured: boolean }>("/paypal/status")
      .then((value) => setConfigured(value.configured))
      .catch(() => setError("Unable to check PayPal configuration."));
  }, []);
  async function start() {
    if (
      !window.confirm(
        "Continue to PayPal Sandbox using the saved invoice amount? The invoice will be locked for payment.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await startCheckout(invoiceId);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to start checkout.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="icon-tile purple">
        <CreditCard size={21} />
      </span>
      <h3>PayPal Sandbox checkout</h3>
      <p>
        Uses the saved invoice total. PayPal approval is required. No real money
        is transferred in Sandbox.
      </p>
      {configured === false && (
        <p role="status">
          PayPal credentials are missing. Configure the server’s Sandbox client
          ID, secret and merchant ID.
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={!configured || busy || paid || cancelled}
        onClick={() => void start()}
      >
        {busy
          ? "Checking existing order…"
          : paid
            ? "Invoice paid"
            : "Pay / Retry in Sandbox"}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </>
  );
}
