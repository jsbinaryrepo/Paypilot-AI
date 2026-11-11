import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Eye,
  FileText,
  Info,
  LockKeyhole,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import { currencies, parseAmount } from "../../../shared/invoices";
import { type ExtractionResult } from "../../../shared/ai-invoice";
import { api } from "../api";
import { ButtonLink, PageHeader } from "../components";
import { formatMoney, type DemoInvoice } from "../demo";
import { guestMode, publicDemo } from "../public-demo";

const draftSchema = z
  .object({
    client: z.string().trim().min(1, "Enter a client name.").max(120),
    email: z.email("Enter a valid client email."),
    company: z.string().trim().max(120),
    due: z.iso.date("Choose a valid due date."),
    currency: z.enum(currencies),
    items: z
      .array(
        z.object({
          description: z
            .string()
            .trim()
            .min(1, "Describe every line item.")
            .max(500),
          quantity: z.number().int().min(1).max(10000),
          rateMinor: z.number().int().min(1).max(2000000000),
        }),
      )
      .min(1)
      .max(20),
    notes: z.string().max(2000),
  })
  .refine(
    (value) =>
      value.items.reduce(
        (sum, item) => sum + item.quantity * item.rateMinor,
        0,
      ) <= 2000000000,
    "The invoice total is too large.",
  );

export function CreateInvoicePage({
  invoice,
  onSave,
}: {
  invoice?: DemoInvoice;
  onSave: (invoice: DemoInvoice) => Promise<void>;
}) {
  const accountMode = import.meta.env.VITE_ACCOUNT_MODE === "true";
  const [prompt, setPrompt] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [currency, setCurrency] = useState<string>(invoice?.currency ?? "USD");
  const [pending, setPending] = useState<DemoInvoice | null>(null);
  const saveLock = useRef(false);
  const generationLock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (publicDemo) return;
    let active = true;
    api<{ configured: boolean }>("/ai/status")
      .then((status) => {
        if (!active) return;
        setAiConfigured(status.configured);
        if (!status.configured)
          setAiNotice(
            "Gemini is not configured. Set GEMINI_API_KEY and GEMINI_MODEL in the server environment and restart it. Manual entry remains available.",
          );
      })
      .catch(() => {
        if (active)
          setAiNotice(
            "Cannot check Gemini configuration. Verify that the backend is running.",
          );
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, []);
  const [client, setClient] = useState(invoice?.client ?? "");
  const [email, setEmail] = useState(invoice?.email ?? "");
  const [company, setCompany] = useState(invoice?.company ?? "");
  const [due, setDue] = useState(invoice?.due ?? "");
  const [items, setItems] = useState(
    invoice?.items.map((item, index) => ({
      key: String(index),
      description: item.description,
      quantity: String(item.quantity),
      rate: (item.rateMinor / 100).toFixed(2),
    })) ?? [{ key: "first", description: "", quantity: "1", rate: "" }],
  );
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function generate() {
    if (publicDemo || generationLock.current || saving) return;
    generationLock.current = true;
    setGenerating(true);
    setPending(null);
    setAiNotice("");
    controller.current = new AbortController();
    try {
      const result = await api<ExtractionResult>("/ai/invoice-draft", {
        method: "POST",
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(30000),
        ]),
      });
      setClient(result.draft.customerName ?? "");
      setEmail(result.draft.customerEmail ?? "");
      setCompany("");
      setNotes("");
      setDue(result.draft.dueDate ?? "");
      setCurrency(result.draft.currency ?? "");
      setItems([
        {
          key: crypto.randomUUID(),
          description: result.draft.description ?? "",
          quantity: "1",
          rate: result.draft.amount ?? "",
        },
      ]);
      setExtraction(result);
      setError("");
      setAiNotice(
        result.clarifications.length
          ? "Please complete the missing details below. No invoice has been created."
          : "Draft extracted. Check every field below, then review and confirm. No invoice has been created.",
      );
    } catch (error) {
      if (!controller.current.signal.aborted)
        setAiNotice(
          error instanceof Error
            ? error.message
            : "Unable to generate a draft. Use manual entry.",
        );
    } finally {
      generationLock.current = false;
      setGenerating(false);
    }
  }
  const previewTotal = items.reduce(
    (sum, item) =>
      sum + (parseAmount(item.rate) ?? 0) * (Number(item.quantity) || 0),
    0,
  );
  const previewMoney = (minor: number) =>
    currency
      ? formatMoney(minor, currency)
      : `${(minor / 100).toFixed(2)} · choose currency`;
  function updateItem(
    key: string,
    field: "description" | "quantity" | "rate",
    value: string,
  ) {
    setPending(null);
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || generating) return;
    const result = draftSchema.safeParse({
      client,
      email,
      company,
      due,
      currency,
      notes,
      items: items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        rateMinor: parseAmount(item.rate),
      })),
    });
    if (!result.success) {
      setError(
        result.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "Invoice"}: ${issue.message}`,
          )
          .join(" "),
      );
      return;
    }
    const id = invoice?.id ?? `session-${crypto.randomUUID()}`;
    setError("");
    setPending({
      ...result.data,
      id,
      number: invoice?.number ?? `DRAFT-${id.slice(-6).toUpperCase()}`,
      issued: invoice?.issued ?? new Date().toISOString().slice(0, 10),
      status: "draft",
      currency: result.data.currency,
      color: invoice?.color ?? "purple",
      version: invoice?.version,
    });
  }
  async function confirm() {
    if (!pending || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(pending);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to save invoice.",
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <a
        href={invoice ? `#/invoices/${invoice.id}` : "#/dashboard"}
        className="back-link"
      >
        <ArrowLeft size={15} />{" "}
        {invoice ? "Back to invoice" : "Back to overview"}
      </a>
      <PageHeader
        title={
          invoice ? "Make it just right." : "Your next invoice starts here."
        }
        description="Bring the details together. Review everything before taking the next step."
      >
        <span className="subtle-tag">
          <LockKeyhole size={13} /> {publicDemo ? "Browser demo" : guestMode ? "Guest workspace" : "Local database"}
        </span>
      </PageHeader>
      {!invoice && !publicDemo && (
        <section className="ai-composer surface">
          <div className="section-head">
            <div className="flex items-center gap-3">
              <span className="icon-tile purple">
                <Sparkles size={20} />
              </span>
              <div>
                <h2>Describe it. Make it yours.</h2>
                <p>
                  {publicDemo ? "Manual invoice workspace" : "AI invoice workspace"}{" "}
                  <span className="coming-soon">Extract · Edit · Confirm</span>
                </p>
              </div>
            </div>
            <span className="subtle-tag">
              {publicDemo ? "AI UNAVAILABLE" : aiConfigured === false ? "AI NOT CONFIGURED" : "GEMINI AI"}
            </span>
          </div>
          <div className="composer-body">
            <label className="sr-only" htmlFor="invoice-prompt">
              Describe your invoice idea
            </label>
            <textarea
              id="invoice-prompt"
              disabled={generating || saving}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setPending(null);
              }}
              maxLength={2000}
              rows={3}
              placeholder="e.g. Invoice Olivia at Layers Studio $2,400 for brand identity design, due November 16…"
            />
            <div className="prompt-bottom">
              <span>
                <CircleHelp size={13} /> {publicDemo
                  ? "This demo does not send prompts to Gemini. Use the manual fields below."
                  : "Only the text you submit is sent to Google Gemini. Review it before generating."}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void generate()}
                disabled={
                  !prompt.trim() ||
                  generating ||
                  saving ||
                  aiConfigured === false
                }
              >
                <Sparkles size={15} />{" "}
                {generating ? "Extracting…" : "Generate with AI"}
              </button>
            </div>
            <div className="prompt-examples">
              <span>Try an idea</span>
              {[
                "Brand design · $2,400",
                "Development · 20 hours",
                "Monthly retainer",
              ].map((example) => (
                <button
                  key={example}
                  disabled={generating || saving}
                  onClick={() => {
                    setPrompt(`Draft an invoice for ${example.toLowerCase()}.`);
                    setPending(null);
                  }}
                >
                  {example}
                  <ArrowRight size={12} />
                </button>
              ))}
            </div>
            {aiNotice && (
              <p className="inline-notice" role="status">
                <Info size={16} /> {aiNotice}
              </p>
            )}
            {extraction && (
              <div className="inline-notice" role="status">
                <div>
                  {extraction.clarifications.length > 0 && (
                    <>
                      <strong>Please clarify in the editable fields:</strong>
                      <ul>
                        {extraction.clarifications.map((item) => (
                          <li key={item.field}>{item.question}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <small>
                    Relative dates use {extraction.referenceDate} in{" "}
                    {extraction.timeZone}. Generating again replaces the
                    editable values.
                  </small>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <form
        onSubmit={submit}
        onChangeCapture={() => setPending(null)}
        className="invoice-builder"
      >
        <fieldset className="contents" disabled={generating || saving}>
          <div className="builder-fields">
            <section className="surface">
              <div className="section-head">
                <div className="flex items-center gap-3">
                  <span className="step-number">01</span>
                  <div>
                    <h2>Client details</h2>
                    <p>Who is this one for?</p>
                  </div>
                </div>
              </div>
              <div className="form-body">
                <div className="form-grid">
                  <label>
                    Client name <span>*</span>
                    <input
                      value={client}
                      onChange={(event) => setClient(event.target.value)}
                      placeholder="e.g. Olivia Rhye"
                      maxLength={120}
                      required
                    />
                  </label>
                  <label>
                    Email address <span>*</span>
                    <input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      placeholder="client@example.com"
                      maxLength={254}
                      required
                    />
                  </label>
                  <label>
                    Company <small>Optional</small>
                    <input
                      value={company}
                      onChange={(event) => setCompany(event.target.value)}
                      placeholder="e.g. Layers Studio"
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Currency <span>*</span>
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      required
                    >
                      <option value="">Choose currency</option>
                      {currencies.map((code) => (
                        <option key={code}>{code}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Due date <span>*</span>
                    <input
                      type="date"
                      value={due}
                      onInput={(event) => setDue(event.currentTarget.value)}
                      onChange={(event) => setDue(event.target.value)}
                      required
                    />
                  </label>
                </div>
              </div>
            </section>
            <section className="surface">
              <div className="section-head">
                <div className="flex items-center gap-3">
                  <span className="step-number">02</span>
                  <div>
                    <h2>The work & the details</h2>
                    <p>A little context goes a long way.</p>
                  </div>
                </div>
                <span className="subtle-tag">
                  {currency || "Choose currency"}
                </span>
              </div>
              <div className="form-body">
                <div className="line-items-head">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Rate ({currency || "currency"})</span>
                  <span />
                </div>
                {items.map((item, index) => (
                  <div className="line-item-fields" key={item.key}>
                    <input
                      aria-label={`Item ${index + 1} description`}
                      required
                      maxLength={500}
                      value={item.description}
                      placeholder="What did you create?"
                      onChange={(event) =>
                        updateItem(item.key, "description", event.target.value)
                      }
                    />
                    <input
                      aria-label={`Item ${index + 1} quantity`}
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      required
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(item.key, "quantity", event.target.value)
                      }
                    />
                    <input
                      aria-label={`Item ${index + 1} rate in ${currency || "currency"}`}
                      inputMode="decimal"
                      required
                      value={item.rate}
                      placeholder="0.00"
                      onChange={(event) =>
                        updateItem(item.key, "rate", event.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="icon-button remove-item"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={items.length === 1}
                      onClick={() => {
                        setPending(null);
                        setItems((current) =>
                          current.filter((row) => row.key !== item.key),
                        );
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  className="inline-link add-item"
                  type="button"
                  disabled={items.length >= 20}
                  onClick={() => {
                    setPending(null);
                    setItems((current) => [
                      ...current,
                      {
                        key: crypto.randomUUID(),
                        description: "",
                        quantity: "1",
                        rate: "",
                      },
                    ]);
                  }}
                >
                  <Plus size={15} /> Add line item
                </button>
                <div className="form-divider" />
                <label className="form-label">
                  A note for your client <small>Optional</small>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="A thank you, payment terms, or a little extra context…"
                  />
                </label>
              </div>
            </section>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {pending && (
              <section className="surface" aria-label="Confirm invoice">
                <div className="section-head">
                  <h2>
                    Review before{" "}
                    {invoice ? "saving changes" : "creating this invoice"}
                  </h2>
                </div>
                <div className="form-body">
                  <p>
                    {pending.client} · {pending.email}
                  </p>
                  <p>
                    {formatMoney(previewTotal, pending.currency)} · Due{" "}
                    {pending.due}
                  </p>
                  <p>
                    {pending.items.map((item) => item.description).join("; ")}
                  </p>
                  <p className="text-muted">
                    {accountMode && !invoice
                      ? "Confirming saves the invoice and asks the server to email it now. You will see an error if the provider does not accept it; no payment is processed."
                      : "This creates a draft only. No invoice is sent and no payment is processed."}
                  </p>
                  <div className="builder-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => setPending(null)}
                    >
                      Back to editing
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={saving}
                      onClick={() => void confirm()}
                    >
                      {saving
                        ? "Saving…"
                        : invoice
                          ? "Confirm and save changes"
                          : accountMode ? "Confirm and send invoice" : "Confirm and create invoice"}
                    </button>
                  </div>
                </div>
              </section>
            )}
            <div className="builder-actions">
              <ButtonLink href="#/invoices" variant="secondary">
                Cancel
              </ButtonLink>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={saving || generating || !!pending}
              >
                <Save size={16} /> Review invoice
              </button>
            </div>
            <p className="save-note">
              <ShieldCheck size={14} /> {accountMode && !invoice
                ? "Review first. The server emails the invoice only after you confirm."
                : "Nothing is sent to your client. A draft is saved only after confirmation."}
            </p>
          </div>
          <aside className="draft-preview">
            <div className="preview-title">
              <Eye size={15} />
              <span>LIVE PREVIEW</span>
              <span className="subtle-tag">Draft</span>
            </div>
            <div className="preview-paper">
              <div className="preview-paper-top">
                <span className="brand-symbol">
                  <ArrowRight size={18} />
                </span>
                <FileText size={21} />
              </div>
              <p className="eyebrow">INVOICE</p>
              <h3>{invoice?.number ?? "Your next invoice"}</h3>
              <div className="preview-bill">
                <span>BILL TO</span>
                <strong>{client || "Your client’s name"}</strong>
                <p>{company || "Company name"}</p>
                <p>{email || "client@example.com"}</p>
              </div>
              <div className="preview-rows">
                {items.map((item, index) => (
                  <div key={item.key}>
                    <span>
                      {item.description || `Line item ${index + 1}`}
                      <small>
                        {item.quantity || 0} ×{" "}
                        {previewMoney(parseAmount(item.rate) ?? 0)}
                      </small>
                    </span>
                    <strong>
                      {previewMoney(
                        (parseAmount(item.rate) ?? 0) *
                          (Number(item.quantity) || 0),
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="preview-total">
                <span>
                  Total <small>{currency || "Choose currency"}</small>
                </span>
                <strong>{previewMoney(previewTotal)}</strong>
              </div>
              <div className="preview-due">
                <span>Due date</span>
                <strong>{due || "Choose a date"}</strong>
              </div>
              {notes && <p className="preview-note">{notes}</p>}
              <div className="preview-watermark">DRAFT PREVIEW · NOT SENT</div>
            </div>
            <div className="preview-hint">
              <ShieldCheck size={16} />
              <p>
                Your details, your call.
                <br />
                <span>
                  Review your draft before any future sending or payment action.
                </span>
              </p>
            </div>
          </aside>
        </fieldset>
      </form>
    </>
  );
}
