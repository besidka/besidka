# Implementation Plan: New Direct Providers (xAI, DeepSeek, Moonshot), AI Gateway Support (Vercel, OpenRouter, Cloudflare), and No-Key UX Gating

> **TEMPORARY WORKING DOCUMENT.** This file tracks planning/progress during
> development of this initiative. Delete it before opening the final PRs for
> manual review — it is not meant to be permanent repo documentation.

Branch: `feat/add-more-providers` (parent PR). All paths below are relative
to the repo root unless written absolute.

---

## 1. Executive summary

This initiative extends Besidka's BYOK chat stack in three tiers: (1) three new **direct providers** — xAI, DeepSeek, Moonshot AI — which slot into the existing static, build-time-curated catalog (`providers/*.ts` merged against a models.dev snapshot and baked into `runtimeConfig.public`) and the existing per-provider server builder pattern; (2) three **AI gateways** — Vercel AI Gateway, OpenRouter, Cloudflare AI Gateway — whose model lists are per-user, runtime-fetched, hundreds strong, and uncurated, and therefore must be built as a **parallel runtime data path that is never merged into the static catalog**: a compound model-selection encoding (`{source, gatewayId?, modelId}`), a KV-cached catalog-fetch layer, a separate branch in the server completion path, per-gateway favorites, and gateway-aware Axiom telemetry; and (3) uniform **no-key UX gating** so any provider or gateway whose key is absent shows disabled models with a link to the keys page — replacing today's only enforcement, a 401 thrown at send time. Everything remains 100% BYOK: users bring their own provider keys and their own gateway credentials; the app owner never pays for inference (the free-trial idea is documented as a future proposal and explicitly not built). The core architectural insight the whole plan hangs on: the existing picker/selection/favorites/routing stack assumes one globally-unique, build-time-known model id space — gateways violate every part of that assumption, so gateway state is namespaced by source everywhere (selection encoding, favorites storage, catalog lookup, telemetry) rather than shoehorned into the static catalog.

**PR dependency graph** (orchestrator scheduling):

```
PR1 (direct providers + icon/meta consolidation)  ── independent, runs parallel with PR3
PR3 (gateway catalog fetch layer)                 ── independent, runs parallel with PR1
PR2 (gateway credentials + keys summary endpoint) ── AFTER PR1 lands on parent (both touch keys.ts enum + provider-meta.ts)
PR4 (picker mode switch UI + per-gateway favorites) ── needs PR1 (icons/meta) + PR3 (catalog)
PR5 (gateway chat completion + cost + telemetry)  ── needs PR2 + PR3
PR6 (no-key UX gating)                            ── needs PR1 + PR2 (summary endpoint) + PR4 (picker)
PR7 (Cloudflare AI Gateway)                       ── last, needs PR2–PR6
```

**Merge topology (advisor-confirmed)**: every child PR merges into the parent
branch `feat/add-more-providers`, never directly into `main`. Only the parent
merges to `main`, once, at the very end. This means an intermediate state
like "PR4 merged but PR5 not yet" is never a deployable/deployed state on its
own — it only matters as a step toward the parent being complete. Don't treat
any single child PR merging as a release event.

**Advisor review gaps folded in** (2026-08-09 reconciliation pass, no
re-planning needed, just scope additions):
1. PR1's `<ProviderIcon>` swap will BREAK the 7 existing specs under
   `tests/unit/components/ChatInput/ModelsTrigger*` (they assert against the
   current hardcoded-chain DOM), not just need new test files alongside them.
   Budget updating those existing specs in PR1's DoD, and again in PR4 (new
   rail) and PR6 (disabled states).
2. Check `docs/auth-security.md`'s per-endpoint rate-limit config and mirror
   it for the new routes: `GET /api/v1/profiles/keys`, the 5 new key CRUD
   trios, and especially `GET /api/v1/gateways/[gateway]/models` (triggers an
   upstream fetch on cache miss).
3. Commit this plan file to the parent branch now (not just locally in one
   worktree) so child worktrees branched from the parent can see it and
   subagent briefs can reference it reliably; delete it in the final cleanup
   commit.
4. **Naming-drift hazard**: `GatewayId` values (`'vercel'`, `'cloudflare'`,
   `'openrouter'`) are NOT the same strings as the `keys.provider` enum
   values (`'vercel-gateway'`, `'cloudflare-gateway'`, `'openrouter'` — note
   OpenRouter has no suffix while the other two do). The mapping between them
   lives ONLY in `provider-meta.ts`'s `keyProviderId` field. Every
   implementation subagent must be told this explicitly — with 5+ agents
   touching this surface, someone hardcoding `'vercel'` into a keys-table
   query would produce a silent "hasKey always false" bug.

---

## 2. Open questions requiring empirical verification (do NOT assume — verify during implementation)

1. **models.dev namespace coverage** (PR1, first task): `curl -s https://models.dev/api.json | jq 'keys'` — check whether `xai`, `deepseek`, `moonshotai` namespaces exist and whether they contain the exact curated model ids. If yes: extend the provider scope in `scripts/fetch-models-metadata.mjs` (currently google+openai only) and re-run `pnpm run models:fetch`. If no: fully hand-curate name/description/contextLength/maxOutputTokens/modalities/price per model (`EXEMPT_IDS` pattern).
2. **Exact API-key dashboard URLs**: xAI (`console.x.ai`), DeepSeek (`platform.deepseek.com`), Moonshot (`platform.moonshot.ai`), Vercel AI Gateway key page (must be an **AI Gateway API key**, not a general Vercel token), OpenRouter (`openrouter.ai/settings/keys`), Cloudflare (API token w/ Workers AI Read scope + account id/gateway id location). Verify by visiting; don't guess.
3. **Package major-version compatibility**: `@ai-sdk/xai@4.0.33` matches this app's `ai@7`/`@ai-sdk/provider@4` line; `@ai-sdk/deepseek@3.0.26` and `@ai-sdk/moonshotai@3.0.30` are lower majors. After install: typecheck, then a real `pnpm run preview` (workerd) smoke test of an actual streamed chat completion through each new provider with a real key.
4. **DeepSeek reasoning param shapes**: `deepseek-chat`'s `thinking: 'adaptive'|'enabled'|'disabled'` toggle — verify exact providerOptions shape in the shipped `.d.ts` + api-docs.deepseek.com. `deepseek-reasoner`'s `reasoningEffort` allowed values — do not trust unverified `xhigh`/`max`.
5. **Moonshot thinking toggle**: exact param name for `kimi-k2.5`/`kimi-k2.6`; per-model vision/image-input support (verify per model, don't assume uniform).
6. **xAI native web_search tool shape**: whether `@ai-sdk/xai` exposes a built-in web search tool normalizable into the existing `web_search_preview` convention. Timebox; ship `tools: []` if it doesn't map cleanly.
7. **Cloudflare AI Gateway catalog endpoint** (PR7): `GET /accounts/{account_id}/ai/models/search?format=openrouter` — unverified shape/completeness. This is why Cloudflare ships last.
8. **Drizzle enum widening**: `keys.provider` enum is TS-only (no SQL CHECK — verified). Run `pnpm db:generate` after widening, confirm no destructive migration.
9. **Vercel `getGenerationInfo` timing**: whether the generation record is available immediately at stream finish or needs a short delay/retry from `waitUntil`.
10. **Catalog payload sizes / KV limits**: confirm normalized cached JSON stays comfortably under KV value limits; confirm no fan-out beyond one upstream fetch per cache miss (6-connection Workers limit).

---

## 3. Per-PR task breakdown

### PR 1 — Direct providers: xAI, DeepSeek, Moonshot AI (+ icon/metadata consolidation)

**Goal**: Three new fully-working direct BYOK providers end to end (catalog → picker → keys page → chat completion → telemetry), plus the shared provider-metadata/icon consolidation the rest of the initiative builds on. Independently shippable.

**Packages**: `pnpm add @ai-sdk/xai @ai-sdk/deepseek @ai-sdk/moonshotai` (then verify #3).

**Create**:
- `shared/utils/provider-meta.ts` — single source of per-provider/gateway static metadata (section 6). PR1 populates the 6 direct-provider entries.
- `app/components/ProviderIcon.vue` — one `v-if/v-else-if` chain over `providerId`, `Svgo*` components, 2-letter badge fallback.
- `app/assets/icons/{xai,deepseek,moonshot}.svg` (+ `SVG_LOGOS_ICONS_LICENSE` entries).
- `providers/xai.ts` — id `xai`. Models in order: `grok-4.20-non-reasoning` (first/recommended), `grok-4.20-reasoning` (`reasoning: {mode:'levels', levels:['low','medium','high']}`), `grok-4.5` (same). `tools: []` unless #6 succeeds. No `imageGeneration` on any xAI model. No `default: true`.
- `providers/deepseek.ts` — id `deepseek`. Models: `deepseek-chat` first (`reasoning: {mode:'toggle'}`), `deepseek-reasoner` (levels if #4 confirms `reasoningEffort`, else omit). `tools: []` both.
- `providers/moonshotai.ts` — id `moonshotai`. Models: `kimi-k2.5` first (owner's pick), `kimi-k2.6`, `kimi-k3` if curatable. Skip sunset `moonshot-v1-*`. Thinking toggle per #5.
- `server/utils/providers/{xai,deepseek,moonshotai}.ts` — cloned from `anthropic.ts` pattern: fetch+decrypt key, `create<Provider>({apiKey})`, 401 "X API key not found..." when missing, reasoning wiring per verification items.
- `server/api/v1/profiles/keys/{xai,deepseek,moonshotai}/index.{get,post,delete}.ts` — copy existing per-provider route pattern verbatim.
- `app/components/Profile/Keys/ProviderKeyCard.vue` — generic single-key card driven by `provider-meta.ts`, replacing the need for 3 more copy-pasted components. Leave existing `Profile/Keys/{Anthropic,Google,OpenAi}.vue` untouched.

**Modify**:
- `providers/index.ts` — add 3 imports to `curatedProviders`. **Fix the default-model loop bug** (labeled `break outer`, `defaultMarkedModel: string | undefined`). Do NOT set `default: true` on any new model.
- `scripts/fetch-models-metadata.mjs` — extend namespaces per #1; EXEMPT_IDS for misses.
- `server/db/schemas/keys.ts` — widen enum to add `xai`, `deepseek`, `moonshotai`.
- `server/api/v1/chats/[slug]/index.post.ts` — add 3 switch cases; widen `toSupportedProviderId()` to all 6 direct ids.
- `server/api/v1/chats/[slug]/title.patch.ts` — add the same 3 cases.
- `ProviderRail.vue`, `ModelsTrigger.vue`, `ModelItem.vue`, `profile/keys.vue` — replace hardcoded icon chains with `<ProviderIcon>`; keys.vue becomes a loop over providers + `provider-meta.ts`.

**Explicitly excluded**: project memory (`memory.ts` union stays 3-provider), deep research (`ResearchProviderId` stays openai/google), image generation for new providers, any gateway work.

**Definition of done**: typecheck/format/test:all clean; build succeeds (no `toFullyCuratedModel` throw); real streamed completion via all 3 on `pnpm run preview` with real keys; reasoning UI correct per provider; keys page shows 6 cards, save/delete works, dashboard links verified real; global default model unchanged (unit test); Axiom fields carry new ids with zero schema change; new tests registered in `scripts/test-affected-check.mjs`.

---

### PR 2 — Gateway credentials + keys summary endpoint

**Goal**: Store Vercel AI Gateway + OpenRouter credentials (Cloudflare's form lands in PR7, storage design fixed here); one endpoint reports key presence for everything.

**Create**:
- `shared/types/gateways.d.ts` — `GatewayId = 'vercel'|'cloudflare'|'openrouter'` + `GatewayModel` normalized type (shared by PR3/4/5).
- `server/api/v1/profiles/keys/{vercel-gateway,openrouter}/index.{get,post,delete}.ts` — single-field, identical pattern to existing routes.
- `server/api/v1/profiles/keys/index.get.ts` — summary endpoint: one query, returns `{keys: [{provider, hasKey}]}` for all 9 ids, never secret material.
- Gateway key cards via `ProviderKeyCard.vue`.
- `app/assets/icons/{vercel,openrouter,cloudflare}.svg` (all 3 land here for PR4's buttons even though Cloudflare's form is PR7).

**Modify**:
- `server/db/schemas/keys.ts` — widen enum to the full 9.
- `app/pages/profile/keys.vue` — add a "Gateways" section + one-line explainer.

**Locked storage decision for Cloudflare** (implemented PR7, designed now): `apiKey` column stores `JSON.stringify({accountId, gatewayId, apiKey})` encrypted (encryption layer is shape-agnostic). Cloudflare's GET returns `{accountId, gatewayId, hasKey: true}`, never the decrypted token — multi-field routes get a stricter GET contract than the existing single-string routes (documented divergence, not churn).

**Definition of done**: save/delete round-trips for Vercel+OpenRouter; summary endpoint returns all 9 with correct `hasKey`, no secrets, one call; tests registered; test:all/typecheck clean; no destructive migration.

---

### PR 3 — Gateway catalog fetch layer (Vercel + OpenRouter)

**Goal**: Server endpoints returning a normalized, cached model catalog per gateway.

**Create**:
- `server/utils/gateways/catalog.ts` — Vercel (`GET https://ai-gateway.vercel.sh/v1/models`, public, 323 models live-verified) and OpenRouter (`GET https://openrouter.ai/api/v1/models`, public) fetchers → `GatewayModel[]`. Both public → cache globally in KV (`useStorage('cache')`), TTL 1h, stale-on-error fallback. One upstream fetch per cache miss.
- `server/api/v1/gateways/[gateway]/models.get.ts` — validates against `['vercel','openrouter']` (PR7 adds cloudflare), requires session, returns `{gateway, models}`.
- `app/composables/gateway-catalog.ts` — `useGatewayCatalog(gatewayId)`, lazy fetch + `useState` cache.

**Definition of done**: both endpoints return normalized catalogs; TTL cache hit confirmed; stale-fallback on upstream failure; unit tests w/ recorded fixtures; payload size within KV limits.

---

### PR 4 — Picker mode switch + per-gateway favorites (Opus-designed)

**Goal**: Picker gains a "by gateway" mode — bottom row of Vercel/Cloudflare/OpenRouter buttons under the existing provider rail; each gateway mode lists its own runtime catalog with its own separate favorites.

**The selection encoding lands here** (full spec section 4).

**Create/modify**:
- `shared/types/model-selection.d.ts` — `ModelSelection` union + parse/serialize helpers.
- `app/composables/model.ts` — `useUserModel()` exposes `{selection, userModel}`; `userModel` stays a bare string for backward compat at every existing call site.
- `app/components/ChatInput/ModelsTrigger/GatewayRail.vue` — new bottom-row controlled component mirroring `ProviderRail.vue`. Cloudflare button renders but gated by `enabledGateways` until PR7.
- `ModelsTrigger.vue` — `pickerMode` state; gateway mode sources `allModels` from `useGatewayCatalog`; loading/error/empty states.
- `ModelItem.vue`/`ModelDetail.vue` — accept normalized `GatewayModel` shape, graceful degradation for missing fields.
- **Per-gateway favorites**: new `favoriteGatewayModels` JSON column on `user_settings` (additive migration); extend settings API + `user-setting.ts`. Critical: never filter/persist a filtered-down gateway favorites list while its catalog hasn't loaded yet (would silently wipe favorites).
- `app/composables/selected-model-info.ts` — resolves display name/capabilities from either catalog based on `selection`.

**Excluded**: actually sending gateway chats (PR5), no-key gating (PR6), Cloudflare enablement (PR7).

**Definition of done**: mode switch works; gateway mode catalog searchable/selectable; favorites isolated per gateway; existing bare-string preference values load unchanged; tests for parse/serialize round-trip (incl. `:free`-suffixed ids) and no-wipe-before-load.

**Implemented (2026-08-09) — one disclosed, reviewed deviation**: the gateway button row renders unconditionally, including in provider mode (not hidden until a gateway key exists), because the mode switch needs to be discoverable somewhere. Verified this triggers no wasted catalog fetch for a keyless/provider-mode user — `GatewayModelList` only mounts once a gateway is actively selected. Everything else in provider mode is unchanged. PR6 owns the actual no-key gating on top of this.

---

### PR 5 — Gateway chat completion path + cost capture + Axiom telemetry

**Goal**: Chats stream through Vercel AI Gateway and OpenRouter with per-request cost + Axiom visibility.

**Packages**: `pnpm add @ai-sdk/gateway @openrouter/ai-sdk-provider`.

**API contract**: POST body keeps `model: string`, adds optional `gateway: z.enum(['vercel','cloudflare','openrouter'])`. `cloudflare` accepted in schema but rejected "not yet supported" until PR7.

**Create**: `server/utils/gateways/{vercel,openrouter}.ts` (uniform builder shape), `server/utils/gateways/index.ts` dispatcher.

**Modify**:
- `index.post.ts` — gateway branch before `useChatProvider()` runs (must not validate gateway ids against the static catalog); reject `web_search`/`image_generation` tool requests for gateway sends (400); telemetry keeps flat `providerId`/`modelId` PLUS new nested `attributes.chat.{gateway, gatewayProvider, gatewayModel}` (already-declared map field, zero schema growth, no map-field script re-run needed). Cost: OpenRouter reads `providerMetadata.openrouter.usage.cost` synchronously; Vercel reads `providerMetadata.gateway.generationId` → `getGenerationInfo()` inside `waitUntil`. Extend `MessageUsage` with optional `totalCost`.
- `title.patch.ts` — accept optional `gateway`.
- `app/composables/chat.ts` — send/title payloads add `gateway` from selection; DR guards already correctly resolve gateway ids to "not a DR model" via `getModel()` — add a test pinning this.

**Excluded**: gateway web_search/image_generation/reasoning UI (v1 scope cut), Cloudflare execution.

**Definition of done**: real streamed completion through both gateways on workerd preview with real credentials; usage row persists gateway provider/model + cost; Axiom shows flat + nested fields; tool request on gateway model → clean 400; old non-gateway clients unaffected (regression test).

**Implemented (2026-08-09) — disclosed deviations/decisions**:
1. Gateway builders take `(userId, model)` only, not the full 4-arg
   `(userId, model, requestedTools, requestedReasoning)` shape — tools are
   hard-rejected before a gateway builder ever runs (v1 scope cut) and
   reasoning is never wired for gateways in v1, so the extra params would be
   permanently unused. Both builders still return the exact
   `{instance, generateChatTitle, tools, providerOptions}` shape the route
   destructures (`tools`/`providerOptions` always `{}`), so `title.patch.ts`
   and `index.post.ts` both work through the same dispatcher unmodified.
2. `keyProviderIdForGateway()` is a thin wrapper over `provider-meta.ts`'s
   existing `keyProviderId` field (not a second mapping table), per the
   plan's own "reuse it directly" option.
3. `ChatErrorPayload.providerId` / `NormalizeChatErrorInput.providerId`
   widened from `SupportedProviderId` to `SupportedProviderId | GatewayId`
   (type-only, additive) so gateway sends get real error attribution
   (`providerId: gatewayId`) instead of `undefined` on every error path,
   including `persistAssistantMessageFromStream`'s catch block.
4. OpenRouter builder sets `compatibility: 'strict'` and
   `usage: { include: true }` on the chat model — neither is optional:
   without `usage.include`, `providerMetadata.openrouter.usage.cost` is
   never populated by OpenRouter's API regardless of gateway-side code,
   silently breaking the cost DoD item. Caught via `@openrouter/ai-sdk-
   provider`'s own compiled source, not the plan text.
5. Vercel's `getGenerationInfo()` cost lookup is scheduled via the same
   `cfCtx.waitUntil` mechanism the route already uses for the push
   notification and Axiom wide-event ship — `persistVercelGenerationCost()`
   (one retry after 1.5s, then gives up and logs non-fatally) runs
   entirely after the assistant message row already exists, updating its
   `usage.totalCost` in place. The initial insert never blocks on it.
6. `providerMetadata.gateway.generationId` (Vercel) could not be verified
   against a live account in this environment — `@ai-sdk/gateway`'s client
   is a transparent proxy, so this field's presence is server-injected and
   unverifiable from package source. Implemented per this plan's spec,
   defensively guarded (absence just skips the background job, never
   throws). **Needs a live `pnpm run preview` smoke test with a real Vercel
   AI Gateway key before shipping** — flagged in the PR5 handoff report too.

---

### PR 6 — No-key UX gating (Opus-designed)

**Goal**: Every model under a keyless provider/gateway is visibly disabled with guidance to `/profile/keys`. Uniform across all 6 providers + 3 gateways.

**Create**: `app/composables/user-keys.ts` — `useUserKeys()`, fetches the PR2 summary endpoint once into shared state, `hasKey(id)`, `refresh()`.

**Modify**: `ModelsTrigger.vue` + `ProviderRail.vue` + `GatewayRail.vue` + `ModelItem.vue` — keyless rows disabled (non-selectable, tooltip/inline note, link to keys page); fail open while `pending` (no flash-disable during load); brand-new zero-key account sees a clear "Bring your own key" callout. Server-side 401 stays as the enforcement backstop — this is UI guidance only.

**Definition of done**: zero-key account has every model disabled with working links; adding a key live-enables without reload; deleting the currently-selected model's key surfaces guidance instead of a raw 401; gating logic covered by component tests.

---

### PR 7 — Cloudflare AI Gateway (last, isolated)

**Goal**: Third gateway via Path B (`@ai-sdk/openai-compatible` + Cloudflare's unified endpoint). Ships only after PR2–PR6 are proven with the two easier gateways.

**Packages**: `pnpm add @ai-sdk/openai-compatible`.

**Create/modify**: multi-field key routes (`accountId`, optional `gatewayId` default `'default'`, `apiKey`) — GET never returns the token; `CloudflareGateway.vue` 3-field form; `server/utils/gateways/cloudflare.ts` via `createOpenAICompatible` against Cloudflare's unified REST endpoint; catalog fetch via `models/search?format=openrouter` cached per-account (verify shape first — fall back to manual normalization if unusable); flip `cloudflare` into `enabledGateways`; unreject the gateway enum value in the chat routes. No per-request cost API — persist tokens only, `totalCost` unset.

**Definition of done**: real streamed completion through a real Cloudflare AI Gateway account; catalog verified/normalized; multi-field form round-trips, token never leaks via GET; no-key gating covers Cloudflare automatically; full `test:all` green; **this is also the point for the final cross-PR review**.

---

## 4. Gateway selection encoding (locked decision)

```ts
export type GatewayId = 'vercel' | 'cloudflare' | 'openrouter'

export type ModelSelection =
  | { source: 'provider'; modelId: string }
  | { source: 'gateway'; gatewayId: GatewayId; modelId: string }
```

**Client persistence**: existing `usePreferenceStorage()` key `'model'`. Bare string (not starting with `{`) = `{source:'provider', modelId: raw}` — zero migration for existing users. Gateway selections store `JSON.stringify(selection)`. No colon-delimited encoding (OpenRouter slugs contain `:` and `/`).

**Wire contract**: request bodies keep `model: string`, add optional `gateway?: GatewayId`.

**Server persistence**: no new message/chat columns — the existing `messages.usage` JSON column's `MessageUsage.{provider, model}` fields cover history/cost attribution.

**Call sites needing the `gateway` field / branch** (see plan detail for exact line numbers at time of research): `app/composables/model.ts` (rewritten), `chat.ts` send-payload builder, `chat.ts` title-generation fetch, `chat.ts` DR-model guards (already correct, add test), `index.post.ts` provider resolution (bypass `useChatProvider` for gateway ids), `toSupportedProviderId` (widened for direct providers only), `title.patch.ts`, `computeModelCost` (provider-only, gateway path uses providerMetadata cost), `user-setting.ts` favorites filtering (new parallel path for gateway favorites), `shared/utils/model.ts`'s `getModelName()` (new `useSelectedModelInfo()` composable resolves from either catalog).

## 5. Per-provider default recommendation (locked)

Keep the single global default (`gemini-2.5-flash-lite`); introduce no per-provider-default concept. New provider files set `default: true` on nothing — list each provider's recommended model first in its array (order = visual recommendation only). Fix the latent footgun in `providers/index.ts`'s default-resolution loop (labeled `break outer`, proper `undefined` initialization) so a future `default: true` on a later provider can't silently steal the global default. Add a unit test pinning the global default.

## 6. Icon/metadata consolidation (locked shape)

1. **`app/components/ProviderIcon.vue`** — single icon-resolution point (template chain, not a component map, for nuxt-svgo tree-shaking/typo-safety), covers all 9 ids, replacing 4 duplicated chains.
2. **`shared/utils/provider-meta.ts`**:

```ts
export interface ProviderMeta {
  id: string
  kind: 'provider' | 'gateway'
  label: string
  keyProviderId: string
  dashboardUrl: string
  keyFields: Array<{
    name: 'apiKey' | 'accountId' | 'gatewayId'
    label: string
    secret: boolean
    required: boolean
  }>
}
export const providerMeta: Record<string, ProviderMeta>
export const enabledGateways: GatewayId[] // ['vercel','openrouter'] until PR7
```

Serves: keys-page cards, dashboard links, no-key gating link targets, gateway-rail buttons, gatewayId → keys-enum mapping.

## 7. Future proposal — NOT built

*Free-trial via Cloudflare AI Gateway* (owner to greenlight later, explicitly out of scope now): new accounts could get N free messages routed through an app-owner-funded Cloudflare AI Gateway credential pinned to the cheapest model, with a per-user D1 counter and hard cutoff, after which standard BYOK gating applies. This inverts the project's BYOK invariant (the maintainer would pay for inference for the first time, with real abuse/cost-cap risk needing rate limiting, bot defense, and a billing kill-switch) — which is why it is **not** being built now. Everything in this initiative is Option A: fully key-gated, the app owner never holds or spends on inference credentials.

## 8. Test & verification plan

Every new spec file must be registered in `scripts/test-affected-check.mjs` or CI will not run it on PRs touching its source.

- **PR1**: `tests/unit/providers/{xai,deepseek,moonshotai}.spec.ts`; `tests/unit/providers/default-model.spec.ts` (loop-fix pin); `merge.spec.ts` extension if hand-curated models added; `ProviderIcon.vue` tests.
- **PR2**: keys-summary endpoint test (no-secret assertion); round-trip tests for the 2 new key routes.
- **PR3**: catalog normalizer unit tests w/ recorded fixtures; route integration test (auth + cache-hit path).
- **PR4**: selection parse/serialize round-trip (incl. `:free` ids, bare-string backward compat); per-gateway favorites isolation + no-wipe-before-load; `GatewayRail.spec.ts`.
- **PR5**: gateway chat integration test (mocked SDK: branch selection, tool rejection, usage/cost persistence, telemetry shape); non-gateway regression test.
- **PR6**: gating component tests; `useUserKeys` composable test.
- **PR7**: Cloudflare credential round-trip (token never in GET); catalog normalization fixtures; per-account cache keying.

Gates on every PR: `pnpm run typecheck`, format/lint, `pnpm test:all` clean, CI green. Manual `pnpm run preview` (workerd) verification with real keys is a hard DoD item for PR1, PR5, PR7 given the `@ai-sdk/deepseek@3`/`@ai-sdk/moonshotai@3` major-version mismatch against this app's `ai@7`/`@ai-sdk/provider@4`. Implementation subagents work in isolated git worktrees per branch. This file is deleted before final handoff; the final cross-PR review runs after PR7 lands.

### Critical files (from research)

- `server/api/v1/chats/[slug]/index.post.ts`
- `providers/index.ts`
- `app/components/ChatInput/ModelsTrigger.vue`
- `app/composables/model.ts`
- `server/db/schemas/keys.ts`
