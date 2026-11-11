import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Command,
  FileCheck2,
  FileText,
  Layers3,
  LayoutDashboard,
  Menu,
  MousePointer2,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { Brand, ButtonLink, DemoNotice } from "../components";
import { publicDemo } from "../public-demo";

export function LandingPage() {
  const [menu, setMenu] = useState(false);
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <nav aria-label="Site navigation" className={menu ? "open" : ""}>
          <a href="#/dashboard" onClick={() => setMenu(false)}>
            Product
          </a>
          <a href="#/create" onClick={() => setMenu(false)}>
            Invoice workspace
          </a>
          <a href="#/invoices" onClick={() => setMenu(false)}>
            Explore invoices
          </a>
        </nav>
        <div className="landing-nav-actions">
          <span className="landing-preview-label">
            {publicDemo ? "Browser demo" : "Local workspace"}
          </span>
          {publicDemo && import.meta.env.VITE_ACCOUNTS_ENABLED === "true" &&
            <a href="/app/#/login" className="btn btn-primary">Sign in or create account</a>}
          <ButtonLink href="#/dashboard" variant="secondary">
            Open workspace <ArrowUpRight size={15} />
          </ButtonLink>
          <button
            className="icon-button landing-menu"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <span className="hero-kicker">
              <span>
                <Sparkles size={13} />
              </span>
              A little less paperwork. A lot more possibility.
            </span>
            <h1>
              Great work deserves
              <br />a smoother
              <br />
              <span>way to get paid.</span>
            </h1>
            <p>
              Your work is personal. Your invoices should feel just as
              considered. Meet a calmer workspace for freelancers and
              independent studios.
            </p>
            <div className="hero-actions">
              <ButtonLink href="#/dashboard">
                Explore the workspace <ArrowRight size={17} />
              </ButtonLink>
              <ButtonLink href="#/create" variant="ghost">
                Create an invoice <ChevronRight size={16} />
              </ButtonLink>
            </div>
            <div className="hero-fineprint">
              <span>
                <Check size={14} /> No signup for this preview
              </span>
              <span>
                <Check size={14} /> No payment required
              </span>
            </div>
          </div>
          <div
            className="hero-visual"
            aria-label="Illustrative invoice workspace preview"
          >
            <div className="visual-grid" />
            <div className="floating-note note-top">
              <span className="icon-tile purple">
                <Sparkles size={18} />
              </span>
              <div>
                <strong>Start with a simple idea</strong>
                <small>Designed around your workflow</small>
              </div>
            </div>
            <div className="hero-invoice">
              <div className="mini-window-bar">
                <div>
                  <span />
                  <span />
                  <span />
                </div>
                <span>
                  <ShieldCheck size={11} /> Workspace preview
                </span>
              </div>
              <div className="hero-invoice-body">
                <div className="mini-invoice-heading">
                  <span className="mini-logo">
                    <ArrowUpRight size={19} />
                  </span>
                  <span>
                    INVOICE<span className="mini-invoice-number">INV-1048</span>
                  </span>
                </div>
                <div className="mini-bill">
                  <div>
                    <small>BILLED TO</small>
                    <strong>Layers Studio</strong>
                    <span>olivia@example.test</span>
                  </div>
                  <span className="status status-draft">
                    <span />
                    Draft preview
                  </span>
                </div>
                <div className="mini-table">
                  <div>
                    <span>Description</span>
                    <span>Amount</span>
                  </div>
                  <div>
                    <span>
                      Brand identity & visual direction
                      <small>A fresh start for a bold brand</small>
                    </span>
                    <strong>$2,400.00</strong>
                  </div>
                </div>
                <div className="mini-total">
                  <span>
                    Total due <small>USD</small>
                  </span>
                  <strong>
                    $2,400<span>.00</span>
                  </strong>
                </div>
                <div className="mini-invoice-footer">
                  <FileCheck2 size={15} />
                  <span>Ready when you are. Always yours to review.</span>
                </div>
              </div>
            </div>
            <div className="floating-note note-bottom">
              <span className="icon-tile green">
                <CheckCheck size={19} />
              </span>
              <div>
                <strong>Everything in its place</strong>
                <small>Clear details. Confident next steps.</small>
              </div>
              <span className="tiny-orbit" />
            </div>
            <div className="hero-cursor">
              <MousePointer2 size={19} fill="currentColor" />
              <span>Your next chapter</span>
            </div>
          </div>
        </section>
        <div className="landing-disclaimer">
          <DemoNotice compact />
        </div>
        <section className="principles-strip" aria-label="Product principles">
          <span>MADE FOR THE WAY YOU WORK</span>
          <div>
            <Layers3 size={19} /> Independent studios
          </div>
          <div>
            <Command size={19} /> Creative freelancers
          </div>
          <div>
            <Zap size={19} /> Small businesses
          </div>
        </section>
        <section className="landing-features">
          <div className="features-intro">
            <p className="eyebrow">FROM IDEA TO INVOICE</p>
            <h2>
              More room for <br />
              the work you love.
            </h2>
            <p>
              One thoughtful place to bring the details together, review your
              invoices, and see what needs your attention.
            </p>
            <a href="#/dashboard" className="inline-link">
              Take a look around <ArrowRight size={16} />
            </a>
          </div>
          <div className="feature-grid">
            <article>
              <span className="icon-tile purple">
                <Sparkles size={22} />
              </span>
              <span className="feature-number">01</span>
              <h3>Start with the essentials</h3>
              <p>
                {publicDemo
                  ? "Capture your client, scope, and pricing in a clean invoice editor. Review and save a draft in this browser."
                  : "Capture your client, scope, and pricing in a clean invoice editor. Describe an invoice with Gemini, then edit and confirm the extracted details."}
              </p>
              <span className="feature-label">
                {publicDemo ? "Browser-only drafts" : "Manual drafts available"}
              </span>
            </article>
            <article>
              <span className="icon-tile blue">
                <FileText size={22} />
              </span>
              <span className="feature-number">02</span>
              <h3>Every detail, considered</h3>
              <p>
                Give each invoice a professional home. Review line items,
                totals, due dates, and the details that matter.
              </p>
              <span className="feature-label">Live invoice preview</span>
            </article>
            <article>
              <span className="icon-tile orange">
                <LayoutDashboard size={22} />
              </span>
              <span className="feature-number">03</span>
              <h3>A clearer view ahead</h3>
              <p>
                Find an invoice, explore its details, and understand the shape
                of your business through one simple overview.
              </p>
              <span className="feature-label">Illustrative dashboard</span>
            </article>
            <article className="future-feature">
              <span className="icon-tile green">
                <Wallet size={22} />
              </span>
              <span className="feature-number">04</span>
              <h3>Payments, thoughtfully</h3>
              <p>
                {publicDemo
                  ? "Payments are unavailable in this public browser demo. No transaction is created."
                  : "PayPal Sandbox checkout uses server-verified captures. No real money is processed in Sandbox."}
              </p>
              <span className="feature-label">
                {publicDemo ? "No checkout in demo" : "Sandbox integration"}
              </span>
            </article>
          </div>
        </section>
        <section className="landing-cta">
          <div>
            <span className="cta-sparkle">
              <Sparkles size={26} />
            </span>
            <p className="eyebrow">A BETTER RHYTHM FOR YOUR BUSINESS</p>
            <h2>Less admin. More momentum.</h2>
            <p>Explore the frontend. Find your flow.</p>
          </div>
          <ButtonLink href="#/dashboard">
            Step into your workspace <ArrowRight size={17} />
          </ButtonLink>
          <div className="cta-decoration" aria-hidden="true">
            <ArrowDown size={140} strokeWidth={0.6} />
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>Thoughtfully built for independent work.</span>
        {publicDemo && import.meta.env.VITE_ACCOUNTS_ENABLED === "true" && <a href="/app/#/login">Create an account or sign in</a>}
        {publicDemo && import.meta.env.VITE_ACCOUNTS_ENABLED !== "true" && <a href="/owner/">Owner workspace</a>}
        <a href="#/dashboard">
          Explore preview <ArrowUpRight size={14} />
        </a>
        <small>© 2026 PayPilot AI</small>
      </footer>
    </div>
  );
}
