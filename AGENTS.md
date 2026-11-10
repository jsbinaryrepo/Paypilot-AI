# PayPilot-AI project rules

## Current requested extension

The user chose automatic invoice email delivery with account setup. This extends the narrower free-demo scope below. Keep the no-sign-in public browser demo, and expose the database-backed owner workspace only at `/owner/` behind the existing `DEMO_PASSWORD` Basic gate. Send invoice emails only from the server after explicit confirmation, using the saved invoice recipient and totals. Keep provider credentials server-only, persist a stable idempotency key before sending, and never report inbox delivery from a provider acceptance response. Render Free SQLite remains ephemeral; do not present it as a durable production invoice system. Real email delivery needs the user's verified sender domain, provider API key and manual end-to-end test.

## Current free demo deployment

The user chose Render Free for the existing web service and a no-sign-in public preview. Set `VITE_PUBLIC_DEMO=true` at build time: visitors create manual drafts in their own browser storage, and Gemini/PayPal are unavailable there. Keep the server `/api` behind the `DEMO_PASSWORD` gate and never expose the shared SQLite database or Gemini key to unauthenticated visitors. The free service's SQLite is ephemeral. The local full app remains separate. This decision supersedes the earlier private paid Blueprint guidance below.

## Current authorized stage

Stages 1–6 are complete; the current request is to repair the existing Render Free web service. Preserve the architecture and UI; add only the access gate and deployment changes needed for a safe free demo. Do not claim deployment or live provider behavior without verification. HOST defaults to loopback locally and binds 0.0.0.0 on Render. Use only https://api-m.sandbox.paypal.com. Never mark an invoice paid from a URL or a browser-supplied price. Never replace an uncertain order without provider-confirmed safe termination. Reload checkout state after acquiring its database lease, and treat malformed provider order responses as safe upstream failures.

Stage 2 had confirmed prerequisite blockers: dashboard aggregate type inference, fresh SQLite migration setup, and disconnected session-only invoice storage. Fix only what is needed to support real draft creation. The application now uses SQLite-backed invoices; optional `details` preserves existing line items and notes. Never populate the active workspace with demo fixtures. `npm run dev`, `npm run build`, and `npm run check` target both frontend and backend; `dev:client`, `build:client`, and `check:client` remain available.

AI extraction must never write to the database. Keep the SDK/key on the server, use bounded explicit calls without automatic retries, and return null plus clarification questions for unknown values. Customer names/emails absent verbatim from the request must be discarded. Require the separate review/confirm UI and `confirmed: true` on invoice creation. Missing Gemini credentials must leave manual invoice entry available. Verify with mocked transport; do not claim live model behavior without an actual configured test.

## Project purpose

Build an AI-powered freelance payment assistant that turns natural-language invoice requests into reviewed, structured invoice details and PayPal Sandbox payment flows. Gemini interprets requests; trusted server code validates details and performs explicitly authorized payment operations.

Source: the description of `jsbinaryrepo/Paypilot-AI` on GitHub. Do not assume that invoicing, checkout, and payouts are interchangeable PayPal products; define the intended flow before integrating an API.

## Inspected baseline

- Inspected GitHub `main` and the local checkout at initial commit `63f3527`.
- The only existing tracked file is `.gitignore`; there is no application, README, package manifest, test suite, or selected framework yet.
- Preserve `.gitignore`. It already excludes dependencies, generated output, logs, and `.env` variants while allowing `.env.example`.
- The original task established guidance only; subsequent implementation follows the latest user-authorized stage above.

## Technology stack

Confirmed product integrations: Gemini AI and PayPal REST APIs, using Sandbox only.

Implementation baseline established by the existing repository:

- TypeScript with strict checking throughout; Node.js on a supported LTS release.
- React with Vite for the web interface; Express for the server API.
- npm with one committed lockfile and reproducible installs.
- Runtime schema validation at API and AI boundaries; prefer one shared schema library.
- Node's test runner with `tsx` for unit/integration tests and temporary SQLite databases; use the existing browser tools for focused smoke checks.
- Preserve the established Prisma/SQLite database; Stage 6 prepares one private Render service with a persistent disk. Add no background queue or additional AI provider.

At the first implementation milestone, record chosen versions, compatible official SDKs, runtime requirements, and scripts in the manifest and README. Reuse future established choices rather than adding competing frameworks.

## Folder structure

Current: `client/`, `server/`, `shared/`, `prisma/`, and root setup/guidance files.

Established structure; create additional folders only when needed:

```text
client/src/             React UI and client-side presentation
server/src/             Express entry point and API routes
server/src/config/     Validated server configuration
server/src/services/   Gemini and PayPal adapters; business operations
shared/                Safe shared types and runtime schemas; no secrets
tests/                 Cross-boundary integration tests and fixtures
docs/                  API flow decisions and setup notes when needed
.env.example           Placeholder configuration, added with configuration code
README.md              Setup, scope, scripts, and milestone status
```

Keep focused unit tests beside their modules as `*.test.ts` or `*.test.tsx`. Keep server-only integrations out of client imports.

## Coding conventions

- Use small, cohesive modules and explicit types at boundaries. Avoid `any`; narrow unknown input with runtime checks.
- Use camelCase for variables/functions, PascalCase for types/components, and UPPER_SNAKE_CASE for environment names.
- Use async/await, handle expected failures, and return consistent safe API errors. Never expose stack traces or provider payloads to users.
- Centralize configuration and external API access; do not scatter environment reads or provider calls through UI/routes.
- Define a validated invoice draft schema before connecting AI. Missing or ambiguous details require clarification, not invented values.
- Represent money using integer minor units or validated decimal strings with explicit currency and currency precision. Do not use floating-point arithmetic for totals.
- Apply the formatter/linter selected during scaffolding; avoid unrelated formatting edits.

## Security requirements

- Use PayPal Sandbox only. Never silently fall back to production credentials or endpoints.
- Keep Gemini keys, PayPal client secrets, and access tokens exclusively on the server. Never log or commit them.
- Treat prompts and model output as untrusted data. Validate recipient, currency, positive amount, limits, and allowed fields on the server; AI must never directly invoke payment tools or choose endpoints.
- Require a review of validated details and explicit user confirmation before payment creation/capture or invoice sending. Respect PayPal's required payer approval flow; do not claim payment success from a browser redirect alone.
- Before exposing payment endpoints, enforce authentication, resource ownership, request size limits, rate limits, and restricted origins. Add CSRF protection if cookie-based authentication is used.
- Make payment mutations idempotent and prevent duplicate captures/replays. Verify outcomes server-side. If webhooks are added, verify signatures and deduplicate events.
- Minimize personal data sent to Gemini or stored locally. Redact emails, invoice text, tokens, and financial details from logs; use synthetic test fixtures.
- Use HTTPS for deployed traffic, fixed provider endpoints, and request timeouts. Retry only when safe for the operation.

## Environment variable rules

- Commit placeholders and descriptions in `.env.example`; keep real `.env` files ignored. Never paste real credentials into documentation, fixtures, screenshots, or chat output.
- Proposed server variables: `GEMINI_API_KEY`, `GEMINI_MODEL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox`, `PORT`, and `CLIENT_ORIGIN`.
- Validate required configuration at startup. Fail with variable names only, never secret values. Reject environments other than Sandbox for the initial application.
- Frontend-prefixed variables such as `VITE_*` are public. Use them only for public configuration such as the application's API URL; never for server credentials.
- Keep development, test, and deployment credentials separate. Tests use fake values by default. Add variables only when code needs them, documenting each addition.

## Testing requirements

- Keep existing tests and scripts. Do not report checks as passed until they have run. Documentation-only changes require content and diff review.
- The first implementation milestone must provide lint, typecheck, test, and build scripts with documented commands.
- Cover configuration validation and a credential-free health endpoint first. Mock external services; ordinary tests must incur no Gemini usage or PayPal operations.
- With invoice parsing, test malformed/hostile model output, missing fields, invalid recipients, currency precision, and zero/negative amounts.
- With payments, test authorization failures, confirmation requirements, idempotency, provider timeouts/errors, and any webhook verification/replay handling.
- Add a browser smoke test once a complete review flow exists. Keep real Sandbox integration checks opt-in and clearly document required credentials and side effects.
- Run checks appropriate to changed behavior and report results plus limitations. Do not add tests that only mirror implementation details.

## Scope, preservation, and usage discipline

- Inspect relevant files, nested guidance, and the working diff before editing. Preserve useful files, user changes, and existing behavior.
- Implement one requested milestone at a time. Do not build the entire application, add speculative features, or perform unrelated refactors.
- Prefer existing utilities and dependencies. Add a dependency only for a concrete requirement; avoid duplicate packages, unnecessary services, and premature abstractions.
- Use mocks and deterministic fixtures during development. Do not trigger paid AI calls, live payments, deployments, or external mutations merely to test setup.
- Bound AI input/output size and call frequency when integration is introduced. Do not send repeated requests on renders or keystrokes; retry deliberately and avoid sensitive-data caching.
- Avoid unnecessary installs, generated artifacts, broad rewrites, and repeated checks without a reason. Keep diffs small and explain changed behavior and verification.
- Treat the following plan as sequencing guidance, not authorization to implement later milestones automatically.

## Implementation plan

1. **Stage 1 — frontend:** completed; preserve the seven existing pages and reusable UI components.
2. **Stage 2 — invoice management:** verify backend types, migrations, persistence, statuses, and dashboard behavior; address only confirmed blockers to Stage 3.
3. **Stage 3 — Gemini:** implement extraction, clarification, editable review, explicit confirmation, safe failures, and relevant tests. Stop after this milestone. Live Gemini requires manual credentials/model configuration and testing.
4. **Stage 4 — PayPal Sandbox:** implemented; actual provider approval/capture and live webhook delivery still require manual verification.
5. **Stage 5 — testing/security review:** completed with 40 passing mocked-provider/database tests and two focused PayPal fixes; preserve its boundaries and documented limitations.
6. **Stage 6 — deployment preparation:** prepare a private Render Blueprint and consolidated submission documentation. No public deployment, authentication replacement, unrelated features or subsequent stage is authorized.
