# Gateway restoration + Brave/Exa search providers — implementation plan

Status: PLANNED. Nothing in this document has been executed yet. Update the
`- [ ]` checkboxes in place as each work package lands.

Branch: `feat/add-more-providers` · PR #362 · worktree
`/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers`

## Why this exists

Gateway support (Vercel AI Gateway, Cloudflare AI Gateway, OpenRouter) was
built on this branch and then fully removed in `24df3b5`, on the reasoning
that gateways did not support native web search and therefore bought
nothing. `docs/web-search-cost-accounting.md` (merged from `main` as PRs
#385/#386/#387) then established that provider-native web search is billed
on a **separate SKU from tokens**, at $10–$35 per 1,000 units, and that this
app had been under-reporting roughly 70% of a real Google bill because of
it. That changes the calculus twice over:

1. Gateways become worth having again — they are a routing choice the user
   can make per model, and the research in
   `docs/web-search-cost-accounting.md` § "The AI Gateway question" says
   both Vercel and Cloudflare gateways pass provider-native tools through
   unmodified (inferred from architecture, **not** end-to-end verified).
2. A BYOK external search backend becomes worth having — Brave at $5/1,000
   is cheaper than every native option, and Exa at $7/1,000 + $1/1,000 per
   extracted page reports its own real cost per response. Both collapse an
   O(providers) search-accounting problem into O(1).

Prior art, read both before executing anything here:

- **`docs/web-search-cost-accounting.md`** (602 lines) — the cost model this
  plan extends. Its § "Sketch: external search backends", § "Double
  counting, once an external backend exists", § "Key storage" and
  § "If we build this next" are the design sketch Epic 1 implements. Its
  § "Privacy — a blocker, not a footnote" is why Epic 3 is in scope and not
  an afterthought.
- **`docs/gateway-removal-plan.md`** (1499 lines) — the removal's own
  reverse-blueprint. § 3 is a per-file spec of exactly what was deleted and
  how; read it **backwards** and it is the restoration spec. § 2 is the
  database runbook whose *inverse* Epic 2 performs. § 5's risk flags (R1–R9)
  still apply in mirror image. That document's `Status: EXECUTED` header
  needs a "superseded by this plan" note once Epic 2 lands.

Two further inputs are not in the repo but are cited throughout by section:
the five research files produced for this effort (gateway-removal
archaeology, current-codebase audit, AI SDK v7 capabilities, Brave/Exa API
research, and the orchestrator's decisions brief). Where this plan says
"per file 00" it means the orchestrator's decisions-and-brief document,
which is where every architectural decision restated below was actually
made.

## Decided architecture (restated so this document stands alone)

These four decisions were made by the product owner and an advisor before
planning began, and are recorded in the orchestrator's decisions brief
(research file `00-orchestrator-decisions-and-brief.md`). They are **not**
open for re-litigation by an executor. Restated here in this plan's own
words so a future reader needs no other document:

### 1. The cost display splits into two non-overlapping mechanisms

- **`MessageUsage.totalCost`** — currently marked legacy/read-only in
  `shared/types/message-usage.d.ts:17-20` — **revives as a live field**,
  written only by restored gateway send paths. It carries one *blended*
  total because that is the only shape a gateway reports: OpenRouter gives
  `providerMetadata.openrouter.usage.cost`, Vercel gives an async
  `getGenerationInfo()` total, Cloudflare gives nothing and gets an estimate
  from catalog pricing. **Do not build a decomposition mechanism for gateway
  cost.** It does not exist upstream and inventing one would fabricate
  numbers.
- **`searchCost` / `searchUnits` / `searchBillingUnit`** — the existing
  fields from #385/#386/#387 — cover every search where *this app* knows
  rate × count: the four native integrations (Google, Anthropic, OpenAI,
  xAI) plus the two new ones (Brave, Exa). A new **`searchProvider`** field
  is added alongside them so the context-menu row can read
  "Web search (Brave)" instead of a bare "Web search".
- **The one blended exception:** never set `searchCost` when the search fee
  is already inside a gateway's blended `usage.cost` — that is OpenRouter's
  `plugins: [{ id: 'web' }]` and Vercel's `client.tools.perplexitySearch()`.
  Setting it there double-counts. This must be a loud code comment at the
  write site, not a silent convention.
- **No new summation code is needed — verified against HEAD, not assumed.**
  `getPerMessageCost()` (`shared/utils/message-metadata.ts:196-214`) reads
  `usage.totalCost` first and only falls back to `usage.outputCost`:

  ```ts
  if (usage?.totalCost !== undefined) {
    return resolveDisplayCost(usage, usage.totalCost)
  }
  return resolveDisplayCost(usage, usage?.outputCost)
  ```

  and `sumMessageCosts()` (`:284-294`) adds `getPerMessageCost()` and
  `getPerMessageSearchCost()` as separate terms. So a turn on a
  gateway-routed model that also fired a Brave tool call sums correctly
  **today**, with no change to either function.

  (`docs/web-search-cost-accounting.md:262-263` says `getPerMessageCost()`
  "reads `outputCost` only". That was accurate about the search-cost work's
  own concern — search cost is excluded from the per-message line — but it
  is not a complete description of the function, which kept its `totalCost`
  preference right through the removal. Do not "fix" the code to match that
  sentence; fix the sentence, per the MD checklist.)

The payoff is that the owner's cost-comparison thesis becomes directly
measurable in the UI: a native `searchCost` and a Brave/Exa `searchCost` are
the same kind of line item, comparable one-for-one, and neither is hidden
inside a blended gateway figure.

### 2. Brave/Exa selection is encoded as new `ModelTool` values

New `ModelTool` members `'web_search_brave'` and `'web_search_exa'` — **not**
a new top-level request field. The reason is the first-turn trap at
`server/api/v1/chats/[slug]/index.post.ts:188-191`:

```ts
const selectedTools = chat.messages.length === 1
  && chat.messages[0]?.role === 'user'
  ? chat.messages[0]?.tools || []
  : body.data.tools
```

On turn one the tools come from the **persisted draft user-message row**,
not the request body. A new top-level field would need fresh threading
through that exact path plus its own persistence column. A `ModelTool` value
inherits `chatToolSchema` validation, `messages.tools` persistence
(`server/db/schemas/chats.ts:53-56`, typed `$type<ModelTool[]>()`), and — via
`TOOL_LABELS: Record<ModelTool | 'deep_research', string>` in
`ContextMenu.client.vue:255-259`, a *total* `Record` — a compile error that
forces the executor to supply a UI label.

At most one of `web_search` / `web_search_brave` / `web_search_exa` may be
present per message, and none of them may coexist with `image_generation`.

### 3. Tool calling is a new `Model` field, fetched — never a `ModelTool`

`Model.toolCall: boolean`, fetched from models.dev's existing `tool_call`
field exactly the way `modalities` already is. It is **not** a `ModelTool`
value: `ModelTool` means "a capability the user can switch on for a turn,
which gets persisted per message", and tool-calling is neither. Conflating
them would make "tool calling" a user-selectable, persisted per-message
value that it is not.

The two flags serve two different purposes and both are needed:
`Model.toolCall` gates *whether Brave/Exa are offered at all* for the
selected model; `ModelTool` records *which search path the user picked* for
this turn.

### 4. Keys are stored by widening `keys.provider`, with a `kind` discriminator

Widen the `keys.provider` Drizzle text enum with `brave`, `exa`,
`vercel-gateway`, `cloudflare-gateway`, `openrouter`. This is **TypeScript
only** — Drizzle's sqlite-core text enum emits no SQL `CHECK` constraint, so
no migration is generated. Precedent is documented at
`docs/providers/general.md:250-254`: Qwen's addition produced "No schema
changes, nothing to migrate".

`docs/web-search-cost-accounting.md:515-522` argued *against* this, on the
grounds that the enum "leaks" into `SupportedProviderId` and every provider
`switch` would gain an unreachable `brave` branch. **That objection has been
checked and does not hold in the current code.** `SupportedProviderId`
(`shared/types/providers.d.ts:4-12`) is a hand-written union of the seven
direct providers with no derivation from `keys.provider.enumValues`, and
`toSupportedProviderId()` (`index.post.ts:1678-1684`) already filters an
arbitrary string down to that union. Nothing decouples; the leak the cost
doc feared was closed independently. That superseded recommendation should
be annotated in `docs/web-search-cost-accounting.md` rather than silently
left standing (see the MD checklist at the end).

`ProviderMeta.kind` — currently the single-valued `'provider'`, a survivor of
the gateway era — widens back to `'provider' | 'search' | 'gateway'`. The
already-generic `Profile/Keys/ProviderKeyCard.vue` then renders a working
Brave/Exa key form from a `providerMeta` entry alone, and
`Profile/Keys/CloudflareGateway.vue` (restored in Epic 2) remains the one
bespoke card, because Cloudflare stores a JSON blob of three fields inside
the single encrypted `keys.apiKey` column.

## Global conventions for every work package

**Model tiering (orchestrator policy, applies to all epics).** Every work
package is sized for a **Sonnet** coder. **Opus is reserved for exactly one
package: WP 2.6, the `server/api/v1/chats/[slug]/index.post.ts` rebuild.**
No other package may be escalated. Each package below restates its tier
explicitly so a dispatching agent never has to infer it. (Note for the
orchestrator's own risk tracking, not a tiering override: WP 2.8's
`ModelsTrigger.vue` rebuild is the second-riskiest package — a 378-line
structural re-add against a file that has since grown a legacy-models
section. The old removal plan tiered its inverse as Opus. It stays Sonnet
per policy, but deserves a dedicated reviewer pass.)

**Epic gating.** Epics run strictly in order 0 → 1 → 2 → 3. An epic's
workers may not start until the previous epic is (a) CI green on PR #362 and
(b) manually browser-verified per that epic's stated script. Packages
*within* an epic may run in parallel only where the package says so.

**Standard verification vocabulary.** Where a package says "run the standard
gates", that means, in this order:

```bash
pnpm run format && pnpm run typecheck
pnpm run lint
pnpm vitest run <the spec files this package names>
pnpm run db:generate        # see the per-epic expectation below
```

`pnpm run db:generate` expectations, stated per epic so a surprise is caught
immediately rather than at merge:

| After | Expected `db:generate` output |
| --- | --- |
| Epic 0 | **Nothing.** The `keys.provider` widening is TS-only. |
| Epic 1 | **Nothing.** No schema change at all. |
| Epic 2 | **Exactly one** migration containing exactly `ALTER TABLE \`user_settings\` ADD \`favorite_gateway_models\` text;` and **no** `DROP TABLE` anywhere. |
| Epic 3 | **Nothing.** Content only. |

If any of those produces something else, stop and reconcile — never commit a
migration you did not expect.

**Test registration is mandatory.** Every new or renamed spec file must be
registered in `scripts/test-affected-check.mjs` in the **same commit**, or it
never runs on a PR. That file is organised as named `const <topic>Tests = [
...]` arrays near the top, consumed by a `testMappings` array of
`{ pattern: RegExp, tests: string[] }` entries. Each package below names the
exact group(s) to extend.

**Axiom telemetry.** Every new telemetry field goes under the `attributes`
map field. `besidka-prod` has already hit Axiom's 256-field-per-dataset cap
once; a new flat nested key becomes a permanent schema field. See
`docs/axiom-map-fields.md`.

**Browser verification.** Real owner test credentials exist in `.dev.vars`
for **every** integration in this plan — `NUXT_BRAVE_SEARCH_API_KEY`,
`NUXT_EXA_API_KEY`, `NUXT_VERCEL_AI_GATEWAY_API_KEY`,
`NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY` + `NUXT_CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID`,
and `NUXT_OPENROUTER_API_KEY`. **Both epics are therefore fully
live-verifiable**, and § "Epic 2 live verification" near the end of this
document is a required gate, not an aspiration.

Two constraints on *how* those keys are used:

- **They are owner dev/testing keys only. They must never become a
  server-side fallback for a user without their own key.** BYOK means the
  spend lands on the user's account; a env-var fallback would silently
  invert that for every user. The production mechanism remains per-user
  encrypted storage via `/profile/keys`. Nothing in this plan reads these
  env vars from application code — they exist so a human (or a script run
  from the scratchpad) can exercise a real path locally.
- **An agent must not type an API key into a web form.** For any
  browser script below that needs a saved key, the owner performs the save
  step; the agent verifies the resulting state.

---

# Epic 0 — shared infrastructure

Everything downstream depends on these three packages. They may run in
parallel with each other (disjoint file sets), but **all three must be green
before Epic 1 starts**.

## WP 0.1 — `keys.provider` enum widening + `providerMeta` `kind` discriminator

**Tier: Sonnet.** Small, fully specified, no discovery.

### Files touched

| Path | Nature |
| --- | --- |
| `server/db/schemas/keys.ts` | new code (hand edit) |
| `shared/utils/provider-meta.ts` | new code (hand edit) |
| `app/components/ProviderIcon.vue` | new code (hand edit — 2 entries only) |
| `app/assets/icons/exa.svg` | new asset |

### What changes, concretely

**`server/db/schemas/keys.ts`** — widen the `provider` text enum from 7 to
12 values, in this exact order (direct providers first, unchanged, then
search, then gateways):

```ts
enum: [
  'openai', 'anthropic', 'google', 'xai', 'deepseek', 'moonshotai', 'qwen',
  'brave', 'exa',
  'vercel-gateway', 'cloudflare-gateway', 'openrouter',
]
```

All five new values land **now**, in Epic 0, even though the three gateway
values have no UI or API route until Epic 2. Rationale: the widening is what
flips `server/api/v1/profiles/keys/index.get.ts` (which iterates
`schema.keys.provider.enumValues` dynamically), and doing it once means one
test flip instead of two. The three gateway ids simply report
`hasKey: false` in the summary payload until Epic 2 — inert, because
`useUserKeys()` only ever looks up a `keyProviderId` that exists in
`providerMeta`, and no gateway `providerMeta` entry exists yet.

**Note the three-id-space naming trap** (documented at
`docs/gateway-removal-plan.md` and in the archaeology report §1.3): the DB
enum value is `vercel-gateway` and `cloudflare-gateway` **with** the suffix,
but `openrouter` **without** it. A hardcoded `'vercel'` where
`'vercel-gateway'` was needed produces a silent "key never found", not a
crash. `providerMeta[].keyProviderId` is the only place that mapping may be
written.

**`shared/utils/provider-meta.ts`** — three changes:

1. `ProviderMeta.kind` widens from `'provider'` to
   `'provider' | 'search' | 'gateway'`.
2. `ProviderMetaKeyField.name` widens from `'apiKey' | 'accountId'` to
   `'apiKey' | 'accountId' | 'gatewayId'`. (`'accountId'` is already present
   as a vestige of the Cloudflare gateway card; `'gatewayId'` was removed and
   comes back for the same card in Epic 2.)
3. Two new entries with `kind: 'search'`:

```ts
brave: {
  id: 'brave',
  kind: 'search',
  label: 'Brave Search',
  keyProviderId: 'brave',
  dashboardUrl: 'https://api-dashboard.search.brave.com/app/keys',
  dashboardLabel: 'Brave Search API → Subscriptions (the Search plan; '
    + 'a card is required even for the free monthly credit)',
  keyFields: [apiKeyField],
},
exa: {
  id: 'exa',
  kind: 'search',
  label: 'Exa',
  keyProviderId: 'exa',
  dashboardUrl: 'https://dashboard.exa.ai/api-keys',
  keyFields: [apiKeyField],
},
```

4. Add an exported, ordered list so no UI hardcodes the set:

```ts
export const enabledSearchProviders: string[] = ['brave', 'exa']
```

Brave first is a product decision, matching
`docs/web-search-cost-accounting.md`'s "Brave is the better default"
conclusion, and it must be the display order everywhere.

5. Rewrite `resolveProviderMetaByKeyProviderId()`'s doc comment
   (`:90-97`). It currently says messages "sent through a now-removed
   integration … simply resolve to `undefined` here". That becomes false the
   moment the gateway entries land in Epic 2. Restore the original framing:
   this indirection exists **only** because `vercel-gateway` ≠ `vercel`, i.e.
   the persisted `keys.provider` value does not always equal the
   `providerMeta` object key. Do that rewrite now, in this package, so Epic 2
   does not have to remember.

**`app/components/ProviderIcon.vue`** — add `brave` and `exa` to
`providerIconNames`. `simple-icons:brave` exists in Iconify. Exa has no
Iconify entry; add a local `app/assets/icons/exa.svg` (`nuxt-svgo`
auto-imports the whole directory via `nuxt.config.ts` `autoImportPath`) and
reference it, or — acceptable fallback if no clean SVG is obtainable — leave
Exa on the existing 2-letter `badgeText` path and **say so in the PR
description**. Do not invent a look-alike logo.

### Tests

**Known flip (confirmed by reading the spec):**
`tests/integration/api/profile-keys-summary.spec.ts:111` —
`it('reports all 7 providers with hasKey false when none are set')` and its
`:120` `expect(response.keys).toHaveLength(7)`. Update the count to 12 and
rename the test. Do **not** delete it; it is the only coverage of the
dynamic `enumValues` iteration.

**Known flip (confirmed by reading the spec):**
`tests/unit/components/ProviderIcon.spec.ts:76-79` —
`it('resolves a real icon for every provider in providerMeta, …')` iterates
`Object.keys(providerMeta)`. Adding `brave`/`exa` without icons fails it
immediately. Either supply both icons, or narrow the test's iteration to
`kind === 'provider'` entries and add a separate assertion for the
search/gateway entries' intended fallback behaviour — but do not silently
weaken it.

**Audit, do not assume:** run
`rg -ln "'qwen'|\"qwen\"" tests/` and inspect every hit. Any spec that
enumerates the full provider set will flip. Known candidates from the
existing `keysApiTests` group: `tests/unit/utils/provider-meta.spec.ts`,
`tests/unit/pages/profile/keys.spec.ts`,
`tests/unit/composables/user-keys.spec.ts`.

**New spec:** none strictly required, but add cases to
`tests/unit/utils/provider-meta.spec.ts` asserting (a) every entry's `kind`
is one of the three literals, (b) `enabledSearchProviders` resolves to real
entries whose `kind === 'search'`, and (c)
`resolveProviderMetaByKeyProviderId('brave')` round-trips.

**`scripts/test-affected-check.mjs`:** the existing `keysApiTests` group
already covers `profile-keys-summary.spec.ts` and the keys page/card specs.
Add `tests/unit/utils/provider-meta.spec.ts` and
`tests/unit/components/ProviderIcon.spec.ts` to it, and extend the mapping
pattern that triggers it to include
`shared/utils/provider-meta\.ts` and `server/db/schemas/keys\.ts`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/integration/api/profile-keys-summary.spec.ts \
  tests/unit/utils/provider-meta.spec.ts \
  tests/unit/components/ProviderIcon.spec.ts \
  tests/unit/composables/user-keys.spec.ts \
  tests/unit/pages/profile/keys.spec.ts
pnpm run db:generate   # MUST print "No schema changes, nothing to migrate"
```

No browser verification — nothing user-visible ships in this package alone.

- [x] WP 0.1 complete (commit `18e89d5`)

## WP 0.2 — Brave/Exa key API routes + `/profile/keys` tab shell rebuild

**Tier: Sonnet.** Mechanical cloning plus a markup rebuild from a readable
deleted diff.

### Files touched

| Path | Nature |
| --- | --- |
| `server/api/v1/profiles/keys/brave/index.{get,post,delete}.ts` | new code — clone of the `qwen` triple |
| `server/api/v1/profiles/keys/exa/index.{get,post,delete}.ts` | new code — clone of the `qwen` triple |
| `app/pages/profile/keys.vue` | hand-rebuild (see below) |

### What changes, concretely

**The six route files are a verbatim structural clone** of
`server/api/v1/profiles/keys/qwen/index.{get,post,delete}.ts` with the
`provider` literal swapped. Each POST is ~50 lines: zod `{ apiKey }` body,
session check, `useEncryptText(body.data.apiKey)`, upsert on
`(userId, provider)` against the `uq_key_user_provider` unique index. GET
returns only `{ hasKey: boolean }` — **a saved key is never returned to the
browser**, and that must not change.

**Rate limiting — a decision, because the two precedents disagree.**
Verified at plan time: `rg -l enforceKeysRateLimit server/api/v1/profiles/keys/`
returns **only `index.get.ts`** (the summary route). The seven direct
per-provider routes are **un-rate-limited**, which `docs/auth-security.md`
records as a known, deliberate gap with "extending them is a follow-up". The
nine deleted *gateway* routes each **were** rate-limited, with their own
`keys-rate-limit:<gateway>:<verb>` prefix at window 60 / max 10.

**This plan chooses the rate-limited shape for Brave and Exa**, i.e. add
`enforceKeysRateLimit()` with prefixes `keys-rate-limit:brave:{get,post,delete}`
and `keys-rate-limit:exa:{get,post,delete}`, window 60 / max 10. Reasons:
the generic limiter already exists and costs three lines per route; these are
brand-new routes so there is no behaviour to regress; and it means WP 2.4's
restored gateway routes and these are consistent with each other rather than
splitting the codebase three ways. **Therefore this is NOT a verbatim qwen
clone** — it is a qwen clone plus the limiter call, and the executor must not
"simplify" it back by matching qwen. `docs/auth-security.md`'s new rows
(see the MD checklist) must state 60/10 to match.

**`app/pages/profile/keys.vue` is a hand-rebuild, not a restore.** The tab
shell that existed pre-removal was deleted twice: `24df3b5` removed the
gateway panel, then `80a3bdb` (2026-09-19) deleted the tab nav entirely. The
current file is 56 lines with no tabs at all — an `alert` plus a flat
`<ul class="grid gap-4">` of `enabledProviders`. Rebuild the nav using the
pre-removal markup as the spec, readable at
`git show 24df3b5^:app/pages/profile/keys.vue`:

```vue
<nav aria-label="Key sections" class="tabs tabs-box tabs-sm mb-6">
```

with `v-for="tab in tabs"`, `:data-testid="\`key-tab-${tab.id}\`"`,
`tab-active` applied on match, the label text rendered **only on the active
tab** (icon-only otherwise), and a `ProviderIcon` when `tab.providerId` is
set, else a `lucide:key-round` icon.

Shape for this epic — two tabs:

```ts
interface KeyTab { id: string; label: string; providerId?: string }

const providersTabId = 'providers'
const searchTabId = 'search'
const activeTab = shallowRef<string>(providersTabId)

const tabs = computed<KeyTab[]>(() => [
  { id: providersTabId, label: 'Per provider' },
  { id: searchTabId, label: 'Search providers' },
])
```

Two `v-show`'d panels. The providers panel wraps the existing
`enabledProviders` list unchanged. The search panel renders
`enabledSearchProviders` through the **same generic**
`LazyProfileKeysProviderKeyCard` — it is already fully generic over
`providerMeta[props.providerId]` and needs no change — with its own
accordion group name and a short blurb, mirroring the tone of the deleted
gateway blurb:

> Search providers give any tool-calling model web search using your own
> search key, instead of the model provider's built-in search.

**Critical:** the search panel's source list is `enabledSearchProviders`,
**not** `enabledProviders`. `enabledProviders` is derived from
`runtimeConfig.public.providers` (the LLM model catalog) filtered by
`providerMeta`; Brave and Exa are not in the model catalog and would never
appear there.

Epic 2 adds a third group of tabs to this same computed. Write `tabs` so
appending is a one-line spread, not a restructure.

### Tests

- `tests/unit/pages/profile/keys.spec.ts` — extend for the tab shell: the
  nav renders, `data-testid="key-tab-providers"` and `key-tab-search` both
  exist, clicking a tab swaps the visible panel, the search panel lists
  Brave then Exa in that order, the providers panel is unchanged.
- **New:** `tests/integration/api/profile-keys-brave.spec.ts` and
  `tests/integration/api/profile-keys-exa.spec.ts`, cloned structurally from
  `tests/integration/api/profile-keys-qwen.spec.ts`. Must cover: POST stores
  an encrypted value, GET returns `{ hasKey: true }` and never the key
  itself, DELETE removes it, and an unauthenticated request 401s.
- `scripts/test-affected-check.mjs`: add both new spec files to the
  `keysApiTests` array, and extend that mapping's pattern to include
  `server/api/v1/profiles/keys/(brave|exa)/.+` and
  `app/pages/profile/keys\.vue`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/pages/profile/keys.spec.ts \
  tests/integration/api/profile-keys-brave.spec.ts \
  tests/integration/api/profile-keys-exa.spec.ts \
  tests/integration/api/profile-keys-qwen.spec.ts \
  tests/integration/api/profile-keys-summary.spec.ts
```

**Manual browser verification script** (local `pnpm run dev`, signed in):

1. Navigate to `/profile/keys`.
2. Confirm a tab bar is present with two tabs; the first ("Per provider") is
   active, shows its label, and the second shows an icon only.
3. Confirm the providers panel still lists all seven direct providers as
   accordion cards, and that expanding one still shows its
   password input, Paste button, dashboard link and Save/Delete buttons.
4. Click the second tab. Confirm the panel swaps, the blurb renders, and
   exactly two cards appear in the order **Brave Search, then Exa**.
5. Expand the Brave card. Confirm the dashboard link points at
   `api-dashboard.search.brave.com` and opens in a new tab.
6. Save a key into the Brave card (the owner does this — an agent must not
   type a key into a form). Confirm the card's status badge flips from
   "No key" to "Key saved" **without a page reload**, then reload and
   confirm it persists.
7. Delete it again and confirm the badge reverts.
8. Repeat steps 5–7 for Exa.
9. Resize to a narrow viewport and confirm the tab bar does not overflow or
   wrap into an unusable state.

- [x] WP 0.2 complete (commit `e272920`)

## WP 0.3 — `Model.toolCall` through the models.dev fetch pipeline

**Tier: Sonnet.** Mechanical, but touches a hard-fail path — read the
`EXEMPT_IDS` note carefully.

### Files touched

| Path | Nature |
| --- | --- |
| `scripts/fetch-models-metadata.mjs` | new code (one field in `toSnapshotEntry`) |
| `providers/merge.ts` | new code (`ModelSnapshotEntry`, `CuratedModel`, `mergeModelMetadata`, `toFullyCuratedModel`) |
| `shared/types/providers.d.ts` | new code (`Model.toolCall`) |
| `providers/{anthropic,google,openai,xai,deepseek,moonshotai,qwen}.ts` | new code — **only the 6 `EXEMPT_IDS` entries** |
| `providers/data/models-dev-snapshot.json` | regenerated artifact |

### What changes, concretely

`docs/models-data-fetching.md` documents a per-field merge policy: `tools`,
`reasoning`, `research`, `imageGeneration`, `forProjectMemory` and `default`
are **curated**; `name`, `description`, `contextLength`, `maxOutputTokens`,
`modalities`, `status` and `price.input`/`price.output` are **fetched**.
`toolCall` joins the **fetched** side, alongside `modalities`. That is a
deliberate decision from file 00: it is a factual property of the upstream
model, not a product choice about which feature this app wired up.

**`scripts/fetch-models-metadata.mjs` → `toSnapshotEntry()` (`:201-242`).**
The function currently drops `tool_call` (along with `structured_output`,
`reasoning`, `attachment`, `temperature`). Add it **optionally**, in the same
conditional-spread style as `releaseDate` and `status`:

```js
...(typeof model.tool_call === 'boolean' ? { toolCall: model.tool_call } : {}),
```

**Do not add it to `hasRequiredFields`.** That guard returns `null` and drops
a model from the snapshot entirely; a model missing `tool_call` upstream must
still get its name/price/modalities, not vanish. (The remote catalog does
carry `tool_call` for every one of its ~8,048 models today — `false` for
~1,045 of them — but the optional treatment is the safe shape regardless.)

**`providers/merge.ts`:**

- `ModelSnapshotEntry` gains `toolCall?: boolean`.
- `CuratedModel` gains `toolCall?: boolean` — **used only as the EXEMPT_IDS
  carrier**, never as an override of a real snapshot value.
- `mergeModelMetadata()` (`:285-321`) sets
  `toolCall: snapshot.toolCall ?? curated.toolCall ?? false`.
- `toFullyCuratedModel()` (`:221-...`) — this is the **EXEMPT_IDS path**, the
  branch taken when a curated id has no snapshot entry at all. It already
  throws a descriptive error when `name`/`description`/`contextLength`/
  `maxOutputTokens`/`modalities` are undefined. **Add `toolCall` to that same
  undefined-check and to the thrown message**, preserving the existing
  hard-fail behaviour: an exempt model must carry every fetched-side field
  explicitly or the build fails loudly rather than defaulting to `false`.

**`shared/types/providers.d.ts`:** `Model` gains `toolCall: boolean`
(**required**, not optional). Required is what makes the `EXEMPT_IDS`
hard-fail meaningful and what makes the picker gate honest.

**The six `EXEMPT_IDS`** (`scripts/fetch-models-metadata.mjs:70-77`) must
each gain an explicit `toolCall` in their curated entry:
`o3-deep-research`, `o4-mini-deep-research` (`providers/openai.ts`),
`gemini-3-pro-preview` (`providers/google.ts`),
`grok-imagine-image-2.0` (`providers/xai.ts`),
`qwen3.7-flash`, `qwen3.5-flash` (`providers/qwen.ts`). Set each from the
vendor's own documentation, not a guess — `grok-imagine-image-2.0` is an
image model and is almost certainly `false`; the deep-research models are
agentic and almost certainly `true`. Record the source for each in the PR
description.

**Regenerate the snapshot.** Run `pnpm run models:fetch` **as part of this
package** (it is manual, never part of build or deploy) and commit the
regenerated `providers/data/models-dev-snapshot.json`. Then
`git diff providers/data/models-dev-snapshot.json` and **audit the result**:
the diff should be additive-only (one `toolCall` key per entry). If any
curated flagship model comes back `toolCall: false`, that is a data anomaly —
investigate and report it, do not ship it silently, because it would
silently withhold Brave/Exa from that model in Epic 1.

> The orchestrator must **not** run `pnpm run models:fetch` during planning.
> It belongs to this work package's executor.

**Payload note:** the merged catalog is injected into
`runtimeConfig.public.providers` and serialised into every page's payload.
One boolean across ~110 models is a negligible (~1–2 KB) growth, well under
the ~25–30 KB the last catalog expansion added — but it is worth a sentence
in the PR description because `docs/models-data-fetching.md` tracks this.

### Tests

- **Typecheck churn, sized:** making `Model.toolCall` required breaks every
  hand-built `Model` literal in test fixtures. Measured: **17 occurrences
  across 11 files** (`rg -n "priceTier:" tests/`). Named:
  `tests/unit/providers/default-model.spec.ts`,
  `tests/unit/utils/models-picker.spec.ts`,
  `tests/unit/utils/providers/{xai,qwen,deepseek,moonshotai}.spec.ts`,
  `tests/unit/utils/chats/provider.spec.ts`,
  `tests/unit/components/ChatInput/ModelsTrigger.spec.ts`,
  `tests/unit/components/ChatInput/ModelsTrigger.keys.spec.ts`,
  `tests/unit/components/ChatInput/ModelsTrigger/{ModelDetail,ModelItem}.spec.ts`.
  **This plan accepts the fixture churn** rather than introducing a fixture
  factory: 17 sites is below the threshold where a factory pays for itself,
  and a factory would hide exactly the field the next three packages depend
  on reading correctly.
- `tests/unit/providers/merge.spec.ts` — new cases: snapshot `toolCall: true`
  wins; snapshot absent falls back to curated; both absent yields `false`;
  `toFullyCuratedModel` throws when an exempt-shaped curated model omits
  `toolCall`.
- `tests/unit/scripts/*` — check whether any existing script spec asserts the
  exact shape of `toSnapshotEntry()`'s output and extend it.
- `scripts/test-affected-check.mjs`: the existing `modelCatalogTests` group
  and its mapping pattern already cover `providers/(index|merge|…)\.ts`,
  `providers/data/models-dev-snapshot\.json`,
  `scripts/fetch-models-metadata\.mjs` and `shared/types/providers\.d\.ts`.
  **No new registration needed** — verify this is still true before
  concluding it.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/providers/ tests/unit/utils/models-picker.spec.ts \
  tests/unit/components/ChatInput/ModelsTrigger.spec.ts
pnpm run models:fetch && git diff --stat providers/data/models-dev-snapshot.json
pnpm run db:generate   # MUST print "No schema changes, nothing to migrate"
```

No browser verification — no UI reads `toolCall` until Epic 1 WP 1.6.

- [x] WP 0.3 complete (commit `09c08a2`)

## Epic 0 gate

- [ ] CI green on PR #362 with all three packages landed (Build PR pending
      as of commit `e6c1997`; Check PR state and Check latest commit paths
      already pass)
- [~] `/profile/keys` browser script (WP 0.2) — steps 1-5 and the tab/panel/
      card-order/dashboard-link checks verified live against local dev
      (`Rail Test` session): tab bar renders, providers panel unchanged,
      search panel shows the blurb and exactly Brave-then-Exa, Brave's
      dashboard link resolves to `https://api-dashboard.search.brave.com/app/keys`,
      Exa correctly falls back to its 2-letter badge. Step 9 (narrow-viewport
      overflow) was not confirmed — the browser tool's window resize did not
      affect the captured viewport in this environment; needs a real device
      or a differently-instrumented check. **Steps 6-8 (saving/deleting a
      real key) require the owner** — an agent must not type an API key into
      a form.
- [x] `pnpm run db:generate` produced no migration (confirmed independently
      in all three work packages: "No schema changes, nothing to migrate")

---

# Epic 1 — Brave and Exa web search providers

All genuinely new code. This is the owner's stated motivation, it is fully
specified, and — unlike Epic 2 — it is fully verifiable, because real Brave
and Exa keys exist in `.dev.vars` (owner testing only; **never** a
server-side fallback for a user without their own key — that would break
BYOK).

**Sequencing inside the epic:** WP 1.1 → WP 1.2 → WP 1.3 → WP 1.4 must run in
order (each consumes the previous). WP 1.5, WP 1.6 and WP 1.7 may run in
parallel after WP 1.1 lands, since they only need the `ModelTool` union and
`Model.toolCall` to exist.

## WP 1.1 — `ModelTool` widening, zod, and mutual exclusivity

**Tier: Sonnet.**

### Files touched

| Path | Nature |
| --- | --- |
| `shared/types/providers.d.ts` | new code |
| `server/utils/chats/request-schema.ts` | new code |
| `server/api/v1/chats/new/index.put.ts` | new code (schema refine applies here too) |
| `server/api/v1/chats/[slug]/index.post.ts` | new code — **validation block only** (`:211-229`), not the rebuild |
| `shared/utils/message-metadata.ts` | new code (`persistedModelTools`, `getMessageUsedTools`) |
| `app/components/Chat/ContextMenu.client.vue` | new code (`TOOL_LABELS`) |

### What changes, concretely

**`shared/types/providers.d.ts`:**

```ts
export type ModelTool
  = 'web_search'
    | 'web_search_brave'
    | 'web_search_exa'
    | 'image_generation'
```

**`server/utils/chats/request-schema.ts`** — widen `chatToolSchema` to the
same four values, and add an exported array-level refinement so both routes
enforce identical rules:

```ts
export const chatToolsSchema = z.array(chatToolSchema)
  .refine(tools => tools.filter(isWebSearchTool).length <= 1, {
    message: 'Only one web search provider may be selected per message.',
  })
  .refine(tools => !(tools.some(isWebSearchTool)
    && tools.includes('image_generation')), {
    message: 'Web search and image generation cannot be combined.',
  })
```

`isWebSearchTool` is a small exported predicate over the three search
members — export it, because WP 1.3, WP 1.5 and WP 1.7 all need the same
set and three independent copies of it will drift.

**Both routes must use `chatToolsSchema`, not `z.array(chatToolSchema)`.**
Confirmed call sites:

- `server/api/v1/chats/new/index.put.ts:21` — this is the route that
  **persists the draft user message**, and therefore the one that decides
  what `chat.messages[0].tools` contains on turn one.
- `server/api/v1/chats/[slug]/index.post.ts:96`.

Applying the refinement to only one of them means turn one silently bypasses
it. This is the concrete failure mode the first-turn trap creates.

**The image-generation exclusion is not cosmetic, it is a hang.**
`image_generation` is wired with a forced `toolChoice`, and Brave/Exa go
through `withFollowUpTurn()`. `docs/providers/general.md` § "Multi-step tool
loop" states that combining `withFollowUpTurn` with a forced `toolChoice`
loops the tool forever and never produces text. The existing client-side
`toggleWebSearch()` already strips `image_generation` for the same reason;
this refine is the server-side backstop.

**`index.post.ts:211-229` — extend the tool-support validation.** Today it is
a pure subset check:

```ts
const supportedTools = [...model.tools, ...requiredTools]
const unsupportedTool = selectedTools.find(t => !supportedTools.includes(t))
```

`web_search_brave` will never be in `model.tools` (that array is the curated
list of natively-wired tools), so the subset check would reject it. Add an
explicit branch **before** the subset check:

- `web_search_brave` is allowed iff `model.toolCall === true` **and** the
  user has a saved `brave` key.
- `web_search_exa` is allowed iff `model.toolCall === true` **and** the user
  has a saved `exa` key.
- If the model lacks tool calling: 400 with
  `why: '<model.name> does not support tool calling.'` and
  `fix: 'Choose a tool-calling model, or use the model's built-in web search.'`
- If the key is missing: 400 with
  `why: 'No Brave Search API key is saved for this account.'` and
  `fix: 'Add one at /profile/keys → Search providers.'`

Both errors follow the existing `createError({ message, status, why, fix })`
shape used throughout this route. The key lookup is the same
`useDb().query.keys.findFirst({ where: { userId, provider: 'brave' } })`
pattern every `use<Provider>()` already uses — but here it must run **before**
the provider `switch`, because it is a request-validation concern, not a
provider concern. Fetch the decrypted key once here and pass it forward to
WP 1.3's tool builder rather than querying twice.

Then run the existing subset check against a **copy** of `selectedTools` with
only `web_search_brave` and `web_search_exa` removed:

```ts
const toolsForSupportCheck = selectedTools.filter((t) => {
  return t !== 'web_search_brave' && t !== 'web_search_exa'
})
const unsupportedTool = toolsForSupportCheck.find(t => !supportedTools.includes(t))
```

**Two precise points, both of which are easy to get wrong:**

- **Do not strip `web_search`.** It is native, it *does* live in
  `model.tools`, and removing it from the check would let a user request
  native search on a model that does not advertise it — deleting validation
  rather than preserving it.
- **Strip from a check-only copy, never from `selectedTools` itself.**
  `requestedTools` is built from `selectedTools` a few lines later
  (`requestedTools = [...new Set([...selectedTools, ...requiredTools])]`),
  and that array is what WP 1.3 reads to decide whether to inject the Brave
  or Exa tool. Mutating `selectedTools` would validate correctly and then
  register no tool at all — a silent no-op search.

**⚠ A third rejection case, easy to miss: `requiredTools`.**
`getRequiredModelTools(model)` re-adds `image_generation` to
`requestedTools` **after** zod has run, for models where image generation is
mandatory rather than optional. So WP 1.1's zod refinement does **not** cover
this path: a required-image-generation model plus a Brave selection produces
exactly the forced-`toolChoice` + `withFollowUpTurn` combination that loops
forever. Reject it explicitly:

```ts
if (requiredTools.includes('image_generation') && selectedTools.some(isWebSearchTool)) {
  throw createError({ /* 400: this model always generates images and cannot search */ })
}
```

`model.toolCall === false` would probably catch today's only such model
(`grok-imagine-image-2.0`), but that is an accident of the current catalog,
not a guarantee. Do not rely on it.

**`shared/utils/message-metadata.ts`** — two edits:

1. `persistedModelTools` (`:47-50`) gains both new members. Its consumer
   `getMessageUsedTools()` filters it by
   `storedTools.includes(tool) || <inference branch>`, so the persisted
   `messages.tools` value alone will light up the Tools row.
2. `getMessageUsedTools()`'s `hasWebSearchPart` inference (`:150-160`) —
   which infers `web_search` from the presence of
   `source-url`/`source-document` parts — **must be suppressed when a
   Brave/Exa tool is in `storedTools`.** WP 1.4 makes Brave/Exa emit
   `source-url` parts deliberately, so without this guard a Brave turn would
   render "Web search, Web search (Brave)" — two labels for one action.
   Concretely: `(tool === 'web_search' && hasWebSearchPart && !storedTools.some(isWebSearchTool))`.

**`ContextMenu.client.vue:255-259`** — `TOOL_LABELS` is a total
`Record<ModelTool | 'deep_research', string>`, so TypeScript *forces* the two
new labels. Use `'Web search (Brave)'` and `'Web search (Exa)'` — the
parenthesised provider name is the attribution mechanism for the **Tools**
row. (The separate **Web search** cost row gets its provider name from the
`searchProvider` field in WP 1.7. Both rows naming the provider is
intentional: they answer different questions — "what did the model do" vs
"who is billing you".)

### Tests

- **New:** `tests/unit/utils/chats/request-schema.spec.ts` (create if absent)
  — both refinements accept every legal combination and reject each illegal
  one, with the exact message text asserted.
- `tests/unit/utils/message-metadata.spec.ts` — new cases for the two new
  `persistedModelTools` members and for the suppression guard (a message with
  `tools: ['web_search_brave']` **and** `source-url` parts must yield exactly
  `['web_search_brave']`).
- `tests/unit/components/Chat/ContextMenu.client.spec.ts` — the Tools row
  renders "Web search (Brave)".
- `tests/integration/api/chats-new.spec.ts` — the draft-message route rejects
  two search tools at once and rejects search + image generation.
- **New:** `tests/integration/api/chats-external-search-validation.spec.ts` —
  400 when the model lacks `toolCall`; 400 when the key is missing; 200 when
  both are satisfied (mock the tool's `fetch`).
- `scripts/test-affected-check.mjs`: the existing mapping for
  `server/utils/chats/request-schema\.ts` currently points at
  `chats-message-id-stream.spec.ts` and `chats-new.spec.ts`. Extend it with
  the new request-schema unit spec and the new validation integration spec.
  Add the validation spec to `chatStreamBranchTests` as well. The
  `messageUsageTests` and `contextMenuTests` groups already cover
  `message-metadata.spec.ts` and `ContextMenu.client.spec.ts` — extend the
  mapping pattern that triggers `messageUsageTests` to include
  `shared/types/providers\.d\.ts` if it does not already.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/chats/request-schema.spec.ts \
  tests/unit/utils/message-metadata.spec.ts \
  tests/unit/components/Chat/ContextMenu.client.spec.ts \
  tests/integration/api/chats-new.spec.ts \
  tests/integration/api/chats-external-search-validation.spec.ts
```

No browser verification in isolation — the UI that produces these values
arrives in WP 1.5.

- [x] WP 1.1 complete (commit `7ee1210`)

## WP 1.2 — Brave and Exa tool modules + rate configuration

**Tier: Sonnet.** Read `.agents/skills/web-search/SKILL.md` (Brave, official
`brave/brave-search-skills`) and `.agents/skills/build-with-exa/` (Exa,
official `exa-labs/agent-skills`) **directly** for authoritative request and
response shapes. Both were installed in commit `5be767c` specifically so this
package does not have to re-derive them.

### Files touched

| Path | Nature |
| --- | --- |
| `server/utils/search/brave.ts` | new code |
| `server/utils/search/exa.ts` | new code |
| `server/utils/search/types.d.ts` | new code |
| `server/utils/ai/external-search-cost.ts` | new code |
| `nuxt.config.ts` | new code — 3 `runtimeConfig` keys |
| `wrangler.jsonc` | new code — same 3 keys in **both** blocks |
| `.dev.vars.example` | already carries the two key placeholders — verify only |

### What changes, concretely

**Structural template: `server/utils/providers/moonshotai-web-search.ts`.**
Copy its shape, not its content: a module-level const block for the base URL
and timeouts, typed response interfaces, a private `execute*` function that
does the `fetch`, and a single exported `get*Tools(apiKey, logger?):
Promise<FormattedTools>` that returns
`{ tools: { <key>: withFollowUpTurn(tool({ … })) } }`.

**Hard constraints, all from `docs/providers/general.md` § "Multi-step tool
loop" and `docs/web-search-cost-accounting.md`:**

1. **Distinct local tool keys.** Register under `web_search_brave` and
   `web_search_exa`. **Never** reuse `web_search_preview` — that key is
   shared by Google, Anthropic and OpenAI's native tools, and
   `getWebSearchUsage()` in `server/utils/ai/web-search-cost.ts` is
   hard-gated to `anthropic|openai` precisely because of that collision.
   Reusing it would make native and external searches indistinguishable in
   both persisted parts and telemetry. Note also that Moonshot's Formula-API
   tool registers under whatever `declaration.name` the API returns (today
   `web_search`), so that bare key is taken too.
2. **`withFollowUpTurn()`, with no `toolChoice` — ever.** The marker is what
   makes `resolveToolLoopOptions()` return
   `{ stopWhen: stepCountIs(3), timeout: { totalMs: 540_000, toolMs: 60_000 } }`
   so the model gets a second turn to read the results and answer. Pairing it
   with a forced `toolChoice` loops the tool forever and never emits text.
3. **`options.abortSignal` must be threaded into the tool's own `fetch`.**
   `toolMs` is *cooperative*: the AI SDK only passes the signal to
   `execute()`; it never races or cancels the call itself. A `fetch()` that
   omits `signal: options.abortSignal` is never interrupted and can hang past
   `totalMs` too. Combine it with the module's own
   `AbortSignal.timeout(...)` via `AbortSignal.any([...])` so both bounds
   apply.
4. **Every failure path uses `createError({ message, status, why, fix })`**
   from `evlog`, as Moonshot's does. A thrown `execute()` produces a
   `tool-error` output the model can see and answer from, which terminates
   the loop gracefully rather than retrying it.

**Brave (`server/utils/search/brave.ts`):**

- `GET https://api.search.brave.com/res/v1/web/search`
- Auth header `X-Subscription-Token: <key>` — **not** `Bearer`.
- Fixed request shape, **not user-configurable**: `q` from the tool input,
  `count=10`, `result_filter=web`, `safesearch` at Brave's default. Filtering
  to `web` keeps the response shape predictable — without it Brave nests
  `news`, `videos`, `locations` and `infobox` verticals.
- `inputSchema`: a Zod object with one field, `query: z.string().min(1).max(400)`
  (Brave's documented `q` bound), plus a clear `description` telling the
  model to issue one focused query.
- Normalise `web.results[]` to `{ title, url, snippet }` —
  `.title` → title, `.url` → url, `.description` → snippet — and return
  `{ results, provider: 'brave' }`. Cap the returned array at 10.
- Brave returns **no cost field**; its cost comes from config (below).

**Exa (`server/utils/search/exa.ts`):**

- `POST https://api.exa.ai/search`
- Auth header `x-api-key: <key>`.
- Fixed request body, **not user-configurable**: `{ query, type: 'auto',
  numResults: 10, contents: { highlights: true } }`. `contents.highlights` is
  mandatory, not optional — a bare Exa query returns **no body text at all**,
  only title/url/date/author, so there would be nothing renderable as a
  snippet. Fixing `numResults` at 10 is a cost decision (see below).
- Normalise `results[]` to `{ title, url, snippet, publishedDate?, author? }`
  where snippet is the joined `highlights[]`. Exa's `title` is nullable more
  often than Brave's — fall back to the hostname.
- **Return Exa's own `costDollars` in the tool output object**, e.g.
  `{ results, provider: 'exa', costDollars: body.costDollars?.total }`. This
  is what lets WP 1.3's cost reader lift a *real* per-request cost off the
  persisted tool-result part with no side channel and no hardcoded-rate
  guesswork. Exa is the only one of the six search integrations in this app
  that reports its own price.

**`server/utils/ai/external-search-cost.ts`** — the counter and pricer, in
the same bespoke-per-vendor style `docs/web-search-cost-accounting.md`
argues for (a thin dispatcher over imperative readers; explicitly **not** a
declarative billing-rule engine):

- `getExternalSearchUsage(steps, toolName)` — counts `tool-result` parts
  (never `tool-error` parts; `ai` converts an errored provider tool result
  into a `tool-error` part type, so errors are excluded structurally) whose
  tool name matches, returning `{ searches, billingUnit: 'search' }` or
  `undefined` at zero.
- `getExternalSearchCost(usage, provider, rates, reportedCostDollars)` —
  **prefers `reportedCostDollars` when present** (Exa), falls back to
  `searches × rate` (Brave, and Exa if the field is absent), returns
  `undefined` when neither resolves. Unknown cost is `undefined`, **never
  `0`** — this mirrors `buildMessageUsage()`'s existing contract and is
  non-negotiable.
- `resolveExternalSearchRates(config)` — same shape as the existing
  `resolveGoogleSearchRates` / `resolveWebSearchRates`: read from runtime
  config, divide the per-1,000 figure, return `undefined` for anything empty,
  non-finite or `<= 0`.

**Rates live in config, never as a code literal.** Three locations must be
edited — `docs/web-search-cost-accounting.md` names two (`wrangler.jsonc`'s
top-level `vars` and `env.production.vars`, hand-synced) but there is a
**third**: `nuxt.config.ts:205-208`'s `runtimeConfig` declares the empty
defaults that make the keys readable at all.

| Key | Value | Note |
| --- | --- | --- |
| `NUXT_BRAVE_SEARCH_COST_PER_THOUSAND_REQUESTS_USD` | `"5"` | Brave Search (Web & LLM Context) plan, official pricing page, as of 2026-09-22. Documentation-only, not invoice-verified. |
| `NUXT_EXA_SEARCH_COST_PER_THOUSAND_REQUESTS_USD` | `"17"` | **Not `7`.** See below. |
| `NUXT_EXA_SEARCH_COST_PER_THOUSAND_HIGHLIGHT_PAGES_USD` | `"1"` | Optional; only if the executor prefers a two-term computation to a single blended figure. |

**The Exa rate must reflect the request shape actually shipped.** Exa's
`$7/1,000` is the *base search* price for up to 10 results. `contents.highlights`
is billed **per page extracted**, at `$1/1,000 pages`, and stacks. The fixed
request above (10 results + highlights) therefore costs
`$7/1,000 + $1 × 10/1,000 ≈ $0.017` per request — i.e. **`17` per thousand,
not `7`**. Hardcoding `7` would under-report Exa by ~59% and quietly
invalidate the exact cost comparison this whole effort exists to enable.
This is also precisely why `numResults` must not be user-configurable: a
configurable count makes the rate un-derivable from the response alone,
which `docs/web-search-cost-accounting.md` § "Billing-unit heterogeneity"
names as the one condition that would break the current accounting shape.

In practice the hardcoded Exa rate is a fallback — the live path prefers
Exa's own `costDollars`. Ship both, and put a dated source comment above each
`wrangler.jsonc` block stating which rates are documentation-only (all of
them here) versus invoice-verified (none of them here), matching the existing
comment discipline for the four Google/Anthropic/OpenAI rates.

### Tests

- **New:** `tests/unit/utils/search/brave.spec.ts` — request URL, header name
  (`X-Subscription-Token`, asserted literally), fixed params, response
  normalisation, hostname fallback, abort-signal threading, and
  `createError` shape on non-2xx.
- **New:** `tests/unit/utils/search/exa.spec.ts` — same, plus: the request
  body always carries `contents.highlights: true` and `numResults: 10`, and
  `costDollars` is surfaced in the tool output.
- **New:** `tests/unit/utils/ai/external-search-cost.spec.ts` — counting
  excludes `tool-error` parts; `reportedCostDollars` wins over the rate;
  missing rate yields `undefined` not `0`; zero searches yields `undefined`.
- **New:** `tests/unit/config/wrangler-search-rates.spec.ts` — asserts the
  two `wrangler.jsonc` blocks agree with each other on every
  `*_COST_PER_THOUSAND_*` key. This is item 7 of
  `docs/web-search-cost-accounting.md`'s "If we build this next" list — a few
  lines that eliminate a live failure mode (the production and non-production
  blocks silently diverging), and it should cover the four pre-existing rates
  as well as the new ones.
- `scripts/test-affected-check.mjs`: add a new `externalSearchTests` array
  containing all four new specs plus
  `tests/unit/utils/search-usage.spec.ts` and
  `tests/unit/utils/message-usage.spec.ts`, mapped from
  `^(server/utils/search/.+\.ts|server/utils/ai/external-search-cost\.ts)$`.
  Add the wrangler-consistency spec to the mapping for `wrangler\.jsonc` if
  one exists, and create that mapping if it does not.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/search/ \
  tests/unit/utils/ai/external-search-cost.spec.ts \
  tests/unit/config/wrangler-search-rates.spec.ts
```

**Live smoke test (optional but strongly recommended, owner-run):** with
`.dev.vars`' real keys loaded, hit each vendor once from a scratch script
under the scratchpad and diff the real response against the typed interface.
Both vendors' response shapes in the research files came from documentation,
not from a live call against this app's exact request.

No browser verification — nothing is wired into the send path until WP 1.3.

- [x] WP 1.2 complete (commit `6a01fc6`)

## WP 1.3 — Send-path wiring: tool injection, cost, telemetry

**Tier: Sonnet.** This touches `index.post.ts`, but it is a small **additive**
change at three well-isolated points. It is explicitly **not** the Opus
rebuild — that is WP 2.6, and it happens later.

### Files touched

| Path | Nature |
| --- | --- |
| `server/api/v1/chats/[slug]/index.post.ts` | new code — additive, ~4 insertion points |
| `server/utils/ai/search-usage.ts` | new code — one new dispatch branch |
| `server/utils/ai/message-usage.ts` | new code — `searchProvider` in `addSearchUsage` |
| `shared/types/message-usage.d.ts` | new code — `searchProvider` field |

### What changes, concretely

**Inject the tool AFTER the provider `switch`, never inside it.** This is the
single most important structural decision in Epic 1. The switch at
`index.post.ts:494-753` has one `case` per direct provider, each calling
`use<Provider>()` and assigning `parsedTools`. Brave and Exa are **provider
independent** — they work with any tool-calling model. Wiring them inside the
switch would mean editing seven builders now and three more gateway builders
in Epic 2. Instead, immediately after the `try { switch … } catch` block
closes and **before** `const toolLoopOptions = resolveToolLoopOptions(parsedTools.tools)`
at `:758`:

```ts
if (requestedTools.includes('web_search_brave')) {
  const { tools: braveTools } = await getBraveWebSearchTools(braveApiKey, aiLogger)
  parsedTools = {
    ...parsedTools,
    tools: { ...parsedTools.tools, ...braveTools },
  }
}
// … same shape for exa
```

`resolveToolLoopOptions()` is already called after this point and is a pure
function of `parsedTools.tools`, so the multi-step loop engages
automatically. `parsedTools.toolChoice` is untouched and will be `undefined`,
because WP 1.1's mutual exclusivity guarantees no native search tool was
requested in the same turn. **Epic 2 gets this for free**: the restored
`if (gatewayId) { … } else { switch … }` wrapper closes before this point, so
a gateway-routed model gains Brave/Exa with zero extra code.

The decrypted key comes from WP 1.1's validation block, which already fetched
it. Do not query or decrypt twice.

**`server/utils/ai/search-usage.ts` — a new dispatch branch, placed FIRST.**
The current `resolveSearchUsage({ providerId, modelId, steps, rates })`
dispatches on `providerId`: Google, else a gate to `anthropic|openai`.
Brave/Exa are orthogonal to `providerId`, so they must be checked before the
provider branches, keyed on which external tool actually ran:

```ts
export function resolveSearchUsage(input: {
  providerId: string
  modelId: string
  steps: ReadonlyArray<WebSearchStep>
  rates: SearchRates
  externalSearchProvider?: 'brave' | 'exa'   // NEW
}): SearchUsage | undefined {
  if (input.externalSearchProvider) {
    // count tool-result parts for the matching tool key, price via
    // external-search-cost.ts, return early
  }
  // … existing google / anthropic|openai branches, unchanged
}
```

`SearchUsage` gains `provider?: 'google' | 'anthropic' | 'openai' | 'xai' |
'brave' | 'exa'`. The existing branches set it from `providerId`; the new
branch sets it from `externalSearchProvider`. `billingUnit` for both external
vendors is `'search'`, which `formatSearchGroundingUnits()` already renders
as "2 searches" with no change.

**`shared/types/message-usage.d.ts`** gains:

```ts
export type SearchProvider
  = 'google' | 'anthropic' | 'openai' | 'xai' | 'brave' | 'exa'

// … on MessageUsage:
searchProvider?: SearchProvider
```

and its `searchUnits`/`searchCost` doc comment is extended to name Brave and
Exa alongside the native four, and to state the blended exception explicitly:

> `searchCost` is never set when the search fee is already inside a
> gateway's blended `totalCost` (OpenRouter's `web` plugin, Vercel's
> `perplexitySearch()`) — that would double-count the same charge.

Write that sentence **now**, in Epic 1, even though gateways do not exist
yet. It is the contract Epic 2 must honour, and a comment that arrives with
the code it constrains is worth more than one retrofitted afterwards.

**`server/utils/ai/message-usage.ts` — `addSearchUsage()`** gains one
conditional spread, following the existing style exactly:

```ts
...(search.provider === undefined ? {} : { searchProvider: search.provider }),
```

Everything else about that function is unchanged, including the asymmetry
that makes it good: `searchUnits` is set **unconditionally** whenever a
search ran, `searchCost` only when a rate resolved. A unit count is never
stale; a dollar figure from a stale rate is worse than no figure.

**All three `resolveSearchUsage` call sites must pass the new argument.**
They are, per `docs/web-search-cost-accounting.md` § "The three integration
points":

| Call site | Line (current) | Feeds |
| --- | --- | --- |
| `streamText`'s `onEnd` | `:884` | the Axiom wide event |
| `toUIMessageStream`'s `messageMetadata` | `:1023` | the live streamed metadata |
| `persistAssistantMessageFromStream` | `:1454` | the persisted D1 row |

Each computes independently from the step data available to it — none reads
another's output, and that independence must be preserved. Derive
`externalSearchProvider` once near the top of the handler from
`requestedTools` and close over it.

**`buildChatInstructions()` needs a search clause — verified as absent.**
`buildChatInstructions(projectSystemPrompt, requestedTools)`
(`index.post.ts:1650-1666`) currently branches on **`image_generation` only**;
it carries no wording for any search tool, because all four native
integrations use a forced `toolChoice` and therefore need no prompting. Brave
and Exa are the **first search tools in this app with no forced
`toolChoice`** — the model genuinely decides whether to call them. Without an
instruction, a model can and will answer from memory while the user watches a
"Brave" pill that did nothing.

Add a clause when `requestedTools` contains either new member, mirroring the
image-generation block's tone:

> Web search is available via the `web_search_brave` tool. Call it when the
> question depends on current information, recent events, or anything you are
> not confident about. Cite the sources you used.

Naming the tool key explicitly (rather than a generic "search the web") is
deliberate: the key differs per provider, and the instruction is built from
`requestedTools`, which already knows which one is active.

**Telemetry.** `onEnd` already writes `ai.cost = textCost + imageCost +
searchCost` and a set of `attributes.ai.*` keys
(`webSearchUnits`/`webSearchCost`/`webSearchBillingUnit`). Add
`attributes.ai.webSearchProvider`. **Under `attributes`, never as a new flat
key** — `besidka-prod` is at Axiom's 256-field cap and a flat key becomes a
permanent schema field. Do not add a new top-level `ai.*` number; the
existing `ai.cost` roll-up already includes the external search cost by
construction.

### Tests

- `tests/unit/utils/search-usage.spec.ts` — the new branch wins over the
  provider branches; absent `externalSearchProvider` leaves existing
  behaviour byte-identical (assert this explicitly — it is the regression
  that would silently break Google's invoice-verified path).
- `tests/unit/utils/message-usage.spec.ts` — `searchProvider` is set when
  present and omitted when absent.
- **New:** `tests/integration/api/chats-external-search.spec.ts` — a mocked
  Brave send: the tool is registered under `web_search_brave`, the loop runs
  more than one step, the persisted usage carries
  `searchProvider: 'brave'`, `searchUnits`, `searchBillingUnit: 'search'` and
  a `searchCost`; and an Exa send prefers the response's `costDollars` over
  the configured rate. Model this on
  `tests/integration/api/chats-tool-loop.spec.ts`, which already drives the
  loop through a direct-provider (Moonshot) mock.
- `scripts/test-affected-check.mjs`: add the new integration spec to both
  `chatStreamBranchTests` and the `externalSearchTests` group created in
  WP 1.2. The `messageUsageTests` group already includes
  `search-usage.spec.ts` and `message-usage.spec.ts`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/search-usage.spec.ts \
  tests/unit/utils/message-usage.spec.ts \
  tests/integration/api/chats-external-search.spec.ts \
  tests/integration/api/chats-tool-loop.spec.ts \
  tests/integration/api/chats-single-step-characterization.spec.ts
```

The last two are regression guards: they cover the direct-provider tool loop
and the single-step characterisation, and a mistake in tool injection breaks
them first.

- [x] WP 1.3 complete (commit `da88f71`)

## WP 1.4 — Convert Brave/Exa results into `source-url` chunks

**Tier: Sonnet.** Small and self-contained, but the augment-vs-replace rule
below is the whole package.

### Files touched

| Path | Nature |
| --- | --- |
| `server/utils/chats/filter-ui-message-stream.ts` | new code — a third exported transform |
| `server/api/v1/chats/[slug]/index.post.ts` | new code — one line in the transform chain |

### What changes, concretely

`server/utils/chats/filter-ui-message-stream.ts` is the established home for
pre-`.tee()` stream transforms. It currently exports two:
`filterRecoverableUIMessageStreamErrors` and
`insertParagraphBreakAfterNonTextGap`. Add a third,
`emitSourcesForExternalSearchResults`, built with the same
`stream.pipeThrough(new TransformStream({ transform … }))` shape and the same
`typeof stream?.pipeThrough !== 'function'` guard.

Behaviour: when a `tool-output-available` chunk carries an external-search
result payload, enqueue one `source-url` chunk per result
(`{ type: 'source-url', sourceId, url, title }`), deduplicated by URL within
the message.

**⚠ Identify the tool by its output payload, not by a tool name on the
chunk.** In the AI SDK v7 UI-message-stream a `tool-output-available` chunk
carries `toolCallId` and `output` but **no `toolName`** — the name only
appears on the earlier `tool-input-start` / `tool-input-available` chunks. A
transform written against `chunk.toolName` will compile, run, and silently
match nothing.

This plan's chosen discriminator is the `provider` field WP 1.2 already puts
in both tools' returned output object:

```ts
if (chunk.type === 'tool-output-available'
  && isRecord(chunk.output)
  && (chunk.output.provider === 'brave' || chunk.output.provider === 'exa')) {
  // enqueue the original chunk, then the derived source-url chunks
}
```

That is why WP 1.2 specifies `{ results, provider: 'brave' }` rather than a
bare array — the field exists for this transform. (The alternative, keeping a
`toolCallId → toolName` map populated from the input chunks, also works but
adds per-message state for no gain. Do not implement both.) **Confirm the
exact chunk type name and field shape against the installed `ai@7.0.56`
before writing the matcher** — this is the one place in Epic 1 where a wrong
guess fails silently rather than loudly.

**Augment, never replace.** Enqueue the original tool chunk through
**unchanged first**, then the derived `source-url` chunks. Dropping the tool
chunk would satisfy the source-rendering goal while silently breaking the
reasoning-step surfacing, because `isThinkingToolPart()` in
`app/utils/reasoning.ts` keys on the presence of a `tool-*` part. Both
behaviours are required; they are not alternatives.

Wire it at `index.post.ts:1069-1072`, **before** the `.tee()`:

```ts
const correctedUiMessageStream = emitSourcesForExternalSearchResults(
  insertParagraphBreakAfterNonTextGap(uiMessageStream),
)
const [clientStream, persistenceStream] = correctedUiMessageStream.tee()
```

Placing it pre-`.tee()` is what makes the `source-url` parts land in **both**
the client stream and the persisted row, so a reloaded chat renders the same
citations the live stream did.

**Why `source-url` specifically, rather than a new detection branch:**
`getMessageUsedTools()` already infers web search from
`source-url`/`source-document` parts, and the client's existing citation
rendering already handles them. Emitting the established part type means
Brave/Exa citations render through the path native search already uses, with
no new client component. `docs/web-search-cost-accounting.md:537-543` flagged
this exact gap ("external searches wouldn't light up the existing Web search
tool badge without an added detection branch") — this transform is the answer
to it, and WP 1.1's suppression guard is what stops the inference
double-labelling the turn.

**Ordering caution:** `insertParagraphBreakAfterNonTextGap` treats any chunk
whose `type` starts with `tool-` or `reasoning-` as a "gap" marker and does
not touch other types. Injecting `source-url` chunks **after** it, as shown
above, keeps that logic seeing exactly the stream it sees today. Injecting
before it would introduce unrecognised chunk types into its state machine —
harmless by inspection, but unnecessary risk. Keep the order above.

### Tests

- `tests/unit/utils/filter-ui-message-stream.spec.ts` — existing file, listed
  in `chatStreamBranchTests`. New cases: a Brave tool-output chunk yields the
  original chunk **plus** N `source-url` chunks in that order; duplicate URLs
  emit once; a malformed or empty output emits the tool chunk and no sources
  and throws nothing; a non-search tool chunk passes through untouched.
- `tests/integration/api/chats-external-search.spec.ts` (from WP 1.3) —
  extend: the persisted message's `parts` contain both the
  `tool-web_search_brave` part and the `source-url` parts.
- `scripts/test-affected-check.mjs`: already mapped via
  `chatStreamBranchTests`. Verify the mapping pattern covers
  `server/utils/chats/filter-ui-message-stream\.ts`; add it if not.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/filter-ui-message-stream.spec.ts \
  tests/integration/api/chats-external-search.spec.ts
```

Browser verification is folded into WP 1.5's end-to-end script, since a
visible citation needs a visible way to trigger a search.

- [x] WP 1.4 complete (commit `24fde38`)

## WP 1.5 — The web-search-provider picker (client)

**Tier: Sonnet.** The largest client package in Epic 1. The three-piece
pattern and the alignment coupling below are the two things most likely to be
missed.

### Files touched

| Path | Nature |
| --- | --- |
| `app/components/ChatInput/WebSearchMenuItems.vue` | new component |
| `app/components/ChatInput/WebSearchTrigger.vue` | new component |
| `app/components/ChatInput/ToolbarMore.client.vue` | hand edit — replace the toggle row with the menu-items component |
| `app/components/ChatInput/ReasoningTrigger.vue` | hand edit — alignment rule |
| `app/components/ChatInput.client.vue` | hand edit — state, watches, handlers |
| `app/composables/chat-input.ts` | hand edit — new computeds |

### What changes, concretely

**Mirror the reasoning dropdown, which is a `<details class="dropdown">`, not
a `<dialog>`.** The repo does use real `<dialog>` elements elsewhere (Files
Modal, ShareModal, ProjectPicker, Search Modal, Confirmation), so "dialog" in
the original request is ambiguous. The thing to copy is
`app/components/ChatInput/ReasoningTrigger.vue` (105 lines).

**The three-piece pattern is mandatory.** `ReasoningTrigger.vue` is only the
desktop half; the menu body lives in a separate
`app/components/ChatInput/ReasoningMenuItems.vue` which is embedded **twice** —
once inside the trigger (desktop, `hidden md:flex` toolbar row) and once
inside `ToolbarMore.client.vue` (the `md:hidden` overflow dropdown, at
`:19-27`). **Skipping the `ToolbarMore` embed silently removes the control on
mobile with no error.** Build all three pieces:

1. `WebSearchMenuItems.vue` — the reusable menu body. A `menu-title` header
   ("Web search"), then one `<li>` per option, emitting
   `select-provider`. Copy `ReasoningMenuItems.vue`'s active-state styling
   verbatim: `:class="{ 'bg-accent text-accent-content pointer-events-none': selected === option }"`.
2. `WebSearchTrigger.vue` — the desktop `<details class="dropdown dropdown-top">`
   wrapping `WebSearchMenuItems`. Copy `ReasoningTrigger.vue`'s behaviours
   exactly: `useElementHover(dropdown)` plus a
   `watch(isDropdownHovered, …, { flush: 'post' })` that opens on hover
   **only on desktop** (`if (!dropdown.value || isIos || isAndroid) return`),
   and `onClickOutside(dropdown, …)` to force-close.
3. The `ToolbarMore.client.vue` embed — **replace** the existing plain
   checkbox row at `:103-114` (`isWebSearchSupported && !isDeepResearchModel`,
   emitting `toggle-web-search`) with `<ChatInputWebSearchMenuItems>`,
   emitting a new `select-web-search-provider` event. Keep the `v-if` gating
   condition. `isAnyFeatureActive` (`:...`) must keep lighting the overflow
   badge for any of the three active states, not just native.

**Menu options** — derived, never hardcoded:

| Option | Label | Enabled when |
| --- | --- | --- |
| `off` | Off | always |
| `web_search` | Model's built-in search | `selectedModel.tools.includes('web_search')` |
| `web_search_brave` | Brave Search | `selectedModel.toolCall === true` **and** `hasKeyForProvider('brave')` |
| `web_search_exa` | Exa | `selectedModel.toolCall === true` **and** `hasKeyForProvider('exa')` |

Render a disabled option with a short reason rather than hiding it, so the
user learns the feature exists — except when `toolCall` is false, where all
external options collapse to a single explanatory line. When a key is
missing, link to `/profile/keys` (the existing
`ModelsTrigger/KeyPrompt.vue` is the precedent for that copy and tone).

**Trigger button state.** The current desktop control is a plain `<UiButton>`
toggle at `ChatInput.client.vue:154-174` with
`icon-name="lucide:globe"`, going from circle+icon-only (off) to
`pl-[5px] btn-active` with the text "Search" (on). Preserve that visual
grammar: off = ghost circle globe; on = active pill with the **provider's**
short label ("Search", "Brave", "Exa"), and the provider's `ProviderIcon` in
place of the globe for Brave/Exa. This is what makes the current selection
readable without opening the dropdown.

**⚠ The `ReasoningTrigger` alignment coupling must be redesigned.**
`ReasoningTrigger.vue:6-7` currently keys its dropdown alignment on
`isWebSearchEnabled`:

```
:class="{ 'dropdown-end': isWebSearchEnabled,
          'max-xs:dropdown-start xs:dropdown-end': !isWebSearchEnabled }"
```

The prop exists **only** to control alignment: when the web-search button is
expanded into its labelled state it takes horizontal room, pushing the
reasoning dropdown's anchor, so the menu flips its alignment to avoid
clipping at the viewport edge. Turning web search into a second adjacent
dropdown breaks that premise — there are now two `dropdown-top` menus side by
side, and the reasoning one can be pushed further than the current boolean
anticipates. **Replace the boolean prop with an explicit alignment prop**
(e.g. `align: 'start' | 'end'`) computed once in `ChatInput.client.vue` from
the actual set of expanded toolbar controls, and pass it to both triggers.
Do not leave `isWebSearchEnabled` in place as a proxy — it will be wrong the
moment a third control lands. This is a small refactor with a visual failure
mode, so it gets its own browser-verification step below.

**`app/composables/chat-input.ts`** — the natural home, per its existing
role as the single composable the input reads. Add:

```ts
const isToolCallingSupported = computed(() => selectedModel.value?.toolCall === true)
const webSearchProviderOptions = computed<WebSearchOption[]>(() => { … })
```

`isWebSearchSupported` stays exactly as it is
(`!!selectedModel.value?.tools.includes('web_search')`) — it means "native
search", and renaming it would churn six call sites for nothing.

**`ChatInput.client.vue`** — state lives in the existing `tools` model, not a
new ref:

- `:336` `const tools = defineModel<Tools>('tools', { default: () => [] })` —
  unchanged.
- `:569` `isWebSearchEnabled` — keep it (`ToolbarMore` and the badge logic
  read it) but redefine it as "any of the three search members is present",
  and add a `selectedWebSearchProvider` computed returning the specific
  member or `'off'`.
- `:623-642` `toggleWebSearch()` → `selectWebSearchProvider(option)`:
  remove **all three** search members, then add the chosen one (if not
  `off`), and strip `image_generation` whenever any is chosen. The existing
  function already strips `image_generation`; preserve that.
- `:512-555` the watch on `[isWebSearchSupported, isImageGenerationSupported,
  isImageGenerationRequired]` that prunes tools when the model changes —
  extend it to also drop `web_search_brave`/`web_search_exa` when the newly
  selected model loses `toolCall`, or when the corresponding key disappears.
  This mirrors the existing `reasoning.value = 'off'` reset at `:485-510`;
  without it a user can switch to a non-tool-calling model and send a request
  the server will 400.
- `:665-687` the auto-enable on a pasted URL — **decision, stated as a
  default rather than left implicit: auto-enable native `web_search` only,
  never Brave or Exa.** Pasting a link should not silently spend money on a
  third-party API the user did not choose. If the model has no native search,
  auto-enable does nothing, exactly as it does today for a model without
  `web_search`. Flag this in the PR description so the owner can overrule it
  cheaply.

### Tests

- **New:** `tests/unit/components/ChatInput/WebSearchMenuItems.spec.ts` —
  option list derivation for every combination of `toolCall` × key presence ×
  native support; disabled reasons render; `select-provider` emits the right
  value.
- **New:** `tests/unit/components/ChatInput/WebSearchTrigger.spec.ts` —
  modelled on any existing `ReasoningTrigger` spec if one exists: hover opens
  on desktop only, click-outside closes, the trigger label reflects the
  selection.
- `tests/unit/components/ChatInput.spec.ts` — `selectWebSearchProvider`
  mutual exclusivity (never two search members; never search + image
  generation); the model-change watch prunes an now-invalid external
  selection; URL auto-enable picks native only.
- `tests/unit/composables/chat-input.spec.ts` — `isToolCallingSupported` and
  `webSearchProviderOptions`.
- `tests/unit/components/ChatInput/ToolbarMore.spec.ts` (create if absent) —
  the menu items render in the mobile overflow and emit upward. **If no such
  spec exists today, creating it is required, not optional** — the mobile
  path is the one that fails silently.
- `scripts/test-affected-check.mjs`: `userKeysTests` already pulls in
  `ChatInput.spec.ts` and `chat-input.spec.ts`. Add the three new specs to a
  group triggered by
  `^app/components/ChatInput(\.client\.vue|/(WebSearch(Trigger|MenuItems)|ToolbarMore\.client|ReasoningTrigger)\.vue)$` —
  the `imageGenerationTests` mapping already matches
  `app/components/ChatInput(\.client\.vue|/ToolbarMore\.client\.vue)`, so
  extend that pattern rather than adding an overlapping one.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/components/ChatInput/ \
  tests/unit/components/ChatInput.spec.ts \
  tests/unit/composables/chat-input.spec.ts
```

**Manual browser verification script** (local `pnpm run dev`, signed in, with
real Brave and Exa keys saved from Epic 0):

1. Open a new chat. Select a tool-calling model that also has native search
   (e.g. a Claude or Gemini chat model).
2. Confirm the globe button is a ghost circle. Hover it — the dropdown opens
   on hover (desktop) and lists four options: Off, the model's built-in
   search, Brave Search, Exa.
3. Pick "Brave Search". Confirm the trigger collapses to an active pill
   reading "Brave" with Brave's icon, and the dropdown closes.
4. Open the reasoning dropdown next to it. **Confirm its menu is not clipped
   at the viewport edge** and does not overlap the search dropdown. Repeat at
   a narrow (<480px) viewport — this is the alignment rule being verified.
5. Send "what happened in the news today". Confirm: a reasoning step appears
   reading "Searching the web" then "Searched the web"; the answer cites
   sources; the citations render as links.
6. Open the message context menu. Confirm the **Tools** row reads "Web search
   (Brave)" and the **Web search** cost row reads `~$0.01 (1 search)` or
   similar — a cost *and* a unit count, with the `~`.
7. Switch to Exa and repeat steps 3–6. Confirm the cost row shows Exa's own
   reported figure.
8. Switch to a model with `toolCall: false` (find one via the picker's new
   tool-calling chip from WP 1.6). Confirm the search dropdown no longer
   offers Brave/Exa, **and** that the previously-selected Brave selection was
   dropped rather than silently carried into the next send.
9. Narrow the viewport until the toolbar collapses into the "⋮" overflow.
   Confirm the web-search options are present **in the overflow menu**, that
   selecting one works, and that the overflow button's accent badge lights up.
10. Select "Off" and confirm the button returns to a ghost circle.
11. Enable image generation on a model that supports it, then open the search
    dropdown and select Brave. Confirm image generation switches itself off
    (they are mutually exclusive) rather than both appearing active.

- [x] WP 1.5 complete (commit `bed5ddb`)

## WP 1.6 — Tool-calling capability chip and badge in the model picker

**Tier: Sonnet.** Three small edits plus an optional filter. May run in
parallel with WP 1.2–1.5.

### Files touched

| Path | Nature |
| --- | --- |
| `app/components/ChatInput/ModelsTrigger/ModelItem.vue` | new code |
| `app/components/ChatInput/ModelsTrigger/ModelDetail.vue` | new code |
| `app/components/ChatInput/ModelsTrigger/FilterDropdown.vue` | new code (optional filter) |
| `app/utils/models-picker.ts` | new code (only if the filter ships) |

### What changes, concretely

`docs/models-data-fetching.md` already records this duplication as a known,
accepted trade-off: "Capability-icon conditionals are duplicated between the
row and the detail panel… A fifth capability would need adding in two
places." This is that fifth capability. Do **not** refactor the duplication
away as part of this package — that is a separate change with its own
review, and bundling it would obscure a UI regression.

**Row chip — `ModelItem.vue:79-133`.** Add one more
`<span class="capability-chip shrink-0 flex items-center p-0.5 rounded-full text-{colour}">`
+ `<Icon>` following the five that exist (reasoning `lucide:brain`
`text-warning`; web search `lucide:globe` `text-info`; image generation
`lucide:image-plus` violet; vision `lucide:eye` `text-accent`; deep research
`lucide:telescope` `text-success`). Use `lucide:wrench` (or
`lucide:square-function`) and a colour not already taken by the five —
`text-neutral` reads as "structural capability" rather than "feature", which
matches what tool calling is. Gate it on `model.toolCall` and on the existing
`hasTooltip = isDesktop && !isLegacy`. Tooltip copy: "Supports tool calling —
can use Brave or Exa web search".

**⚠ `hasCapabilities` (`ModelItem.vue:225-234`) must be extended too.** It is
an OR of the five existing flags and gates the whole chip group's
visibility — a model whose *only* capability is tool calling would otherwise
render no chips at all, including the new one.

**Detail badge — `ModelDetail.vue:135-140, 221-268`.** Push one more
`CapabilityBadge` (`{ label, icon, class, tooltip? }`) onto the `badges`
array: `{ label: 'Tool calling', icon: 'lucide:wrench', class: 'badge-neutral' }`.
The rendering wrapper (`badge badge-sm badge-soft` plus conditional
`tooltip tooltip-soft tooltip-bottom` and `:data-tip`) already handles it.

**Optional — "Tool calling only" filter.** `FilterDropdown.vue` is a
`<details class="dropdown dropdown-end">` already carrying a "Vision only"
toggle alongside the category options and a Clear row. A "Tool calling only"
toggle slots in beside it with no structural change, mirroring
`isVisionOnly`'s plumbing through `ModelsTrigger.vue`'s
`hasActiveFilters`/`clearFilters()`. **Recommended but not required** — ship
it if the executor can do so without touching `ModelsTrigger.vue`'s
`sections`/`filteredModels` logic in a way that risks WP 2.8's rebuild.
If it is skipped, say so in the PR description rather than silently omitting
it.

### Tests

- `tests/unit/components/ChatInput/ModelsTrigger/ModelItem.spec.ts` — the
  chip renders for `toolCall: true` and not for `false`;
  `hasCapabilities` is true for a tool-calling-only model (assert the chip
  group is visible, not just the boolean).
- `tests/unit/components/ChatInput/ModelsTrigger/ModelDetail.spec.ts` — the
  badge renders with the right label and class.
- `tests/unit/components/ChatInput/ModelsTrigger/FilterDropdown.spec.ts` —
  only if the filter ships.
- `tests/unit/utils/models-picker.spec.ts` — only if the filter ships.
- `scripts/test-affected-check.mjs`: all four specs are already members of
  the `modelsTriggerTests` array and are triggered by `modelsTriggerPattern`.
  **No new registration needed** — verify before concluding it.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/components/ChatInput/ModelsTrigger/
```

**Manual browser verification script:**

1. Open the model picker. Confirm a new chip appears on rows for
   tool-calling models and is absent on rows for models where models.dev
   reports `tool_call: false`.
2. Hover the chip on desktop and confirm the tooltip text.
3. Click a model row to open its inline detail panel. Confirm the
   "Tool calling" badge renders alongside the existing capability badges and
   does not wrap the badge row awkwardly at a narrow viewport.
4. Find a model with **only** tool calling and no other capability (use the
   picker search); confirm its chip group renders rather than collapsing.
5. If the filter shipped: toggle "Tool calling only", confirm the list
   narrows, confirm "Clear" resets it, and confirm it composes correctly with
   "Vision only" and a category selection.

- [x] WP 1.6 complete (commit `6995e73`)

## WP 1.7 — Cost row attribution and reasoning-step titles

**Tier: Sonnet.** Small. May run in parallel with WP 1.5/1.6, but its
browser check needs WP 1.5 landed.

### Files touched

| Path | Nature |
| --- | --- |
| `shared/utils/message-metadata.ts` | new code (`MessageMenuInfo.searchProvider`) |
| `app/components/Chat/ContextMenu.client.vue` | new code (label) |
| `app/utils/reasoning.ts` | new code (two `TOOL_STEP_TITLES` entries) |

### What changes, concretely

**`MessageMenuInfo`** (`shared/utils/message-metadata.ts:10-30`) already
carries `searchCost`, `searchUnits` and `searchBillingUnit`. Add
`searchProvider?: SearchProvider`, populated from `MessageUsage.searchProvider`
in the same place the other three are read.

**`ContextMenu.client.vue`** — `searchGroundingLabel` (`:372-385`) currently
composes `formatSearchGroundingUnits(units, billingUnit)` with
`formatMessageCost(searchCost, true)`. Leave that composition alone and
change only the **row label**: the static `<span>Web search</span>` at
`:124-135` becomes a computed reading
`searchProvider ? \`Web search (${providerMeta[searchProvider]?.label ?? searchProvider})\` : 'Web search'`.
Keep `data-testid="message-menu-search-grounding"` unchanged — several tests
and the e2e suite key on it.

Note the four native providers are also valid `searchProvider` values, so
this change retroactively improves attribution for them too ("Web search
(Anthropic)"). That is a behaviour change on existing messages — but only
forward-looking ones, since `searchProvider` is never backfilled onto
already-persisted rows (consistent with
`docs/web-search-cost-accounting.md`'s non-goal: "any accounting change is
prospective only"). A legacy row with no `searchProvider` renders the
unadorned "Web search", exactly as today.

**`app/utils/reasoning.ts` — good news, verified by reading the file.** Both
functions already work for the new tools with **zero** changes:

- `isThinkingToolPart()` is generic: any `tool-*` part whose name is not in
  `EXCLUDED_TOOL_STEP_NAMES` (`{'generate_image'}`) counts. `web_search_brave`
  and `web_search_exa` qualify.
- `getToolStepTitle()` has a substring fallback:
  `if (toolName.toLowerCase().includes('search'))` → "Searching the web" /
  "Searched the web" / "Search failed". Both new names contain "search".

So this file needs **no** change to work. It gets one anyway, for polish:
add two explicit `TOOL_STEP_TITLES` entries so the step reads
"Searching with Brave" / "Searched with Brave" (and the Exa equivalents)
instead of the generic wording, matching the attribution the Tools and cost
rows now carry. **Write this in the PR description as "a polish change on top
of already-correct generic behaviour", not as a bug fix** — file 00's blind
spot #5 raised this as a possible gap, and the finding is that it is not one.

### Tests

- `tests/unit/utils/message-metadata.spec.ts` — `searchProvider` flows from
  `MessageUsage` to `MessageMenuInfo`; absent stays absent.
- `tests/unit/components/Chat/ContextMenu.client.spec.ts` — the row reads
  "Web search (Brave)" with a provider and plain "Web search" without one.
- `tests/unit/utils/reasoning.spec.ts` (create if absent, else extend) —
  `getToolStepTitle('web_search_brave', …)` returns the Brave wording in all
  three states, and `isThinkingToolPart` accepts a `tool-web_search_exa`
  part.
- `scripts/test-affected-check.mjs`: `messageUsageTests` and
  `contextMenuTests` already cover the first two. Add the reasoning spec to
  whichever group maps `app/utils/reasoning\.ts`; create that mapping if it
  does not exist.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/message-metadata.spec.ts \
  tests/unit/components/Chat/ContextMenu.client.spec.ts \
  tests/unit/utils/reasoning.spec.ts
```

**Manual browser verification** — folded into WP 1.5's script, steps 5–7.
Additionally: open an **old** chat whose messages predate this work and
confirm its Web search rows still render the unadorned label and throw
nothing.

- [x] WP 1.7 complete (commit `64e9e87`)

## Epic 1 gate

- [x] CI green on PR #362 with all seven packages landed (confirmed on
      commit `0e46727`: Build PR, Check PR state, Check latest commit paths,
      Preview Deploy all passed)
- [x] WP 1.5's browser script passed against the deployed preview
      (`pr-362-besidka-preview`), owner keys saved: a real Brave send (3
      Brave calls in one turn, 18 real sources, reasoning steps read
      "Searched with Brave") and a real Exa send (1 call, 10 real sources,
      "Searched with Exa") both worked end to end; the search-provider and
      reasoning dropdowns render and align correctly side by side; mutual
      exclusivity with image generation holds. **Found and fixed one real
      bug in the process** (see below) that no unit test caught because it
      required a real persisted DB row to surface.
- [x] WP 1.6's picker script — confirmed live against the deployed preview:
      104 real models render the tool-calling chip with the exact tooltip
      text `"Supports tool calling — can use Brave or Exa web search"`. The
      detail-popover badge was not independently re-driven live (tooling
      friction reaching that specific click target in this session's
      browser automation, unrelated to the feature) but its code is
      unit-tested and was independently code-reviewed.
- [x] **Live-verification bug found and fixed, commit `d9ac692`**: the
      context-menu **Tools** row showed generic "Web search" instead of
      "Web search (Brave)"/"Web search (Exa)" on a real message, even though
      the **cost** row correctly attributed the provider. Root cause,
      confirmed by querying the live D1 row directly
      (`besidka-preview`, message id 1917): an assistant message's own
      `tools` column is always empty by pre-existing design (only the
      paired user message row carries it), so the `storedTools`-based
      lookup WP 1.1 built could never fire in production — only synthetic
      unit fixtures ever populated it. Fixed by detecting the specific
      `tool-web_search_brave`/`tool-web_search_exa` part directly, which
      does persist reliably. Re-verified live after the fix deployed: both
      Brave's and Exa's Tools rows now read correctly.
- [x] `pnpm run db:generate` produced no migration (confirmed independently
      across every Epic 1 package)
- [x] `docs/web-search-cost-accounting.md` updated — annotated "Sketch:
      external search backends" and "If we build this next" as implemented,
      pointing at this plan doc; annotated "The AI Gateway question" with the
      real R12 spike verdict (Vercel PASS, Cloudflare inconclusive/owner-
      blocked). The shipped Exa rate is $7/1,000, not the originally-sketched
      $17/1,000 — see `wrangler.jsonc`'s comment and this plan's R3 for the
      empirical correction; the superseded key-storage recommendation in
      that doc is annotated in place, not deleted, per its own convention.
- [x] Independent code review pass completed (`abf6795`... see commit
      `1d09948`'s message) — found and fixed: a duplicate D1 key lookup, a
      mislabeled Google search-cost row ("Web search (Google AI Studio)"
      instead of "Web search (Google)" — the same bug class already fixed
      for Brave, not backfilled onto the pre-existing `google` entry), and a
      test that didn't prove what it claimed. `docs/auth-security.md`,
      `docs/models-data-fetching.md`, `docs/providers/general.md` also
      updated per the review's documentation-debt findings.

---

# Epic 2 — Gateway restoration

The largest epic. `docs/gateway-removal-plan.md` § 3 is the per-file spec,
read backwards; `git show 24df3b5 -- <path>` read in reverse is the diff
spec for any file that has churned.

**A whole-commit `git revert 24df3b5` is not viable** and must not be
attempted: 115+ commits have landed since, and the highest-value files were
rewritten by exactly the web-search-cost work that motivates this
restoration. The shape is instead **per-file `git checkout 24df3b5^ -- <path>`
for the zero-churn set, hand-rebuild for the rest**.

**Sequencing inside the epic** — this is the consumers-before-producers
ordering inverted:

```
2.1 (deps + mechanical restore)
  └─> 2.2 (migration)  ──┐
  └─> 2.3 (shared layer) ┼─> 2.4 (key routes + keys tab)
                         ├─> 2.5 (catalog server + API)
                         └─> 2.6 (index.post.ts rebuild — OPUS)
                               └─> 2.7 (title.patch + message-usage + images)
2.3 ──> 2.8 (picker rail) ──> 2.9 (composables)
all ──> 2.10 (tests + docs)
```

2.4, 2.5 and 2.8 may run in parallel once 2.3 lands. 2.6 must not start until
2.3 and 2.5 are green, because it imports from both.

## WP 2.1 — Dependencies and mechanical restore

**Tier: Sonnet.** Mechanical, near-zero judgement — but read the two "do not
restore" notes.

### Files touched

**Dependencies (`package.json`, `pnpm-lock.yaml`):**

| Package | Action | Note |
| --- | --- | --- |
| `@ai-sdk/gateway` | re-add at `^4.0.46` | Never left `pnpm-lock.yaml` — it is still a transitive dependency of `ai@7.0.56` and `nuxt-studio@1.7.0`. Re-adding is cheap and yields no bundle-size change. |
| `@openrouter/ai-sdk-provider` | re-add at `^3.0.0` | **Fully left the lockfile** — a real install. |
| `@ai-sdk/openai-compatible` | **already present, do not touch** | Used by both the Cloudflare gateway builder and the surviving `server/utils/providers/qwen.ts`. Removing it breaks Qwen. |

There is no Cloudflare-AI-Gateway npm package — that integration is raw
`fetch` plus `@ai-sdk/openai-compatible`.

Edit `package.json`, then run `pnpm install`. **Never hand-edit
`pnpm-lock.yaml`.** `.npmrc` sets `save-exact=true`, so pin exactly what
resolves and record the resolved versions in the PR description.

> **Correction to an earlier assumption.** File 00's blind spot #9 states
> that re-adding `@openrouter/ai-sdk-provider` "hits this repo's
> `minimumReleaseAge` 1-day gate". **Verified false at plan time:**
> `pnpm config get minimumReleaseAge` returns `undefined`, and the string
> appears in neither `.npmrc`, `pnpm-workspace.yaml`, `package.json` nor
> `~/.npmrc`. There is no release-age gate to satisfy. Re-run
> `pnpm config get minimumReleaseAge` before installing anyway — if it has
> since been configured, pin to a compliant version and **never bypass the
> gate**.

**Mechanical restores — `git checkout 24df3b5^ -- <path>`.** The archaeology
report confirms **zero commits** have touched any of these since the removal,
so each applies cleanly and needs re-verification, not redesign:

Wholesale-deleted files (nothing has replaced them):

```
server/utils/gateways/{catalog,cloudflare,index,openrouter,vercel}.ts
server/api/v1/gateways/[gateway]/models.get.ts
server/api/v1/profiles/keys/vercel-gateway/index.{get,post,delete}.ts
server/api/v1/profiles/keys/cloudflare-gateway/index.{get,post,delete}.ts
server/api/v1/profiles/keys/openrouter/index.{get,post,delete}.ts
shared/types/gateways.d.ts
shared/types/model-selection.d.ts
shared/utils/gateway-{capabilities,model-id,pricing}.ts
app/composables/gateway-catalog.ts
app/components/ChatInput/ModelsTrigger/Gateway{ModelDetail,ModelItem,ModelList,ProviderRail,Rail}.vue
app/components/Profile/Keys/CloudflareGateway.vue
```

Zero-churn surgical files (restore the whole file, then re-read it against
current neighbours):

```
shared/utils/model-selection.ts
app/composables/{user-setting,model,selected-model-info,image-input-support,user-keys,chat-title}.ts
app/utils/models-picker.ts
app/types/models-picker.d.ts
server/utils/chats/errors.ts
shared/types/chat-errors.d.ts
server/api/v1/profiles/settings/index.{get,patch}.ts
server/db/schemas/user-settings.ts
server/api/v1/chats/[slug]/title.patch.ts
```

> **Do NOT restore these, despite appearing in the deleted set:**
>
> - `app/assets/icons/{openrouter,vercel,cloudflare}.svg` — the removal plan
>   § 6.5 established they were **already unreferenced before the removal**;
>   the icon system had moved to `simple-icons:*` via `@nuxt/icon`. Restoring
>   them adds three dead assets. `ProviderIcon.vue` is restored by hand-merge
>   in WP 2.8 instead.
> - `.drizzle/migrations/20260809021640_vengeful_lifeguard/` — see WP 2.2.
>   Resurrecting it is a **mid-chain insertion** and is unsafe.
> - `docs/future/gateway-free-trial-proposal.md` — a proposal that was never
>   built. Out of scope; restore only if the owner asks.

**After the checkout, typecheck will not pass.** That is expected: these
files import types and call helpers that the hand-rebuilt files
(2.3, 2.6, 2.8, 2.9) have not yet re-grown. Do not "fix" the restored files
to make an intermediate state compile — that is how the restoration silently
diverges from the known-good original. Land WP 2.1 and WP 2.3 together as one
commit if the CI shape demands a green tree.

### The zero-churn pre-check — run this BEFORE any checkout

**A post-checkout diff against `24df3b5^` is empty by construction and
proves nothing.** The check that matters runs *before* the checkout, and
asks a different question: has anything touched this path since the removal?

```bash
for path in <every path in the restore lists above>; do
  if git diff --quiet 24df3b5..HEAD -- "$path"; then
    echo "SAFE   $path"
  else
    echo "CHURN  $path"
  fi
done
```

**Rule: any path reported `CHURN` moves out of this package and into a
hand-merge package.** Do not check it out.

**This must be re-run at the start of Epic 2, not trusted from the
archaeology report.** The archaeology measured churn as of plan time;
Epics 0 and 1 land in between and *do* touch files on the restore list.
At least one collision is already known and must be handled:

- **`app/utils/models-picker.ts`** is on the restore list, and WP 1.6's
  optional "Tool calling only" filter modifies it. If that filter shipped,
  a blind `git checkout 24df3b5^ --` on this path **silently wipes Epic 1
  work**, and the (useless) post-hoc diff would report success. Hand-merge
  it: take the restored gateway helpers
  (`gatewayModelCategoryOptions`, `getGatewayProviderGroups`,
  `sortGatewayModelsByProvider`, `formatGatewayPriceDetail`/`toPricePair`/
  `formatPricePerMillionTokens`) and add them **alongside** current
  contents rather than replacing the file.
- Re-check `app/composables/chat-input.ts`,
  `app/types/models-picker.d.ts` and `shared/utils/provider-meta.ts` the
  same way — WP 0.1 and WP 1.5 touch the latter two areas. (This plan
  already routes `chat-input.ts` and `provider-meta.ts` to hand-merge
  packages, WP 2.9 and WP 2.3 respectively; the pre-check is what confirms
  no *other* path joined them.)

### Verification

```bash
pnpm install
pnpm run lint          # format/style only — typecheck will NOT pass yet
git status --short     # every restored path present, nothing unexpected deleted
```

Then, per restored path, confirm the working-tree content matches the
pre-removal content (this *is* tautological, but it catches a typo'd path
or a partial checkout):

```bash
git diff --stat 24df3b5^ -- <each restored path>   # expect EMPTY
```

No browser verification.

- [x] WP 2.1 complete (commit `d031d32`)

## WP 2.2 — The `favorite_gateway_models` migration

**Tier: Sonnet.** Small, but it is the one package in this plan that touches
a database. Read `AGENTS.md`'s "🚨 SUPER IMPORTANT — HIGH RISK: D1 Migration
Safety 🚨" section **before** starting.

### Files touched

| Path | Nature |
| --- | --- |
| `server/db/schemas/user-settings.ts` | restored in WP 2.1 — verify only |
| `.drizzle/migrations/<new-timestamp>_<name>/` | **generated**, never hand-written |

### What changes, concretely

The only physical schema drift gateways ever required was one column:

```sql
ALTER TABLE `user_settings` ADD `favorite_gateway_models` text;
```

Its original migration directory (`20260809021640_vengeful_lifeguard`) was
deleted as a **tail** removal. **It is no longer the tail** — two migrations
have landed after that timestamp:

```
20260802215200_skinny_ozymandias
20260829223128_amused_energizer          ← after
20260829223140_message_search_fts5       ← after (current tail)
```

Re-adding a `20260809…` directory is therefore a mid-chain insertion. The
fts5 tail snapshot does not contain `favorite_gateway_models`, so the chain
would be left inconsistent — drizzle-kit `1.0.0-rc.4` diffs against the
lexically-last `snapshot.json` and has no `meta/_journal.json` to consult.
**Generate a fresh migration at the current tail instead.**

Steps, in order:

1. Confirm WP 2.1 restored `favoriteGatewayModels` to
   `server/db/schemas/user-settings.ts` with its original type:
   `text({ mode: 'json' }).$type<Partial<Record<GatewayId, string[]>>>()` —
   nullable, **no default**.
2. `pnpm run db:generate`.
3. **Open the emitted `.sql` and read it.** It must be exactly one
   `ALTER TABLE \`user_settings\` ADD \`favorite_gateway_models\` text;` and
   must contain **no `DROP TABLE`** anywhere. Grep for it explicitly:
   `rg -n "DROP TABLE" .drizzle/migrations/<new-dir>/`. A nullable JSON text
   column with no `DEFAULT` is the safest possible SQLite/D1 change — a
   native in-place `ALTER TABLE ADD COLUMN`, not a Drizzle table rebuild.
   If a rebuild appears, **stop**: something else drifted, and the rebuild is
   the exact pattern the project's D1 rule exists to prevent.
4. Commit the generated directory as-is. Preview auto-applies it —
   `.github/workflows/preview-deploy.yml:126` runs
   `wrangler d1 migrations apply DB --remote` on every successful PR build,
   and `production.yml:465` on the preview-fallback path.
5. Before any **production** apply, take a Time Travel bookmark:
   `npx wrangler d1 time-travel info besidka` and record the string in the PR
   description. Production never had this column, the old migration or the
   rows, so this is a genuinely additive first application.

**There is no data to recover.** Preview's three gateway `keys` rows were
hard-deleted during the removal, the `gateway-catalog:*` KV sweep found zero
keys on both preview and production, and the orphan `d1_migrations`
bookkeeping row was removed — so the new migration's name cannot collide.
Users re-enter their gateway credentials from a clean slate.

### Tests

None directly. `pnpm run db:generate` producing exactly one expected
migration **is** the gate.

### Verification

```bash
pnpm run db:generate
rg -n "DROP TABLE|CREATE TABLE|__new" .drizzle/migrations/<new-dir>/   # expect NO hits
cat .drizzle/migrations/<new-dir>/migration.sql                        # read it
pnpm run db:generate   # second run MUST now produce nothing
pnpm run typecheck
```

The second `db:generate` producing nothing is the proof that schema and
snapshot chain agree.

No browser verification, but after the preview deploy lands, confirm
`/profile` loads and a favourite can be starred — the restored
`user_settings` read path is the first thing a stale column would break.

- [x] WP 2.2 complete (commit `d6e2b47`)

## WP 2.3 — Shared layer hand-merge + single source of truth for gateway ids

**Tier: Sonnet.** These files interlock through the same union types — do
them in **one** package, not in parallel, or you get conflicting edits to the
same unions.

### Files touched

| Path | Nature |
| --- | --- |
| `shared/utils/provider-meta.ts` | hand-rebuild — WP 0.1 already changed it |
| `shared/utils/model-selection.ts` | restored in 2.1 — verify + wire the shared const |
| `shared/types/gateways.d.ts` | restored in 2.1 — becomes the single source of truth |
| `shared/types/message-usage.d.ts` | hand-rebuild — WP 1.3 already changed it |
| `shared/utils/message-metadata.ts` | hand-rebuild — 3 commits of churn since removal |
| `shared/types/chat-errors.d.ts` | restored in 2.1 — verify |

### What changes, concretely

**Fix the four-copy gateway-id duplication while you are here.** The removal
plan § 10.4 documented that the union was hardcoded in four independent
places with no single source of truth, and the archaeology report § 1.3 calls
this out as something restoration **should** fix rather than reproduce:

1. `shared/types/gateways.d.ts` — `export type GatewayId = 'vercel' | 'cloudflare' | 'openrouter'`
2. `shared/utils/model-selection.ts` — `const gatewayIds: GatewayId[] = [...]`
3. `server/api/v1/chats/[slug]/index.post.ts` — `z.enum(['vercel','cloudflare','openrouter'])`
4. `server/api/v1/chats/[slug]/title.patch.ts` — the same `z.enum`
5. (`server/api/v1/gateways/[gateway]/models.get.ts` — a fifth, in a restored file)

Export **one** const from `shared/types/gateways.d.ts` (or an adjacent `.ts`
if a `.d.ts` cannot carry a value — it cannot, so put the const in
`shared/utils/gateways.ts` and keep the type derived from it):

```ts
export const gatewayIds = ['vercel', 'cloudflare', 'openrouter'] as const
export type GatewayId = typeof gatewayIds[number]
```

and derive every `z.enum` from it (`z.enum(gatewayIds)`). Keep
`enabledGateways` in `provider-meta.ts` as the **separate, product-ordered**
list (`['cloudflare', 'openrouter', 'vercel']`) — its doc comment stated the
order "is a deliberate product decision, not an incidental default — every
gateway-listing UI (keys page, picker rail) must display in this exact
order". Two lists with two jobs; do not collapse them into one.

**`shared/utils/provider-meta.ts`** — WP 0.1 already widened `kind` and
`ProviderMetaKeyField.name` and rewrote the
`resolveProviderMetaByKeyProviderId()` doc comment, so this is purely
additive: restore the three gateway entries from
`git show 24df3b5^:shared/utils/provider-meta.ts` with `kind: 'gateway'`,
including their dashboard URLs, and restore the `enabledGateways` export.
Cloudflare's entry carries **three** `keyFields` (`accountId`,
`gatewayId` optional, `apiKey`) while every other entry carries one — that
asymmetry is why Cloudflare needs its own card component.

**`shared/types/message-usage.d.ts`** — `totalCost` stops being legacy.
Replace the "No current send path writes it" comment with the live
description from the decided architecture above: a blended, upstream-reported
total written only by gateway sends, preferred over the `inputCost`/
`outputCost` split by `getPerMessageCost()`. Keep WP 1.3's `searchProvider`
field and its blended-exception sentence exactly as written — that sentence
is now load-bearing rather than anticipatory.

**`shared/utils/message-metadata.ts`** — 3 commits of churn (+51 lines) since
removal, all from the search-cost merges. The gateway-era change here was
small: `getPerMessageCost()` prefers `totalCost`, and the comment at
`:187-191` currently reads "**Some already-persisted turns** carry one
blended `totalCost` instead of the `inputCost`/`outputCost` split **every
current send path produces**". Reword it to describe the live gateway path.
Verify `sumMessageCosts()` still adds `getPerMessageCost` and
`getPerMessageSearchCost` as separate terms — it does today, and that is
what makes a gateway-model-plus-Brave-tool turn sum correctly with no new
code.

**`shared/types/chat-errors.d.ts`** and `server/utils/chats/errors.ts` —
restored in 2.1; verify `providerId?: SupportedProviderId | GatewayId` is
back and that `looksLikeImageInputRejection`'s `NO_ENDPOINTS_FOUND_PATTERN`
(written for gateway upstream wording) is once again live rather than
vestigial.

### Tests

**Known flip, pre-identified:**
`tests/unit/utils/message-metadata.spec.ts:609-632` —
`it('degrades an assistant message with a legacy gateway provider id to no provider row, instead of throwing')`.
It asserts `providerId`, `providerLabel` and `providerKind` are all
`undefined` for `provider: 'openrouter'`. **The moment
`providerMeta.openrouter` exists again, `resolveProviderMetaByKeyProviderId('openrouter')`
resolves and all three assertions flip.** This test must be **rewritten, not
deleted** — it also guards the `cost` read path (`expect(info?.cost).toBe(0.05)`).
Rewrite it as two tests: (a) an `openrouter`-provider message now resolves to
a real provider row with `providerKind === 'gateway'` and still reports its
cost; (b) a genuinely unknown provider string still degrades to no provider
row without throwing (keep an unrecognisable value so the degradation path
retains coverage).

- `tests/unit/utils/provider-meta.spec.ts` — the three gateway entries exist,
  `enabledGateways` is in the documented `cloudflare, openrouter, vercel`
  order, and `keyProviderId` maps `vercel → vercel-gateway`,
  `cloudflare → cloudflare-gateway`, `openrouter → openrouter` (the suffix
  trap, asserted explicitly).
- **New:** `tests/unit/utils/gateways.spec.ts` — `gatewayIds` is the single
  source and every derived `z.enum` accepts exactly it.
- `tests/unit/composables/model.spec.ts` — a `{"source":"gateway",…}` JSON
  selection round-trips again instead of degrading to the fallback model id.
- `tests/unit/utils/message-usage.spec.ts` — `totalCost` is preferred over
  the split.
- `scripts/test-affected-check.mjs`: add a `gatewaySharedTests` group and map
  it from
  `^(shared/(types/gateways\.d\.ts|utils/(gateways|gateway-(capabilities|model-id|pricing)|model-selection|provider-meta)\.ts))$`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/message-metadata.spec.ts \
  tests/unit/utils/provider-meta.spec.ts \
  tests/unit/utils/gateways.spec.ts \
  tests/unit/composables/model.spec.ts \
  tests/unit/utils/message-usage.spec.ts
```

**Regression check with real user data:** open an existing chat whose
assistant messages predate the gateway removal and confirm the context menu
renders without throwing. This is removal-plan risk R4 in mirror image — the
Provider row that silently disappeared for those messages now reappears.

- [x] WP 2.3 complete (commit `4a119e0`)

## WP 2.4 — Gateway credential routes + keys page gateway tabs

**Tier: Sonnet.** Mostly restored files; the keys page is a small extension
of WP 0.2's shell.

### Files touched

| Path | Nature |
| --- | --- |
| `server/api/v1/profiles/keys/{vercel-gateway,cloudflare-gateway,openrouter}/index.{get,post,delete}.ts` | mechanical restore (WP 2.1) — verify only |
| `app/components/Profile/Keys/CloudflareGateway.vue` | mechanical restore (WP 2.1) — verify only |
| `app/pages/profile/keys.vue` | hand edit — extend WP 0.2's `tabs` computed |

### What changes, concretely

The nine route files and the 261-line Cloudflare card come back verbatim from
WP 2.1's checkout. Verify rather than rewrite:

- Each route's rate-limit prefix is `keys-rate-limit:<gateway>:<verb>` via
  the surviving generic `server/utils/keys-rate-limit.ts`.

  > **Correction found during WP 0.2 (verified against
  > `git show 24df3b5^:server/api/v1/profiles/keys/openrouter/index.get.ts`):
  > the deleted gateway routes were window 60 / max 10 on POST and DELETE
  > only — GET was window 60 / max 30**, matching the keys-summary route's
  > limit. WP 0.2 chose 60/10 uniformly (including GET) for the new Brave/Exa
  > routes, since the plan's original text (inaccurately) said all three
  > verbs were 60/10 for gateways. **Decision: keep this WP 2.4 checkout's
  > verbatim gateway GET at 60/30 as originally coded** rather than tightening
  > it to match Brave/Exa's 60/10 — do not "fix" it to match Brave/Exa. The
  > resulting three-way inconsistency (gateway GET 30, Brave/Exa GET 10) is
  > accepted as low-stakes: `ProviderKeyCard.vue` never calls a per-provider
  > GET route directly, only the aggregate summary endpoint, so neither limit
  > is exercised by normal UI use. Do not spend a package reconciling this.
- `server/api/v1/profiles/keys/index.get.ts` needs **zero** changes — it
  iterates `schema.keys.provider.enumValues` dynamically, and WP 0.1 already
  widened that enum, so gateways are already being listed.
- **Cloudflare stores a JSON blob in the single encrypted `keys.apiKey`
  column**, not three columns:
  `useEncryptText(JSON.stringify({ accountId, gatewayId, apiKey }))`, with
  Zod validation `CLOUDFLARE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/`, max 128 chars
  for the ids, 2048 for the key, plus a control-character refinement. That is
  the whole reason this one card is bespoke.

**`app/pages/profile/keys.vue`** — extend WP 0.2's `tabs` computed with the
gateway spread, which is exactly what `24df3b5` deleted:

```ts
const tabs = computed<KeyTab[]>(() => [
  { id: providersTabId, label: 'Per provider' },
  { id: searchTabId, label: 'Search providers' },
  ...enabledGateways.map(id => ({
    id,
    label: providerMeta[id]?.label || id,
    providerId: id,
  })),
])
```

and add the gateway panel block, restoring the original blurb verbatim:

> Gateways proxy to many models using your own gateway account, instead of a
> single provider's key

rendering `<LazyProfileKeysCloudflareGateway v-if="gatewayId === 'cloudflare'" open />`
else `<LazyProfileKeysProviderKeyCard v-else :provider-id="gatewayId" open />`.
Note `open` — gateway panels render their single card expanded, unlike the
provider list's accordion.

This yields a five-tab bar. Check the narrow-viewport behaviour explicitly
(step 6 below): the original design only ever had four.

### Tests

- `tests/unit/pages/profile/keys.spec.ts` — five tabs in the order
  `providers, search, cloudflare, openrouter, vercel`; the gateway panels
  render the right card component per id.
- Restore (from `git show 24df3b5^`) and re-verify:
  `tests/integration/api/profile-keys-{cloudflare-gateway,vercel-gateway,openrouter}.spec.ts`
  and `tests/unit/components/Profile/Keys/CloudflareGateway.spec.ts`. These
  were wholesale-deleted and nothing has replaced them, so the restored
  versions should pass as-is once the routes are back.
- `tests/integration/api/profile-keys-summary.spec.ts` — already updated to
  12 in WP 0.1; re-confirm it still passes with the gateway routes live.
- `scripts/test-affected-check.mjs`: add all four restored specs to the
  `keysApiTests` array, and extend that mapping's pattern to include
  `server/api/v1/profiles/keys/(vercel-gateway|cloudflare-gateway|openrouter)/.+`
  and `app/components/Profile/Keys/CloudflareGateway\.vue`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/pages/profile/keys.spec.ts \
  tests/unit/components/Profile/Keys/ \
  tests/integration/api/profile-keys-*.spec.ts
```

**Manual browser verification script** (this is the *most* that can be
verified for gateways this session — there are no gateway test credentials,
so a real save cannot be confirmed against a live gateway):

1. `/profile/keys` — confirm five tabs in the order Per provider, Search
   providers, Cloudflare, OpenRouter, Vercel.
2. Click each gateway tab. Confirm the blurb renders and exactly one card is
   shown, already expanded.
3. On the **Cloudflare** tab, confirm the card shows **three** fields —
   Account ID, Gateway ID (optional), API Key — not one.
4. Type an invalid Account ID (e.g. `abc def!`) and submit. Confirm the
   client-side validation message appears and no request is sent.
5. On the **OpenRouter** and **Vercel** tabs, confirm a single API-key field
   with a working Paste button and a dashboard link that opens the right
   vendor's key page.
6. Narrow the viewport. Confirm the five-tab bar degrades to icon-only tabs
   without overflowing or wrapping into an unreachable state.
7. **Owner saves a real key on each of the three gateway tabs** (the
   `.dev.vars` credentials). For Cloudflare, that is the account id **and**
   the API key. Confirm each card's badge flips to "Key saved" without a
   reload, then reload and confirm persistence.
8. Confirm the Cloudflare key round-trips as a **JSON blob in one encrypted
   column**: re-expand the card and confirm the account id is repopulated
   while the API key field is **empty** (a saved key is never returned to the
   browser — the account id is not secret, the key is).
9. Delete each and confirm the badge reverts. Re-save them; the rest of
   Epic 2's live verification depends on them being present.

- [x] WP 2.4 complete (commit `4345791`, landed with WP 2.5)

## WP 2.5 — Gateway model catalog (server + API + client cache)

**Tier: Sonnet.** Restored wholesale; the work is verification, not writing.

### Files touched

| Path | Nature |
| --- | --- |
| `server/utils/gateways/catalog.ts` | mechanical restore (989 lines) — verify |
| `server/utils/gateways/{vercel,openrouter,cloudflare}.ts` | mechanical restore — verify |
| `server/api/v1/gateways/[gateway]/models.get.ts` | mechanical restore — rewire its `z.enum` to the shared const from WP 2.3 |
| `app/composables/gateway-catalog.ts` | mechanical restore (59 lines) — verify |

### What to verify, concretely

Nothing here needs rewriting, but four mechanisms are subtle enough that a
reviewer must confirm them rather than assume the restore was faithful:

**1. The three fetch strategies differ on purpose.**

| Gateway | Endpoint | Auth | Cache |
| --- | --- | --- | --- |
| Vercel | `GET https://ai-gateway.vercel.sh/v1/models` | none (public) | global KV, 1 h |
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | none (public) | global KV, 1 h |
| Cloudflare | `GET /accounts/{id}/ai/models/search?format=openrouter` | user credentials | **per-account**, 15 min, keyed by `sha256(apiKey)` |

Cloudflare's cache key deliberately includes the key hash, not just the
account id: "a guessed account ID paired with an unrelated key must never
produce a cache hit against another user's real catalog." **That is a
security property, not an optimisation** — flag any change to it.

**2. Cloudflare's two-format join is inverted, and that is the trap.**
Neither response shape suffices alone, so both are fetched in parallel inside
one cache unit. `?format=openrouter` gives ids/names/descriptions but **no**
pricing, tool-calling or reasoning data; the default format's `properties[]`
array is the only place those live. The identity relationship is inverted
between them: in the marketplace shape `id` is the real `@cf/vendor/model`
string, while in the default shape `id` is an internal UUID and that same
string lives in `name`. **The join key is `marketplace.id === default.name`.**
Joining `id === id` silently matches nothing — no error, just an
uncorrelated catalog.

**3. Property parsing must stay defensive.** Cloudflare returns
`context_window`, `function_calling` and `reasoning` as **strings**
(`"128000"`, `"true"`), while `price` is a real JSON array of
`{ unit, price, currency }` in **USD per million tokens** against
`GatewayModel.pricing` being **per token** — hence a `/1e6`. Enrichment
**backfills only** and never overwrites. Coverage is logged as
`gatewayCatalogEnrichment.{gateway,models,matched,priced}`.

**4. KV keys carry no storage TTL.** Freshness comes from a `cachedAt`
timestamp inside the value. Key shapes:

```
gateway-catalog:<schemaVersion>:vercel
gateway-catalog:<schemaVersion>:openrouter
gateway-catalog:<schemaVersion>:cloudflare:<accountId>:<sha256(apiKey)>
gateway-catalog:rate-limit:*                    (TTL'd)
```

The removal's sweep found **zero** such keys on preview and production, so
there is nothing stale to collide with — but if `schemaVersion` has any
reason to change (e.g. `GatewayModel` gains the tool-calling field below),
**bump it**, because a stale value under an old shape is exactly what the
version segment exists to avoid.

**5. `GatewayModel` needs a tool-calling signal, new in this restoration.**
Epic 0 gave `Model` a `toolCall` boolean so Brave/Exa can be gated. A
gateway-routed model is a `GatewayModel`, not a `Model`, so it needs the
equivalent from each gateway's own catalog shape — otherwise Brave/Exa are
silently unavailable on every gateway model:

| Gateway | Source field |
| --- | --- |
| Vercel | `tags` — check for the tool/function-calling tag |
| OpenRouter | `supported_parameters` — contains `tools`/`tool_choice` |
| Cloudflare | `function_calling` — the **string** `"true"`, from the default-format `properties[]` |

Add `toolCall: boolean` to `GatewayModel` and populate it in all three
normalisers. **This is genuinely new code inside a restored file** — call it
out in the PR description so a reviewer does not diff it against `24df3b5^`
and flag it as an unfaithful restore.

**6. Rewire the `z.enum`** at `models.get.ts:41` to WP 2.3's shared
`gatewayIds` const — the fifth hardcoded copy.

### Tests

- Restore and re-verify: `tests/unit/utils/gateways/{vercel,openrouter,cloudflare,index}.spec.ts`,
  `tests/unit/utils/gateway-catalog-normalize.spec.ts`,
  `tests/integration/api/gateways-models.spec.ts`.
- **New cases** in the per-gateway specs for the `toolCall` normalisation,
  including Cloudflare's string-`"true"` coercion and the
  `marketplace.id === default.name` join (a fixture where `id === id` would
  wrongly match must assert zero matches on the wrong key).
- `scripts/test-affected-check.mjs`: restore the `gatewayCatalogTests` array
  and its mapping. **Do not restore it by line number** — the removal plan
  § 12.5's line ranges (318-324 etc.) are long dead; the file has 17 commits
  of churn since. Add the array next to the existing named groups and add a
  `testMappings` entry with pattern
  `^(server/utils/gateways/.+\.ts|server/api/v1/gateways/.+|app/composables/gateway-catalog\.ts)$`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/utils/gateways/ \
  tests/unit/utils/gateway-catalog-normalize.spec.ts \
  tests/integration/api/gateways-models.spec.ts
```

**Live catalog verification — REQUIRED, all three gateways.** Real
credentials exist, so every catalog claim in this package is testable now.
These normalisers were written in mid-2026 and **Cloudflare's was never
validated against a real response at all**; a field rename or an envelope
difference surfaces as an empty picker rail with no error.

Vercel and OpenRouter need no auth:

```bash
curl -s https://ai-gateway.vercel.sh/v1/models | head -c 2000
curl -s https://openrouter.ai/api/v1/models   | head -c 2000
```

Cloudflare needs the owner's credentials (read them from `.dev.vars`; do not
paste them into this document or a commit). Fetch **both** formats, because
the two-format join is the untested part:

```bash
curl -s -H "Authorization: Bearer $CF_KEY" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/ai/models/search?format=openrouter&per_page=1000"
curl -s -H "Authorization: Bearer $CF_KEY" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/ai/models/search?per_page=1000"
```

Then confirm, against the real bytes, each of the four things the removal-era
docs listed as never-verified:

1. **The response envelope** — `{ result: [] }` vs `{ data: [] }`. The
   normaliser assumes one; check which.
2. **`per_page=1000` pagination** — does it return everything, or is there a
   `result_info` indicating more pages the normaliser silently drops?
3. **The inverted join key.** In the marketplace shape `id` is the real
   `@cf/vendor/model` string; in the default shape `id` is a UUID and that
   string lives in `name`. Confirm `marketplace.id === default.name` matches
   a non-trivial number of rows, and that `id === id` matches ~zero.
4. **Property string types** — `context_window`, `function_calling` and
   `reasoning` arriving as strings (`"128000"`, `"true"`), and `price` as an
   array of `{ unit, price, currency }` in USD **per million** tokens.

Finally, run one real catalog fetch through the app and read the logged
`gatewayCatalogEnrichment.{gateway,models,matched,priced}` counters. **A
`matched` or `priced` of zero against a non-empty `models` means the join
failed** — that is the single most informative number in this package, and it
is now observable.

- [x] WP 2.5 complete (commit `4345791`, landed with WP 2.4) - Cloudflare live catalog verification blocked, owner's API token fails Cloudflare's own token-verify endpoint

## WP 2.6 — `server/api/v1/chats/[slug]/index.post.ts` rebuild

**Tier: OPUS.** This is the **only** package in this entire plan that gets
Opus. It is the single biggest restoration risk in the effort: **18 commits**
of unrelated churn since the gateway code was removed, and the file must now
interleave the old gateway cost capture with the *new* `searchCost`/
`searchUnits`/`searchBillingUnit`/`searchProvider` accounting that did not
exist when the gateway code was written.

Assign this package a **dedicated reviewer**, separate from its coder.

### Files touched

| Path | Nature |
| --- | --- |
| `server/api/v1/chats/[slug]/index.post.ts` | hand-rebuild — 1751 lines today |

### Why it cannot be restored mechanically

The file went 1752 (pre-removal) → 1482 (post-removal) → **1751 now**, with
`+353` changed lines from: Google Search grounding cost (`0fbd44c`, #385),
Anthropic/OpenAI search cost (`2e7f488`, #387), xAI image generation
(`e7af9a7`, `bb728e1`), image-gen stream failure surfacing (`420fba1`),
assistant retry recovery (`626b9a4`), FTS5 search (`e517653`), plus a
merge-conflict fix in `5347f57` where `providerId` was renamed to
`errorProviderId` during the removal itself. Epic 1's WP 1.3 adds more.

The spec is `docs/gateway-removal-plan.md` § 3.C's 25-row table, **read
backwards**. Each row names a line range in the *pre-removal* file; use
`git show 24df3b5 -- server/api/v1/chats/\[slug\]/index.post.ts` and read the
deletions as additions. The line numbers in that table are all dead against
the current file — locate each block by its surrounding code, never by
number.

### The blocks to re-add

| Concern | Pre-removal lines | What comes back |
| --- | --- | --- |
| Body schema | 89 | `gateway: z.enum(gatewayIds).optional()` — derived from WP 2.3's shared const |
| Reasoning | 103-106 | the gateway ternary forcing `reasoningLevel` |
| Tool allowlist | 190-203 | the gateway tool-allowlist check, via `isGatewayToolAllowed()` |
| Provider/gateway fork | 209-252 | the `if (gatewayId) { … } else { … }` wrapper around the existing body |
| Model resolution | 432-445 | the gateway branch |
| Telemetry | 447-457, 502, 514 | `gatewayTelemetryAttributes` + both spreads |
| Locals | 525-527 | `vercelGatewayClient`, `gatewayMaxOutputTokens`, `gatewayPricing` |
| Send fork | 530-782 | the gateway branch (530-549) alongside the provider `switch` |
| Output cap | 887-902 | `maxOutputTokens: gatewayMaxOutputTokens` |
| Live cost | 964, 972-981 | `streamedGatewayCost` + the `finish-step` branch |
| Cost helpers | 1176-1196, 1217-1246 | `sumOpenRouterStepCosts()`, `resolveLiveGatewayCost()` |
| Images | 1452-1462, 1479, 1487 | `gatewayImageResult` / `partsAfterGatewayImages` |
| Vercel async cost | 1490, 1497-1505, 1547-1560 | `readVercelGenerationId`, `persistVercelGenerationCost` scheduling |
| Instructions | 1678 (sig), 888 (call) | `buildChatInstructions()`'s 3rd `gatewayId` param |

Narrow `errorProviderId` and `supportedProviderId` back to
`SupportedProviderId | GatewayId | undefined` where the removal narrowed
them, and restore the four gateway fields on the
`persistAssistantMessageFromStream` input interface.

### The three cost mechanisms, and the one that is genuinely new work

- **OpenRouter — synchronous.** Cost is read from
  `providerMetadata.openrouter.usage.cost`. **This requires BOTH
  `compatibility: 'strict'` AND `usage: { include: true }` on the client** —
  without both, OpenRouter never returns cost at all. The live path cannot
  `await`: `toUIMessageStream`'s `messageMetadata` callback is synchronous
  and its `finish` branch empirically fires **before** `onEnd`. The fix reads
  `providerMetadata` off each per-step `finish-step` chunk. **Per-step costs
  are summed, not last-wins** (`sumOpenRouterStepCosts()` folds over
  `finish-step` chunks live and `result.steps` when persisting). This is
  **observed behaviour of `ai@7.0.56`, not a documented contract.** The
  installed version is still exactly `7.0.56`, so the ordering has not
  shifted — but **re-run the empirical check** and record the result.
- **Vercel — asynchronous.** `providerMetadata.gateway.generationId` →
  `client.getGenerationInfo({ id })`, scheduled via `waitUntil`. The cost
  lands **after** the response has streamed, which is a real, disclosed
  limitation and is deliberately excluded from `resolveLiveGatewayCost()`.
- **Cloudflare — estimated.** No per-request cost API.
  `estimateGatewayMessageCost()` multiplies real token counts by catalog
  `pricing.input`/`pricing.output` and sets `MessageUsage.costEstimated` so
  the context menu renders "Cost (estimated)". A catalog miss leaves the
  estimate unset — **no fallback number is ever guessed.**

**⚠ The genuinely new reconciliation.** `d97aaed` (the merge of `main`) gave
`streamText`'s `onEnd` a `steps` argument, consumed by the new
`resolveSearchUsage`. That is the **same** `result.steps` the old
`sumOpenRouterStepCosts()` folds over. The two must be reconciled in **one
place**, not read twice from two different closures. Concretely, the
`onEnd({ usage, steps })` handler must:

1. compute `textCost` (unchanged),
2. compute `imageCost` (unchanged),
3. compute `search = resolveSearchUsage({ …, externalSearchProvider })`
   (from WP 1.3, unchanged),
4. compute the gateway blended cost from the same `steps`,
5. and **not** add a `searchCost` term when the search was a gateway-bundled
   one (OpenRouter's `web` plugin, Vercel's `perplexitySearch()`), because
   that fee is already inside the blended figure.

That last point is the double-count guard from the decided architecture.
Implement it as an explicit early return or an explicit `undefined`, with the
reason in a comment at the site — not as an implicit consequence of which
branch ran.

**`buildMessageUsage()` regains its 4th `totalCost?: number` parameter.** It
existed solely to carry the gateway override and was dropped in the removal
(see WP 2.7). Both call sites in this file pass it again; the third call site
(`server/utils/research/finalize.ts:252`) stays 3-arg.

### What must NOT be touched

Explicitly shared and unmodified — the removal plan verified each:

- the replay-guard block (issues #263/#275),
- `sanitizeMessagesForModelContext` / `convertFilesForAI` wiring,
- `computeModelCost`, `getGeneratedImageCostFromParts`,
  `getToolInputAspectRatio`, `buildPersistedAssistantReplayChunks`,
  `generationInProgressKvKey`, `toSupportedProviderId`, `emitChatErrorLog`,
- the file-linking / share-sync tail,
- **the multi-step tool loop.** `resolveToolLoopOptions` is a pure function
  of `parsedTools.tools` with zero gateway awareness. It sits next to gateway
  code and reads like gateway machinery. It is not — it is a direct-provider
  feature (removal-plan risk R1), and Epic 1 now depends on it.
- **WP 1.3's post-switch Brave/Exa injection.** It sits after the `try {…}
  catch` that the restored `if (gatewayId) { … } else { switch … }` lives
  inside, so it needs **no change** and gains gateway models for free. Verify
  this is still true after the rebuild rather than assuming it.

### Tests

- `tests/integration/api/chats-single-step-characterization.spec.ts` — was
  **split** during the removal (its gateway cases deleted, its direct-provider
  cases kept) and has churned 5 times since; `d97aaed` just fixed its `onEnd`
  mock for the new `steps` argument. **Add the gateway cases back as new
  `it()` blocks; do not revert the file.** The direct-provider rewiring must
  survive intact.
- `tests/integration/api/chats-tool-loop.spec.ts` — was **deliberately
  rewired from a gateway mock to a Moonshot direct-provider mock** during the
  removal, and has churned 6 times since. **Do not revert it.** Restoring
  gateway coverage means a **new** suite —
  `tests/integration/api/chats-gateway.spec.ts`, seeded from
  `git show 24df3b5^:tests/integration/api/chats-gateway.spec.ts` — covering
  the gateway send path, per-step OpenRouter cost summing, Vercel's
  async-generation-id path, and Cloudflare's estimate.
- **New:** a test asserting the double-count guard — a turn using
  OpenRouter's `web` plugin produces a `totalCost` and **no** `searchCost`.
  This is the one behaviour with no prior art in either direction.
- `tests/unit/utils/message-usage.spec.ts` — the 4-arg `buildMessageUsage`.
- `scripts/test-affected-check.mjs`: add `chats-gateway.spec.ts` to both
  `gatewayCatalogTests`' sibling `gatewayChatTests` array (restore that
  array by name, not by line number) and to `chatStreamBranchTests`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/integration/api/chats-gateway.spec.ts \
  tests/integration/api/chats-tool-loop.spec.ts \
  tests/integration/api/chats-single-step-characterization.spec.ts \
  tests/integration/api/chats-external-search.spec.ts \
  tests/unit/utils/message-usage.spec.ts
pnpm vitest run           # full suite — this package can break anything
```

The full-suite run is not optional for this package.

**Browser verification — regression first, then real sends.** Real gateway
credentials exist, so this package is fully live-verifiable. Do the
regression half first: the gateway fork wrapping the provider `switch` is the
most likely place to silently perturb paths that already work.

1. Send a normal **direct-provider** message. Confirm it is unchanged —
   same reasoning, same tools, same cost rows, same citations.
2. Send a **Brave** search and an **Exa** search on a direct-provider model.
   Confirm Epic 1's behaviour is unchanged.
3. Select a gateway model **with no key saved** and send. Confirm a friendly
   "no key" 401, not a crash, a hang or a 500.
4. Confirm Axiom receives `attributes.chat.gateway`,
   `attributes.chat.gatewayProvider` and `attributes.chat.gatewayModel` —
   under `attributes`, not as new flat fields.

Then the real sends, once the owner has saved the three keys (WP 2.4):

5. **OpenRouter** — send a message on an OpenRouter-routed model. Confirm a
   streamed reply, and that the context menu shows a **cost** (this is the
   `providerMetadata.openrouter.usage.cost` path, which requires **both**
   `compatibility: 'strict'` and `usage: { include: true }` — a missing cost
   here almost certainly means one of those two options was dropped in the
   rebuild). Send a multi-step turn and confirm per-step costs are **summed,
   not last-wins**.
6. **Vercel** — send and confirm a streamed reply. The cost arrives
   **asynchronously** via `getGenerationInfo()`, so it will be absent on the
   live stream and present after a reload. Verify both halves; a cost that
   never appears means `providerMetadata.gateway.generationId` was not
   returned, which was never observable from package source before now.
7. **Cloudflare** — send and confirm a streamed reply, then confirm the
   context menu renders "Cost (estimated)". Also confirm the model id the
   picker offered is actually accepted by
   `/ai/v1/chat/completions` — id compatibility between the catalog endpoint
   and the completions endpoint was a documented unknown.
8. **The `maxOutputTokens` cap.** Pick a model with a small
   `max_model_len` (the historical failure was `qwen3-14b` via Vercel hitting
   `max_tokens=65536 cannot be greater than max_model_len=40960`) and confirm
   the send succeeds rather than 400ing.
9. **R12, the highest-value open question in this plan:** on a
   gateway-routed model that supports **native** web search, enable native
   search and send. Inspect the response for `groundingMetadata` /
   `server_tool_use` / `web_search_call`. This settles whether a BYOK gateway
   strips provider-native tools — an inference from architecture
   descriptions until now. **Record the answer in
   `docs/providers/gateways.md` whichever way it falls.**
10. On the same gateway model, select **Brave** and send. Confirm Epic 1's
    external search works through a gateway (it should — WP 1.3's injection
    is post-switch and gateway-agnostic), and that `searchCost` is set.
11. On an OpenRouter model, enable the gateway's **own** `web` plugin search
    if the UI exposes it, and confirm the double-count guard: a blended
    `totalCost` and **no** `searchCost`.

- [x] WP 2.6 complete (commit `e36fd8b`) - code-complete and independently
      re-verified (diff review + re-run typecheck/named-specs/full-suite, all
      matched the coder's report exactly); the 11-step browser verification
      script above is **deferred to the Epic 2 gate** once WP 2.7/2.9/2.10
      land, per this plan's "land together" guidance - flagged for dedicated
      reviewer attention as the highest-risk package in the epic. Two
      real bugs found and fixed during this package, beyond the plan's
      original scope: Vercel's async cost path was empirically dead (real
      `getGenerationInfo()` latency ~12s vs. the original 1.5s retry) and
      is now read synchronously off `providerMetadata.gateway.cost`
      (`readVercelGatewayCost`, confirmed against a live divergent case
      that `cost` and not `inferenceCost`/`marketCost`/`gatewayCost` is
      the right field); and a gateway send had no server-side
      `GatewayModel.toolCall` gate for Brave/Exa, meaning a search could
      run and bill the user's own key on a model that could never use the
      result — added, mirroring the direct-provider `model.toolCall` gate.
      Cloudflare gateway sends remain **owner-blocked** for live
      verification: the provided credential lacks Workers AI permission
      (has AI-Gateway-only scope), the `besidka` gateway is out of
      wholesale credits, and `@cf/meta/llama-3.3-70b-instruct` returned
      "no such model" even when authenticated — none of this is a code
      defect in the restored `useCloudflareGateway()` builder, which
      correctly targets Workers AI's own catalog API (a different
      Cloudflare product from the AI-Gateway reverse proxy R12's spike
      tested).

## WP 2.7 — Title route, `buildMessageUsage` 4th param, gateway image persistence

**Tier: Sonnet.** Three small, well-specified surgical re-adds. Must land
**after** WP 2.6 (it consumes the same helpers).

### Files touched

| Path | Nature |
| --- | --- |
| `server/api/v1/chats/[slug]/title.patch.ts` | mechanical restore (WP 2.1) — verify + rewire the `z.enum` |
| `server/utils/ai/message-usage.ts` | hand-rebuild — 2 commits of churn (+29) |
| `server/utils/files/assistant-files.ts` | hand-rebuild — 3 commits of churn |
| `server/utils/files/reconstruct-generated-image-parts.ts` | comment only |

### What changes, concretely

**`title.patch.ts`** — zero churn since removal, so the restore is faithful.
Re-add the `gateway` body-schema field, `const gatewayId = body.data.gateway`,
and the `else if (gatewayId) { useGateway(...) }` branch. All seven provider
`switch` cases survive unchanged. Rewire the `z.enum` to WP 2.3's shared
`gatewayIds` const (the fourth hardcoded copy).

> **Title generation must never carry OpenRouter's `web` plugin.** The
> original deliberately built a separate instance with no `plugins` for title
> generation — carrying the plugin across would silently charge a second,
> unwanted per-search fee for every generated title. Confirm the restored
> `useGateway()` still does this.

**`server/utils/ai/message-usage.ts`** — `buildMessageUsage()` regains its
4th `totalCost?: number` parameter, whose only purpose is the gateway
override, plus the doc sentence explaining it. This file has churned twice
since removal (the search-cost merges) and Epic 1 added `searchProvider` to
`addSearchUsage()`, so this is a hand edit against current code, not a
revert. Verify all three call sites: the two in `index.post.ts` pass it
again, `server/utils/research/finalize.ts:252` stays 3-arg.

**`server/utils/files/assistant-files.ts`** — re-add the ~225-line gateway
image-persistence block the removal deleted (pre-removal lines 199-424):
`PersistGatewayImageOutputInput`/`Result`, `gatewayGeneratedImageFailureText`,
`gatewayNonImageFileFailureText`, `maxGatewayGeneratedImagePartsPerMessage = 4`,
`maxGeneratedImageBase64Length`, `persistGatewayGeneratedImageParts()` and
its private helpers `decodeBase64DataUrl` and
`buildGatewayGeneratedImageFileName`.

Without it, a gateway-generated image's base64 `data:` URL lands **verbatim**
in `messages.parts`. The function decodes the inline URL, reuses the existing
`validateGeneratedImage()` + `persistFile()`, and rewrites the part to a
`/files/<storageKey>` URL.

> **Risk R2 in mirror image.** `maxGeneratedImageBase64Length` is *derived
> from* `maxGeneratedImageBytes`, which is **shared** and already present
> (read by `isImageGenerationReady` for direct-provider validation). Re-add
> only the derived base64-length constant. Do not re-declare, shadow or move
> the byte constant.

Gateway image generation is **not** an AI SDK tool — it is each gateway's
native multimodal output, single-step by construction. OpenRouter needs
`modalities: ['image','text']` sent via `extraBody` (it is not a typed field
on `OpenRouterChatSettings`) and returns images as `choice.message.images[]`,
which the provider maps to ordinary AI SDK `file` parts. Vercel takes **no
request parameter at all** — the model id (`google/gemini-*-image`) is the
only configuration, and images surface in `result.files`.

Two gaps were deliberately accepted at the time and are **inherited, not
introduced**: no aspect-ratio control on gateway image generation, and no
per-user concurrency lease/cooldown (unlike direct-provider generation's
`acquireImageGenerationLease()`). Restate both in the PR description rather
than letting them be rediscovered.

**`server/utils/files/reconstruct-generated-image-parts.ts`** — **zero code
changes.** `hasOriginMetadata()` already allowlists
`originProvider === 'openai' | 'google'`, so gateway-origin files are never
reconstructed into a `tool-generate_image` part (which the client's
`getGenerateImageOutput()` would render as nothing). That guard survived the
removal intact and is **already correct for restoration**. Only its doc
comment's framing needs updating — it currently references the deleted
`persistGatewayGeneratedImageParts` in the past tense.

### Tests

- Restore and re-verify the gateway halves of
  `tests/integration/server/assistant-files.spec.ts` and
  `tests/integration/server/reconstruct-generated-image-parts.spec.ts` from
  `git show 24df3b5^`. Both have churned (image-gen error surfacing, xAI
  image-gen recognition), so **merge the gateway `describe` blocks in**
  rather than reverting the files.
- `tests/integration/api/chats-title.spec.ts` — restore the gateway cases;
  add one asserting the title instance carries **no** OpenRouter `plugins`.
- `tests/unit/utils/message-usage.spec.ts` — the 4th param overrides the
  computed split; omitting it is byte-identical to today.
- `scripts/test-affected-check.mjs`: `messageUsageTests` already covers
  `message-usage.spec.ts`. Add `chats-title.spec.ts` to the restored
  `gatewayChatTests` array, and confirm the `filesModuleTests` mapping still
  triggers on `server/utils/files/assistant-files\.ts`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/integration/server/assistant-files.spec.ts \
  tests/integration/server/reconstruct-generated-image-parts.spec.ts \
  tests/integration/api/chats-title.spec.ts \
  tests/unit/utils/message-usage.spec.ts
```

**Browser verification:**

1. Direct-provider image generation must be unaffected — generate one image
   on an OpenAI or Google model and confirm it renders, persists and survives
   a reload.
2. **Now live-verifiable:** generate an image through a gateway — Vercel with
   a `google/gemini-*-image` model (the model id is the only configuration),
   or OpenRouter with `modalities: ['image','text']`. Confirm the image
   renders, that its URL is a `/files/<storageKey>` path and **not** an inline
   `data:` blob, and that it survives a reload. A `data:` URL in
   `messages.parts` means `persistGatewayGeneratedImageParts()` did not run.
3. Confirm the gateway-generated image is **not** reconstructed into a
   `tool-generate_image` part after reload (the `hasOriginMetadata()`
   allowlist guard), i.e. it renders as an ordinary file part.
4. Generate a title on a gateway chat and confirm no second search fee is
   incurred — the title instance must carry no OpenRouter `plugins`.

- [ ] WP 2.7 complete

## WP 2.8 — Model picker: the gateway rail

**Tier: Sonnet** (per the global policy). **Second-riskiest package in the
plan — assign a dedicated reviewer.** `ModelsTrigger.vue` went 1054 → 676
lines, a 378-line structural deletion, and the current file has grown a
legacy/deprecated-models section that did not exist pre-removal.

### Files touched

| Path | Nature |
| --- | --- |
| `app/components/ChatInput/ModelsTrigger/Gateway{ModelDetail,ModelItem,ModelList,ProviderRail,Rail}.vue` | mechanical restore (WP 2.1) — verify |
| `app/components/ChatInput/ModelsTrigger.vue` | **hand-rebuild** |
| `app/utils/models-picker.ts` | mechanical restore (WP 2.1) — verify (129 → 261 lines) |
| `app/types/models-picker.d.ts` | mechanical restore (WP 2.1) — verify |
| `app/components/ProviderIcon.vue` | hand-merge — 1 commit of churn (`108a745`) |

### What changes, concretely

**`ModelsTrigger.vue` is a hand-rebuild, not a revert.** The removal plan
§ 3.D lists every deleted state ref, computed, function and template range —
read backwards, that is the re-add checklist. What must come back:

- state: `pickerMode: 'provider' | 'gateway'`, `gatewayHighlightedOptionId`,
  `gatewayProviderGroups`, `activeGatewayProviderPrefix`,
  `isGatewayCatalogPending`, the `gatewayList` template ref and the
  `GatewayListHandle` interface;
- computeds: `gatewayRailItems`, `activeGateway`, `isActiveGatewayKeyless`,
  `activeGatewayPrompt`, `activeGatewayFavorites`, `selectedGatewayModelId`,
  `isGatewayProviderRailVisible`, `filterCategoryOptions`, `isFreeOnly`;
- the gateway branches of `hasFavorites`, `isRailVisible`,
  `hasActiveFilters`, `selectedProviderModelId`, `selectableModels`,
  `highlightedOptionId`;
- functions: `getModeFromSelection`, `switchMode`, `setProviderMode`,
  `toggleGateway`, `toggleGatewayProvider`, `onGatewayProviderGroupsChange`,
  `selectGatewayModel`, `toggleGatewayFavorite`, `onGatewayHighlight`,
  `onGatewayPendingChange`, plus the four `*InActiveList` keyboard wrappers
  that `onSearchKeydown` delegates through;
- template: the gateway banner, `GatewayProviderRail`, the non-compact
  `KeyPrompt`, `GatewayModelList` and `GatewayRail` blocks.

**⚠ The legacy-models section is new since removal and must coexist with
`pickerMode`.** The current file renders deprecated models in a collapsed
`<ul v-show="isLegacyExpanded">` at the bottom of the provider path, with its
own `legacyModels`/`legacyLabel`/`legacyListId`/`legacyLabelId` plumbing.
Decide and state explicitly: **legacy grouping applies to provider mode
only.** Gateway catalogs have no curated `status: 'deprecated'` signal, so a
gateway-mode legacy section would always be empty and would render a stray
header. Guard the whole legacy block on `pickerMode === 'provider'`.

**`isVisionOnly` is also new since removal** (`7220abc`). Same question, same
answer shape: gateway models carry modality data from their catalogs, so the
vision filter *can* apply — but confirm `GatewayModelList` actually receives
and honours it, or the toggle will silently no-op in gateway mode. If it
cannot be wired cheaply, hide the toggle in gateway mode rather than leaving
a dead control.

**Three rules keep the gateway rail honest — re-implement all three:**

1. It renders only when the catalog has **more than one** distinct prefix, or
   a favourite exists. Cloudflare ids are `@cf/vendor/model-slug`, and
   `getGatewayModelProviderPrefix()` returns the real vendor segment, not the
   shared `@cf` namespace.
2. It **hides while searching** — a hidden rail governs nothing, so search
   *suspends* the provider filter rather than compounding with it.
3. `getGatewayProviderGroups()` **must be fed a search-independent list**
   (`groupableModels` = favourites + free only), or a reset silently discards
   a filter the user set before typing.

**The count-badge pattern already survives** on the direct-provider
`ProviderRail.vue:44-62` (an `indicator` wrapper, a `badge badge-xs` as
`indicator-item indicator-end indicator-bottom`, `formatRailCount()` capped
at `99+`, and a plain accent dot instead of a number for a keyless provider
at `:51-54`). `GatewayProviderRail.vue` mirrors it — with one deliberate
difference: it uses a **native `title`** rather than daisyUI's
`tooltip tooltip-right`, because the rail scrolls (a 58-vendor OpenRouter
catalog cannot be allowed to stretch the panel) and a scroll container
force-computes `overflow-x` to `auto`, which clips the tooltip bubble as it
reaches past the rail's right edge. **Do not "fix" this to match the
direct-provider rail.**

Scale figures worth knowing while testing: OpenRouter reports **58 distinct
prefixes across ~400 models**; Vercel **28 across ~209**.

**`ProviderIcon.vue` is a hand-merge**, not a restore — it has one commit of
churn (`108a745`, the xAI dark-mode logo) that must survive. Re-add the 13
gateway-vendor entries to `providerIconNames` (`bytedance, cloudflare,
deepgram, huggingface, ibm, meta, microsoft, mistral, nvidia, openrouter,
pipecat, vercel, zhipu`) alongside WP 0.1's `brave`/`exa`, plus
`gatewayProviderPrefixIconOverrides` and `cloudflareVendorIconOverrides`
(which map OpenRouter's `x-ai` and `~`-prefixed "latest" aliases, and
Cloudflare's `mistralai`/`meta-llama`/`deepseek-ai`/`ibm-granite`/`zai-org`)
and the `resolvedProviderId` computed. `badgeText`'s 2-letter fallback is
already generic.

### Tests

- Restore: `tests/unit/components/ChatInput/ModelsTrigger/Gateway{ModelDetail,ModelItem,ProviderRail,Rail}.spec.ts`.
- `tests/unit/components/ChatInput/ModelsTrigger.spec.ts` (101 gateway refs
  pre-removal) and `ModelsTrigger.keys.spec.ts` (34) — **merge the gateway
  `describe` blocks back in**; these files have 6 commits of churn and must
  not be reverted.
- `tests/unit/utils/models-picker.spec.ts` — the restored gateway helpers.
- `tests/unit/components/ProviderIcon.spec.ts` — the WP 0.1 flip again: its
  `Object.keys(providerMeta)` loop now sees three more entries. Confirm all
  three gateway icons resolve.
- **New:** a case asserting the legacy section is hidden in gateway mode.
- `scripts/test-affected-check.mjs`: the four restored Gateway component
  specs go into the existing `modelsTriggerTests` array (which
  `modelsTriggerPattern` already triggers on the whole
  `ModelsTrigger/` directory, so the pattern likely needs no change —
  **verify**).

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/components/ChatInput/ModelsTrigger.spec.ts \
  tests/unit/components/ChatInput/ModelsTrigger.keys.spec.ts \
  tests/unit/components/ChatInput/ModelsTrigger/ \
  tests/unit/utils/models-picker.spec.ts \
  tests/unit/components/ProviderIcon.spec.ts
```

**Manual browser verification script** — this is the richest gateway-side
check available without credentials, because the Vercel and OpenRouter
catalogs are public:

1. Open the model picker. Confirm the direct-provider rail, the favourites
   star, the count badges, the keyless accent dots and the collapsed legacy
   section are **all exactly as before this epic**. Regression first.
2. Confirm a gateway mode switch is present, and switch to it.
3. Pick **OpenRouter**. Confirm the catalog loads (its endpoint is public, so
   this works with no key), the vertical gateway rail appears on the left
   with per-vendor icons, and each icon carries a model-count badge capped at
   `99+`.
4. Hover a rail icon. Confirm a **native browser tooltip** appears (not a
   daisyUI bubble) and is **not clipped** at the rail's right edge.
5. Click a vendor. Confirm the list filters to that vendor only.
6. Type into search. Confirm the rail **hides** and the vendor filter is
   suspended, not compounded. Clear the search and confirm the previous
   vendor filter is restored, not lost.
7. Confirm the legacy/deprecated section does **not** render in gateway mode.
8. Star a gateway model. Confirm it appears in favourites and survives a
   reload (this exercises WP 2.2's restored column end to end — it is the
   best available proof the migration applied).
9. Repeat 3–8 for **Vercel** (also public).
10. Switch to **Cloudflare**. With no key saved, confirm the keyless prompt
    renders with a link to `/profile/keys`, **not** an error or an empty
    panel. Then, with the owner's key saved, confirm the real catalog loads,
    the rail groups by **vendor** (`mistralai`, `meta-llama`, `deepseek-ai`,
    …) rather than collapsing every model under the shared `@cf` namespace,
    and that prices render — a price-less catalog means the two-format join
    failed (see WP 2.5).
11. Select a gateway model and close the picker. Confirm the chat input's
    model label updates to the gateway model's name, and that the web-search
    dropdown from Epic 1 re-derives its options correctly for it.

- [x] WP 2.8 complete (commit `afcc94c`) - flagged for dedicated reviewer attention per the plan's own risk call-out

## WP 2.9 — Client composables hand-merge

**Tier: Sonnet.** Mostly verification of WP 2.1's restores, plus two real
hand-merges.

### Files touched

| Path | Nature |
| --- | --- |
| `app/composables/chat.ts` | **hand-rebuild** — 7 commits, +236 lines |
| `app/composables/chat-input.ts` | **hand-rebuild** — 1 commit + Epic 1 changes |
| `app/composables/{user-setting,model,selected-model-info,image-input-support,chat-title,user-keys,gateway-catalog}.ts` | mechanical restore (WP 2.1) — verify only |

### What changes, concretely

**`app/composables/chat.ts`** — the gateway change itself is tiny: re-add
`gateway: getSelectionGatewayId(selection.value)` to the
`prepareSendMessagesRequest` body, and re-add `selection` to the
`useUserModel()` destructure that feeds it. But the file has 7 commits of
churn (+236 lines) from in-flight tool calls as reasoning steps, reasoning
state derived from SDK part state, and retry/regenerate fixes — so the
surrounding code has moved. Locate the body-builder by shape:

```ts
prepareSendMessagesRequest({ messages }) {
  return { body: { model: userModel.value, tools: tools.value,
                   messages: [lastMessage], reasoning: reasoning.value } }
}
```

and add the `gateway` key to that object. Same two-line pattern in
`app/composables/chat-title.ts` (zero churn — restored in 2.1, verify only).

> **Removal-plan risk R7 in mirror image:** `selection` exists *only* to feed
> `getSelectionGatewayId()`. If the destructure is re-added without the call
> (or vice versa) lint fails. Add both or neither.

**`app/composables/chat-input.ts`** — re-add the gateway guard in front of
four computeds, each of which currently returns only its direct-provider
else-branch: `isWebSearchSupported`, `isImageGenerationSupported`,
`reasoningCapability` (via the deleted `gatewayReasoningCapability`), and
`selectedModelKeyOwnerId`. Re-add the `gateway-capabilities` import and the
`gatewayModel` destructure from `useSelectedModelInfo()`.

> **The gateway path is deliberately fail-CLOSED** (unlike the vision check,
> which fails open). A persisted gateway selection shows no web-search toggle
> until the picker has fetched that gateway's catalog once per session. That
> is intentional — a gateway model's capabilities are not knowable without
> its catalog, and offering a control the model cannot honour produces a
> live-key 400, not a cosmetic glitch. Preserve it.

**This file also carries Epic 1's `isToolCallingSupported` and
`webSearchProviderOptions`.** They must gain a gateway branch too: read
`gatewayModel.toolCall` (the field WP 2.5 adds to `GatewayModel`) when a
gateway model is selected, falling back **closed** — not open — when the
catalog has not loaded. Otherwise Brave/Exa are either silently unavailable
on every gateway model, or offered on models that cannot call tools.

**`app/composables/user-setting.ts`** is the biggest restore (642 → 816
lines) and is zero-churn, so it comes back verbatim: `toGatewayFavoriteModels()`,
`serverFavoriteGatewayModels`, `lastFavoriteGatewayModelsRequestToken`,
`fallbackFavoriteGatewayModels`, `favoriteGatewayModels`,
`getFavoriteGatewayModels()`, the `syncForUser()` block and its reset,
`setFavoriteGatewayModels()`, `toggleFavoriteGatewayModel()`, the
`clearUserContext()` line and the four names on the return. **Verify the
direct-provider `favoriteModels` family is byte-identical to today** — it
sits in the same file and must not shift.

**`app/composables/image-input-support.ts`** — restored; verify the fail-open
default (`?? true`) survives. It serves the **public, anonymous**
`/shared/[slug]` page, where a fail-closed default would break image display
on shared chats (removal-plan risk R8).

### Tests

- `tests/unit/composables/chat.spec.ts` — the `gateway` field is present in
  the request body for a gateway selection and absent for a provider one.
- `tests/unit/composables/chat-input.spec.ts` (93 gateway refs pre-removal) —
  merge the gateway `describe` blocks back in; add cases for
  `isToolCallingSupported` and `webSearchProviderOptions` under a gateway
  selection, including the fail-closed pre-catalog state.
- `tests/unit/composables/{user-setting,model,selected-model-info}.spec.ts` —
  merge back their gateway blocks (52 / 48 / 19 refs pre-removal).
- `tests/unit/composables/user-keys.spec.ts` — gateway `keyProviderId`
  mapping.
- `scripts/test-affected-check.mjs`: `modelSelectionTests` and `userKeysTests`
  already cover most of these. Add
  `app/composables/(gateway-catalog|chat-title)\.ts` to the pattern that
  triggers `modelSelectionTests`.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run tests/unit/composables/
```

**Manual browser verification** — folded into WP 2.8's script (steps 8 and
11 exercise `user-setting.ts` and `chat-input.ts` respectively). Add one:
select a gateway model, **reload the page**, and confirm the selection
persists and the web-search dropdown is initially conservative (no Brave/Exa
offered until the catalog loads), then re-derives once it does.

- [ ] WP 2.9 complete

## WP 2.10 — Tests sweep, test registration, and `docs/providers/gateways.md`

**Tier: Sonnet.** Runs last in the epic; picks up anything the previous
packages left.

### Files touched

| Path | Nature |
| --- | --- |
| `tests/**` | restores + merges left over from WP 2.3–2.9 |
| `scripts/test-affected-check.mjs` | new registrations |
| `docs/providers/gateways.md` | **new document** |
| `docs/gateway-removal-plan.md` | header note only |
| `docs/auth-security.md` | restore two sections |
| `tests/fixtures/follow-up-turn-tool.ts` | comment reword |

### What changes, concretely

**Test restores not already claimed by an earlier package.** From
`git show 24df3b5^`, the wholesale-deleted specs are:

```
tests/integration/api/chats-gateway.spec.ts                       (WP 2.6)
tests/integration/api/gateways-models.spec.ts                     (WP 2.5)
tests/integration/api/profile-keys-{cloudflare-gateway,vercel-gateway,openrouter}.spec.ts  (WP 2.4)
tests/unit/components/ChatInput/ModelsTrigger/Gateway*.spec.ts    (WP 2.8)
tests/unit/components/Profile/Keys/CloudflareGateway.spec.ts      (WP 2.4)
tests/unit/utils/gateway-{capabilities,catalog-normalize,model-id,pricing}.spec.ts
tests/unit/utils/gateways/{cloudflare,index,openrouter,vercel}.spec.ts  (WP 2.5)
```

This package owns the four `tests/unit/utils/gateway-*.spec.ts` files not
claimed elsewhere, and a final sweep confirming every other restore landed.

**Known flip #2, pre-identified:**
`tests/unit/components/Chat/ContextMenu.client.spec.ts` —
`904a77a` renamed `it('shows "(direct)" and a key icon for a direct
provider')` to `it('shows the plain provider name and a key icon')` and added
`expect(providerRow.text()).not.toContain('(direct)')`. **Revert that
assertion alongside the label.**

The `(direct)` label itself is a ~6-line change in
`ContextMenu.client.vue`'s `providerDisplayLabel`, currently
`return props.info?.providerLabel ?? ''`:

```ts
return props.info.providerKind === 'provider'
  ? `${props.info.providerLabel} (direct)`
  : props.info.providerLabel
```

**The `kind` plumbing survived the removal intact** — `ProviderMeta.kind` is
still declared, still populated into `MessageMenuInfo.providerKind`, and
`ContextMenu.client.vue:51` still branches on
`info.providerKind === 'provider'` to pick a key icon vs a `ProviderIcon`.
So this is a label restore, not a re-plumb. WP 0.1 already widened `kind` to
three members, so the ternary is meaningful again. **Note the new third
case:** a `kind: 'search'` value never reaches `providerDisplayLabel`
(Brave/Exa are never a message's *provider*), but assert that explicitly in a
test rather than relying on it.

**`scripts/test-affected-check.mjs`.** The removal plan § 12.5's line ranges
(104-107, 133, 318-342, 413, 462-463, 484-499, 788, 799, 838, 1002) are
**long dead** — 17 commits of churn. Do not use them. Work from the file's
actual structure: named `const <topic>Tests = [...]` arrays followed by a
`testMappings` array of `{ pattern, tests }`. Restore `gatewayCatalogTests`
and `gatewayChatTests` by name, and add a `testMappings` entry with the
pattern
`^(server/utils/gateways/.+\.ts|shared/utils/gateway-(pricing|model-id|capabilities)\.ts|shared/types/gateways\.d\.ts)$`.
**Run a final audit: every `.spec.ts` under `tests/` must appear in at least
one group**, or it never runs on a PR.

**`docs/providers/gateways.md` — a new document.** The pre-removal
`docs/gateways.md` (1459 lines, half of which was direct-provider content
that survived as `docs/providers/*.md`) is readable at
`git show 24df3b5^:docs/gateways.md`; **lines 398-1459 are the gateway half**
and are the source material. Do **not** re-merge into `general.md` — the
`docs/providers/` split is the current structure and `AGENTS.md:7` already
forward-references `docs/providers/gateways.md`. The new doc must cover, at
minimum:

- the three-id-space naming trap (`GatewayId` vs the `keys.provider` DB enum
  vs `keyProviderId`), and the new **single source of truth** const from
  WP 2.3 that replaces the old four-copy duplication;
- the per-gateway catalog fetch strategies and Cloudflare's inverted
  two-format join;
- the three cost mechanisms (OpenRouter synchronous + per-step summing and
  its two required client options; Vercel async via `getGenerationInfo`;
  Cloudflare estimated from catalog pricing) **and the blended-vs-`searchCost`
  double-count rule**, which is new in this restoration;
- the reasoning mechanism divergence: OpenRouter needs a **settings-level
  chat field**, not the standardised top-level `streamText({ reasoning })`
  option — verified against `@openrouter/ai-sdk-provider@3.0.0`'s `getArgs()`,
  and "the opposite of what the round-4 plan document assumed";
- web search resolution (`'native'` when the routed provider supports it —
  Vercel's `tags` contains `web-search`, OpenRouter's `supported_parameters`
  contains `web_search_options`; `'universal'` when the gateway itself
  searches — OpenRouter's `plugins: [{ id: 'web' }]`, Vercel's
  `perplexitySearch()`; `undefined` always for Cloudflare) and the rule that
  title generation never carries the plugin;
- the new `GatewayModel.toolCall` signal and how each gateway supplies it;
- image generation's non-tool nature and the two accepted gaps;
- the never-live-verified list (below).

**`docs/gateway-removal-plan.md`** — add a note under its `Status: EXECUTED`
header: superseded by this plan, retained because § 3 is the restoration
spec read backwards.

**`docs/auth-security.md`** — restore what the removal stripped: the entire
"Reused outside Better Auth: the gateway catalog route" section (documenting
`GET /api/v1/gateways/[gateway]/models`), and the nine rate-limit budget rows
for the gateway key routes plus the gateway `keyPrefix` design rationale in
the key-management section. **Also add** the six new rows for Brave and Exa
from Epic 0's WP 0.2 — the same section, the same table, and they are
currently missing entirely.

**`tests/fixtures/follow-up-turn-tool.ts`** — its doc comment was reworded
during removal and is now doubly stale (it said "no real tool sets
`withFollowUpTurn()` yet"; Moonshot landed, and now Brave/Exa have too).
Update it to name all three.

### Verification

```bash
pnpm run format && pnpm run typecheck && pnpm run lint
pnpm vitest run                       # full suite
pnpm run db:generate                  # MUST produce nothing (WP 2.2 already landed)
node scripts/test-affected-check.mjs  # or the project's own invocation
```

Plus an explicit registration audit:

```bash
comm -23 \
  <(cd tests && find . -name '*.spec.ts' | sed 's|^\./|tests/|' | sort) \
  <(rg -o "tests/[^'\"]+\.spec\.ts" scripts/test-affected-check.mjs | sort -u)
```

Expect **no output**. Any line printed is a spec that will never run on a PR.

- [ ] WP 2.10 complete

## Epic 2 gate

- [ ] CI green on PR #362 with all ten packages landed, full suite passing
- [ ] `pnpm run db:generate` emitted exactly one `ALTER TABLE … ADD
      favorite_gateway_models text` with no `DROP TABLE`, and a second run
      emitted nothing
- [ ] WP 2.4's 7-step keys-page script passed
- [ ] WP 2.8's 11-step picker script passed, including a real OpenRouter and
      Vercel catalog load and a persisted gateway favourite
- [ ] WP 2.6's regression checks passed: direct-provider sends and Epic 1's
      Brave/Exa sends are unchanged
- [ ] The Vercel and OpenRouter live catalog shapes were diffed against the
      restored normalisers (WP 2.5)
- [ ] WP 2.5's live catalog checks passed for **all three** gateways,
      including Cloudflare's four previously-unverified items and a non-zero
      `gatewayCatalogEnrichment.matched`/`priced`
- [ ] WP 2.6's live sends passed for all three gateways, including
      OpenRouter's summed per-step cost, Vercel's async cost appearing after
      reload, and Cloudflare's estimated cost
- [ ] **R12 answered and recorded:** whether a BYOK gateway strips
      provider-native web search, established by a real call rather than
      inferred
- [ ] Gateway image generation verified end to end, rendering a
      `/files/<storageKey>` URL rather than an inline `data:` blob

---

# Epic 3 — Content and legal

Runs last because it must describe what actually shipped. Both packages are
content-only — no code, no schema, no tests beyond the existing SEO config
spec. **Neither is optional.** `docs/web-search-cost-accounting.md` § "Privacy
— a blocker, not a footnote" states that adding a new external recipient
requires the recipients table updated and `updatedAt` bumped **before
shipping**, and that this analysis "shouldn't be attempted by whoever writes
the code either". Treat WP 3.2 as a release gate.

## WP 3.1 — Home page SEO content

**Tier: Sonnet.** Content-only. All copy lives in `content/index.md`
frontmatter — **verified: none of the `app/components/content/Home*.vue`
components, nor `app/utils/landing-jsonld.ts`, hardcodes any provider name.**

### Files touched

| Path | Nature |
| --- | --- |
| `content/index.md` | content edit |
| `app/utils/landing-jsonld.ts` | verify only (reads the FAQ data, does not duplicate it) |

### What changes, concretely

The current copy is stale on **two independent axes**: it names three
providers where seven already exist, and it names none of the new search
providers or gateways. Every line below was verified against the current
file:

| Line | Field | Current text (abridged) | Required change |
| --- | --- | --- | --- |
| 111 | `description` | "Bring your own **Anthropic, OpenAI or Google** API key" | all seven providers, or a generic phrasing plus "and more" |
| 114 | FAQ "What does BYOK mean?" | same three | same |
| **116** | FAQ **"Which AI providers are supported?"** | "Currently Anthropic (Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5), OpenAI (GPT-5 and the full GPT family), and Google AI Studio (Gemini models including Gemini 2.5 Pro and the Gemini 3 series). More providers are planned." | **the single most important line.** List all seven direct providers, the three gateways, and Brave/Exa as search providers. Also fix the stale **model names** ("GPT-5", "Gemini 2.5 Pro") |
| 118 | FAQ images | "a supported **OpenAI or Google** chat model" | xAI generates images too now |
| 128 | FAQ deep research | names OpenAI/Google research models | verify still accurate; unchanged by this work |
| 130 | FAQ pricing | "You pay the AI provider (**Anthropic, OpenAI or Google**) directly" | must now also cover paying a **gateway** and paying a **search provider** — three distinct bills |
| 141 | `features[0]` "Multiple AI models" | "Switch between the latest **Claude, GPT and Gemini** models" | broaden |
| **143-144** | `features[1]` **Web search** | icon `lucide:globe`, "Ground AI answers with real-time web context…" | **the natural home for Brave/Exa** — "…using the model's built-in search or your own Brave or Exa key" |
| 150 | `features[3]` image generation | "supported **OpenAI and Google** models" | add xAI |
| 169 | `hero.subheadline` | "Switch between **Claude, GPT and Gemini** models" | broaden |
| 184 | `steps[1]` "Add your API key" | "Paste your **Anthropic, OpenAI or Google AI Studio** API key" | broaden |
| 199 | `useCases[2]` | "switching between **Claude, GPT and Gemini** flagships" | broaden |
| 275 | body MDC bubble | same three, twice | broaden |
| 21 | carousel `alt` text | "switching between Claude, GPT and Gemini flagship models" | broaden (it is also an accessibility string) |

**Comparison table (lines 24-110).** `columns` are
`[Besidka, ChatGPT Plus, Google AI Pro, Claude Pro, T3 Chat]`, with 11 rows
of `{ label, values[5] }`. Existing rows include `Multi-provider models`,
`Image generation`, `Deep research` and `Per-message cost breakdown`.

- **There is no "Web search" row today.** Add one, and add a second row that
  is genuinely differentiating: **"Bring your own search key"** — Besidka
  yes (Brave/Exa), every competitor no. That is the honest competitive claim
  this epic creates.
- Consider a **"Route through your own AI gateway"** row for the same reason.
- `note` (line 109) and `priceDate: June 2026` (line 110) are **stale** —
  refresh the date or re-verify every competitor price before shipping. Do
  not ship a comparison table with a 15-month-old price date.

**`app/utils/landing-jsonld.ts`** holds the hand-rolled `@graph`
(`Organization` + `WebSite` + `SoftwareApplication` + `FAQPage`). It **reads**
the FAQ data rather than duplicating provider names, so it needs no edit —
but **re-check it after the FAQ edits** and confirm the `#about-the-name`
section stays in sync with `alternateName`, per `docs/seo.md`.

**Content accuracy is a hard constraint.** This is the public landing page.
Do not list a gateway or search provider as supported until its epic has
actually landed. Since Epic 3 runs last, everything listed here will be true —
but if an epic is descoped, this copy must be descoped with it.

### Tests

- `tests/unit/config/seo.spec.ts` (the `seoTests` group) — re-run; it may
  assert FAQ counts or structure.
- If a new comparison row or FAQ entry changes an asserted count, update the
  assertion rather than the content.
- `scripts/test-affected-check.mjs`: the `landingTests` group already exists.
  Verify its mapping pattern covers `content/index\.md`; add it if not.

### Verification

```bash
pnpm run format && pnpm run lint
pnpm vitest run tests/unit/config/seo.spec.ts
pnpm vitest run  # the landingTests group
```

**Manual browser verification script:**

1. Load `/` and read the hero, the features grid and the FAQ end to end.
   Every provider claim must match what actually ships.
2. Confirm the comparison table renders the new rows without horizontal
   overflow on mobile.
3. Expand the "Which AI providers are supported?" FAQ entry and confirm the
   answer is accurate and not truncated.
4. View source (or use the SEO devtools) and confirm the `FAQPage` JSON-LD
   picked up the new/edited entries automatically.
5. Confirm `#about-the-name` still matches `alternateName`.

- [ ] WP 3.1 complete

## WP 3.2 — Legal pages

**Tier: Sonnet**, but **this is a compliance change, not a copy edit.** The
executor must follow `docs/legal.md`'s conventions exactly and must not
paraphrase a legal basis. Flag anything ambiguous to the owner rather than
deciding it.

### Files touched

| Path | Nature |
| --- | --- |
| `content/legal/privacy-policy.md` | content edit + `updatedAt` bump |
| `content/legal/terms-of-use.md` | content edit + `updatedAt` bump |
| `content/legal/cookie-policy.md` | content edit + `updatedAt` bump (small) |

Current dates, all of which must move: privacy `2026-08-03`, terms
`2026-07-26`, cookie `2026-07-26`. `docs/legal.md:25` requires the bump
whenever substance changes.

### What changes, concretely — `privacy-policy.md` (290 lines)

**The recipients table (lines ~114-125) is the centrepiece.** It currently
lists Cloudflare (processor, EU–US DPF), Axiom (processor, SCCs),
"Anthropic, OpenAI or Google AI Studio" (independent controller), push
services, OAuth providers, and search engines. Add a row per **new external
recipient**, each with its own privacy-policy link — `docs/legal.md:28-36`
sets that precedent explicitly ("The Turnstile Privacy Addendum link is a
compliance obligation, not a nice-to-have"):

| Recipient | What they receive | Safeguard |
| --- | --- | --- |
| **Brave Search** | the search query your model generates from your prompt, sent with **your own** Brave API key | Independent controller. Link Brave's privacy policy. |
| **Exa** | the same, with your own Exa key | Independent controller. Link Exa's privacy policy. |
| **Vercel (AI Gateway)** | your prompt, message history and attachments **in transit** to the model vendor you selected, with your own gateway key | Link Vercel's privacy policy. See the controller/processor note below. |
| **Cloudflare (AI Gateway)** | the same | Cloudflare already appears as a **processor** for hosting — this is a **different** role and needs its own row, not a merge into the existing one. |
| **OpenRouter** | the same | Link OpenRouter's privacy policy. |

> **A gateway is a genuinely new kind of recipient, not another provider.**
> The user's prompt now transits Vercel / Cloudflare / OpenRouter **before**
> reaching the model vendor. Under GDPR that is an additional party in the
> flow whose role (independent controller vs processor) the current policy
> does not name. **This is a legal-review item for the owner, not an
> executor decision.** Draft the rows, mark the controller/processor
> classification as `@TODO owner`, and do not ship a classification nobody
> confirmed.

Other sections in the same file that must change:

- **line 5 `summary`** — "…it goes to the AI provider whose key you
  supplied" now understates the flow. Mention search vendors and gateways.
- **line 30 "How Besidka works, in one paragraph"** — "You bring your own API
  key from an AI provider (**Anthropic, OpenAI or Google AI Studio**)". Stale
  for seven providers already; now stale for three categories of key.
- **lines 66-81, the legal-basis table** — it has a row for "Send your
  prompt, message history and attachments to the AI provider you chose |
  Contract — Art. 6(1)(b)". **A search query sent to Brave/Exa needs its own
  row**, and a prompt routed via a gateway arguably needs one too.
- **lines 86-112 "The AI provider you choose"** — "Those providers are
  **independent controllers**, not my processors." Extend or add a parallel
  subsection for search providers and gateways.
- **lines 51-53 "Your AI provider API keys"** — describes AES-256-GCM /
  PBKDF2-SHA512. **A Cloudflare gateway credential is a JSON blob containing
  an `accountId` inside that same encrypted column** — worth one sentence,
  since it means a non-secret identifier is also encrypted at rest.
- **line 131 "Transfers outside the EU"**, **line 220 Security**, **line 272
  "Deleting your account"** ("I cannot erase anything from Anthropic, OpenAI
  or Google") — all three enumerate the same three providers and all three
  must now cover search vendors and gateways. The deletion clause in
  particular: Besidka cannot erase a query from Brave's logs either.

### `terms-of-use.md` (247 lines)

- **line 32** — "**I do not provide the AI model.** You supply your own API
  key from an AI provider (currently **Anthropic, OpenAI or Google AI
  Studio**)". The one hard enumeration; it must now cover all seven, plus
  gateways and search providers.
- **lines 38, 62, 64-65, 92, 107, 182, 225** — you pay the provider directly;
  you must comply with your provider's terms; you are responsible for usage
  costs; content is forwarded to a third-party provider; the licence to
  transmit your content; the service depends on third parties; no liability
  for what your provider does. **Each of these now has three flavours of
  third party, not one.** Lines 64-65 matter most commercially: a Brave or
  Exa bill is a **new, separate cost** the user incurs, on a separate
  account, and the terms should say so plainly.

### `cookie-policy.md` (110 lines)

Line 87 — "**Your AI provider** receives your prompts through a
server-to-server API call. No provider cookie is set in your browser by
that." The same sentence covers a search vendor and a gateway with a small
generalisation. This is the only change needed here, plus the `updatedAt`
bump.

### Tests

None — content only. Re-run the `landingTests` / legal page specs if any
assert document structure.

### Verification

```bash
pnpm run format && pnpm run lint
pnpm vitest run   # the landing/legal groups
```

**Manual browser verification script:**

1. Load `/privacy-policy`. Confirm the recipients table renders all new rows
   and that **every external link opens the right vendor's privacy policy**
   (click each one).
2. Confirm the `updatedAt` date renders and is the new date.
3. Load `/terms-of-use` and `/cookie-policy`; confirm the same.
4. Confirm the tables do not overflow horizontally on mobile — the
   recipients table gains rows and is already the widest element on the page.
5. **Owner review of the controller/processor classification before merge.**
   This step is a human gate, not an agent check.

- [ ] WP 3.2 complete

## Epic 3 gate

- [ ] CI green on PR #362
- [ ] WP 3.1's 5-step landing script passed
- [ ] WP 3.2's 5-step legal script passed, including every link clicked
- [ ] **Owner sign-off on the gateway controller/processor classification**
- [ ] All three `updatedAt` dates bumped

---

# Risks and open questions

Ordered by how much they could cost if ignored.

## R1 — Six mechanisms were never live-verified, even when first written

> **RESOLVED CONSTRAINT.** This risk originally read "no gateway credentials
> exist; Epic 2's send path is unverifiable". **Owner test credentials for
> all three gateways now exist in `.dev.vars`** (see the Addendum). Epic 2's
> verification steps were rewritten accordingly. What remains is the
> *substance* of the risk: six things the original gateway code asserted from
> documentation and never checked against a real account.

Restoration inherits all six, and every one is now testable. They are no
longer deferred — each maps to a concrete step in WP 2.5 or WP 2.6:

1. Cloudflare's catalog response shape — the two-format join was built
   against published schemas only. Probe
   `gatewayCatalogEnrichment.{matched,priced}` on the first real run; the
   envelope (`{result:[]}` vs `{data:[]}`) and `per_page=1000` pagination are
   both unconfirmed.
2. Cloudflare model-id compatibility between `/ai/models/search` and
   `/ai/v1/chat/completions`.
3. Vercel's `providerMetadata.gateway.generationId` — injected by Vercel's
   backend, not observable from package source.
4. Cloudflare token scope — Cloudflare's own docs conflict on
   "Workers AI Read"-only vs Read+Edit.
5. The `maxOutputTokens` cap actually clearing the Vercel/Cloudflare 400
   (unit-tested only; the observed failure was `qwen3-14b` via Vercel hitting
   `max_tokens=65536 cannot be greater than max_model_len=40960`, while the
   same model worked via OpenRouter).
6. OpenRouter's live pre-reload `usage.totalCost`.

Given the owner's motivation is a **cost comparison**, item 6 — plus the
`usage: { include: true }` + `compatibility: 'strict'` requirement — is the
single highest-value check in Epic 2, and it is now a required step
(WP 2.6 step 5). If OpenRouter reports no cost, the comparison this whole
effort exists to enable does not work.

## R2 — Brave and Exa response shapes came from documentation, not a live call

Both vendors' request/response shapes in this plan come from their official
skills (`.agents/skills/web-search/`, `.agents/skills/build-with-exa/`) and
pricing pages, not from a call this app actually made. Real keys exist in
`.dev.vars`, so **this risk is cheap to close** — WP 1.2's live smoke test
does it in two commands. Do it; it is no longer optional.

Specific unknowns worth watching: Exa's `costDollars` shape (is it a scalar
or an object with a `total`?), and whether Brave's `result_filter=web`
genuinely suppresses every non-web vertical.

## R3 — The Exa rate is a modelling decision, not a looked-up number

> **RESOLVED, corrected by real evidence during WP 1.2.** This originally
> proposed `$17/1,000` (`$7` base + `$1 × 10` highlight pages, read
> literally off Exa's pricing page). **Two live smoke-test calls against the
> exact shipped request shape (`numResults: 10`, `contents.highlights:
> true`) both returned `costDollars.total: 0.007` — exactly the $7/1,000
> base fee, with no separate highlights line.** The fallback rate is now
> `$7/1,000`, not `$17/1,000` (`wrangler.jsonc`, both blocks, commit
> `6a01fc6`). The live send path already prefers Exa's own reported
> `costDollars` whenever present, so this fallback rate has a small blast
> radius regardless — but per this project's own doctrine (never hardcode
> an unverified number when a real one is available), the fallback should
> match observed reality, not a plausible-sounding derivation two real
> calls already contradicted. If a future request against a differently-
> shaped Exa call (more results, no highlights, a different `type`) reveals
> highlights genuinely do bill separately under some condition, re-open
> this and re-derive — two samples is not exhaustive evidence, just better
> evidence than a theoretical read of a pricing page.

If the shipped request shape ever changes — a different `numResults`,
`contents.text` instead of `highlights`, a different `type` — **the rate
silently becomes wrong** and the cost comparison this effort exists to
enable becomes misleading. Two mitigations, both in WP 1.2: the request
shape is a module constant and explicitly not user-configurable, and the
live path prefers Exa's own reported `costDollars` over the rate. A comment
at the config site states the derivation and the correction.

## R4 — `minimumReleaseAge`: file 00's blind spot #9 is wrong

File 00 asserts this repo has a 1-day `minimumReleaseAge` gate that re-adding
`@openrouter/ai-sdk-provider` would hit. **Verified at plan time:**
`pnpm config get minimumReleaseAge` → `undefined`; the string appears in
none of `.npmrc`, `pnpm-workspace.yaml`, `package.json` or `~/.npmrc`. There
is no gate. WP 2.1 re-checks before installing anyway. This is noted as a
correction, not a silent override.

## R5 — `isThinkingToolPart` / `getToolStepTitle` were already generic

File 00's blind spot #5 raised a possible gap: that Brave/Exa tool calls
would not surface as reasoning steps. **Verified at plan time: they already
will.** `isThinkingToolPart()` accepts any `tool-*` part not named
`generate_image`, and `getToolStepTitle()` has a
`toolName.toLowerCase().includes('search')` fallback that both new names
satisfy. WP 1.7's change is polish, not a fix. Recording this so a reviewer
does not treat the absence of a "fix" as an oversight.

## R6 — `SupportedProviderId` was already decoupled

File 00 § 3 asked the planner to "first check whether `SupportedProviderId`
derives from `keys.provider.enumValues` — if yes, decouple it". **Verified:
it does not.** `shared/types/providers.d.ts:4-12` is a hand-written union,
and `toSupportedProviderId()` already narrows an arbitrary string to it. No
decoupling work is needed, and the objection
`docs/web-search-cost-accounting.md:515-522` raised against widening the keys
enum no longer applies. That superseded recommendation should be **annotated
in place**, per that document's own convention of keeping reversed
conclusions legible.

## R7 — Three test flips, not two

File 00 § Blind Spots names two tests that will fail on gateway restoration.
Reading the specs surfaced **two more that fail earlier, in Epic 0**:

| Spec | Flips at | Why |
| --- | --- | --- |
| `tests/integration/api/profile-keys-summary.spec.ts:111,120` | **Epic 0** | asserts exactly 7 providers; the widened enum makes it 12 |
| `tests/unit/components/ProviderIcon.spec.ts:76-79` | **Epic 0** | iterates `Object.keys(providerMeta)` asserting a real icon for each; brave/exa (then 3 gateways) have none until added |
| `tests/unit/utils/message-metadata.spec.ts:609-632` | Epic 2 | pins "legacy gateway provider degrades to no provider row" |
| `tests/unit/components/Chat/ContextMenu.client.spec.ts` | Epic 2 | `not.toContain('(direct)')` |

All four must be **rewritten, not deleted** — each guards a real behaviour
beyond the assertion that flips. A full audit (`rg -ln "'qwen'" tests/`) is
mandated in WP 0.1 because there may be more.

## R8 — `Model.toolCall` required breaks 17 fixture sites

Measured, not estimated: 17 occurrences across 11 test files. This plan
accepts the churn rather than introducing a fixture factory, on the grounds
that a factory would default the one field three subsequent packages depend
on reading correctly. If the executor finds the real number is materially
higher than 17, stop and re-decide rather than mass-editing.

## R9 — The legacy-models section and the vision filter are new since removal

`ModelsTrigger.vue` grew a collapsed deprecated-models section and an
`isVisionOnly` filter after the gateway code was deleted. Neither existed
when the `pickerMode` switcher did, so the original code has **no** guidance
on how they interact. WP 2.8 decides: legacy is provider-mode only; vision
applies in gateway mode **if** `GatewayModelList` honours it, else the toggle
hides. Both are new product decisions made inside a restoration package —
call them out for review rather than letting them read as restored
behaviour.

## R10 — `ReasoningTrigger`'s alignment prop is a real refactor inside a UI package

Replacing `isWebSearchEnabled` with an explicit alignment prop (WP 1.5) is
correct but has a purely visual failure mode that no unit test will catch —
a clipped dropdown at a narrow viewport. Its browser step (WP 1.5 step 4) is
the only guard. Do not skip it.

## R11 — `ai@7.0.56`'s chunk ordering is observed, not contracted

OpenRouter's live cost capture depends on `finish-step` chunks arriving
before `finish`, which the original work recorded as **"observed behaviour of
`ai@7.0.56`, not a documented contract"**. The installed version is still
exactly `7.0.56`, so it has not shifted — but WP 2.6 must **re-run the
empirical check** and record the result, and any future `ai` bump must repeat
it. Flag this in `docs/providers/gateways.md`.

## R12 — Open question: does a gateway strip provider-native web search?

`docs/web-search-cost-accounting.md` § "The AI Gateway question" says both
Vercel and Cloudflare pass native tools through unmodified, **but explicitly
warns both statements are inferences from architecture descriptions, not
end-to-end guarantees**, and that settling it "needs one live call through
whichever Gateway is actually relevant, asserting the response still carries
`groundingMetadata` / `server_tool_use` / `web_search_call`". This cannot be
resolved this session. It is the **first** thing to test when a gateway key
exists, because if a gateway *does* strip native search, the whole
gateway-plus-search story changes shape — and Brave/Exa (which are
gateway-agnostic by construction) become the only search path on a
gateway-routed model.

> **RESOLVED (partially), by a real empirical spike run before Epic 2
> started** (scratchpad:
> `r12-gateway-search-spike/`, raw JSON evidence in its `*.log` files). Do
> not re-run WP 2.6 step 9 as an open question — read this verdict and wire
> Epic 2 to match it:
>
> - **Vercel AI Gateway: PASS, strong evidence.**
>   `gateway('openai/gpt-4o-mini')` + `openai.tools.webSearch({})` and
>   `gateway('google/gemini-2.5-flash')` + `google.tools.googleSearch({})`
>   both actually invoked the search tool (real `tool-call`/`tool-result`
>   steps, real source URLs, live Sept 2026 news in the answer) and were
>   billed a separate `billableWebSearchCalls`/`cost` line distinct from
>   `inferenceCost` — proof the tool executed, not just a confident-sounding
>   answer. **The gateway rail may advertise native web search for
>   Vercel-routed models exactly as the direct-provider path does**, per
>   `WebSearchResolution: 'native'`, as originally planned.
> - **Cloudflare AI Gateway: still open — blocked by account state, not a
>   demonstrated tool-stripping bug.** The request reached the correct
>   `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai/responses`
>   endpoint with `tools:[{type:'web_search'}]` intact, but every gateway on
>   this Cloudflare account rejected it before a 200: HTTP 402 "Insufficient
>   wholesale credits" (no funded credits) or HTTP 401 (no BYOK OpenAI key
>   configured on the gateway — Cloudflare forwarded the CF token itself to
>   OpenAI, which correctly rejected it as an invalid OpenAI key). **This is
>   an owner action item, not an engineering one**: either fund Cloudflare
>   AI Gateway wholesale credits, or add a real OpenAI API key as a BYOK
>   credential on a Cloudflare gateway, then re-run the saved
>   `test2-cloudflare-gateway-openai-search.mjs <gateway-slug>` script. Until
>   then, **WP 2.8 must not advertise native web search as confirmed for
>   Cloudflare-routed models** — gate it behind a code comment citing this
>   finding, default to Brave/Exa or no-search-affordance for Cloudflare
>   until re-verified. Cloudflare's own current docs
>   (`developers.cloudflare.com/ai-gateway/usage/web-search/`) independently
>   describe this exact passthrough as supported, which is *consistent* with
>   a PASS but is documentation, not the verification this project's own
>   standard requires ("docs-reading isn't verification here").
> - **OpenRouter: confirmed structurally incompatible with the
>   AI-SDK-native provider-tool object, not a passthrough at all.** Sending
>   `openai.tools.webSearch({})` through
>   `openrouter('openai/gpt-4o-mini')` fails outright — OpenAI's Chat
>   Completions API (which is what OpenRouter calls) returns HTTP 400
>   ("Invalid value: 'openai:web_search'. Supported values are: 'function'
>   and 'custom'."). OpenRouter's own `plugins: [{ id: 'web' }]`
>   request-level flag **does** work (verified: real scraped source content
>   in `providerMetadata.openrouter.content`, its own separate fee in
>   `usage.cost` vs `costDetails.upstreamInferenceCost`) but is a distinct
>   mechanism, matching `WebSearchResolution: 'universal'` from the
>   pre-removal design, not `'native'`. **WP 2.6's OpenRouter branch must
>   never attempt to pass a provider-native tool object — it must construct
>   `plugins: [{ id: 'web' }]` instead, exactly as the original (deleted)
>   code did.** This was already the pre-removal design; the spike confirms
>   it is still correct and still required, not optional.
>
> Net effect on WP 2.8's capability gating: `isGatewayToolAllowed()`'s
> `WebSearchResolution` model (`'native' | 'universal' | undefined`) is
> **correct as originally restored** — Vercel gets `'native'`, OpenRouter
> gets `'universal'`, and Cloudflare should be treated as `undefined`
> (no advertised web search) until an owner funds credits or adds a key and
> Test 2 is re-run to a real 200. Record all three verdicts, with the raw
> evidence file paths, in `docs/providers/gateways.md` and annotate
> `docs/web-search-cost-accounting.md` § "The AI Gateway question" with the
> resolved (and still-open) parts.

## R13 — Open question: the tool-gating edge case was disclosed and never fixed

Regenerating the **first** message of a conversation after switching from a
direct-provider model (with tools requested) to a Cloudflare model can still
hit a tool-rejection 400, because the server reads `selectedTools` from the
persisted first message when the conversation has exactly one message. This
is the same first-turn trap Epic 1 works around for Brave/Exa. It was
disclosed and accepted pre-removal; restoration **re-inherits it**. Epic 1's
`chatToolsSchema` refinement does not fix it (the persisted row already
contains the offending value). Record it in `docs/providers/gateways.md` as a
known limitation rather than discovering it again.

## R14 — Nothing contradicts the archaeology, with two exceptions

The archaeology and audit reports were spot-checked against current source at
several points and held up everywhere except the two corrections above
(R4, R5) and one clarification: the three gateway SVG assets
(`app/assets/icons/{openrouter,vercel,cloudflare}.svg`) are listed in the
archaeology's restore set, but the removal plan § 6.5 establishes they were
**already unreferenced before the removal** (the icon system had moved to
`simple-icons:*`). WP 2.1 therefore does **not** restore them. Recording the
discrepancy rather than silently resolving it.

---

# MD files to update

A single checklist. Several of these are the *only* places a future reader
would learn a fact this work establishes.

- [ ] **`AGENTS.md` (== `CLAUDE.md`, a symlink — editing one edits both)**
  - [ ] Add a **`docs/providers/gateways.md` entry to the Project Docs
        bullet list** (currently ~line 226, where the `docs/providers/`
        bullet enumerates `general.md`, `xai.md`, `deepseek.md`,
        `moonshotai.md`, `alibaba.md` only). **Line 7 already
        forward-references `docs/providers/gateways.md` "once it lands"** —
        remove the "once it lands" hedge at the same time. **Epic 2 / WP 2.10.**
  - [ ] Update the line-3 overview to mention the search providers
        (Brave, Exa) alongside the seven LLM providers. **Epic 1.**
  - [ ] **Do NOT re-add the old blanket "no AI gateway of any kind… do not
        reintroduce it" block.** It was deliberately replaced with a scoped
        rule in commit `5be767c`.
- [ ] **`docs/auth-security.md`** — lost material on removal (archaeology
      § 1.5) and is missing new material:
  - [ ] Restore the "Reused outside Better Auth: the gateway catalog route"
        section (`GET /api/v1/gateways/[gateway]/models`). **WP 2.10.**
  - [ ] Restore the nine gateway key-route rate-limit budget rows and the
        gateway `keyPrefix` design rationale. **WP 2.10.**
  - [ ] **Add** six new rows for the Brave and Exa key routes — currently
        absent entirely. **Epic 0 / WP 0.2, or WP 2.10 at the latest.**
- [ ] **`docs/web-search-cost-accounting.md`** — the document this whole
      effort extends:
  - [ ] § "Sketch: external search backends" — annotate as **implemented**,
        recording the shipped tool keys, the fixed request shapes, and the
        **Exa $17/1,000 derivation**. **Epic 1 gate.**
  - [ ] § "Key storage" — annotate the separate-surface recommendation as
        **Reversed** (the enum was widened; the `SupportedProviderId` leak it
        feared does not exist), per that document's own convention of keeping
        superseded conclusions legible. **Epic 1.**
  - [ ] § "The AI Gateway question" — `:419`'s "**besidka does not route
        through any AI Gateway today**" becomes false the moment Epic 2
        lands. Rewrite the section; **do not delete it** — it is the
        pre-written case for this restoration and its unresolved
        passthrough question (R12) is still live. **Epic 2.**
  - [ ] § "If we build this next" items 2–7 — mark each resolved, with the
        resolution. Item 7 (the `wrangler.jsonc` two-block consistency
        check) is **implemented** by WP 1.2's new spec. **Epic 2.**
- [ ] **`docs/providers/gateways.md`** — **new document**, per the contents
      list in WP 2.10. **Epic 2.**
- [ ] **`docs/providers/general.md`** — its title is literally "# Direct
      providers: architecture and shared patterns" and `:206`/`:213`
      reference "direct-provider gaps". Add a cross-link to the new
      `gateways.md` and to the Brave/Exa work, and update its § "Multi-step
      tool loop" — which currently says Moonshot's tool is "the **first** real
      caller of the marker" and that "deciding how search steps should look…
      is still deliberately open". Both statements become stale: Brave and
      Exa are the second and third callers, and Epic 1 decided the look
      (reasoning steps plus `source-url` citations). **Epic 1 and Epic 2.**
- [ ] **`docs/gateway-removal-plan.md`** — add a note under its
      `Status: EXECUTED` header marking it **superseded by this plan** and
      retained because § 3 is the restoration spec read backwards. **WP 2.10.**
- [ ] **`docs/models-data-fetching.md`** — three updates:
  - [ ] the per-field merge policy table gains `toolCall` on the **fetched**
        side. **Epic 0 / WP 0.3.**
  - [ ] the `EXEMPT_IDS` hard-fail section gains `toolCall` in its required
        set. **WP 0.3.**
  - [ ] `:15`'s two gateway references in the curated-vs-dynamic catalog
        description were stripped on removal and are now wrong again (there
        *is* a dynamic gateway catalog). **Epic 2.**
  - [ ] its known-trade-off note that "a fifth capability would need adding
        in two places" — record that the fifth has arrived (WP 1.6) and the
        duplication was consciously not refactored. **Epic 1.**
- [ ] **`docs/legal.md`** — the recipients-table and `updatedAt` conventions
      are the spec WP 3.2 follows; check whether the doc itself needs a note
      about the new *categories* of recipient (search vendor, gateway) as
      distinct from "AI provider". **Epic 3.**
- [ ] **`docs/model-catalog-expansion-plan.md`** — `:88` ("131 commits:
      gateway…"), `:197` ("`SupportedProviderId` during gateway removal") and
      `:1478` (pointing at the removal plan's header) all describe the
      removal as settled. Add a forward-pointer to this plan. **Epic 2.**
- [ ] **`docs/seo.md`** — re-check after WP 3.1's FAQ edits that the
      documented `#about-the-name` / `alternateName` sync rule still holds.
      **Epic 3.**
- [ ] **`README.md`** — verify whether it enumerates providers; if it names
      three, it is stale on the same axis as `content/index.md`. **Epic 3.**
- [ ] **Source doc comments that assert gateways are gone** — each reads as
      false the moment Epic 2 lands, and the repo has a no-stale-comment
      rule. All are covered by their owning package, listed here so none is
      missed: `shared/utils/model-selection.ts:1-6`,
      `shared/utils/provider-meta.ts:90-97` (already done in WP 0.1),
      `shared/types/message-usage.d.ts:17-20`,
      `shared/utils/message-metadata.ts:187-191`,
      `server/utils/files/reconstruct-generated-image-parts.ts`,
      `server/utils/keys-rate-limit.ts`,
      `server/utils/providers/qwen.ts:17-18`,
      `server/utils/providers/moonshotai-web-search.ts:96-104`,
      `tests/fixtures/follow-up-turn-tool.ts:18`.

---

# Addendum — gateway test credentials are now available

**Added after the body of this plan was written.** The orchestrator's original
brief listed "no gateway test keys" as blind spot #1, and the first draft of
this plan was written around that constraint. **It no longer holds.** The
owner has supplied real test credentials for all three gateways, and they are
in `.dev.vars` alongside the Brave and Exa keys:

| Variable | Gateway |
| --- | --- |
| `NUXT_VERCEL_AI_GATEWAY_API_KEY` | Vercel AI Gateway |
| `NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY` + `NUXT_CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID` | Cloudflare AI Gateway |
| `NUXT_OPENROUTER_API_KEY` | OpenRouter |
| `NUXT_BRAVE_SEARCH_API_KEY` | Brave Search |
| `NUXT_EXA_API_KEY` | Exa |

**The same BYOK caveat applies to all five.** These are owner dev/testing
credentials for exercising a real path locally. They must **never** become a
server-side fallback for a user who has not saved their own key — that would
put user spend on the owner's accounts and invert the premise of the whole
app. The production mechanism is unchanged: per-user, encrypted, stored in
`keys` via `/profile/keys`. No application code in this plan reads these
variables.

The body of this document has already been revised to reflect this — the
following sections were rewritten rather than left stale, so **do not treat
this addendum as the only place the change is recorded**:

- § "Global conventions" → "Browser verification" — the honesty caveat is
  replaced with the two real constraints (no env-var fallback; an agent must
  not type a key into a form, so the owner performs save steps).
- **WP 2.4** — steps 7–9 now cover the owner saving each real gateway key,
  and verifying that Cloudflare's three-field credential round-trips as a
  JSON blob in one encrypted column with the API key never returned to the
  browser.
- **WP 2.5** — "live verification is impossible" is replaced by a **required**
  three-gateway catalog check, including the exact `curl` calls for both
  Cloudflare response formats and the four previously-unverified items
  (envelope shape, `per_page=1000` pagination, the inverted
  `marketplace.id === default.name` join, and the string-typed properties).
  The `gatewayCatalogEnrichment.matched`/`priced` counters become the
  package's primary signal.
- **WP 2.6** — "NOT POSSIBLE for the send path" is replaced by an 11-step
  script: four regression steps first, then a real send through each gateway
  covering OpenRouter's summed per-step `usage.cost` (and its
  `compatibility: 'strict'` + `usage: { include: true }` requirement),
  Vercel's asynchronous `generationId` cost appearing only after reload,
  Cloudflare's estimated cost and model-id compatibility, the
  `maxOutputTokens` cap, **the R12 native-search passthrough question**, and
  the blended-vs-`searchCost` double-count guard.
- **WP 2.7** — gateway image generation is now verified end to end, including
  that the persisted part is a `/files/<storageKey>` URL and not an inline
  `data:` blob.
- **WP 2.8** — step 10 now loads the real Cloudflare catalog and checks that
  the rail groups by real vendor rather than the shared `@cf` namespace.
- **Epic 2 gate** — the bullet reading "no gateway send was verified end to
  end" is replaced by four positive gates.
- **R1** and **R12** — reframed from "cannot verify" to "must verify, here is
  where".

## The one thing that was run first — R12 is resolved (Vercel + OpenRouter), Cloudflare is owner-blocked

**Run before Epic 0 finished, in parallel with WP 0.1/0.3, per the
orchestrator's advisor's recommendation to not wait until Epic 2.** See the
full verdict in R12 above; summary: **Vercel PASS** (native search survives
and is billed separately — advertise it), **OpenRouter confirmed
mechanism-incompatible** (must build `plugins: [{ id: 'web' }]`, never a
native tool object — this was always the plan, now confirmed necessary),
**Cloudflare inconclusive and blocked on the owner's account** (no funded
wholesale credits, no BYOK OpenAI key on a gateway — HTTP 402/401 before any
tool could be exercised). WP 2.6 step 9 and WP 2.8's capability gating should
be written directly to this verdict rather than re-treating it as open; only
the Cloudflare half needs a follow-up owner action (fund credits or add a
key) and a re-run of the saved spike script before it can be advertised as
working. Record all three verdicts in `docs/providers/gateways.md` and
annotate `docs/web-search-cost-accounting.md` § "The AI Gateway question"
when Epic 2 lands.
