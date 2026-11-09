import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import {
  CreateLink,
  EmptyState,
  InvoiceTable,
  PageHeader,
} from "../components";
import {
  formatMoney,
  totalMinor,
  type DemoInvoice,
  type Status,
} from "../demo";

const filters: { label: string; value: Status | "all" }[] = [
  { label: "All invoices", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Sent", value: "sent" },
  { label: "Paid", value: "paid" },
  { label: "Overdue", value: "overdue" },
  { label: "Cancelled", value: "cancelled" },
];
export function InvoicesPage({ invoices }: { invoices: DemoInvoice[] }) {
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest" | "amount">("newest");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const currencies = new Set(invoices.map((invoice) => invoice.currency));
  const filtered = invoices
    .filter(
      (invoice) =>
        (filter === "all" || invoice.status === filter) &&
        `${invoice.client} ${invoice.email} ${invoice.number} ${invoice.company}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      order === "amount"
        ? totalMinor(b) - totalMinor(a)
        : order === "oldest"
          ? a.issued.localeCompare(b.issued)
          : b.issued.localeCompare(a.issued),
    );
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <PageHeader
        title="Invoices"
        description="All the details. None of the clutter. A home for every invoice."
      >
        <CreateLink />
      </PageHeader>
      <div className="invoice-summary-strip">
        <div>
          <span>Total invoice value</span>
          <strong>
            {currencies.size > 1
              ? `${currencies.size} currencies (not combined)`
              : formatMoney(
                  invoices
                    .filter((i) => i.status !== "cancelled")
                    .reduce((sum, i) => sum + totalMinor(i), 0),
                  invoices[0]?.currency ?? "USD",
                )}
          </strong>
          <small>Saved invoices · excludes cancelled</small>
        </div>
        <div>
          <span>Ready to review</span>
          <strong>
            {invoices.filter((i) => i.status === "draft").length}
            <small> drafts</small>
          </strong>
        </div>
        <div>
          <span>Needs attention</span>
          <strong className="text-orange">
            {invoices.filter((i) => i.status === "overdue").length}
            <small> overdue</small>
          </strong>
        </div>
      </div>
      <section className="surface">
        <div
          className="invoice-tabs"
          role="group"
          aria-label="Filter invoice status"
        >
          {filters.map(({ label, value }) => (
            <button
              key={value}
              className={filter === value ? "selected" : ""}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
              <span>
                {value === "all"
                  ? invoices.length
                  : invoices.filter((i) => i.status === value).length}
              </span>
            </button>
          ))}
        </div>
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search invoices"
              placeholder="Search by client, invoice, or company…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <label className="sort-field">
            {order === "oldest" ? (
              <ArrowUp size={15} />
            ) : (
              <ArrowDown size={15} />
            )}
            <select
              aria-label="Sort invoices"
              value={order}
              onChange={(event) => {
                setOrder(event.target.value as typeof order);
                setPage(1);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount">Highest amount</option>
            </select>
          </label>
        </div>
        {visible.length ? (
          <InvoiceTable invoices={visible} />
        ) : (
          <EmptyState
            title="No invoices found"
            description="Try a different search or choose another status."
          >
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSearch("");
                setFilter("all");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </EmptyState>
        )}
        <div className="pagination">
          <span>
            {filtered.length
              ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length}`
              : "0"}{" "}
            invoices <span className="pagination-demo">· Saved records</span>
          </span>
          <div>
            <button
              className="btn btn-secondary btn-small"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={15} /> Previous
            </button>
            <span className="page-number" aria-current="page">
              {page}
            </span>
            <button
              className="btn btn-secondary btn-small"
              disabled={page * pageSize >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
      <p className="list-footnote">
        Invoices are saved in your local database. Nothing is sent to your
        clients.
      </p>
    </>
  );
}
