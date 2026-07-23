# Axiom map fields — evlog wide-event schema limit

> **Do not deploy this change until the `attributes` field has been declared
> a map field on `besidka-prod` (and `besidka-audit-prod` /
> `besidka-consent-prod`).** Run `scripts/axiom-declare-map-field.mjs` first
> (see [Rollout](#rollout) below). The `besidka-prod` schema is already at
> Axiom's 256-field cap. If the code below deploys before the map field
> exists, `attributes.*` becomes a batch of brand-new flat fields that try to
> push the schema past 256 and get **rejected** — turning currently-succeeding
> log writes into failures. Declaring the map field first is what makes this
> a fix instead of a regression.

## What happened

Axiom emailed that `besidka-prod` hit its 256-field-per-dataset schema limit
and started rejecting events that would add new fields. Axiom's own fix
recommendation is [map fields](https://axiom.co/docs/apl/data-types/map-fields).

## Root cause

Our evlog → Axiom drain (`server/utils/evlog-drains.ts`, `evlog/axiom`) just
`JSON.stringify()`s each wide event and POSTs it — there's no field-limit
awareness on our side. Axiom flattens **every nested JSON key path** in a
plain (non-map) field into its own permanent schema field: logging
`research: { provider, modelId }` creates two schema fields,
`research.provider` and `research.modelId`, forever — Axiom's schema is a
high-water mark that never shrinks on its own.

With 60+ server files each calling `logger.set()` with their own
domain-namespaced object (`chat`, `project`, `push`, `research`,
`imageGeneration`, `fileConversion`, ...), all shipping into the *same*
`besidka-prod` dataset, the union of distinct field paths across the whole
app's history grew past 256. An audit of every `logger.set()` call site
found 267 distinct nested field paths across 63 files — comfortably enough,
combined with evlog's own reserved fields and Cloudflare request metadata, to
explain the breach.

Field **names** cause this, not field **values** — a field like
`research.error` only ever counts once regardless of how many different
error strings flow through it. The fix is about *which fields exist*, not
about "unpredictable data."

## The fix

Added one reserved wide-event field, `attributes`, typed via evlog's
sanctioned `declare module 'evlog'` extension point
(`server/types/evlog.d.ts`):

```ts
declare module 'evlog' {
  interface BaseWideEvent {
    attributes?: Record<string, Record<string, unknown>>
  }
}
```

`attributes` is declared as an **Axiom map field** (see
[Rollout](#rollout)) — once declared, anything nested under it, at any
depth, is exempt from the field-count check, no matter how many different
sub-keys different call sites add over time. This mirrors exactly how Axiom
handles OpenTelemetry's `attributes.custom` field for arbitrary span
attributes.

Across 26 files, the ~55 field paths identified as high-variety and rarely
filtered by exact value — free-form exception messages/stacks, provider ids,
model ids, media/mime types, and error-code enums with many variants — moved
from `<domain>.<key>` to `attributes.<domain>.<key>`. Bounded, genuinely
useful-to-filter dimensions (entity ids, status/phase enums, counts,
operation names) were left flat exactly where they were.

Example (`server/utils/research/start.ts`):

```ts
// Before — errorCode/errorMessage are each a new permanent schema field
input.logger.set({
  research: {
    phase: 'start',
    jobId: job.id,
    errorCode: chatError.code,
    errorMessage: chatError.why,
  },
})

// After — phase/jobId stay flat and queryable; errorCode/errorMessage nest
// under the declared map field and never grow the schema
input.logger.set({
  research: {
    phase: 'start',
    jobId: job.id,
  },
  attributes: {
    research: {
      errorCode: chatError.code,
      errorMessage: chatError.why,
    },
  },
})
```

A small helper, `server/utils/evlog-attributes.ts`, DRYs up the
`exception instanceof Error ? exception.message : String(exception)` pattern
that was repeated at ~20 call sites:

```ts
import { exceptionMessage, exceptionStack } from '~~/server/utils/evlog-attributes'
```

## Rollout

Two independent, ordered steps:

1. **Before deploying this code**, declare `attributes` as a map field on
   Axiom:
   ```bash
   AXIOM_API_TOKEN=xapt-... node scripts/axiom-declare-map-field.mjs
   ```
   This needs a **management-scoped** Axiom API token (Settings → API
   tokens → a token with `datasets:update`), not the ingest-only token
   already configured as `NUXT_AXIOM_TOKEN`/`NUXT_AXIOM_AUDIT_TOKEN`/
   `NUXT_AXIOM_CONSENT_TOKEN`. Never store that management token as a Worker
   secret — run the script locally and discard it. It targets all three
   datasets (`besidka-prod`, `besidka-audit-prod`, `besidka-consent-prod`) by
   default, since a request's wide event can carry `attributes` alongside an
   `audit` or `consent` marker field and would otherwise flow through those
   drains too.
2. **Then deploy.** New events that nest data under `attributes` stop
   introducing new schema fields immediately — this unblocks the events Axiom
   is rejecting today, right away, without waiting on anything else.

## What this does *not* do

Declaring a map field is **prospective only**. It does not shrink
`besidka-prod`'s existing ~256-field count — the flat fields already in the
schema (e.g. the pre-migration `research.error`) stay there until they leave
Axiom's retention window or are explicitly removed. Axiom's own docs are
direct about this: converting a field to a map "affects new events"; events
ingested before the change "retain the ordinary structure."

If you need headroom back sooner than that, the options (from
[Axiom's limits doc](https://axiom.co/docs/reference/field-restrictions)),
independent of this code change:

- **Trim + vacuum** (`POST /v1/datasets/{dataset}/trim` then
  `POST /v2/datasets/{dataset}/vacuum`) — trim deletes old data blocks
  (destructive to that log history), vacuum then rebuilds the schema from
  what's left within retention. Vacuum is async (can take hours) and limited
  to once per dataset per day.
- **Upgrade the Axiom plan** — 256 fields is the Personal-plan limit; Axiom
  Cloud raises it to 1,024 (itself a soft limit, raisable further on
  request). This is the lowest-effort way to get real headroom back without
  auditing which of this app's remaining ~212 flat fields are safe to
  demote — that judgment call needs visibility into which fields live
  dashboards/alerts actually query, which this audit didn't have.
- **Fresh dataset** — starts at 0 fields; loses continuity with existing
  history/dashboards pointed at `besidka-prod`.

This PR's code change stops the schema from growing further and unblocks
ingestion of the previously-rejected event shapes. It intentionally does not
attempt to reclaim the existing headroom or pick a plan/trim strategy — those
are operational/cost decisions, not code changes.

## Convention going forward

When adding a new `logger.set()` field, ask: is this a small, bounded
dimension someone would actually filter or alert on (an id, a status/phase
enum, a count, an operation name)? Keep it flat. Is it free-form text, an
identifier that grows as the product grows (provider/model ids, mime types),
or an error-code enum with many variants? Nest it under
`attributes.<domain>`, using the existing domain object's name.
