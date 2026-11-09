import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  FileText,
  Plus,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  Badge,
  ButtonLink,
  CreateLink,
  InvoiceTable,
  PageHeader,
  StatCard,
} from "../components";
import {
  formatMoney as formatAmount,
  totalMinor,
  type DemoInvoice,
} from "../demo";
import { publicDemo } from "../public-demo";

function RevenueChart({
  received,
  outstanding,
  currency,
}: {
  received: number;
  outstanding: number;
  currency: string;
}) {
  const formatMoney = (minor: number) => formatAmount(minor, currency);
  const maximum = Math.max(received, outstanding, 1);
  return (
    <div className="chart-area">
      <div className="chart-y">
        <span>{formatMoney(maximum)}</span>
        <span>{formatMoney(Math.round(maximum / 2))}</span>
        <span>$0</span>
      </div>
      <div
        className="bar-chart"
        role="img"
        aria-label={`Saved totals: received ${formatMoney(received)}, outstanding ${formatMoney(outstanding)}.`}
      >
        <div className="chart-grid-lines">
          <i />
          <i />
          <i />
        </div>
        <div className="chart-column">
          <div
            className="chart-bar received"
            style={{ height: `${Math.max(3, (received / maximum) * 100)}%` }}
          >
            <span>{formatMoney(received)}</span>
          </div>
          <strong>Received</strong>
        </div>
        <div className="chart-column">
          <div
            className="chart-bar outstanding"
            style={{ height: `${Math.max(3, (outstanding / maximum) * 100)}%` }}
          >
            <span>{formatMoney(outstanding)}</span>
          </div>
          <strong>Outstanding</strong>
        </div>
      </div>
    </div>
  );
}
export function DashboardPage({ invoices }: { invoices: DemoInvoice[] }) {
  const [currency, setCurrency] = useState("USD");
  const scoped = invoices.filter((invoice) => invoice.currency === currency);
  const formatMoney = (minor: number) => formatAmount(minor, currency);
  const paid = scoped
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + totalMinor(i), 0);
  const outstanding = scoped
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((sum, i) => sum + totalMinor(i), 0);
  const drafts = scoped.filter((i) => i.status === "draft").length;
  const overdue = scoped.filter((i) => i.status === "overdue").length;
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORK, IN VIEW"
        title="A little clarity for your day."
        description="Here’s the big picture of your saved invoices."
      >
        <CreateLink />
      </PageHeader>
      <div className="stats-grid">
        <StatCard
          title="Total received"
          value={formatMoney(paid)}
          icon={Wallet}
          detail="Recorded payments"
          tone="green"
        />
        <StatCard
          title="Outstanding"
          value={formatMoney(outstanding)}
          icon={Clock3}
          detail={`${overdue} invoice past its due date`}
          tone="orange"
        />
        <StatCard
          title="Total invoices"
          value={String(scoped.length).padStart(2, "0")}
          icon={FileText}
          detail="For the selected currency"
        />
        <StatCard
          title="Draft invoices"
          value={String(drafts).padStart(2, "0")}
          icon={FileText}
          detail="Waiting for your finishing touches"
          tone="blue"
        />
      </div>
      <div className="dashboard-middle">
        <section className="surface revenue-panel">
          <div className="section-head">
            <div>
              <h2>Money overview</h2>
              <p>Saved totals · {currency}</p>
            </div>
            <span className="subtle-tag">
              <CalendarDays size={13} />{" "}
              <select
                aria-label="Dashboard currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {["USD", "EUR", "GBP", "INR"].map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </span>
          </div>
          <div className="revenue-summary">
            <strong>{formatMoney(paid + outstanding)}</strong>
            <span>Total paid + outstanding</span>
          </div>
          <RevenueChart
            received={paid}
            outstanding={outstanding}
            currency={currency}
          />
          <div className="chart-legend">
            <span>
              <i className="legend-dot received" /> Received
            </span>
            <span>
              <i className="legend-dot outstanding" /> Outstanding
            </span>
            <span className="legend-note">{publicDemo ? "Browser-only drafts" : "Local database records"}</span>
          </div>
        </section>
        <section className="quick-create">
          <span className="ai-orb">
            <Sparkles size={26} />
          </span>
          <span className="subtle-tag">YOUR NEXT INVOICE</span>
          <h2>
            From a blank page
            <br />
            to a clear next step.
          </h2>
          <p>
            Bring the details together in a draft. You’re always in control of
            what comes next.
          </p>
          <div className="example-prompt">
            <span>
              <Sparkles size={13} /> Example idea
            </span>
            <p>
              “Invoice Olivia $2,400 for the new brand identity, due in 14
              days.”
            </p>
          </div>
          <ButtonLink href="#/create">
            Create a draft <ArrowRight size={16} />
          </ButtonLink>
          <small>{publicDemo ? "Browser demo: manual drafts only." : "AI drafts always require your review and confirmation."}</small>
        </section>
      </div>
      <section className="surface">
        <div className="section-head">
          <div>
            <h2>
              Recent invoices{" "}
              <span className="count-pill">{scoped.length}</span>
            </h2>
            <p>Your latest saved invoices in the selected currency.</p>
          </div>
          <ButtonLink href="#/invoices" variant="secondary">
            View all invoices <ArrowRight size={15} />
          </ButtonLink>
        </div>
        <InvoiceTable invoices={scoped.slice(0, 5)} />
        <div className="table-bottom">
          <span>
            <span className="tiny-dot" /> {publicDemo ? "Browser storage" : "Local database"}
          </span>
          <a href="#/create">
            <Plus size={14} /> New draft
          </a>
        </div>
      </section>
      <section className="bottom-insight">
        <span className="icon-tile purple">
          <ArrowDownLeft size={20} />
        </span>
        <div>
          <h3>Good work deserves a clear paper trail.</h3>
          <p>Keep your drafts organized and make room for what’s next.</p>
        </div>
        <a href="#/invoices">
          Explore your invoices <ArrowRight size={16} />
        </a>
        <Badge status="draft" />
      </section>
    </>
  );
}
