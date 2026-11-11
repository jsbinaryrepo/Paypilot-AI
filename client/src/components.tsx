import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  House,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  formatDate,
  formatMoney,
  initials,
  totalMinor,
  type DemoInvoice,
  type Status,
} from "./demo";
import { guestMode, publicDemo } from "./public-demo";
import { api } from "./api";
const accountMode = import.meta.env.VITE_ACCOUNT_MODE === "true";

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <a
      href="#/"
      className={`brand ${dark ? "brand-dark" : ""}`}
      aria-label="PayPilot AI home"
    >
      <span className="brand-symbol">
        <ArrowUpRight size={22} strokeWidth={3} />
      </span>
      <span>
        paypilot<span className="brand-ai">AI</span>
      </span>
    </a>
  );
}
export function ButtonLink({
  children,
  href,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  href: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <a href={href} className={`btn btn-${variant} ${className}`}>
      {children}
    </a>
  );
}
export function Badge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>
      <span />
      {status === "sent" ? "Sent" : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`demo-notice ${compact ? "compact" : ""}`}>
      <span className="demo-tag">UI PREVIEW</span>
      <span>
        {compact
          ? "Illustrative data · No real transactions"
          : "Temporary demo data. Changes stay in this session. AI and payments are not connected."}
      </span>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="text-muted">{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function StatCard({
  title,
  value,
  icon: Icon,
  detail,
  tone = "purple",
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  detail: string;
  tone?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <span className={`icon-tile ${tone}`}>
          <Icon size={19} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
export function InvoiceTable({ invoices }: { invoices: DemoInvoice[] }) {
  return (
    <div className="table-scroll">
      <table className="invoice-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Client</th>
            <th>Amount</th>
            <th>Due date</th>
            <th>Status</th>
            <th>
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>
                <a className="invoice-number" href={`#/invoices/${invoice.id}`}>
                  {invoice.number}
                </a>
                <small>{formatDate(invoice.issued)}</small>
              </td>
              <td>
                <div className="client-cell">
                  <span className={`avatar ${invoice.color}`}>
                    {initials(invoice.client)}
                  </span>
                  <div>
                    <strong>{invoice.client}</strong>
                    <small>{invoice.company || invoice.email}</small>
                  </div>
                </div>
              </td>
              <td className="amount-cell">
                {formatMoney(totalMinor(invoice), invoice.currency)}
                <small>{invoice.currency}</small>
              </td>
              <td>{formatDate(invoice.due)}</td>
              <td>
                <Badge status={invoice.status} />
              </td>
              <td>
                <a
                  href={`#/invoices/${invoice.id}`}
                  className="icon-button"
                  aria-label={`View ${invoice.number}`}
                >
                  <ArrowUpRight size={17} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <FileText size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
const mainLinks = [
  { href: "#/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "#/create", label: "Create invoice", icon: Sparkles },
  { href: "#/invoices", label: "Invoices", icon: FileText },
];
export function AppLayout({
  route,
  children,
}: {
  route: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [returnsOpen, setReturnsOpen] = useState(route.startsWith("/payment/"));
  const current = route.startsWith("/invoices/")
    ? "Invoice details"
    : route === "/create"
      ? "Create invoice"
      : route === "/invoices"
        ? "Invoices"
        : route.startsWith("/payment/")
          ? "Payment return preview"
          : "Overview";
  return (
    <div
      className="app-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape") setMobileOpen(false);
      }}
    >
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <Brand dark />
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-picker">
          <span className="workspace-logo">S</span>
          <span>
            Studio workspace<small>{publicDemo ? "Browser demo" : guestMode ? "Guest workspace" : accountMode ? "Your account" : "Local workspace"}</small>
          </span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        {accountMode && <button className="nav-link" onClick={async () => {
          try {
            await api("/auth/logout", { method: "POST", body: "{}" });
            window.location.hash = "/login";
            window.location.reload();
          } catch { window.alert("Sign out failed. Please try again."); }
        }}>Sign out</button>}
        <nav>
          {mainLinks.map(({ href, label, icon: Icon }) => {
            const active =
              href === "#/invoices"
                ? route.startsWith("/invoices")
                : href === `#${route}`;
            return (
              <a
                key={href}
                href={href}
                className={`nav-link ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {href === "#/create" && !publicDemo && <span className="nav-pill">AI</span>}
              </a>
            );
          })}
          {!publicDemo && <button
            className={`nav-link ${route.startsWith("/payment/") ? "active" : ""}`}
            aria-expanded={returnsOpen}
            onClick={() => setReturnsOpen(!returnsOpen)}
          >
            <CreditCard size={19} />
            <span>Payment pages</span>
            <ChevronDown
              size={14}
              className={returnsOpen ? "rotate-180" : ""}
            />
          </button>}
          {!publicDemo && returnsOpen && (
            <div className="subnav">
              <a
                href="#/payment/success"
                aria-current={route === "/payment/success" ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                Payment return
              </a>
              <a
                href="#/payment/cancel"
                aria-current={route === "/payment/cancel" ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                Payment cancellation
              </a>
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-callout">
            <span className="sparkle-small">
              <Sparkles size={18} />
            </span>
            <h3>
              Less admin.
              <br />
              More momentum.
            </h3>
            <p>Your next invoice starts with a simple idea.</p>
            <a href="#/create" onClick={() => setMobileOpen(false)}>
              Create a draft <ArrowRight size={15} />
            </a>
          </div>
          <a href="#/" className="nav-link">
            <House size={18} />
            <span>Back to home</span>
          </a>
          <button
            className="nav-link"
            onClick={() => setHelpOpen(!helpOpen)}
            aria-expanded={helpOpen}
          >
            <CircleHelp size={18} />
            <span>About this preview</span>
          </button>
          {helpOpen && (
            <p className="sidebar-help">
              {publicDemo
                ? "Drafts stay in this browser only. Gemini and PayPal are unavailable. Clear browser storage to remove demo invoices."
                : accountMode
                  ? "Your invoices are stored in your account. Gemini drafts require review. New invoices are emailed after confirmation; PayPal needs your own merchant connection."
                  : guestMode
                    ? "Invoices are private to this browser session and saved on the server. Gemini and PayPal Sandbox are available when configured."
                    : "Invoices are stored locally in SQLite. Gemini drafts require your review and confirmation. PayPal Sandbox checkout is available when configured."}
            </p>
          )}
          <div className="sidebar-user">
            <span className="avatar purple">AM</span>
            <div>
              <strong>{guestMode ? "Guest workspace" : "Workspace owner"}</strong>
              <small>{publicDemo ? "Browser demo" : guestMode ? "This browser" : accountMode ? "Your account" : "Local account"}</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{current}</strong>
          </div>
          <div className="topbar-actions">
            <a
              href="#/invoices"
              className="header-search"
              aria-label="Search invoices"
            >
              <Search size={17} />
              <span>Find an invoice</span>
            </a>
            <span className="topbar-divider" />
            <span className="preview-chip">
              <span />
              {publicDemo ? "Browser demo" : guestMode ? "Guest workspace" : accountMode ? "Your account" : "Local mode"}
            </span>
            <span
              className="avatar purple small-avatar"
              aria-label={publicDemo ? "Browser demo" : guestMode ? "Guest workspace" : "Local workspace owner"}
            >
              AM
            </span>
          </div>
        </header>
        <main className="workspace-content">
          <div className="demo-notice">
            <span className="demo-tag">{publicDemo ? "BROWSER DEMO" : guestMode ? "GUEST WORKSPACE" : accountMode ? "YOUR ACCOUNT" : "LOCAL WORKSPACE"}</span>
            <span>
              {publicDemo
                ? "Drafts stay in this browser. Gemini and PayPal are unavailable; no payment can be made."
                : guestMode
                  ? "Your invoices are saved on the server for this browser. Review AI output before creating; PayPal Sandbox and email require server credentials."
                  : accountMode
                  ? "Review AI results before confirming. Confirmed new invoices are emailed by the server; PayPal requires your own merchant connection."
                  : "Invoices are stored locally. AI output requires review. PayPal Sandbox requires configuration."}
            </span>
            {publicDemo && import.meta.env.VITE_ACCOUNTS_ENABLED === "true" &&
              <a href="/app/#/login" className="inline-link">Use account workspace</a>}
          </div>
          {children}
          <footer className="app-footer">
            <span>© 2026 PayPilot AI</span>
            <span>
              <Check size={13} /> Built for a calmer workflow
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
export function CreateLink() {
  return (
    <ButtonLink href="#/create">
      <Plus size={17} /> Create invoice
    </ButtonLink>
  );
}
