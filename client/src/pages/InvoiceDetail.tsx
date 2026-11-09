import { PayPalCheckout } from "../paypal";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  Clock3,
  Download,
  FileText,
  Info,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { Badge, Brand, ButtonLink, PageHeader } from "../components";
import { formatDate, formatMoney, totalMinor, type DemoInvoice } from "../demo";
import { publicDemo } from "../public-demo";

export function InvoiceDetailPage({ invoice }: { invoice: DemoInvoice }) {
  return (
    <>
      <a href="#/invoices" className="back-link">
        <ArrowLeft size={15} /> All invoices
      </a>
      <PageHeader
        title={invoice.number}
        description={`${invoice.company || invoice.client} · Saved invoice`}
      >
        <button className="btn btn-secondary" onClick={() => window.print()}>
          <Download size={16} /> Print / Save PDF
        </button>
        {invoice.status === "draft" && (
          <ButtonLink href={`#/create?edit=${invoice.id}`}>
            <Pencil size={15} /> Edit draft
          </ButtonLink>
        )}
      </PageHeader>
      <div className="invoice-detail-layout">
        <article className="invoice-paper surface">
          <div className="invoice-paper-header">
            <Brand />
            <div>
              <p className="eyebrow">INVOICE</p>
              <h2>{invoice.number}</h2>
              <Badge status={invoice.status} />
            </div>
          </div>
          <div className="paper-divider" />
          <div className="billing-grid">
            <div>
              <p className="eyebrow">FROM</p>
              <h3>{publicDemo ? "Browser demo" : "Local workspace"}</h3>

              <span className="sample-label">
                Sender details not configured
              </span>
            </div>
            <div>
              <p className="eyebrow">BILL TO</p>
              <h3>{invoice.client}</h3>
              {invoice.company && <p>{invoice.company}</p>}
              <p>{invoice.email}</p>
            </div>
          </div>
          <div className="paper-dates">
            <div>
              <span>Invoice date</span>
              <strong>{formatDate(invoice.issued)}</strong>
            </div>
            <div>
              <span>Due date</span>
              <strong>{formatDate(invoice.due)}</strong>
            </div>
            <div>
              <span>Currency</span>
              <strong>{invoice.currency}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table className="paper-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr key={index}>
                    <td>{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.rateMinor, invoice.currency)}</td>
                    <td>
                      {formatMoney(
                        item.quantity * item.rateMinor,
                        invoice.currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="paper-totals">
            <div>
              <span>Subtotal</span>
              <strong>
                {formatMoney(totalMinor(invoice), invoice.currency)}
              </strong>
            </div>
            <div className="paper-total-final">
              <span>
                Total <small>{invoice.currency}</small>
              </span>
              <strong>
                {formatMoney(totalMinor(invoice), invoice.currency)}
              </strong>
            </div>
          </div>
          <div className="paper-notes">
            <p className="eyebrow">A NOTE FOR YOU</p>
            <p>
              {invoice.notes ||
                "Thank you for your business. It’s a pleasure to work together."}
            </p>
          </div>
          <div className="paper-stamp">
            <ShieldCheck size={15} /> UI preview · Not a payment request · No
            funds processed
          </div>
        </article>
        <aside className="invoice-aside">
          <section className="surface">
            <div className="section-head">
              <h2>Invoice summary</h2>
              <FileText size={17} />
            </div>
            <div className="summary-body">
              <span className="text-muted">Total invoice amount</span>
              <strong className="summary-amount">
                {formatMoney(totalMinor(invoice), invoice.currency)}
                <small> {invoice.currency}</small>
              </strong>
              <Badge status={invoice.status} />
              <dl>
                <div>
                  <dt>Invoice number</dt>
                  <dd>{invoice.number}</dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd>{formatDate(invoice.due)}</dd>
                </div>
                <div>
                  <dt>Record type</dt>
                  <dd>Saved invoice</dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="surface payment-unavailable">
            {publicDemo ? (
              <p>Payment checkout is unavailable in this browser demo. No PayPal transaction can be made.</p>
            ) : (
              <PayPalCheckout
                invoiceId={invoice.id}
                paid={invoice.status === "paid"}
                cancelled={invoice.status === "cancelled"}
              />
            )}
          </section>
          <section className="surface activity-panel">
            <div className="section-head">
              <h2>Record details</h2>
            </div>
            <div className="timeline">
              <div>
                <span>
                  <FileText size={14} />
                </span>
                <p>
                  <strong>
                    {invoice.id.startsWith("session-")
                      ? "Draft created"
                      : "Invoice created"}
                  </strong>
                  <small>{formatDate(invoice.issued)}</small>
                </p>
              </div>
              <div>
                <span>
                  {invoice.status === "paid" ? (
                    <CircleCheck size={14} />
                  ) : (
                    <Clock3 size={14} />
                  )}
                </span>
                <p>
                  <strong>
                    {invoice.status === "paid"
                      ? "Paid status"
                      : `Current status: ${invoice.status}`}
                  </strong>
                  <small>
                    {invoice.status === "paid"
                      ? "Use payment verification for provider status"
                      : publicDemo ? "Saved in this browser only" : "Saved in your local database"}
                  </small>
                </p>
              </div>
            </div>
          </section>
          <a href="#/create" className="detail-create">
            Create another draft <ArrowUpRight size={16} />
          </a>
          <p className="detail-info">
            <Info size={14} /> {publicDemo
              ? "Browser drafts are for demo use only. No client is contacted or payment processed."
              : "Sample invoices and statuses are for interface review only."}
          </p>
        </aside>
      </div>
    </>
  );
}
