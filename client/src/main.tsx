import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppLayout, ButtonLink, EmptyState } from "./components";
import { type DemoInvoice } from "./demo";
import { loadInvoices, saveInvoice } from "./invoice-store";
import { LandingPage } from "./pages/Landing";
import { DashboardPage } from "./pages/Dashboard";
import { InvoicesPage } from "./pages/Invoices";
import { CreateInvoicePage } from "./pages/CreateInvoice";
import { InvoiceDetailPage } from "./pages/InvoiceDetail";
import { PaymentPage } from "./pages/Payment";
import { AccountPage } from "./pages/Account";
import { api } from "./api";
import "./styles.css";

function getRoute() {
  return window.location.hash.slice(1) || "/";
}
function EntryPage() {
  const accountsReady = import.meta.env.VITE_ACCOUNTS_ENABLED === "true";
  return <main className="account-shell">
    <section className="account-card" aria-labelledby="entry-title">
      <a className="brand" href="#/home">paypilot<span className="brand-ai">AI</span></a>
      <h1 id="entry-title">Choose your workspace</h1>
      <p className="text-muted">Manage invoices as a freelancer, or explore PayPilot as a guest.</p>
      {accountsReady ? <>
        <a className="btn btn-primary" href="/app/#/login">Sign In</a>
        <a className="btn btn-secondary" href="/app/#/register">Create Account</a>
      </> : <>
        <button className="btn btn-primary" disabled>Sign In</button>
        <button className="btn btn-secondary" disabled>Create Account</button>
        <p className="text-muted">Freelancer accounts need the hosted database and email sender to be configured.</p>
      </>}
      <a className="btn btn-secondary" href="#/dashboard">Continue as Guest</a>
      <a href="#/home">Explore PayPilot</a>
    </section>
  </main>;
}
function App() {
  const accountMode = import.meta.env.VITE_ACCOUNT_MODE === "true";
  const [signedIn, setSignedIn] = useState<boolean | null>(accountMode ? null : true);
  const [location, setLocation] = useState(getRoute);
  const [invoices, setInvoices] = useState<DemoInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const route = location.split("?")[0];
  const workspace = accountMode || (route !== "/" && route !== "/home");
  useEffect(() => {
    if (!accountMode) return;
    let active = true;
    api("/auth/me").then(() => { if (active) setSignedIn(true); })
      .catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, [accountMode]);
  useEffect(() => {
    if (!workspace || !signedIn || ["/login", "/register", "/verify"].includes(route)) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    loadInvoices()
      .then((data) => {
        if (!cancelled) setInvoices(data);
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error ? error.message : "Unable to load invoices.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, reload, route, signedIn]);
  useEffect(() => {
    const onChange = () => {
      setLocation(getRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  useEffect(() => {
    const page =
      route === "/"
        ? accountMode ? "Overview" : "Choose your workspace"
        : route === "/home"
          ? "Less admin. More momentum."
        : route === "/dashboard"
          ? "Overview"
          : route === "/create"
            ? "Create invoice"
            : route === "/invoices"
              ? "Invoices"
              : route.startsWith("/payment/")
                ? "Payment return preview"
                : "Invoice details";
    document.title = `${page} · PayPilot AI`;
  }, [route]);
  async function save(invoice: DemoInvoice) {
    const saved = await saveInvoice(invoice);
    setInvoices((current) => [
      saved,
      ...current.filter((existing) => existing.id !== saved.id),
    ]);
    window.location.hash = `/invoices/${saved.id}`;
  }
  if (accountMode && signedIn === null) return <p role="status" className="account-shell">Checking account…</p>;
  if (accountMode && (!signedIn || ["/login", "/register", "/verify"].includes(route)))
    return <AccountPage route={["/register", "/verify"].includes(route) ? route : "/login"} onSignedIn={() => { setSignedIn(true); window.location.hash = "/dashboard"; }} />;
  if (route === "/" && !accountMode) return <EntryPage />;
  if (route === "/home") return <LandingPage />;
  const id = route.startsWith("/invoices/") ? route.split("/")[2] : undefined;
  const selected = invoices.find((invoice) => invoice.id === id);
  const editId =
    route === "/create"
      ? new URLSearchParams(location.split("?")[1]).get("edit")
      : null;
  const editable = invoices.find(
    (invoice) => invoice.id === editId && invoice.status === "draft",
  );
  return (
    <AppLayout route={route}>
      {loading ? (
        <p role="status" className="text-muted">
          Loading invoices from the database…
        </p>
      ) : loadError ? (
        <div role="alert" className="form-error">
          {loadError}{" "}
          <button
            className="btn btn-secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : route === "/dashboard" || (accountMode && route === "/") ? (
        <DashboardPage invoices={invoices} />
      ) : route === "/invoices" ? (
        <InvoicesPage invoices={invoices} />
      ) : route === "/create" ? (
        <CreateInvoicePage
          key={editId ?? "new"}
          invoice={editable}
          onSave={save}
        />
      ) : selected ? (
        <InvoiceDetailPage invoice={selected} />
      ) : route === "/payment/success" || route === "/payment/cancel" ? (
        <PaymentPage cancelled={route === "/payment/cancel"} />
      ) : (
        <EmptyState
          title="Page not found"
          description="This page or invoice is not available in your workspace."
        >
          <ButtonLink href="#/dashboard">Back to overview</ButtonLink>
        </EmptyState>
      )}
    </AppLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
