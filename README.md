# Bug Bounty Asset Intelligence Platform

Aggregates **authorized** bug bounty programs and their in-scope assets, keeps full
historical scope data, detects meaningful changes, uses AI to prioritise research,
and presents it all in one dashboard.

This tool is for **authorized** bug bounty research only. It is an inventory,
change-detection and prioritisation system. It does not scan, exploit, or touch
target systems in any way — the only hosts it talks to are the bug bounty
platform APIs themselves.

---

## What the AI does, and does not do

The AI is the **intelligence and prioritisation layer**. It answers "what should
I look at first, and why".

It does **not**:

- exploit vulnerabilities, attack credentials, or bypass authentication
- perform destructive or active testing of any kind
- decide whether an asset is in scope

Two hard invariants back that up in code:

1. **Authorization never comes from AI.** `ScopeAuthorizationService` reads only
   provider-backed data. Nothing in it consults an evaluation, so a model can
   never move an asset from `OUT_OF_SCOPE`/`UNKNOWN` into `IN_SCOPE`. Verified
   by `tests/authorization.test.ts`.
2. **The score is computed by the application.** The model supplies seven
   dimension scores; the final Opportunity Score is a deterministic weighted sum
   in `src/lib/scoring/opportunity.ts`. Verified by `tests/scoring-and-hashing.test.ts`.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Database | SQLite via Prisma 7 (`@prisma/adapter-better-sqlite3`) |
| Auth | First-party sessions: scrypt password hashing, HMAC'd session tokens |
| Queue | Database-backed job table + standalone worker (no Redis) |
| AI | `@anthropic-ai/sdk` with structured outputs, plus an offline heuristic provider |
| Crypto | `node:crypto` AES-256-GCM, versioned keys, master key in env |
| Styling | Tailwind v4 |
| Tests | Vitest against a real SQLite database |

---

## Quick start

```bash
npm install

cp .env.example .env
#   Set INTEGRATION_CREDENTIAL_ENCRYPTION_KEY and SESSION_SECRET.
#   Generate each with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run setup                 # migrate + generate + seed providers

# Create your operator account (password read from ADMIN_PASSWORD,
# or generated and printed once).
ADMIN_PASSWORD='a-long-local-password' npm run admin:create -- you@example.com

npm run dev                   # http://localhost:3000
```

Optionally load obviously fake demo data (`example.com` / `example.test` only)
to explore the UI without any provider credentials:

```bash
npm run seed:demo
```

Process the AI queue, either with the standalone worker or with the
**Process AI jobs** button on the dashboard:

```bash
npm run worker
```

### Running without an Anthropic API key

With no `ANTHROPIC_API_KEY`, the platform automatically uses the **heuristic**
provider: a deterministic, offline, rule-based estimator. Everything works end
to end. Those evaluations are stored with `aiProvider = "heuristic"` and are
badged **Rule-based** in the UI — they are never presented as model output.

---

## Configuring HackerOne

1. In HackerOne, go to **Settings → API Tokens** and create a token. Note the
   **API username** shown beside it (this is not your login email).
2. In this app, open **Integrations** (`/settings/integrations`).
3. On the HackerOne card, click **Configure**, enter the API username and token,
   and save. The token is encrypted with AES-256-GCM before it touches the
   database and is never returned by any endpoint again — the card shows only a
   masked hint such as `API Token: ****3f9a`.
4. Click **Test Connection**. The real state is displayed: `CONNECTED`,
   `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMITED`, or `API_ERROR`. Success is
   never faked.
5. Click **Enable**, then **Sync Now**.

The adapter uses only the documented Hacker API
(`/v1/hackers/programs`, `/v1/hackers/programs/{handle}/structured_scopes`)
with HTTP Basic auth. No internal, private or session-authenticated endpoints
are used.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run worker` | Standalone AI job worker |
| `npm test` | Full Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npx eslint .` | Lint |
| `npm run setup` | Migrate, generate client, seed providers |
| `npm run db:migrate` | Create/apply a migration |
| `npm run admin:create -- <email>` | Create or reset an operator account |
| `npm run seed:demo` | Load fake demo data |

---

## Architecture

```
HackerOne / Bugcrowd / Intigriti / YesWeHack / Manual
        ↓  provider adapters (all provider HTTP lives here)
    normalization  → canonical snapshot → SHA-256 content hash
        ↓
    upsert → scope versioning → change detection
        ↓  (after commit; never blocks the sync)
    AI evaluation queue → dimension scores
        ↓
    deterministic Opportunity Score
        ↓
    dashboard / assets / scope detail
```

### Modules

```
src/lib/
  providers/        adapters + registry + retrying HTTP client
  normalization/    asset-type and severity normalisation
  credentials/      the only path to encrypted credentials
  crypto/           AES-256-GCM envelope, key rotation
  canonical/        stable serialisation + hashing
  sync/             canonical snapshots, change detection, the sync engine
  ai/               provider abstraction, input hashing, evaluation orchestration
  scoring/          deterministic opportunity score
  authorization/    the scope safety gate
  jobs/             queue + worker
  queries/          shared read models for pages and API
  api/              validation schemas and route helpers
```

Adding a provider means implementing `ProviderAdapter` and registering it in
`src/lib/providers/registry.ts`. Nothing else changes.

---

## Key behaviours

**Idempotency.** Re-running an identical sync creates no duplicate program or
scope, no new `ScopeVersion`, no false `ChangeEvent`, and no duplicate AI job.
Only `lastSeenAt` moves. Content hashes deliberately exclude provider timestamps
and raw payloads, so a bumped `updated_at` with unchanged content is not a change.

**Scope removal.** A disappearing scope is never deleted. It becomes
`scopeStatus = REMOVED` with `removedAt` set, all versions are retained, an
`ASSET_REMOVED` event is emitted, and the authorization gate then refuses it.

**AI cost control.** Each evaluation is keyed by a hash of its canonical input.
An unchanged input reuses the existing `COMPLETED` evaluation with no model call.
Age values are bucketed so the hash does not drift daily, and the evaluation's own
output tags are excluded from the hash so completing an evaluation cannot
invalidate itself.

**Unevaluated ≠ zero.** A scope with no completed evaluation has a `null` score,
renders as `—` / "Not evaluated", and always sorts last. It is never shown as 0.

**AI failures never fail a sync.** Evaluations are queued after the data is
committed and processed out of band.

---

## Security notes

- Credentials are encrypted with AES-256-GCM, with the provider slug bound in as
  additional authenticated data — a ciphertext copied between provider rows fails
  to decrypt rather than silently authenticating against the wrong service.
- The master key lives in the environment, never the database. Key ids are stamped
  into each envelope and `INTEGRATION_CREDENTIAL_PREVIOUS_KEYS` supports rotation.
- No endpoint returns credential material. The UI shows at most the last four
  characters of a sufficiently long secret.
- Structured logs redact sensitive field names, and error messages are scrubbed of
  inline bearer tokens and API keys before being stored or displayed.
- **SSRF:** provider base URLs are server-controlled constants, never user input.
  The HTTP client requires HTTPS, re-validates that each resolved URL stays on the
  adapter's own origin, and refuses to follow redirects.
- State-changing endpoints require an authenticated session plus a same-origin
  `Origin` check; session cookies are `HttpOnly` + `SameSite=Lax`.
- Provider policy and scope instructions are third-party text. They are passed to
  the model inside explicit `<untrusted_*>` delimiters with a standing instruction
  not to follow them. Even a successful injection cannot grant authorization or
  change a score — both are computed outside the model.

---

## Provider status

| Provider | Status |
|---|---|
| **HackerOne** | Fully implemented against the documented Hacker API and exercised end to end in tests. |
| **Bugcrowd** | Complete adapter against the documented REST API. Bugcrowd issues API credentials to *organisation* accounts; a researcher-only account will get `PERMISSION_ERROR`, which is reported honestly. Wire format follows published docs but is unverified against a live account. |
| **Intigriti** | Complete adapter against the documented researcher API with a personal access token. Unverified against a live token. |
| **YesWeHack** | Complete adapter using the documented email/password JWT flow. 2FA accounts need a fresh TOTP code, so unattended scheduled syncs are not reliable there. Unverified against a live account. |
| **Manual** | First-class, no credentials. Records run through the same normalisation, hashing, versioning and change-detection pipeline, are always labelled `MANUAL`, and require explicit operator confirmation before the authorization gate allows them. |

Each unverified adapter carries a specific `TODO(<provider>)` in its source
listing exactly what to confirm against a live credential. No provider fabricates
data when its API is unavailable.

---

## Testing

```bash
npm test
```

147 tests across 10 files, run against a real SQLite database with the actual
migrations applied. Tests never make paid API calls — they use the deterministic
heuristic provider and a mocked `fetch`.

Coverage includes HackerOne normalization, pagination, provider error mapping
(401/403/429/5xx/malformed), SSRF protections, sync idempotency, scope versioning,
change detection, removal semantics, credential encryption and rotation, log
redaction, AI input hashing and reuse, staleness, opportunity-score arithmetic,
the authorization gate, queue semantics, API authentication and CSRF, and a full
end-to-end Definition-of-Done walkthrough.
