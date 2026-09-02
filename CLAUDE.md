# CLAUDE.md — Bug Bounty Asset Intelligence (BBI)

Handoff notes for an AI agent working in this repo. Read this before touching code.
It captures what the code alone does not: design intent, hard invariants, the
gotchas that will bite you, current runtime state, and what is still open.

---

## 1. What this is

A **single-user** web app for **authorized** bug bounty research. It aggregates
bug bounty programs and their in-scope assets from provider APIs, keeps full
historical scope data, detects meaningful changes, uses AI to prioritise which
scopes are worth researching, and presents it all in a dashboard.

It is an **inventory / change-detection / prioritisation** system. It does
**not** scan, exploit, or actively test anything. The only hosts it contacts are
the bug bounty platform APIs themselves. Do not add scanning, exploitation,
credential attacks, or active testing. Research suggestions stay at planning
level ("review the tenant isolation model"), never technique level.

---

## 2. Stack & platform

- **Next.js 16** (App Router, React 19), **TypeScript strict** (zero `any` in
  app code).
- **Prisma 7** + **SQLite** via the `@prisma/adapter-better-sqlite3` driver
  adapter. Postgres-ready (enums are `String` columns, indexes in place).
- **Tailwind v4** with semantic design tokens (`globals.css`).
- **Vitest** (202 tests) against a real SQLite DB.
- Auth: first-party sessions (scrypt password hash, HMAC'd session token).
- Queue: DB-backed `Job` table + a standalone worker (no Redis/broker).
- AI: `@anthropic-ai/sdk`, plus an OpenAI/OpenAI-compatible provider over
  `fetch`, plus a deterministic offline heuristic engine.
- **Host is Windows.** Shell is Git Bash (POSIX) or PowerShell. Node 24.

---

## 3. Run & commands

```bash
npm install
cp .env.example .env                 # set the two required secrets (below)
npm run setup                        # migrate deploy + prisma generate + seed providers
npm run admin:create -- you@x.com    # password via ADMIN_PASSWORD env, else generated & printed
npm run dev                          # hot-reload dev server
# or: npm run build && npm start
npm run worker                       # drains the AI job queue (see gotcha #5)
npm test                             # 202 tests
npm run typecheck                    # tsc --noEmit
npx eslint .                         # lint
npm run seed:demo                    # fake demo program (example.com/.test only)
npm run seed:eval                    # larger synthetic dataset via the real sync pipeline
```

Required env (`src/lib/env.ts` is the single source of truth):
`DATABASE_URL`, `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`, `SESSION_SECRET`.
Optional: `ANTHROPIC_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `PROVIDER_HTTP_USER_AGENT`,
freshness/timeout knobs. See `.env.example`.

---

## 4. Architecture & data flow

```
provider adapter (HackerOne/Bugcrowd/Intigriti/YesWeHack/Manual)
   → normalization (asset-type + severity onto one vocabulary)
   → canonical snapshot → SHA-256 content hash
   → upsert → scope versioning → change detection
   → (after commit) AI evaluation queue
   → deterministic Opportunity Score
   → dashboard / assets / AI Supporter
```

Module map (`src/lib/`):
- `providers/` — adapters + `registry.ts` + retrying `http-client.ts`. All
  provider HTTP lives here; the rest of the app uses normalized models only.
- `normalization/asset.ts` — asset-type inference, identifier canonicalisation,
  `truncate`/`parseDate`/`normalizeSeverity` helpers.
- `credentials/store.ts` — the **only** path to encrypted provider credentials.
- `crypto/credentials.ts` — AES-256-GCM envelope, versioned keys, AAD-bound.
- `canonical/hash.ts` — stable serialisation + content hashing.
- `sync/` — `canonical.ts` (snapshots), `change-detection.ts`, `engine.ts` (the
  pipeline; idempotent, partial-failure tolerant).
- `ai/` — `types.ts` (the `AiProvider` interface + Zod output schemas),
  `prompt.ts` (shared, vendor-neutral, language directive), `anthropic.ts`,
  `openai.ts`, `heuristic.ts`, `provider.ts` (selection + fallback),
  `settings.ts` (DB-driven config + encrypted key), `input.ts` (canonical AI
  input + hash), `evaluate.ts` (orchestration, cost control, staleness).
- `scoring/opportunity.ts` — deterministic weighted score (see invariants).
- `authorization/scope-authorization.ts` — the safety gate.
- `jobs/` — `queue.ts` (DB-backed, idempotent enqueue, safe claim) + `worker.ts`.
- `queries/` — read models for pages: `assets.ts`, `dashboard.ts`,
  `integrations.ts`, `ai-supporter.ts`.
- `i18n/` — `config.ts`, `translator.ts`, `dictionaries/{en,vi}.ts`.
- `theme/config.ts`, `preferences.ts` (cookie + user row).
- `api/` — Zod schemas + `http.ts` (`withApi`, `requireApiUser`, same-origin).

Pages under `src/app/(app)/` (auth-gated by that layout): `/`, `/assets`,
`/assets/[id]`, `/programs`, `/ai-supporter`, `/changes`,
`/settings/{ai,appearance,language,integrations,integrations/[provider]}`.
`/login` is outside the group. API under `src/app/api/`.

---

## 5. HARD INVARIANTS — do not break these

1. **AI never grants authorization.** `scope-authorization.ts` reads only
   provider data — never an evaluation. A model cannot move an asset into scope.
   Test: `authorization.test.ts` seeds a max-confidence eval on an out-of-scope
   asset and asserts denial.
2. **The app owns the score.** The model returns 7 dimension scores; the final
   Opportunity Score is a deterministic weighted sum in `scoring/opportunity.ts`
   (20% business value, 20% attack surface, 20% freshness, 15% research
   potential, 10% complexity, 10% policy fit, 5% inverse duplicate risk). Model
   output is clamped, never trusted raw. Exact arithmetic is asserted in tests.
3. **Heuristic output is never labelled AI.** Every evaluation stores
   `evaluationSource` (`AI_MODEL` | `HEURISTIC`); the UI badges them differently.
   A fallback to the rule engine must stay visibly HEURISTIC.
4. **Secrets never leave the server.** AES-256-GCM at rest; master key in env,
   never the DB; no endpoint returns key material; logs redact by field name
   (`logger.ts`). Credential ciphertext is AAD-bound to its provider.
5. **Sync is idempotent.** Content hashes exclude provider timestamps and raw
   payloads, so an unchanged re-sync creates no dup program/scope, no new
   version, no false change event, no dup job — only `lastSeenAt` moves.
6. **Unevaluated ≠ 0.** A scope with no completed evaluation renders `—` /
   "not evaluated" and sorts last. Never show it as score 0.
7. **SSRF discipline.** Provider base URLs are server-controlled constants. The
   one user-supplied URL (custom OpenAI-compatible endpoint) is validated
   (`normalizeBaseUrl`): https only, no creds, private/loopback/link-local
   rejected. `http-client.ts` refuses redirects and off-origin paths.
8. **i18n parity is enforced at compile time.** `en.ts` is the typed source of
   truth; `vi.ts` is `Record<MessageKey,string>`. A missing key fails typecheck.
   Every new user-facing string needs both dictionaries. Technical identifiers
   (domains, asset types, provider names, protocols, model ids) are never
   translated.
9. **Per-user scoping.** Preferences/sessions are per-user. As per-user features
   land (watchlist, saved views, research), scope every query by user and add an
   IDOR test.

---

## 6. GOTCHAS — these will trip you

1. **`server-only` throws outside the `react-server` condition.** Any script
   importing app code must run as
   `node --conditions=react-server --import tsx scripts/x.ts` (see the npm
   scripts). Tests alias a stub — see `vitest.config.ts` (`server-only` →
   `tests/stubs/server-only.ts`) and its `conditions`.
2. **Prisma 7 driver adapter + config.** The datasource block has no `url`; it
   comes from `prisma.config.ts`. `src/lib/load-env.ts` loads `.env` for
   non-Next contexts and **absolutises** a relative SQLite path (avoids two DB
   files). The generated client is in `src/generated/prisma` (gitignored; run
   `prisma generate`).
3. **SQLite bound-parameter limit.** Never call `findMany` with relation
   `include` on a large candidate set — Prisma builds one `IN (…N ids…)` per
   relation and SQLite rejects it past a few hundred. This crashed the assets
   page at ~48k scopes. Pattern to follow: `queries/assets.ts` fetches scalar
   rows, then loads relations in **chunks of 400** (`RELATION_CHUNK`) and via
   `groupBy` aggregates. Do the same for any new high-volume list.
4. **Provider JSON uses `null`, TS types say `undefined`.** Optional chaining
   handles both, but helpers must too — `truncate()` guards `null` for this
   reason (Intigriti sends `description: null`). Don't call `.trim()` on a
   provider field without guarding null.
5. **The AI queue does not drain itself.** Syncs auto-enqueue an EVALUATE_SCOPE
   job per scope (currently ~48k pending) but **no worker runs by default**.
   Nothing gets a completed evaluation until you run `npm run worker`, click
   "Process AI jobs" on the dashboard, use AI Supporter → Generate, or
   re-evaluate on an asset.
6. **`next start` serves the last build.** After changing code you must
   `npm run build` and restart for the running production server to pick it up
   (or use `npm run dev`). Several times this session a "still broken" report
   was a stale build/stale browser badge.
7. **Provider User-Agent must stay neutral.** Intigriti (and others) sit behind
   Cloudflare, which 403s bot-flagged agents *at the edge, before the token is
   checked* — so it looks like a permission error but is a UA/WAF block. Default
   UA is neutral (`PROVIDER_HTTP_USER_AGENT`). Don't put "bug bounty" in it.
8. **Windows line endings.** `.gitattributes` normalises to LF. Expect
   `LF→CRLF` warnings on `git add`; they're harmless.
9. **Port 3000 is taken by Docker on this machine.** The app has been run on
   **:3200** via `next start -p 3200`.

---

## 7. Provider access models (important, non-obvious)

- **HackerOne** — works for researcher accounts (API username + token, HTTP
  Basic). The one integration verified end-to-end. Currently syncing 591 programs.
- **Intigriti** — bearer token. **Program *list* returns 200 for all programs,
  but program *detail* (which carries scope) 403s for programs you haven't
  joined.** The adapter swallows a per-program 403/404 as "no accessible scope"
  and continues; only a list-level 401/403 is a real credential failure. The
  sync engine aborts the whole run on a 401/403 *thrown out of a program's scope
  fetch*, which is why the adapter must swallow the per-program case. Syncing 218
  programs / ~2,700 scopes.
- **YesWeHack** — email/password → JWT, optional TOTP. 2FA accounts can't do
  unattended scheduled syncs. Syncing 61 programs.
- **Bugcrowd** — API is **organisation-only**; researcher accounts have no API
  token page and get 401/403. Expected dead end; use Manual instead.
- **Manual** — no credentials, status `READY` (never `CONNECTED`). Records run
  through the same normalize/hash/version/change pipeline. **UI for entering
  manual programs/scopes is not built yet — API only** (`/api/manual/*`).

Adapters for Bugcrowd/Intigriti/YesWeHack were written against published docs;
Intigriti and YesWeHack are now exercised against live accounts, Bugcrowd is not.
Each carries a `TODO(<provider>)`.

---

## 8. Current state (2026-09-02)

- Git: initialized, one commit on `main`, **not pushed** (no `gh` installed;
  push steps are in the last chat + README). `.env` and `prisma/dev.db`
  (196 MB, real encrypted creds) are gitignored and verified out of the commit.
- Real synced data: **HackerOne 591, Intigriti 218, YesWeHack 61 programs;
  ~48,158 scopes (45,128 in scope).** This is the user's real data — do NOT wipe
  it. Mock seed data was already removed (only `example.com`/`.test` fixtures
  were mock; a real program legitimately lists `example.com`, so never delete by
  domain — delete seeds by synthetic externalId `h1-2001/h1-2002/bc-3001/manual:demo-corp`).
- AI: provider `HEURISTIC`, **no API key configured** → all evaluations are
  rule-based. 50 completed evals, ~48k pending (queue undrained).
- Integrations: HackerOne/Intigriti/YesWeHack CONNECTED + enabled; Bugcrowd
  NOT_CONFIGURED; Manual DISABLED.
- App has been running at `http://localhost:3200`. Admin: `spidey.elec@gmail.com`.
- `public/BBI-Product-Overview.pdf` + `docs/` hold a generated product doc.

---

## 9. Known limitations & roadmap (highest-leverage first)

**Tier 0 (small, do first):**
- **Heuristic score distribution saturates** — everything lands ~84–93/HIGH, so
  rankings don't discriminate. Widen the spread in `ai/heuristic.ts`. This is the
  single highest-impact change; AI Supporter and the dashboard depend on it.
- **Condense the dashboard "Today's Opportunities"** rows (repetitive template
  prose).

**Open security-review findings (not yet fixed):**
- `public/BBI-Product-Overview.pdf` is served **unauthenticated** (public/ has no
  auth). Remove it or add middleware.
- `POST /api/assets/[id]/ai-evaluations` calls `drainJobs(3)`, which processes
  **arbitrary** queued jobs (paid model calls) on the request thread. Scope it to
  the one asset (AI Supporter's generate route already does this correctly via
  targeted `runScopeEvaluation`).
- New-scope write in `sync/engine.ts` (`scope.create` then `scopeVersion.create`)
  is **not** in a transaction; the update path is. Wrap it to match.

**Scale:**
- `queries/assets.ts` caps the working set at 5,000 rows and reduces in memory,
  so `total` is capped and rows past 5k are unreachable. Needs cursor pagination
  + a DB-side "current evaluation" join before it's correct at 48k.

**Product (roadmap, mostly unbuilt):**
- Sync health/freshness states on the dashboard; retry-failed-sync.
- Saved views; watchlist → notifications; global search (Cmd/Ctrl-K).
- Research workspace UI (models exist: `ResearchSession`/`Finding`; no UI). This
  makes the Coverage column real and feeds personal duplicate intelligence.
- Manual program/scope entry UI; a control to confirm a manual asset as
  authorized (`POST /api/assets/[id]/review` exists, no UI calls it).
- AI usage/cost tracking + budget caps; prompt versioning surfaced in UI.

---

## 10. Working conventions

- Match surrounding code: comments explain *why*, not *what*; strict TS; no `any`.
- Every new user-facing string → both `en.ts` and `vi.ts`.
- Every schema change → a Prisma migration (`npm run db:migrate`); never edit a
  migration after it's applied.
- Before finishing any change: `npm run typecheck && npx eslint . && npm test`
  green, and `npm run build` for anything touching pages/routes. Verify UI in
  EN/dark, EN/light, VI/dark, VI/light where relevant.
- Don't commit or push unless asked. `.env` and `*.db` must never be staged
  (they're gitignored; verify with `git check-ignore` if unsure).
