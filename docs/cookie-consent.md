# Cookie Consent — Integration Guide

This document explains how to use the headless `cookie-consent` module from
within the Besidka app: reading consent state, subscribing to changes,
server-side gating, SSR/edge-cache constraints, and extending the manifest.

## Overview

The module is auto-discovered (no entry in `modules` array required). It ships
composables and headless primitives. The styled layer lives in
`app/components/Cookies/Banner.client.vue` and is mounted once in `app/app.vue`
via `<LazyCookiesBanner />`.

---

## Reading consent state (client-side)

Use `useCookieConsent()` anywhere in client-side Vue code:

```ts
const { isAllowed, granted, isDecided } = useCookieConsent()

// Reactive check
if (isAllowed('analytics')) {
  // fire tracking event
}

// Reactive list of granted category ids
// granted.value → ['necessary', 'preferences']

// Has the user made a decision yet?
// isDecided.value → true / false
```

`isAllowed` is reactive: wrap it in a `computed` or `watchEffect` when you
need reactivity to re-run when consent changes.

---

## Subscribing to consent changes

> **Reference pattern.** The landing analytics is **not** consent-gated today
> (it is cookieless and anonymous — see
> [Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
> The `analytics`-gated example below is preserved as the recommended pattern
> for **if/when you introduce a consent-requiring analytics tool** (e.g. GA4).
> Substitute your own category id where it reads `analytics`.

Use `onConsentChange` for side effects that must run when the user commits or
revises their choice. Pass `immediate: true` to also fire right away when
consent is already decided — this is the correct pattern for late-init
analytics that need to recover queued events on page load:

```ts
// app/composables/useLandingAnalytics.ts
export function useLandingAnalytics() {
  const { onConsentChange } = useCookieConsent()

  const pendingEvents: AnalyticsEvent[] = []

  function track(event: AnalyticsEvent) {
    const { isAllowed } = useCookieConsent()

    if (isAllowed('analytics')) {
      send(event)
    } else {
      // Queue until consent is granted
      pendingEvents.push(event)
    }
  }

  onConsentChange(({ granted }) => {
    if (granted.includes('analytics')) {
      // Flush queued events now that analytics is allowed
      for (const event of pendingEvents.splice(0)) {
        send(event)
      }
    } else {
      // Analytics revoked — clear queue, do not send
      pendingEvents.length = 0
    }
  }, { immediate: true })

  return { track }
}
```

The `onConsentChange` callback also auto-cleans within component scope, so
no manual cleanup is needed when called inside `<script setup>` or a composable
used inside a component.

### Nuxt hook alternative

For module-level or plugin-level subscriptions outside Vue component scope,
listen to the `cookie-consent:changed` Nuxt hook:

```ts
// plugins/analytics.client.ts
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('cookie-consent:changed', ({ granted, denied, changed }) => {
    if (changed.includes('analytics')) {
      if (granted.includes('analytics')) {
        initAnalytics()
      } else {
        teardownAnalytics()
      }
    }
  })
})
```

The payload shape:

```ts
interface CookieConsentChangedPayload {
  granted: string[]  // all currently granted category ids
  denied: string[]   // all currently denied category ids
  changed: string[]  // ids whose state changed vs the previous commit
}
```

---

## Server-side gating

> **Reference pattern.** The events ingest endpoint (`/api/v1/events`) is
> **not** consent-gated today — it records cookieless, anonymous data that
> does not require consent (see
> [Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
> The check below is the recommended defense-in-depth pattern for **if/when you
> introduce a consent-requiring analytics tool**.

For a consent-requiring analytics or event ingestion endpoint, use
`getCookieConsent(event)` — auto-imported in Nitro — to guard the route as
defense-in-depth. This parses the `cookies_consent` cookie server-side and is
synchronous (no DB call):

```ts
// server/api/v1/events/index.post.ts
export default defineEventHandler(async (event) => {
  const consent = getCookieConsent(event)

  if (!consent.isAllowed('analytics')) {
    throw createError({ status: 403, message: 'Analytics consent not granted' })
  }

  // ... process event
})
```

The return type:

```ts
interface ServerConsent {
  isDecided: boolean
  granted: string[]
  isAllowed: (categoryId: string) => boolean
}
```

Note: server-side gating is defense-in-depth. The primary enforcement happens
client-side by not firing events in the first place. HttpOnly cookies set by
the server (e.g. `better_auth.session_token`) cannot be cleared by the client
cleanup routine — server-side logic must handle revocation of those entries.

---

## Analytics consent — when it is (and isn't) required

Besidka's landing analytics is **cookieless and anonymous**, so it is **not
gated behind consent** and **not shown as a banner category**. It uses two
mechanisms:

- **Cloudflare Analytics Engine** — server-side `writeDataPoint` via
  `/api/v1/events`, recording event name, path, target, coarse country, and
  device class. No IP is stored, no user id, no cookie.
- **Cloudflare Web Analytics** — a cookieless edge beacon.

Neither stores or reads anything on the user's device, and neither processes
personal data. The analytics simply runs.

### Why cookieless + anonymous analytics needs no consent

- **ePrivacy Directive Art. 5(3)** — the "cookie law" that mandates the consent
  banner — is triggered **only** by *storing or reading information on the
  user's device* (cookies, localStorage, fingerprinting). Cookieless analytics
  never touches the device, so Art. 5(3) is not triggered.
- **GDPR** governs *processing of personal data*. Truly anonymous, aggregate
  data (no IP retained, no identifier, cannot single out a person) falls
  outside GDPR's scope (Recital 26). No personal data → no consent needed.
- This is exactly why privacy-first analytics (Cloudflare Web Analytics,
  Plausible, Fathom) advertise "no cookie banner required."

### Decision rule

Analytics consent is required only when the analytics tool either:

1. **Stores or reads data on the device** — cookies, localStorage,
   fingerprinting (→ ePrivacy Art. 5(3)), **or**
2. **Processes personal data** — IP retained, persistent id, cross-site
   tracking (→ GDPR).

If a tool does neither, it runs without consent.

| Tool | Device access | Personal data | Consent? |
|------|---------------|---------------|----------|
| Cloudflare Web Analytics | None (cookieless) | None (anonymous) | **No** |
| Cloudflare Analytics Engine (our `/api/v1/events`) | None (cookieless) | None (aggregate, no IP/id) | **No** |
| Plausible / Fathom (self-hosted, cookieless) | None | None | **No** |
| Google Analytics 4 (GA4) | Sets `_ga` / `_gid` cookies | Yes (personal data) | **Required** |
| Meta Pixel / ad-tech | Cookies + cross-site tracking | Yes | **Required** + "Do Not Sell/Share" |

When a tool lands in the **Required** rows, add the `analytics` category back
and gate it (see [Re-enabling consent-gated analytics](#re-enabling-consent-gated-analytics)).

### Remaining obligation either way

Cookieless/anonymous analytics still requires **transparency** under
**GDPR Art. 13**: disclose it in the privacy policy. That is disclosure, not
consent.

### Important nuance — Cloudflare Web Analytics is not app-controllable

Cloudflare Web Analytics is **auto-injected at the edge by Cloudflare** and is
**not controllable by app-level consent code**. If a future tool must be
consent-gated, it has to be loaded by app code (manually), **not** via a
platform auto-injector — an auto-injected beacon cannot be held back behind a
consent decision.

### Re-enabling consent-gated analytics

If you introduce a consent-requiring analytics tool (e.g. GA4), re-enable
consent gating in three steps:

1. **Add the category.** Add `{ id: 'analytics' }` to
   `cookieConsent.categories` in `nuxt.config.ts` so it appears in the banner.
2. **Gate both ends.** Gate the client send (the queue-and-flush
   `useLandingAnalytics().track()` pattern in
   [Subscribing to consent changes](#subscribing-to-consent-changes)) **and**
   add the server `getCookieConsent(event).isAllowed('analytics')` check (see
   [Server-side gating](#server-side-gating)) as defense-in-depth.
3. **Declare the cookies.** Declare any cookies the tool sets as `entries`
   under the `analytics` category so the module's cleanup routine purges them
   on withdrawal (see [Adding new cookies to the manifest](#adding-new-cookies-to-the-manifest)).

Two hardenings are worth applying at the same time:

- **Validate the consent cookie** in the server util — confirm the parsed
  `granted[]` contains only strings before trusting it.
- **Restrict the ingest endpoint** — limit `/api/v1/events` to requests whose
  `sec-fetch-site` is `same-origin`.

---

## SSR and edge-cache constraints

**Never branch cacheable SSR HTML on consent state.** Consent is a
per-user, client-side signal. Doing so would:

1. Cache one user's consent-branched HTML and serve it to another user.
2. Break ISR/CDN caching because the cache key would not include consent.

The cookie-consent UI is `client-only` (all three primitives use `.client.vue`
suffixes and are mode: 'client'). The styled banner is also `.client.vue`.
`LazyCookiesBanner` is wrapped in `<ClientOnly>` in `app.vue`, so it never
renders on the server.

For personalisation that depends on consent (e.g. showing/hiding a
preference-driven widget), gate it in client-side Vue
(`v-if="isAllowed('preferences')"`) not in server-rendered layouts.

---

## Adding new cookies to the manifest

1. **Declare the entry in `nuxt.config.ts`** under the appropriate category:

```ts
// nuxt.config.ts
cookieConsent: {
  categories: [
    {
      id: 'preferences',
      entries: [
        // ... existing entries
        {
          id: 'my-new-pref',      // unique id, used for i18n key
          name: 'my_new_pref',    // actual cookie / localStorage key
          type: 'localStorage',   // 'cookie' | 'localStorage' | 'sessionStorage'
        },
      ],
    },
  ],
},
```

2. **Add i18n descriptions** in `i18n/i18n.config.ts` for both `en` and `uk`:

```ts
// i18n/i18n.config.ts
messages: {
  en: {
    cookieConsent: {
      entries: {
        'my-new-pref': {
          description: 'What this cookie/key stores and who sets it.',
          duration: 'Until deleted',
        },
      },
    },
  },
  uk: {
    cookieConsent: {
      entries: {
        'my-new-pref': {
          description: 'Що зберігає цей ключ та хто його встановлює.',
          duration: 'До видалення',
        },
      },
    },
  },
},
```

3. That is all. The banner's modal auto-renders all declared entries from the
   manifest. No component changes required.

---

## Gating `useLandingAnalytics().track()`

> **Reference pattern.** The landing analytics shipped cookieless and
> anonymous, so it is **not** gated today (see
> [Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
> This is the recommended pattern for **if/when you introduce a
> consent-requiring analytics tool** and gate the `track` call.

If you introduce a consent-requiring analytics tool, gate the `track` call as
shown in the subscribing section above. The recommended pattern:

```ts
// Usage in a component or composable
const analytics = useLandingAnalytics()

// This is safe to call unconditionally — useLandingAnalytics queues
// events internally and flushes them once analytics consent is granted.
analytics.track({ type: 'page_view', path: route.path })
```

The queue-and-flush pattern ensures no events are lost when the user grants
consent after having loaded the page (the `onConsentChange({ immediate: true })`
fires immediately and drains the queue).

---

## Gating preference writes

All writes to localStorage keys declared under the `preferences` category must
go through `usePreferenceStorage()` instead of `useLocalStorage()` or
`window.localStorage` directly.

### usePreferenceStorage()

Auto-imported composable (lives in `app/composables/preference-storage.ts`).

```ts
const { setItem, getItem, removeItem, flushPending } = usePreferenceStorage()
```

| Method | Behavior |
|--------|----------|
| `setItem(key, value)` | If `preferences` is granted → writes to `localStorage`. Otherwise → stores in an in-memory pending `Map` and removes the real key. |
| `getItem(key)` | Returns the real `localStorage` value first; falls back to the pending map. Composables therefore keep working in-session even when denied. |
| `removeItem(key)` | Clears both the real key and the pending map entry. |
| `flushPending()` | Writes all pending entries to `localStorage` and clears the map. Called by the gate plugin when consent is granted. |

All methods are SSR-safe (guarded by `import.meta.client`).

### Gate plugin (app/plugins/cookie-consent-gate.client.ts)

Runs once per client boot and subscribes to consent changes.

**On grant of `preferences`:**
- Calls `flushPending()` to write all in-memory pending values to localStorage.
- Re-persists the current color mode preference (reads `useColorMode().preference`
  and writes `nuxt-color-mode` to localStorage) — no page reload required.

**On deny of `preferences`:**
- The module's built-in cleanup routine already removes declared entries.
- The pending map is left intact so in-session values remain accessible.

**Ongoing prevention — color mode:**
`@nuxtjs/color-mode` writes `nuxt-color-mode` to localStorage on every theme
change (inside its own plugin — cannot be intercepted at write time). The gate
plugin watches `useColorMode().preference` with `{ flush: 'post' }` and, if
`preferences` is denied, removes the `nuxt-color-mode` localStorage key and
cookie right after the write. The theme keeps working in-session via the
module's reactive state.

**Ongoing prevention — better_auth.last_login_method:**
The better-auth client sets this cookie during sign-in (not interceptable). The
gate plugin watches `useAuth().lastLoginMethod` and deletes the cookie via a
`document.cookie` expiry write whenever it changes while `preferences` is
denied. On a grant-flush, this cookie is **not** regenerated (it is only set at
login time) — this is acceptable and documented here.

### Adding a new preference key

1. Declare it in `nuxt.config.ts` under the `preferences` category.
2. Use `usePreferenceStorage().setItem/getItem/removeItem` instead of
   `useLocalStorage` or raw `localStorage` in the composable that owns it.
3. Add an i18n description per the manifest guide above.

### feat/244 note — Plyr VideoPlayer

When the `feat/244` branch ships `VideoPlayer`, Plyr must respect the
`preferences` consent. Pass the `storage` option reactively and listen for
consent changes:

```ts
import Plyr from 'plyr'

const { isAllowed, onConsentChange } = useCookieConsent()

let player: Plyr | null = null

function initPlayer(element: HTMLElement) {
  player = new Plyr(element, {
    storage: { enabled: isAllowed('preferences') },
  })
}

onConsentChange(({ granted, denied }) => {
  if (!player) return

  if (granted.includes('preferences')) {
    player.storage.enabled = true
  }

  if (denied.includes('preferences')) {
    player.storage.enabled = false
    localStorage.removeItem('plyr')
  }
})
```

Plyr's default `storageKey` is `'plyr'`, which is already declared in the
`preferences` category manifest so the cleanup routine removes it on deny.

---

## Category reference

| Category id | Required | Purpose |
|-------------|----------|---------|
| `necessary` | Yes | Auth session and consent cookie — always active |
| `preferences` | No | UI state persisted in cookies/localStorage |
| `marketing` | No | Not currently in use — shown as "not used" in the banner |

There is **no `analytics` category** today: the landing analytics is cookieless
and anonymous and runs without consent (see
[Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
Add an `analytics` category only when a consent-requiring analytics tool (e.g.
GA4) is introduced.

Check `nuxt.config.ts` → `cookieConsent.categories` for the full list of
declared entries per category.

---

## Consent receipt logging (Axiom)

### What is logged

When a visitor commits a consent decision (allow-all, allow-selected, or
withdraw), the client fires a fire-and-forget POST to `/api/v1/consents`.
The server logs a wide event to Axiom containing the following fields — all
**pseudonymous**, no personal data:

```
consent.id          — UUID generated client-side at decision time (no user link)
consent.date        — ISO 8601 timestamp of the decision
consent.revision    — banner revision number from cookieConsent.revision
consent.granted     — array of granted category ids
consent.denied      — array of denied category ids
consent.changed     — array of ids whose state changed vs previous decision
consent.decision    — derived bucket: 'all' | 'partial' | 'none'
                      (computed over non-required categories)
consent.cookiePresent  — whether cookies_consent cookie was present server-side
consent.consistent  — whether cookie id + granted set matched the POST body
```

Country and colo fields are attached automatically by evlog wide-event
enrichers — these are aggregate/infrastructure metadata, not personal data.

No raw IP address, no user-agent string, and no user account identifier are
logged. The consent `id` is a random UUID created at decision time and is
never linked to a Better Auth user record.

### Why it is lawful

- **Art. 7(1) GDPR (accountability)**: Controllers must be able to demonstrate
  that consent was given. A timestamped, pseudonymous receipt for every consent
  decision satisfies this burden.
- **Art. 6(1)(c) GDPR (legal obligation)**: Where applicable national law
  requires evidence of consent (e.g. ePrivacy, TTDSG §25), this logging
  fulfils that legal obligation.
- The data is pseudonymous (no IP, no account link) and therefore presents
  minimal risk to data subjects. The consent `id` stored in the cookie is
  already disclosed to the user via the banner's details section.

### Retention recommendation

Configure the Axiom **audit dataset** (`axiomAuditDataset`) and the dedicated
**consent dataset** (`axiomConsentDataset`) with a retention period of **3–5
years**. This covers standard supervisory authority inquiry windows (most EU
DPAs operate within 3 years; 5 years provides a margin for complex
investigations).

The main dataset (`axiomDataset`) can use shorter operational retention
(e.g. 90 days) as consent receipts flow to both the audit dataset (via evlog's
`auditOnly` drain filter) and the dedicated consent dataset (via the
`consentOnly` filter) independently.

To configure retention in Axiom: Settings → Datasets → select the audit
dataset → Retention.

### Drain routing

Each consent receipt wide event (identified by a non-empty `consent` field)
is delivered to **all three configured Axiom drains in parallel**:

| Drain | Dataset env key | Filter | Purpose |
|-------|----------------|--------|---------|
| `main` | `NUXT_AXIOM_DATASET` | none (all events) | Operational telemetry; short retention |
| `audit` | `NUXT_AXIOM_AUDIT_DATASET` | `auditOnly` (events with `audit` field) | Long-retention compliance copy |
| `consent` | `NUXT_AXIOM_CONSENT_DATASET` | `consentOnly` (events with `consent` field) | Dedicated consent analytics dataset |

The `consent` drain is a **second live copy** specifically for consent receipt
analytics, isolated from request-level app telemetry. The 30-day Axiom free-
plan window is intentional here — D1 is the legal system of record; Axiom is
the analytics layer where a rolling 30-day window is sufficient for monitoring
acceptance rates and consistency spikes.

### Setting up the consent dataset

1. Axiom → **Datasets → New dataset** → name it (e.g. `besidka-consent`).
2. **Settings → API tokens → New token** → ingest permission, scoped to that
   dataset only.
3. Set the secrets:

   ```bash
   npx wrangler secret put NUXT_AXIOM_CONSENT_DATASET
   npx wrangler secret put NUXT_AXIOM_CONSENT_TOKEN
   ```

   Locally: `.dev.vars` with the same keys.

   When either key is absent the drain is silently skipped — safe for local
   development without Axiom credentials.

### Org prerequisites

1. **Axiom DPA + SCCs**: Execute a Data Processing Agreement with Axiom and,
   if Axiom processes data in a third country (e.g. US), ensure Standard
   Contractual Clauses are in place before enabling the audit or consent drain.
2. **Privacy policy**: When the legal pages land, add a paragraph noting that
   consent decisions are logged pseudonymously for accountability purposes,
   are retained for up to 5 years in D1 (and 30 days in Axiom), and are
   accessible only to authorised engineering and legal staff.

### Example Axiom APL queries

Run these against the dedicated consent dataset (`besidka-consent`). The same
queries work against the audit dataset (`besidka-audit`) if you prefer a single
long-retention source.

**Decision distribution — counts by consent.decision:**

```apl
['besidka-consent']
| where ['consent.decision'] != ""
| summarize count() by ['consent.decision']
```

**Per-category acceptance rate — preferences as example:**

```apl
['besidka-consent']
| where isnotempty(['consent.granted'])
| extend grantedPreferences = array_contains(['consent.granted'], 'preferences')
| summarize
    total = count(),
    grantedCount = countif(grantedPreferences == true)
| extend acceptanceRate = round(todouble(grantedCount) / todouble(total) * 100, 1)
```

**Receipt lookup by consent id — support flow:**

```apl
['besidka-consent']
| where ['consent.id'] == "<paste-id-here>"
| project _time, ['consent.id'], ['consent.decision'],
    ['consent.granted'], ['consent.revision'], ['consent.consistent']
| sort by _time desc
```

## Storage strategy — D1 system of record

**Status: IMPLEMENTED.** `/api/v1/consents` persists every receipt to a
dedicated Cloudflare D1 database (`CONSENT_DB`) in addition to the Axiom
wide-event log. D1 is the legal system of record; Axiom is the analytics
layer.

### Table schema

```sql
CREATE TABLE IF NOT EXISTS consent_receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  granted TEXT NOT NULL,       -- JSON array of granted category ids
  denied TEXT NOT NULL,        -- JSON array of denied category ids
  changed TEXT NOT NULL,       -- JSON array of changed category ids
  decision TEXT NOT NULL,      -- 'all' | 'partial' | 'none'
  consistent INTEGER NOT NULL DEFAULT 0,  -- 1 = cookie matched body
  country TEXT                 -- cf-ipcountry header, nullable
);
CREATE INDEX IF NOT EXISTS idx_consent_receipts_created_at
  ON consent_receipts (created_at);
```

Migration file: `.drizzle/migrations-consent/0000_deep_stardust.sql`
(generated by Drizzle Kit from `server/db/consent/schema.ts` via `pnpm run db:consents:generate`)

Bindings:
- Default env: `CONSENT_DB` → `besidka-consent-preview`
- Production env: `CONSENT_DB` → `besidka-consent`

No foreign keys — zero interaction with the cascade-sensitive app schema
(see the D1 migration safety rules in `CLAUDE.md`).

### Applying migrations

**Local (miniflare state — already applied):**

```bash
pnpm run db:consents:migrate
```

**Preview (run this before production):**

```bash
pnpm run db:consents:migrate:preview
```

**Production:**

```bash
pnpm run db:consents:migrate:prod
```

Always apply to preview first and verify a row lands before applying to
production.

### CI auto-apply

GitHub Actions applies `CONSENT_DB` migrations automatically alongside the
main `DB`, mirroring the existing migration pipeline:

- **PR (same-repo) build success** → `preview-deploy.yml` applies
  `CONSENT_DB --remote` from the uploaded `.drizzle` artifact (which includes
  `.drizzle/migrations-consent/`).
- **Merge / push to `main`** → `production.yml` (`build-production`) applies
  `CONSENT_DB --remote --env production`, gated on any change under
  `.drizzle/`, regenerating first via `pnpm run db:consents:generate`.
- **Direct push to `main` without a PR** → `production.yml`
  (`deploy-preview-direct-push`) applies `CONSENT_DB --remote` to preview.

`wrangler d1 migrations apply` is idempotent, so these steps only run
migrations not yet recorded in `CONSENT_DB`'s `d1_migrations` table. See
[`.github/workflows/README.md`](../.github/workflows/README.md#database-migrations)
for the full matrix. Manual `:preview` / `:prod` commands remain available for
out-of-band application.

### Support lookup

Point lookup by consent id:

```bash
pnpm exec wrangler d1 execute CONSENT_DB --remote \
  --command "SELECT * FROM consent_receipts WHERE id = '<paste-id>'"
```

Production:

```bash
pnpm exec wrangler d1 execute CONSENT_DB --env production --remote \
  --command "SELECT * FROM consent_receipts WHERE id = '<paste-id>'"
```

### Art. 17 GDPR — erasure and pseudonymization

Consent receipts contain no direct personal identifiers: `id` is a
random UUID with no link to a Better Auth user record, and IP addresses
are never stored. The `country` column is aggregate metadata (ISO 3166
two-letter code).

**Option A — Row deletion (erasure).** Delete by consent id when the
data subject cannot be linked to any stored identifier anyway and when
national law permits it (Art. 17(3)(b) allows retention for legal claims):

```sql
DELETE FROM consent_receipts WHERE id = ?;
```

**Option B — In-place pseudonymization.** Replace array fields with
empty arrays, preserving the audit trail structure (timestamp, decision
bucket, revision) while removing category-level detail:

```sql
UPDATE consent_receipts
SET granted = '[]', denied = '[]', changed = '[]', country = NULL
WHERE id = ?;
```

Choose Option B when you need to prove a decision was recorded (Art. 7(1)
accountability) but need to reduce the data footprint. Choose Option A
when no accountability interest survives.

Note: Art. 17(3)(b) allows continued processing for the establishment,
exercise, or defence of legal claims. A 3–5 year retention window is
appropriate for most EU supervisory authority inquiry windows.

### Retention cleanup

No automatic cleanup is implemented yet. To manually purge receipts older
than five years (run locally or in a cron Worker):

```sql
DELETE FROM consent_receipts
WHERE created_at < date('now', '-5 years');
```

A future scheduled Worker (Cloudflare Cron Trigger) can automate this
by running the DELETE on a monthly schedule.

### Decision matrix (why D1, not Axiom)

| Option | Retention | Erasure/pseudonymization | Verdict for receipts |
| --- | --- | --- | --- |
| Axiom (free) | 30 days, fixed | No event-level deletion | Dashboards/monitors only |
| Axiom (paid) | Custom per dataset | Still no surgical deletion | Long-term receipts violate Art. 17 handling |
| CF Analytics Engine | 92 days | None, sampled at volume | Disqualified — receipts must be lossless |
| CF D1 (SQLite) | Manual (yours) | `UPDATE`/`DELETE` per row | **System of record** ✓ |
| CF R2 (JSONL archive) | Lifecycle/locks | Immutable — conflicts with erasure | Cold WORM archive of exports only |

Axiom remains the analytics layer (acceptance rates, withdraw spikes,
consistency monitoring). Analytics Engine stays as the cookieless,
first-party page analytics layer and must not hold consent receipts
(sampling + 92-day limit).

## Axiom setup — datasets and dashboards

### Free plan constraints (verified)

- 30-day retention on every dataset, not configurable.
- **Maximum 3 datasets** — Besidka uses all three slots:
  - `axiomDataset` — main operational telemetry
  - `axiomAuditDataset` — long-retention compliance copy (receipts + audit events)
  - `axiomConsentDataset` — dedicated consent analytics (30-day rolling window)
- Monitors with email/Discord notifications are available.

### Creating a dataset + wiring it

**Audit dataset:**

1. Axiom → **Datasets → New dataset** → name it (e.g. `besidka-audit`).
2. **Settings → API tokens → New token** → ingest permission, scoped to that
   dataset only.
3. Set the secrets:

   ```bash
   npx wrangler secret put NUXT_AXIOM_AUDIT_DATASET
   npx wrangler secret put NUXT_AXIOM_AUDIT_TOKEN
   ```

**Consent dataset:**

1. Axiom → **Datasets → New dataset** → name it (e.g. `besidka-consent`).
2. **Settings → API tokens → New token** → ingest permission, scoped to that
   dataset only.
3. Set the secrets:

   ```bash
   npx wrangler secret put NUXT_AXIOM_CONSENT_DATASET
   npx wrangler secret put NUXT_AXIOM_CONSENT_TOKEN
   ```

   Locally: `.dev.vars` with the same keys for both datasets.

### Dashboards worth building (consent dataset)

Create via **Dashboards → New dashboard**, one APL query per panel,
using the `besidka-consent` dataset (30-day rolling window):

1. **Decision split** (donut / statistic): the all/partial/none counts —
   query in "Example Axiom APL queries" above.
2. **Acceptance trend** (time series):

   ```apl
   ['besidka-consent']
   | where ['consent.decision'] != ""
   | summarize count() by ['consent.decision'], bin(_time, 1d)
   ```

3. **Per-category acceptance** (table): the acceptance-rate query above,
   repeated per category id, or extended with one `countif` per category.
4. **Withdrawals** (time series + monitor): decisions turning `none` —
   alert on spikes (often means a scary banner change or a bug):

   ```apl
   ['besidka-consent']
   | where ['consent.decision'] == "none"
   | summarize count() by bin(_time, 1h)
   ```

5. **Consistency monitor** (monitor → threshold): `consent.consistent ==
   false` should stay near zero; a spike means the client/cookie race
   regressed:

   ```apl
   ['besidka-consent']
   | where ['consent.consistent'] == false
   | summarize count() by bin(_time, 1h)
   ```

6. **Geography** (bar): `summarize count() by ['country']` — consent
   behavior per market.

### Why a dedicated consent dataset instead of reusing audit?

The 30-day Axiom free-plan window is intentional for the `besidka-consent`
dataset. Consent analytics (acceptance rates, withdrawal spikes, consistency
monitoring) are operational dashboards with a short horizon — the rolling
30-day window is sufficient. The `besidka-audit` dataset retains receipts for
the full 3–5 year compliance window. The separation also keeps token scoping
clean: a read-only token for the consent dataset can be shared with a
front-end dashboard tool without exposing request-level audit events.

**Access scope** — audit data should be queryable without exposing
request-level app logs (token scoping is per dataset). The three-dataset
split gives the right shape: receipts land in all configured drains in
parallel, D1 is the system of record, and each Axiom dataset has a
distinct governance purpose.

---

## Regulatory status of server-side logging (EU + US)

Research date: 2026-06-12. Sources: EDPB Guidelines 2/2023 (technical scope
of ePrivacy Art. 5(3), final Oct 2024), EDPB Guidelines 1/2024 (legitimate
interest), EDPB Guidelines 05/2020 (consent), WP29 Opinion 04/2012, GDPR
Recital 49, CCPA/CPRA + 2026 state privacy laws, CIPA litigation trends,
FTC Act §5 guidance.

### Verdict: logging is NOT subject to cookie consent

Cookie consent (ePrivacy Art. 5(3)) regulates **storing or reading
information on the user's terminal equipment**. All Besidka observability
(evlog wide events for API requests, Vercel AI SDK usage, Better Auth
context, custom fields → Axiom; Cloudflare Workers observability) is
**server-side observation** of data the browser sends anyway — outside
Art. 5(3) per EDPB Guidelines 2/2023. In the US, no state requires opt-in
consent for first-party operational logging; it falls under the CCPA
"business purpose" exception (security, debugging, auditing).

Consequences:

- Do **not** add a "logging" category to the banner.
- Do **not** gate evlog on consent — the legal basis is GDPR
  Art. 6(1)(f) **legitimate interest** (Recital 49 explicitly endorses
  network/information-security logging), which cannot be "withdrawn" the
  way consent can. Users instead have an Art. 21 right to object,
  handled case by case.
- Reading the `better_auth.session_token` cookie server-side IS terminal
  access, but is covered by the strictly-necessary exemption. The
  `cookies_consent` cookie itself is likewise exempt (it implements the
  consent mechanism).
- The line not to cross: combining server-observable signals (IP + UA
  hashing) into a persistent cross-session identifier is fingerprinting
  and WOULD fall back under Art. 5(3) consent (cf. the Criteo
  enforcement). Nothing in the codebase does this; keep it that way.

### Verified data-flow facts (audited 2026-06-12)

What actually ships to Axiom — verified against `evlog` internals and the
drain pipeline, not just our call sites:

- **No raw IP address ever reaches Axiom.** `attachCloudflareMeta()`
  (`server/utils/cloudflare-meta.ts`) attaches only `cfColo`, `cfCountry`,
  `cfRegion`, `cfRegionCode`, `cfContinent`, `cfAsn`, `cfTimezone` —
  country/region-level aggregate metadata, no `cf-connecting-ip`, no
  city/latitude/longitude.
- **Request headers are never serialized into the Axiom payload.** evlog
  drains receive headers only as side context (`ctx.headers`, already
  passed through `filterSafeHeaders` which strips `authorization`,
  `cookie`, `x-api-key`); `defineDrain` ships **only `ctx.event`** (the
  wide event) to the ingest endpoint. The only header-derived value in
  the event is `requestMeta.cfRay` (infrastructure request id).
- **evlog's optional `userAgent`/`geo` enrichers are NOT enabled** — the
  geo enricher would add city/lat/long; it is not wired anywhere. Do not
  enable it without revisiting this section.
- `redact: true` masks request/response bodies; fields passed explicitly
  to `logger.set()` bypass redaction — minimization happens at the call
  site (see below).
- Auth routes (`/api/auth/**`) are excluded from the identity middleware;
  `maskEmail: true` hashes the email field
  (`server/middleware/evlog-auth.ts`).
- Chat message content, prompts, completions, and reasoning output are
  **never** logged.
- Raw IP + user-agent exist in exactly two places, neither of which is
  Axiom: the `sessions` table (Better Auth session security / rate
  limiting — D1 only) and Cloudflare Workers Logs
  (`wrangler.jsonc` → `observability.enabled`, Cloudflare-side short
  retention). Both rest on legitimate interest and must be disclosed in
  the privacy policy.

### Per-sink legal basis

| Sink | Personal data | Legal basis | Notes |
| --- | --- | --- | --- |
| Axiom main | `userId`, `userName`, country-level geo | Art. 6(1)(f) legitimate interest | Ops/security/cost telemetry; 30-day retention is fine |
| Axiom audit | same + `audit` actions | Art. 6(1)(f) + Art. 7(1) accountability | Long retention justified by consent-proof duty |
| Axiom consent | pseudonymous receipt only | Art. 7(1) (legally required) | No user link, no IP, no UA |
| D1 `CONSENT_DB` | pseudonymous receipt + country | Art. 7(1) | System of record |
| CF Workers Logs | raw IP, UA in headers | Art. 6(1)(f) (Recital 49) | Cloudflare-side retention is short; disclose |
| `sessions` table | raw IP, UA | Art. 6(1)(f) session security | Deleted with session lifecycle |
| AI SDK telemetry | tokens, estimated cost, tool-call shape | Art. 6(1)(f) / Art. 6(1)(b) billing | Tool input **content** is not captured (see below) |

US view: none of the above is a CCPA "sale" or "share" — Axiom and
Cloudflare act as service providers under their standard DPAs. A
"Do Not Sell or Share" link and GPC handling become relevant only when
analytics/marketing categories activate with third-party ad-tech.

### Data-minimization rules at logging call sites

`logger.set()` bypasses `redact: true`, so user-generated **content**
must never be passed to it — log shape, not substance:

- Chat rename logs `titleLength`, not the title
  (`server/api/v1/chats/[slug]/rename.patch.ts`).
- Project create/rename log `nameLength`, not the name
  (`server/api/v1/projects/index.put.ts`,
  `server/api/v1/projects/[id]/name.patch.ts`).
- Project instructions/memory endpoints log `hasInstructions` /
  `enabled` booleans only.
- AI tool inputs (e.g. `web_search` queries — conversation-derived
  content) are transformed to `{ length }` before capture
  (`createAILogger` `toolInputs.transform` in
  `server/api/v1/chats/[slug]/index.post.ts`). Tool **names** and
  counts remain logged.
- Known justified exception: `fileName` appears in file-persistence
  **error paths** (`server/utils/files/persist-file.ts`) — needed to
  debug failed uploads; covered by legitimate interest, disclosed here.

When adding a new `logger.set()` call, apply the same test: if the value
was typed by a user, log its length/hash/presence — not the value. This
also keeps CIPA (California wiretapping) exposure at zero: the 2022–2026
litigation wave targets sites sharing communication content with
third-party vendors; Besidka ships none to Axiom.

### Compliance checklist (org-side, before/with feat/244 legal pages)

1. **Privacy policy** must disclose: purposes (security, debugging, cost
   monitoring, consent accountability); legal bases (legitimate
   interest; Art. 7(1) for receipts); categories (user id, country,
   usage/cost, request metadata; IP/UA in CF logs and session records);
   **named processors: Axiom, Inc. and Cloudflare, Inc.**; retention
   per sink; transfer mechanism (EU-US Data Privacy Framework); user
   rights incl. Art. 21 objection to legitimate-interest processing.
2. **Processor paperwork**: verify Axiom on
   <https://www.dataprivacyframework.gov/participant-search> and keep
   their DPA on file; Cloudflare Customer DPA (v6.3+, DPF-certified).
   If DPF reliance fails, fall back to SCCs.
3. **Document a short LIA** (legitimate-interest assessment) + retention
   table — converts "probably fine" into demonstrable Art. 5(2)
   accountability. The three-part test (purpose/necessity/balancing)
   passes for this setup given the minimization above.
4. **When analytics/marketing categories activate**: add a
   "Do Not Sell or Share My Personal Information" mechanism
   (California), detect and honor the `Sec-GPC` header server-side
   (12 states mandate GPC as of 2026), propagate opt-outs to any
   analytics vendor, and consider adding a `gpc` boolean to consent
   receipts.
5. **Do not** enable evlog's geo enricher (city/lat/long), log raw IPs
   to Axiom, or build identifiers from IP+UA — each would change the
   legal analysis above.
