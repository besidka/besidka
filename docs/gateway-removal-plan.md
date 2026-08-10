# Gateway removal plan

Status: PLAN ONLY — nothing in this document has been executed.

Branch: `feat/add-more-providers`
Worktree: `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers`

## How to use this document

Read § 1, § 5 (risks) and § 8 (wave order) before touching anything. § 3 is the
per-file spec an executor works from. § 2 is a separate, ordered database
runbook that runs **after** the code is merged and pushed. § 6 lists the four
decisions that need the owner, not the executor.

| § | Section | Audience |
| --- | --- | --- |
| 1 | Goal and scope | everyone |
| 2 | Database plan (preview runbook, production no-op) | whoever runs the DB steps |
| 3 | File inventory — delete lists + per-file surgical specs | executors |
| 4 | Legacy persisted data: read-side tolerance | executors (MUST items) |
| 5 | Risk flags — verify before deleting | executors |
| 6 | Decision points | **owner** |
| 7 | Verification gates (definition of done) | executors |
| 8 | Execution plan — wave structure | orchestrator |
| 9 | Dependency removal | executors |
| 10 | Dangling cross-references | executors |
| 11 | Shared-layer surgical edits (wave 2) | executors |
| 12 | Tests (wave 4) | executors |
| 13 | `docs/auth-security.md` edit spec | executors |
| 14 | Verified-clean surfaces (negative findings) | reference — do not re-search |
| 15 | Open verification items | executors |

## 1. Goal and scope

Remove **all** gateway functionality from the codebase. Keep **all** direct
BYOK provider functionality.

**Removed (gateways):** Vercel AI Gateway, Cloudflare AI Gateway, OpenRouter —
their credentials UI and API routes, dynamic model catalog fetch/cache, the
gateway branch of the chat send pipeline, the gateway model-picker UI, the
gateway capability/pricing/model-id helpers, the `favoriteGatewayModels`
user setting, gateway tests, gateway docs, and the gateway SDK dependencies.

**Kept (direct providers), untouched unless explicitly listed below:**
Anthropic, Google, OpenAI, xAI, DeepSeek, Moonshot AI, Qwen (DashScope) —
including the curated `providers/*.ts` catalog + models.dev snapshot merge,
per-provider key management, the multi-step tool loop, Moonshot Formula-API
web search, Qwen DashScope web search, reasoning controls, and image
generation on direct providers.

### 1.1 Branch context

Everything gateway-related was added on `feat/add-more-providers` (merge-base
with `main`: `26f5875b`). Nothing gateway-related exists on `main`, so the
removal is confined to this branch's own additions.

The same branch also genericised things that must **survive**: the per-provider
keys page was rewritten from three hardcoded components
(`Profile/Keys/{Anthropic,Google,OpenAi}.vue`, all deleted on this branch) into
the generic `Profile/Keys/Card.vue` + `Profile/Keys/ProviderKeyCard.vue`, and
`server/utils/ai/tool-loop.ts` added the multi-step tool loop. Do not mistake
either for gateway work.

## 2. Database plan

### 2.1 Facts established

- The **only** physical schema drift introduced by gateway work is the
  `user_settings.favorite_gateway_models` column, added by
  `.drizzle/migrations/20260809021640_vengeful_lifeguard/migration.sql`:

  ```sql
  ALTER TABLE `user_settings` ADD `favorite_gateway_models` text;
  ```

- `20260809021640_vengeful_lifeguard` is the **newest / last** migration
  directory in `.drizzle/migrations/` (39 directories, lexically sorted by the
  timestamp prefix). Removing it is a tail removal, not a mid-chain removal.
- `.drizzle/migrations/` has **no `meta/_journal.json`**. Each migration
  directory contains `migration.sql` + `snapshot.json`.
- Migrations are applied with **`wrangler d1 migrations apply DB`** (binding
  name `DB`), not drizzle-kit's own apply. See `package.json` `db:migrate*`
  scripts.
- `user_settings` has exactly one index, `uq_user_settings_user` on `user_id`.
  **`favorite_gateway_models` is not indexed**, not part of any primary key,
  unique constraint, generated column, view, or trigger — so it is eligible for
  SQLite's native `ALTER TABLE ... DROP COLUMN`.
- `keys.provider` is a plain Drizzle `text({ enum: [...] })` column. Drizzle's
  sqlite-core text enum is **TypeScript-only** — no SQL `CHECK` constraint is
  emitted — so narrowing the enum is a pure code change requiring **no
  migration**.

### 2.1a `DROP COLUMN` is safe here — why the CLAUDE.md rebuild rule does not apply

CLAUDE.md's D1 disaster rule is about **Drizzle-generated table rebuilds**
(`CREATE __new / INSERT SELECT / DROP TABLE / RENAME`) triggered by default,
type, nullability, constraint, PK or FK changes. A hand-written
`ALTER TABLE ... DROP COLUMN` is a different mechanism entirely.

Per the official SQLite documentation
([sqlite.org/lang_altertable.html](https://sqlite.org/lang_altertable.html) §5.1
"How It Works"):

> In the case of the DROP COLUMN command, the only text modified is that the
> column definition is removed from the CREATE TABLE statement.

SQLite rewrites each row's serialized content in place. The table object, its
name and its schema entry all persist. **`DROP COLUMN` never issues
`DROP TABLE`, so it cannot fire any `ON DELETE CASCADE`.** The 12-step
rebuild procedure appears in §8 of the same page as the *manual workaround for
changes SQLite does not natively support* — it is explicitly not what
`DROP COLUMN` does.

Supporting facts:

- `DROP COLUMN` landed in **SQLite 3.35.0** (2021-03-12); D1 is well past that
  floor.
- **This repository has already run `ALTER TABLE ... DROP COLUMN` against D1
  twice, successfully:**
  `.drizzle/migrations/20250725193349_last_shinko_yamashiro/migration.sql`
  (`ALTER TABLE \`messages\` DROP COLUMN \`sources\`;`) and
  `.drizzle/migrations/20251109182857_complete_firebrand/migration.sql`
  (`ALTER TABLE \`sessions\` DROP COLUMN \`ip_address\`;`). Both tables are
  cascade-children of `users`. There is direct precedent.
- SQLite refuses `DROP COLUMN` only if the column is a PRIMARY KEY, has a
  UNIQUE constraint, is indexed, appears in a partial index WHERE clause, a
  CHECK constraint, a foreign key, a generated-column expression, a trigger or
  a view. `favorite_gateway_models` is **none** of these (§ 2.1).
- Even in the hypothetical where a rebuild did occur, `user_settings` is a
  **leaf**: it is a cascade *child* of `users`, and no other table carries a
  cascade FK pointing *at* `user_settings`. A rebuild of this specific table
  could not wipe anything.

> Sharpening the CLAUDE.md wording for future readers: D1 does not merely
> handle `PRAGMA foreign_keys=OFF` "unreliably" — it never disables FK
> enforcement at all. Cloudflare's docs state D1 runs every query inside an
> implicit transaction so user queries cannot change this, and that
> `PRAGMA defer_foreign_keys = ON` explicitly "does not prevent
> `ON DELETE CASCADE` actions from being executed."

### 2.2 Environment targets

| Environment | D1 database name | wrangler env flag | Gateway migration applied? |
| --- | --- | --- | --- |
| Preview | `besidka-preview` | none (top-level) | **YES** (auto-applied on PR push) |
| Production | `besidka` | `--env production` | **NO** |

### 2.3 PRODUCTION: no action

**Do not run any migration, `ALTER TABLE`, or `DELETE` against the `besidka`
production database.** The gateway migration never reached production, and no
production row can hold a gateway value. Running the column drop there will
fail with "no such column" and is pure downside.

### 2.4 PREVIEW runbook (ordered, destructive)

> **ORDERING GATE — read first.** `.github/workflows/preview-deploy.yml:126`
> runs `wrangler d1 migrations apply DB --remote` against `besidka-preview` on
> every successful PR build (`production.yml:465` does the same on the
> preview-fallback path). If the preview database steps below are run *before*
> `.drizzle/migrations/20260809021640_vengeful_lifeguard/` is deleted from the
> branch and pushed, the very next CI deploy re-applies the migration and
> **re-adds the dropped column**.
>
> Therefore: **complete and push all code waves (including the migration
> directory deletion) first; run the steps below only afterwards.** Once the
> migration file no longer exists in the repo, deleting its `d1_migrations`
> bookkeeping row can never cause re-application.

Run from the repo root. Every step is required and ordered.

**Step 1 — Take a Time Travel bookmark BEFORE anything destructive.**

```bash
npx wrangler d1 time-travel info besidka-preview
```

Record the printed bookmark string somewhere retrievable (paste it into the PR
description). Recovery, if needed:

```bash
npx wrangler d1 time-travel restore besidka-preview --bookmark=<bookmark>
```

**Step 2 — Record the "before" row counts** so the drop can be proven
non-destructive to neighbouring data:

```bash
npx wrangler d1 execute besidka-preview --remote --command="SELECT
  (SELECT COUNT(*) FROM user_settings) AS user_settings,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM keys) AS keys,
  (SELECT COUNT(*) FROM chats) AS chats,
  (SELECT COUNT(*) FROM messages) AS messages;"
```

**Step 3 — Delete gateway credential rows from `keys`.** The enum narrowing is
TypeScript-only, so these rows survive the code change and would otherwise sit
in preview forever as unreadable orphans.

```bash
npx wrangler d1 execute besidka-preview --remote --command="DELETE FROM keys
  WHERE provider IN ('vercel-gateway', 'cloudflare-gateway', 'openrouter');"
```

**Step 4 — Drop the gateway column.**

```bash
npx wrangler d1 execute besidka-preview --remote --command="ALTER TABLE
  user_settings DROP COLUMN favorite_gateway_models;"
```

**Step 5 — Remove the orphan `d1_migrations` bookkeeping row (OPTIONAL, tidy).**

Wrangler tracks applied migrations in:

```sql
CREATE TABLE IF NOT EXISTS "d1_migrations"(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**The orphan row is harmless.** Wrangler's `getUnappliedMigrationNames` is a
one-way diff (`on-disk migrations MINUS applied names`) — there is no reverse
check and no checksum anywhere in the flow, so a row naming a migration that no
longer exists on disk is silently ignored by both `migrations apply` and
`migrations list`. Deleting it is housekeeping, not a requirement.

If you do delete it, **discover the exact stored name first** — it is the
migration's path relative to `migrations_dir`, not a bare directory name:

```bash
npx wrangler d1 execute besidka-preview --remote --command="SELECT id, name
  FROM d1_migrations ORDER BY id DESC LIMIT 5;"
```

Then delete using the exact string that query returned (expected to be
`20260809021640_vengeful_lifeguard/migration.sql`):

```bash
npx wrangler d1 execute besidka-preview --remote --command="DELETE FROM
  d1_migrations WHERE name = '<exact-name-from-the-SELECT>';"
```

> Do **not** guess the name. If the `DELETE` matches zero rows the orphan stays
> (harmless), but a wrong-but-matching guess could delete a real migration's
> row and cause that migration to be re-applied on the next deploy.

**Step 6 — Verify.** Re-run the Step 2 count query and confirm every count is
unchanged, and confirm the column is gone:

```bash
npx wrangler d1 execute besidka-preview --remote --command="PRAGMA
  table_info(user_settings);"
```

**Step 7 — Local dev database.** The local D1 state under
`.wrangler/state/v3/d1` also has the column. Simplest reset:

```bash
pnpm run db:reset
```

### 2.5 Codebase migration removal

Delete the whole directory:

```
.drizzle/migrations/20260809021640_vengeful_lifeguard/
```

(both `migration.sql` and `snapshot.json`).

**Why tail deletion is safe (source-verified, docs are thin here).**
drizzle-kit `1.0.0-rc.4` has no `meta/_journal.json`. Its `prepareOutFolder`
simply `readdirSync`s the migrations directory, collects every
`*/snapshot.json`, sorts the paths lexicographically, and
`prepareSqliteSnapshot` diffs against `snapshots[snapshots.length - 1]`.
Because folders are named `YYYYMMDDHHMMSS_name`, lexicographic order equals
chronological order.

So deleting the newest folder simply removes it from `readdirSync`'s output and
the next generate naturally diffs against
`20260802215200_skinny_ozymandias/snapshot.json`, which does not contain
`favorite_gateway_models`. There is no stale pointer and no index file to fix.
(The `prevIds` chain inside each `snapshot.json` is used only to stamp lineage
on newly created snapshots, not to select the diff base.)

With the column also removed from `server/db/schemas/user-settings.ts`, schema
and snapshot agree, so `pnpm run db:generate` must produce **no new
migration**. That "generates nothing" outcome is the proof the chain is
consistent — it is a required verification gate (§ 7).

> This would **not** hold for deleting a migration from the middle of the
> sequence: the tail snapshot would still describe the post-deletion schema,
> and generate would produce nothing while the on-disk SQL no longer builds
> that schema from scratch. Tail-only is what makes this safe.

### 2.6 KV cache: orphaned entries that never expire

> **Corrected finding — do not skip this.** The gateway catalog entries look
> like they expire, but they do **not**. `server/utils/gateways/catalog.ts`
> (see its own comment at 893-898) sets **no storage TTL at all** — freshness
> is decided purely by comparing a `cachedAt` timestamp *inside the value*.
> Once the reading code is deleted, nothing ever expires or reads these keys
> again, so they persist in KV indefinitely.

| Key prefix | Expires on its own? | Notes |
| --- | --- | --- |
| `gateway-catalog:<schemaVersion>:vercel` | **No** | one entry |
| `gateway-catalog:<schemaVersion>:openrouter` | **No** | one entry |
| `gateway-catalog:<schemaVersion>:cloudflare:<accountId>:<sha256(apiKey)>` | **No** | **one entry per user credential pair** — the largest orphan set |
| `gateway-catalog:rate-limit:*` | Yes | auth-rate-limit storage applies a TTL |
| `keys-rate-limit:{vercel-gateway,cloudflare-gateway,openrouter}:{get,post,delete}` | Yes | TTL'd |
| `keys-rate-limit:summary:get` | — | **SHARED — keep**, used by the surviving `server/api/v1/profiles/keys/index.get.ts` |

**Recommended one-off sweep** (preview and production — the catalog cache is
written by any deploy that served a gateway request):

```bash
npx wrangler kv key list --binding=KV --prefix="gateway-catalog:"
npx wrangler kv key list --binding=KV --prefix="gateway-catalog:" --env production
```

Then delete the listed keys. Per CLAUDE.md's connection-saturation rule, KV has
no batch delete — delete **sequentially**, not with a parallel
`Promise.all`/`allSettled` fan-out.

This is orphaned data, not a correctness problem — nothing reads it once the
code is gone. It is cheap to leave and cheap to clean; flag the choice to the
owner rather than silently skipping it.

### 2.7 Axiom: removal reclaims no schema headroom

Gateway code owns six **flat, top-level** Axiom fields
(`gatewayCatalogEnrichment.{gateway,models,matched,priced}`,
`gatewayCatalogFetch.{gateway,servedStale}`). Per `docs/axiom-map-fields.md`,
the Axiom dataset schema is a **high-water mark that never shrinks** — deleting
this code does not reclaim those fields on `besidka-prod`. Do not expect this
removal to buy headroom against the 256-field cap.

The remaining gateway logging correctly went into the `attributes` map field
and costs nothing. The shared flat field `providerId` stays (direct providers
use it); only its gateway *values* stop appearing.

### 2.7 Explicitly out of scope

No data migration is to be written that rewrites users' stored model
selections. Code-side graceful degradation (§ 4) is sufficient. An executor
must not invent one.

## 3. File inventory

### 3.A Wholesale delete — server

Every export in each of these was verified to have no importer outside the
gateway tree or the surgically-edited files in § 3.C.

```
server/utils/gateways/catalog.ts
server/utils/gateways/cloudflare.ts
server/utils/gateways/index.ts
server/utils/gateways/openrouter.ts
server/utils/gateways/vercel.ts
server/api/v1/gateways/[gateway]/models.get.ts
server/api/v1/profiles/keys/vercel-gateway/index.{get,post,delete}.ts
server/api/v1/profiles/keys/cloudflare-gateway/index.{get,post,delete}.ts
server/api/v1/profiles/keys/openrouter/index.{get,post,delete}.ts
```

Delete the now-empty `server/utils/gateways/`, `server/api/v1/gateways/` and
the three key-route directories.

### 3.B Wholesale delete — client, shared, assets, docs

```
app/components/ChatInput/ModelsTrigger/GatewayModelDetail.vue
app/components/ChatInput/ModelsTrigger/GatewayModelItem.vue
app/components/ChatInput/ModelsTrigger/GatewayModelList.vue
app/components/ChatInput/ModelsTrigger/GatewayProviderRail.vue
app/components/ChatInput/ModelsTrigger/GatewayRail.vue
app/components/Profile/Keys/CloudflareGateway.vue
app/composables/gateway-catalog.ts
shared/types/gateways.d.ts
shared/types/model-selection.d.ts
shared/utils/gateway-capabilities.ts
shared/utils/gateway-model-id.ts
shared/utils/gateway-pricing.ts
app/assets/icons/openrouter.svg
app/assets/icons/vercel.svg
app/assets/icons/cloudflare.svg
docs/future/gateway-free-trial-proposal.md
.drizzle/migrations/20260809021640_vengeful_lifeguard/
```

`shared/utils/model-selection.ts` is **not** deleted — it collapses (§ 4.1).

### 3.C Surgical edits — server

#### `server/api/v1/chats/[slug]/index.post.ts` (1752 lines) — the hard one

**The multi-step tool loop MUST SURVIVE.** `resolveToolLoopOptions` (line 818)
is a pure function of `parsedTools.tools` with zero gateway awareness, and the
only producer of the `requiresFollowUpTurn` marker in the whole repo is
`server/utils/providers/moonshotai-web-search.ts:249`. It is a direct-provider
feature. Leave it and its call site untouched.

Imports to delete: `GatewayProvider` from `@ai-sdk/gateway` (line 9);
`GatewayId, GatewayModel` (line 20); `isGatewayReasoningSupported`,
`isGatewayToolAllowed` (24-27); `estimateGatewayMessageCost` (28);
`persistGatewayGeneratedImageParts` from the assistant-files import list (65 —
keep the other four names); `ProviderMetadata` from `'ai'` (line 6, becomes
unused — but keep `LanguageModelUsage`, used by the shared `computeModelCost`).

Blocks to delete / collapse:

| Lines | Action |
| --- | --- |
| 89 | delete `gateway: z.enum([...]).optional()` from the body schema |
| 103-106 | collapse gateway ternary → `const reasoningLevel: ReasoningLevel = body.data.reasoning` |
| 175 | drop the `gateway: gatewayId` destructure |
| 190-203 | delete the gateway tool-allowlist check |
| 209-252 | delete the `if (gatewayId) {...} else {...}` wrapper; keep only the else body (213-251), unindented and unconditional |
| 432-445 | delete the `if (gatewayId)` branch; turn `else if (provider && model)` into `if (provider && model) {...} else { throw ... }` |
| 447-457, 502, 514 | delete `gatewayTelemetryAttributes` and both spreads |
| 525-527 | delete `vercelGatewayClient`, `gatewayMaxOutputTokens`, `gatewayPricing` locals |
| 530-782 | delete the gateway branch (530-549); convert the provider branch to `if (provider && model) { switch {...} } else { throw }`. **Every provider `case` and the `default:` (771-775) is shared and unmodified.** |
| 887-902 | delete the comment + `maxOutputTokens: gatewayMaxOutputTokens` |
| 903-907 | drop `providerMetadata`/`steps` from the `onEnd` destructure; `textCost` → `computeModelCost(modelId, telemetryProviderId, usage)` |
| 964, 972-981 | delete `streamedGatewayCost` and the `finish-step` branch maintaining it |
| 987-992, 998 | delete `gatewayCost`; `buildMessageUsage` call becomes 3-arg |
| 1010-1012 | → `const usage = usageWithImageCost` |
| 1068-1071 | drop `gatewayId`, `gatewayPricing`, `vercelGatewayClient`, `scheduleBackgroundWork` args |
| 1176-1196 | delete `sumOpenRouterStepCosts` |
| 1217-1246 | delete `resolveLiveGatewayCost` |
| 1412, 1423-1426 | narrow `supportedProviderId` to `SupportedProviderId \| undefined`; drop the four gateway interface fields |
| 1452-1462 | delete `gatewayImageResult`/`partsAfterGatewayImages`; replace uses at 1470, 1476, 1514 with `responseParts` |
| 1479, 1487 | drop the `...(gatewayImageResult?.fileIds ?? [])` spread and the `\|\| (gatewayImageResult?.fileIds.length ?? 0) > 0` disjunct |
| 1490, 1497-1505, 1511 | delete `vercelGenerationId`, `readVercelGenerationId`, the `gatewayCost` block, and the 4th `buildMessageUsage` arg |
| 1521-1523 | → `usage = usageWithImageCost` |
| 1547-1560 | delete the `persistVercelGenerationCost` scheduling block |
| 1678 (sig), 888 (call) | `buildChatInstructions` loses its 3rd `gatewayId` param; body collapses the 1683-1695 ternary to the direct-provider wording |
| 430 | narrow `errorProviderId` to `SupportedProviderId \| undefined` |

Shared and untouched: the replay-guard block (267-363, issues #263/#275),
`sanitizeMessagesForModelContext`/`convertFilesForAI` wiring, `computeModelCost`
(1252-1264), `getGeneratedImageCostFromParts` (1271-1305), `getToolInputAspectRatio`,
`buildPersistedAssistantReplayChunks`, `generationInProgressKvKey`,
`toSupportedProviderId`, `emitChatErrorLog`, and the file-linking/share-sync tail
(1562-1656).

#### `server/api/v1/chats/[slug]/title.patch.ts`

Delete the `gateway` body-schema field (20), `const gatewayId = body.data.gateway`
(74), and the `else if (gatewayId) { useGateway(...) }` branch (93-102). All seven
provider `switch` cases survive. No import removal needed (`useGateway` is a Nuxt
auto-import).

#### `server/utils/ai/message-usage.ts`

No gateway import — only the `totalCost?: number` 4th param of
`buildMessageUsage`, which exists solely to carry a gateway cost override.
Verified every call site: `index.post.ts:994`, `:1507` (both losing the arg
above) and `server/utils/research/finalize.ts:252` (already 3-arg). **Drop the
4th param from the signature** and trim the gateway sentence from the doc
comment (17-20). `addImageGenerationCostToUsage` and the research-cost helpers
are untouched.

#### `server/utils/chats/errors.ts` + `shared/types/chat-errors.d.ts`

Both: delete the `GatewayId` import (line 2 / line 1) and narrow
`providerId?: SupportedProviderId | GatewayId` → `SupportedProviderId`
(line 34 / line 32). All error classifiers are shared — zero logic changes.

Optional, non-blocking: `looksLikeImageInputRejection` (106-134) and its
`NO_ENDPOINTS_FOUND_PATTERN` were written for gateway upstream wording and
become vestigial. Harmless dead pattern-matching, not a required deletion.

#### `server/utils/files/assistant-files.ts` (629 lines)

Delete lines 199-424: the `PersistGatewayImageOutputInput` /
`PersistGatewayImageOutputResult` interfaces, `gatewayGeneratedImageFailureText`,
`gatewayNonImageFileFailureText`, `maxGatewayGeneratedImagePartsPerMessage`,
the doc comment (237-287), `persistGatewayGeneratedImageParts` (288-385), and
its private helpers `decodeBase64DataUrl` (387-418) and
`buildGatewayGeneratedImageFileName` (420-424).

> **VERIFY BEFORE DELETING.** `maxGeneratedImageBase64Length` (225-227) is
> gateway-only and goes, but it is *derived from* `maxGeneratedImageBytes`
> (line 27), which is **shared** — also read by `isImageGenerationReady`
> (line 558) for direct-provider file validation. Delete only the derived
> base64-length constant, never the byte constant.

Shared and untouched: `sanitizeMessagesForModelContext` (36-151),
`normalizeAssistantMessagePartsForPersistence` (165-197),
`getGeneratedImageFileIds` (426-453), `normalizeGeneratedImageToolParts`
(455-508), `isKnownImageGenerationModel`, `isImageGenerationReady` (519-564),
and the remaining helpers.

#### `server/utils/files/reconstruct-generated-image-parts.ts`

**Zero required code changes.** `hasOriginMetadata` already allowlists only
`originProvider === 'openai' | 'google'` (90-98), so gateway-origin files were
always excluded by design. Doc comment references the deleted
`persistGatewayGeneratedImageParts` — optional reword.

#### `server/utils/keys-rate-limit.ts`

**Zero code changes.** Generic per-route limiter keyed by `keyPrefix`, called
from the surviving `server/api/v1/profiles/keys/index.get.ts`. Doc comment
mentions gateways illustratively — cosmetic only.

#### `server/api/v1/profiles/settings/index.get.ts` and `index.patch.ts`

- `index.get.ts`: remove `favoriteGatewayModels: true` from `columns` (19) and
  `favoriteGatewayModels: settings?.favoriteGatewayModels ?? {}` from the
  return (30).
- `index.patch.ts`: remove the `GatewayId` import (1), the
  `favoriteGatewayModelIds` const (5), the `favoriteGatewayModels` body-schema
  field (21-25), the `fieldUpdates` type field (54), and the
  `if (body.data.favoriteGatewayModels !== undefined) {...}` block (82-96).

#### `server/db/schemas/keys.ts`

Remove `'vercel-gateway'`, `'cloudflare-gateway'`, `'openrouter'` from the
`provider` text enum. **Generates no migration** — the column is plain
`text NOT NULL` with no `CHECK` constraint (verified against
`.drizzle/migrations/20250617221739_fast_the_call/migration.sql:75-83` and a
repo-wide grep finding zero `CHECK` in any migration). This is the safest edit
in the plan.

`server/api/v1/profiles/keys/index.get.ts` needs **zero changes** — it iterates
`schema.keys.provider.enumValues` dynamically, so shrinking the enum
automatically stops it listing gateway providers.

#### `server/db/schemas/user-settings.ts`

Delete the `GatewayId` import (line 1) and the `favoriteGatewayModels` field
(29-30) entirely.

> **CONFLICT RESOLVED.** One analysis recommended *keeping* the column and
> merely retyping it, citing the CLAUDE.md D1 rule. That rule targets
> **Drizzle-generated table rebuilds** (default/type/constraint changes that
> emit `CREATE __new / INSERT SELECT / DROP TABLE / RENAME`). It does not
> apply to a hand-written `ALTER TABLE ... DROP COLUMN`, which SQLite ≥3.35
> performs natively without issuing `DROP TABLE` and therefore without firing
> any FK cascade. The owner's instruction is explicit removal, the column is
> unindexed, and preview is the only database holding it. **Drop the field and
> the column.** See § 2 for the runbook and § 5 for the risk note.

#### Server files needing NO changes (confirmed)

`server/utils/providers/moonshotai-web-search.ts`, `server/utils/providers/qwen.ts`
(gateway mentions are doc-comment analogies only), and all of `server/utils/ai/*`
including `tool-loop.ts`, `cost-map.ts`, `image-generation*.ts`.

### 3.D Surgical edits — client

#### `app/components/ChatInput/ModelsTrigger.vue` — the unified rail

The component is a `pickerMode: 'provider' | 'gateway'` switcher wrapping two
separate rendering paths. **Every gateway branch is paired with an already
correct direct-provider else-branch** — this is pure branch deletion, no
compensating logic needs to be written.

Delete state: `pickerMode` (363), `gatewayHighlightedOptionId` (364),
`gatewayProviderGroups` (365), `activeGatewayProviderPrefix` (366),
`isGatewayCatalogPending` (367), the `gatewayList` template ref (368), and the
`GatewayListHandle` interface (336-341).

Delete computeds: `gatewayRailItems` (390-398), `activeGateway` (415-425),
`isActiveGatewayKeyless` (427-429), `activeGatewayPrompt` (431-439),
`activeGatewayFavorites` (441-445), `selectedGatewayModelId` (453-466),
`isGatewayProviderRailVisible` (544-554).

Simplify computeds:

| Computed | After |
| --- | --- |
| `hasFavorites` (488-494) | `return favoriteModels.value.length > 0` |
| `isRailVisible` (501-503) | `return !isSearching.value` |
| `hasActiveFilters` (513-517) | drop the `\|\| !!activeGatewayProviderPrefix.value` term |
| `filterCategoryOptions` (525-529) | delete; drop the `:options` binding — `FilterDropdown`'s default is already `modelCategoryOptions` |
| `isFreeOnly` (531-533) | **delete** — `'free'` only ever appears in `gatewayModelCategoryOptions`, so it is unreachable in provider mode |
| `selectedProviderModelId` (447-451) | `return current.modelId` |
| `selectableModels` (611-619) | drop the `if (activeGateway.value) return []` guard |
| `highlightedOptionId` (645-655) | drop the gateway branch |

Delete functions: `getModeFromSelection` (690-701), `switchMode` (720-739),
`setProviderMode` (741-743), `toggleGateway` (745-751), `toggleGatewayProvider`
(791-795), `onGatewayProviderGroupsChange` (802-814), `selectGatewayModel`
(837-846), `toggleGatewayFavorite` (848-856), `onGatewayHighlight` (858-860),
`onGatewayPendingChange` (862-864).

Simplify functions: `close()` (665-673) drops the highlight reset; `toggle()`
(703-718) drops the `pickerMode` assignment and the `if (activeGateway.value)
return` guard; `clearFilters()` (783-789) drops the prefix reset; the four
`*InActiveList` wrappers (926-972) become pass-throughs — **delete them** and
have `onSearchKeydown` (974-1007) call `moveHighlight`/`highlightFirst`/
`highlightLast`/`selectHighlighted` directly; the watch at 1017-1025 drops its
guard.

Template — delete: 56-83 (gateway banner), 113-121 (`GatewayProviderRail`),
127-133 (`KeyPrompt` non-compact), 134-156 (`GatewayModelList`), 311-316
(`GatewayRail`). Simplify: 49 → `v-if="!hasAnyKey"`; 85 drop the `v-if`;
125 → `{ 'pb-9': filteredModels.length }`; 157 `<template v-else>` unwraps.

#### `app/components/ChatInput/ModelsTrigger/` — untouched files

`ProviderRail.vue`, `ModelItem.vue`, `ModelDetail.vue`, `Search.vue`,
`FilterDropdown.vue` have **zero** gateway references. `KeyPrompt.vue` needs no
change either; only its non-compact branch loses its last caller (dead but
harmless — optional follow-up, not required).

#### `app/utils/models-picker.ts` and `app/types/models-picker.d.ts`

`models-picker.ts` — delete `gatewayModelCategoryOptions` (20-27, keep
`modelCategoryOptions` at 10-18), `getGatewayProviderGroups` (203-222),
`sortGatewayModelsByProvider` (230-246), and
`formatGatewayPriceDetail`/`toPricePair`/`formatPricePerMillionTokens`
(100-164). Drop the `GatewayModel`, `GatewayProviderGroup`,
`getGatewayModelProviderPrefix` imports. Keep everything else — note
`formatModelTokenLimit` is used by `ModelDetail.vue` and
`formatRailCount`/`formatModelCount` by `ProviderRail.vue`.

`models-picker.d.ts` — delete `PickerMode` (24-26), `GatewayPickerSection`
(28-32), `GatewayProviderGroup` (34-37); narrow `ModelCategory` (line 4) to
`'chat' | 'research' | 'image-generation'`; drop the `GatewayId`/`GatewayModel`
imports.

#### `app/composables/chat-input.ts` (HIGH RISK)

Delete the `gateway-capabilities` import and the `gatewayModel` destructure from
`useSelectedModelInfo()`. Then delete only the gateway guard from each of:

- `isWebSearchSupported` (43-49) — **keep** `return !!selectedModel.value?.tools.includes('web_search')`
- `isImageGenerationSupported` (62-74) — **keep** the `tools.includes('image_generation') || isImageGenerationModel(...)` return
- `gatewayReasoningCapability` (92-113) — delete entirely
- `reasoningCapability` (115-121) — **keep** `return getReasoningCapability(selectedModel.value)`
- `selectedModelKeyOwnerId` (144-152) — **keep** `return getModel(current.modelId).provider?.id ?? null`

The direct-provider tool-gating in each surviving return is already the else-branch
today, so it keeps working verbatim.

#### Other composables

| File | Change |
| --- | --- |
| `app/composables/chat.ts` | delete `body.gateway: getSelectionGatewayId(...)` (665) and drop the now-unused `selection` from the `useUserModel()` destructure (564) |
| `app/composables/chat-title.ts` | same pattern at line 19 and the destructure at line 5 |
| `app/composables/model.ts` | `selection` customRef collapses with the `ModelSelection` union (§ 4.1); keep the `!getModel(parsed.modelId).model` validity guard — it is a second safety net for stale stored values |
| `app/composables/selected-model-info.ts` | delete the `gatewayModel` computed (14-26) and its `useGatewayCatalogCache()` call; `name`/`description`/`iconProviderId` (28-56) each lose their gateway branch; drop `gatewayModel` from the return |
| `app/composables/user-keys.ts` | **no functional change** — fully generic over `providerMeta` |
| `app/composables/user-setting.ts` | delete the `GatewayId`/`GatewayFavoriteModels` imports (1-4), `toGatewayFavoriteModels()` (7-25), `serverFavoriteGatewayModels` (60-63), `lastFavoriteGatewayModelsRequestToken` (84-87), `fallbackFavoriteGatewayModels` (151-176), `favoriteGatewayModels` (280-290), `getFavoriteGatewayModels()` (292-294), the `syncForUser()` block (349-353) and reset (369), `setFavoriteGatewayModels()` (694-756), `toggleFavoriteGatewayModel()` (758-774), the `clearUserContext()` line (785), and the four names from the return (791-816). **Keep `favoriteModels` and its whole direct-provider family untouched.** |
| `app/composables/image-input-support.ts` (HIGH RISK) | delete the `gatewayModel` destructure (14) and the gateway branch in `isImageInputSupported` (34-40). **Keep** `return selectedModel.value?.modalities?.input?.includes('image') ?? true` — the fail-open default anonymous `/shared/[slug]` viewers depend on. |

#### `app/components/ProviderIcon.vue`

Shrink `providerIconNames` (31-52) from 20 entries to the 7 direct providers
(`anthropic, deepseek, google, moonshotai, openai, qwen, xai`). The other 13
(`bytedance, cloudflare, deepgram, huggingface, ibm, meta, microsoft, mistral,
nvidia, openrouter, pipecat, vercel, zhipu`) exist solely to render vendor icons
for models routed through the Cloudflare/OpenRouter gateway catalogs — verified
unreferenced elsewhere in `app/`, `shared/`, `providers/`.

Delete `gatewayProviderPrefixIconOverrides` (63-72) and its
`cloudflareVendorIconOverrides` import (15); delete `resolvedProviderId` (79-82);
simplify `iconName` (84-86) to `return providerIconNames[props.providerId]`.
`badgeText` (88-94) is already generic — untouched.

#### `app/pages/profile/keys.vue` and `app/components/Profile/Keys/`

`keys.vue` — delete the gateway tab panel (67-91) and the
`...enabledGateways.map(...)` spread from `tabs` (138-144), leaving a
single-entry array. Drop `enabledGateways` from the import (95); keep
`providerMeta`. `enabledProviders`/`providers` untouched.

> **Design decision to surface, not to make silently.** Once `tabs` always has
> one entry, the tabs nav (13-45) renders a single always-active button. The
> minimal surgical fix above is correct and sufficient; collapsing the tab shell
> entirely is a reasonable follow-up but widens the diff beyond "delete gateway
> code." Ask the owner.

`Profile/Keys/ProviderKeyCard.vue` and `Profile/Keys/Card.vue` are **generic and
untouched** — they simply stop receiving gateway ids.

#### `app/components/Chat/ContextMenu.client.vue` — no edit required

The provider/gateway display is already fully generic (`info.providerKind`,
`info.providerLabel`, `info.providerId`), resolved upstream in
`shared/utils/message-metadata.ts` / `shared/utils/provider-meta.ts`. Grep for
"gateway" in this file returns zero hits. See § 5 for the behavioural
consequence on historical messages.

## 4. Legacy persisted data: read-side tolerance

Deleting gateway *code* does not delete gateway *data* users already created.
Three stores outlive the code and every one of them needs a defensive read
path. **These are MUST items, not nice-to-haves** — each one is a crash or a
visibly broken UI for an existing preview user on the first load after deploy.

### 4.1 Stored model selection (highest risk)

`shared/utils/model-selection.ts` serialises a gateway selection as JSON
(`{"source":"gateway","gatewayId":"openrouter","modelId":"..."}`) and a
provider selection as a bare model-id string. `parseModelSelection()` today
falls back to `{ source: 'provider', modelId: raw }` whenever the JSON is
unparseable or structurally invalid.

Once the gateway branch is deleted, a **previously stored gateway selection
still parses as JSON** but no longer matches any valid shape — and the current
fallback would hand the rest of the app a model id that is literally the raw
JSON string. That is a broken send, not a graceful degradation.

Required after-shape: any raw value starting with `{` must degrade to the
fallback model id, never to `raw`.

```ts
export function parseModelSelection(
  raw: string | null,
  fallbackModelId: string,
): string {
  if (!raw || raw.startsWith('{')) {
    return fallbackModelId
  }

  return raw
}
```

The `ModelSelection` union collapses to a bare `string` model id, so
`serializeModelSelection()` and `getSelectionGatewayId()` are deleted along
with `shared/types/model-selection.d.ts`. Call sites that destructured
`selection.source` / `selection.gatewayId` collapse accordingly.

### 4.2 Stored assistant-message metadata

Assistant messages already written to D1 carry usage/metadata JSON that can
include gateway fields (`shared/utils/message-metadata.ts`,
`shared/types/message-usage.d.ts`, and the message context-menu display).
Deleting the gateway *display* branch is correct; the *read/parse* path must
still tolerate a legacy row carrying gateway keys without throwing. Prefer
ignoring unknown fields over asserting on a narrowed union.

Verification: render an existing preview chat whose assistant messages were
produced through a gateway and confirm the context menu shows the provider
row (or degrades quietly) rather than erroring.

### 4.3 Gateway rows in `keys`

The `keys.provider` enum narrowing is TypeScript-only, so rows with
`provider IN ('vercel-gateway','cloudflare-gateway','openrouter')` survive the
code change. They are deleted from preview in § 2.4 Step 3. Production has no
such rows (no gateway key could be created without the code being deployed
there, and the feature never shipped to production).

### 4.4 Explicitly NOT done

No backfill/data-migration script that rewrites users' stored settings.
Code-side degradation above is the whole fix.

## 5. Risk flags — verify before deleting

Ordered by blast radius. Each is a place where deleting gateway code can
silently break, or silently change, a direct-provider path.

### R1. The multi-step tool loop is a DIRECT-PROVIDER feature (do not delete)

`server/utils/ai/tool-loop.ts` (`withFollowUpTurn`, `resolveToolLoopOptions`)
has zero gateway awareness, and its only producer in the entire repo is
`server/utils/providers/moonshotai-web-search.ts:249`. It sits inside the chat
send route right next to gateway code and reads as gateway machinery. It is
not. Deleting it silently breaks Moonshot AI web search.

**Verify:** `rg -n "withFollowUpTurn|requiresFollowUpTurn"` must show only
`server/utils/ai/tool-loop.ts`, `moonshotai-web-search.ts`, the send route, and
tests — no gateway file.

### R2. `maxGeneratedImageBytes` vs `maxGeneratedImageBase64Length`

In `server/utils/files/assistant-files.ts`, the base64-length constant
(225-227) is gateway-only and derived from `maxGeneratedImageBytes` (line 27),
which is **shared** — `isImageGenerationReady` (line 558) reads it for
direct-provider validation. Deleting the byte constant along with its derived
sibling silently removes direct-provider image size validation.

### R3. `@ai-sdk/openai-compatible` must STAY in `package.json`

It is imported by both the doomed `server/utils/gateways/cloudflare.ts` **and**
the surviving `server/utils/providers/qwen.ts`. Removing it breaks Qwen
entirely. Only `@ai-sdk/gateway` and `@openrouter/ai-sdk-provider` are
genuinely orphaned.

### R4. Historical gateway-served messages lose their Provider row

Once `providerMeta` drops its three gateway entries,
`resolveProviderMetaByKeyProviderId()` returns `undefined` for messages already
persisted with `MessageUsage.provider = 'openrouter' | 'vercel-gateway' |
'cloudflare-gateway'`. `ContextMenu.client.vue`'s Provider row is guarded by
`v-if="info.providerLabel"`, so it silently disappears for those messages.

Nothing throws — this is a safe degradation — but it is a **user-visible
history change**, not a no-op. Confirm the read path tolerates the legacy value
without asserting on a narrowed union (§ 4.2), and report the behaviour to the
owner rather than letting it be discovered later.

### R5. Stale `{"source":"gateway",...}` in localStorage

See § 4.1. The value lives in **browser localStorage under key `model`** (via
`usePreferenceStorage()` → `window.localStorage`, read in
`app/composables/model.ts`), not in the database — so no data migration is
possible or needed, and every existing preview user carries one until they pick
a new model. The fix must land in `parseModelSelection` itself.

`useUserModel()`'s existing `!getModel(parsed.modelId).model` guard is a useful
second net but is **not** sufficient on its own: other `parseModelSelection`
consumers do not have it.

### R6. Every gateway branch has a correct provider else-branch

Verified across `ModelsTrigger.vue` (`hasFavorites`, `isRailVisible`,
`selectableModels`, `highlightedOptionId`, `toggle()`), `chat-input.ts`
(`isWebSearchSupported`, `isImageGenerationSupported`, `reasoningCapability`,
`selectedModelKeyOwnerId`), `image-input-support.ts`
(`isImageInputSupported`), and `selected-model-info.ts` (`name`, `description`,
`iconProviderId`).

This is a pure branch-deletion task — **no compensating logic needs to be
written anywhere.** If an executor finds themselves writing new provider logic
to replace a deleted gateway branch, they have misread the code; stop and
re-check.

### R7. Dead `selection` destructures cause lint/type failures

`getSelectionGatewayId(selection.value)` is the *sole* reason `selection` is
destructured from `useUserModel()` in `app/composables/chat.ts:564` and
`app/composables/chat-title.ts:5`. Removing the call without removing the
destructure fails lint. Per the repo style rule, remove the variable entirely
rather than prefixing it with `_`.

### R8. `image-input-support.ts` serves anonymous users

It is consumed by the public `/shared/[slug]` page. Its fail-open default
(`?? true`) must survive — an anonymous viewer has no key and no session, and a
fail-closed default would break image display on shared chats.

### R9. Ordering: shared types must go LAST

`shared/types/gateways.d.ts` has 20+ non-test importers. Deleting it before its
importers are edited breaks typecheck mid-flight and makes every intermediate
state unverifiable. See the wave plan (§ 8).

## 6. Decision points (owner sign-off needed — do not decide silently)

The owner's instruction was "EVERYTHING ABSOLUTELY". These four items are
genuinely ambiguous under that instruction. Each carries a recommendation plus
the evidence behind it; the executor must not silently pick.

### 6.1 `.agents/skills/**` AI-gateway reference docs — RECOMMEND KEEP

Files: `.agents/skills/ai-sdk/references/ai-gateway.md`,
`.agents/skills/cloudflare/references/ai-gateway/{README,configuration,dynamic-routing,features,sdk-integration,troubleshooting}.md`.

**Evidence they are vendored third-party docs, not besidka feature docs:**
`skills-lock.json` records `ai-sdk` with `"source": "vercel/ai"`,
`"sourceType": "github"` and a `computedHash`, and `cloudflare` with
`"source": "cloudflare/skills"` plus its own `computedHash`.
`scripts/setup-ai-agents.mjs` (run from `postinstall`) symlinks
`.agents/skills` into `.claude/skills`, `.agent/skills`, `.windsurf/skills`.

Deleting files inside a vendored, hash-locked skill directory is a **vendoring
divergence**, not a feature removal: the next skill sync would restore them
and/or flag a hash mismatch. These docs describe the AI SDK and Cloudflare
*platforms*, which besidka still runs on — they are not evidence of a besidka
gateway feature.

Additional constraint: `.claude/skills`, `.cursor/rules`, `.windsurf/rules`,
`.windsurf/skills/*` and `.github/copilot-instructions.md` are all **git
symlinks (mode 120000)** into `.agents/`. There is no second copy to clean —
but equally, any deletion propagates to every editor surface at once.

Deleting only the `references/ai-gateway*` files would also leave dangling
internal links at `.agents/skills/cloudflare/SKILL.md:71` and `:164`, and
`.agents/skills/ai-sdk/SKILL.md:76`.

**Recommendation: keep, and exclude from the acceptance grep (§ 7).** If the
owner insists, the correct removal is to drop the whole `ai-sdk` /
`cloudflare` skills from `skills-lock.json`, not to surgically delete files
inside them.

> **Second-order effect worth raising even if we keep them.**
> `.agents/skills/ai-sdk/SKILL.md:23-24` actively instructs agents to "use the
> Vercel AI Gateway provider unless the user specifies otherwise" and to
> `curl https://ai-gateway.vercel.sh/v1/models` for model ids. Left as-is, a
> future agent will be told to reach for a gateway in a codebase that just
> removed gateway support. The clean fix is a project-level override in
> `AGENTS.md` stating that this project uses direct providers only — **not**
> editing the vendored skill.

### 6.2 Round-4 working docs — RECOMMEND DELETE `round4-*`, SURGICAL on wp8

| Doc | Lines | Gateway mentions | Character | Recommendation |
| --- | --- | --- | --- | --- |
| `docs/future/gateway-free-trial-proposal.md` | 59 | 9 | 100% a gateway proposal ("NOT built") | **Wholesale delete** — no ambiguity |
| `docs/round4-web-search-tools-plan.md` | 707 | 134 | Ephemeral round-of-work plan; § 1 is per-vendor *and* per-gateway, and it also records the Moonshot/Qwen direct-provider web-search findings | **Delete, but only after** the wave-5 executor has copied any Moonshot/Qwen findings not already present in `docs/providers.md` (§ 6.3) into it. This is a **required pre-delete step**, not an optional footnote — do not delete this file in the same action as verifying it. |
| `docs/round4-feedback.md` | 124 | 21 | Session feedback log — **but not ephemeral**: it records live, unresolved UX bugs/change-requests on the surviving direct-provider UI (remove sidebar count badges, remove the "Free" text from the cost badge, show the real direct-provider logo without "(direct)" in the context menu, add a per-provider/gateway enable-disable setting — now per-provider only, and the search-hides-sidebar bug) that the owner explicitly asked to preserve across session/context resets so "nothing is lost." Deleting it silently drops that backlog. | **Surgical edit, not delete.** Strip every gateway-only bug (the gateway sidebar tooltip bug, gateway-specific web-search/badge bugs, the gateway filter-expansion request, the gateway half of the enable-disable request) and keep every item that still applies to direct providers. Update the "Status" section to reflect that the tools/gateway work this file tracked is now moot, without erasing the still-open direct-provider items. |
| `docs/investigations/reasoning-gap-wp8.md` | 217 | 2 | A UI paint-flake investigation, essentially unrelated to gateways | **Keep, surgical** — strip the 2 gateway references only |

These are working documents rather than durable feature documentation, which
is why they are a judgement call rather than a mechanical delete.

### 6.3 `docs/gateways.md` — RECOMMEND SPLIT, NOT DELETE

This 1459-line file is **not** a gateway-only document. It splits cleanly:

- **Lines 1-397 — direct providers (MUST SURVIVE).** `## Direct providers:
  xAI, DeepSeek, Moonshot AI, Qwen`, `### Qwen: openai-compatible mechanism,
  not a dedicated SDK`, `### Web search across the direct providers`,
  `### models.dev catalog key: alibaba, not qwen`, `### Missing brand icon`.
  Deleting the file wholesale would destroy the only documentation of how Qwen
  is wired through `@ai-sdk/openai-compatible` and how Moonshot/Qwen web search
  works — all kept features.
- **Lines 398-1459 — gateways (REMOVE)**, except two sections that document
  **kept** behaviour and must be relocated into the surviving doc:
  - `### Multi-step tool loop` (line 1084) documents
    `server/utils/ai/tool-loop.ts`, `withFollowUpTurn()` and
    `resolveToolLoopOptions()` — a direct-provider feature.
  - `### No-key UX gating` (line 1164) — the first paragraph describes generic
    `useUserKeys()` provider gating that survives; only the second paragraph
    (the gateway-mode search/filter-row drop) is gateway-specific.

**Recommendation:** keep lines 1-397, fold in the two sections above, rename
the file to `docs/providers.md`, retitle it, and update the `AGENTS.md`
Project Docs bullet to point at the new path.

> **A rename alone is not enough — `docs/providers.md` must itself pass the
> § 7 acceptance grep.** The kept half still carries gateway prose: the line-1
> title is literally
> `# Providers and gateways: xAI/DeepSeek/Moonshot AI/Qwen + Vercel/Cloudflare/OpenRouter`,
> and the Qwen section (82-124) cites `server/utils/gateways/cloudflare.ts` as
> prior art for the `@ai-sdk/openai-compatible` baseURL. Retitle **and** scrub
> the in-body gateway references, or gate 5 fails on the very document you
> deliberately kept.

### 6.4 Home page and legal pages — CONFIRMED NO-OP

The owner listed "home page, legal page mentioning". Verified independently:

```
rg -i "gateway|openrouter|vercel" content/   →  no matches
```

- `content/index.md` names **no** AI providers at all — nothing to remove.
- `content/legal/privacy-policy.md` and `content/legal/cookie-policy.md`
  mention only Anthropic, OpenAI and Google — no gateway, no OpenRouter.
- `content/legal/terms-of-use.md` — no gateway mentions.

**No edit is required in `content/` for this removal.** Report this back to the
owner explicitly rather than silently skipping the item.

> **Pre-existing gap, explicitly OUT OF SCOPE.** The privacy policy names only
> three providers (Anthropic / OpenAI / Google) while the app supports seven
> (adding xAI, DeepSeek, Moonshot AI, Qwen). That staleness predates and is
> unrelated to gateways. Do **not** fix it as part of this removal; raise it
> separately.

### 6.5 Orphaned vendor SVG assets — RECOMMEND DELETE THE THREE GATEWAY ONES

Commit `59c10ad5` added six local SVGs; the icon system was then swapped to
`simple-icons:*` via `@nuxt/icon` (commit `6057b1da`), leaving all six
**unreferenced**. Verified — no `Svgo*` component usage and no path reference
anywhere outside `app/assets/icons/` itself:

| Asset | Verdict |
| --- | --- |
| `app/assets/icons/openrouter.svg` | **Delete** — gateway brand |
| `app/assets/icons/vercel.svg` | **Delete** — gateway brand |
| `app/assets/icons/cloudflare.svg` | **Delete** — added for the Cloudflare AI *Gateway*; confirm no non-gateway use first |
| `app/assets/icons/deepseek.svg` | **Leave** — direct-provider dead asset, out of scope |
| `app/assets/icons/moonshot.svg` | **Leave** — direct-provider dead asset, out of scope |
| `app/assets/icons/xai.svg` | **Leave** — direct-provider dead asset, out of scope |

`nuxt-svgo` auto-imports this directory (`nuxt.config.ts:299`
`autoImportPath: '~/assets/icons'`), so removing an unreferenced file is safe.

## 7. Verification gates (definition of done)

Run in this order. Every gate must pass before the removal is considered
complete.

```bash
pnpm install                       # regenerates pnpm-lock.yaml after the
                                   # package.json dependency removals
pnpm run format && pnpm run typecheck
pnpm vitest run
pnpm run db:generate               # MUST produce no new migration
```

**Gate 4 is the important one.** `pnpm run db:generate` producing zero new
migration files is the proof that deleting the tail migration directory *and*
removing `favoriteGatewayModels` from the schema left the drizzle snapshot
chain self-consistent. If it emits a migration, something is out of sync —
stop and reconcile rather than committing the generated file.

**Gate 5 — acceptance grep.** This operationalises the owner's "everything is
gone":

```bash
rg -i "gateway|openrouter|vercel-gateway" \
  -g '!node_modules' -g '!pnpm-lock.yaml' -g '!.agents' \
  -g '!skills-lock.json' -g '!docs/gateway-removal-plan.md'
```

Expected result: **no hits**. Deliberately excluded residue, each justified in
§ 6 (Decision points):

| Excluded path | Why |
| --- | --- |
| `.agents/skills/**` | Vendored third-party platform reference docs (AI SDK, Cloudflare), not besidka feature docs |
| `skills-lock.json` | Lockfile for the above; editing it diverges from upstream vendoring |
| `pnpm-lock.yaml` | Regenerated by `pnpm install`; transitive packages may still mention gateways |
| `docs/gateway-removal-plan.md` | This document |

Also re-run without the `.agents`/`skills-lock.json` exclusions and confirm
every remaining hit falls inside those two paths — if a hit appears anywhere
else, it was missed.

## 8. Execution plan — wave structure

The ordering constraint is **consumers before producers**: a wholesale-delete
module cannot go until every importer has stopped importing it, or typecheck
breaks mid-flight and no intermediate state is verifiable.

Importer counts driving the order (non-test, measured):

| Module | Non-test importers |
| --- | --- |
| `shared/types/gateways.d.ts` | 20+ |
| `server/utils/gateways/*` | 12 |
| `shared/utils/gateway-capabilities.ts` | 5 |
| `shared/utils/gateway-model-id.ts` | 5 |
| `shared/utils/gateway-pricing.ts` | 4 |
| `app/composables/gateway-catalog.ts` | 2 |

### Wave 1 — leaf surgical edits (fully parallel)

No file in this wave imports another file in this wave. Safe to fan out to
independent agents. **Typecheck will not pass at the end of this wave** — that
is expected; the gateway modules still exist.

| Agent | Files |
| --- | --- |
| 1a | `server/api/v1/chats/[slug]/index.post.ts` (largest; give it its own agent) |
| 1b | `server/api/v1/chats/[slug]/title.patch.ts`, `server/utils/ai/message-usage.ts`, `server/utils/chats/errors.ts`, `server/utils/files/assistant-files.ts` |
| 1c | `server/api/v1/profiles/settings/index.{get,patch}.ts`, `server/db/schemas/keys.ts`, `server/db/schemas/user-settings.ts` |
| 1d | `app/components/ChatInput/ModelsTrigger.vue` (largest client file; own agent) |
| 1e | `app/utils/models-picker.ts`, `app/types/models-picker.d.ts`, `app/components/ProviderIcon.vue` |
| 1f | `app/composables/{chat-input,chat,chat-title,selected-model-info,user-setting,image-input-support}.ts` |
| 1g | `app/pages/profile/keys.vue` |

**Model tiering:** 1a and 1d on Opus (large, judgement-heavy, high blast
radius). 1b, 1c, 1e, 1f, 1g on Sonnet — each has a precise spec in § 3 and
needs no discovery.

### Wave 2 — shared collapse (sequential, single agent)

Depends on wave 1. Collapse `shared/utils/model-selection.ts` +
`shared/types/model-selection.d.ts` per § 4.1, and strip gateway entries from
`shared/utils/provider-meta.ts`, `shared/utils/message-metadata.ts`,
`shared/types/message-usage.d.ts`, `shared/types/chat-errors.d.ts`.

Single agent, Sonnet. These files interlock — parallelising them causes
conflicting edits to the same union types.

### Wave 3 — wholesale deletes (parallel)

Only now are all importers gone. Delete everything in § 3.A and § 3.B, plus
`.drizzle/migrations/20260809021640_vengeful_lifeguard/`.

Two agents, Haiku or Sonnet — this is mechanical `rm`, no judgement.

### Wave 4 — tests and tooling (parallel)

Delete the gateway spec files, surgically edit the mixed ones, and remove the
gateway groups from `scripts/test-affected-check.mjs`.

> **Do not defer the `test-affected-check.mjs` edit.** Per CLAUDE.md, every test
> file must be registered there. Leaving stale gateway mappings pointing at
> deleted source paths desyncs CI. This edit belongs in the same wave as the
> test deletions.

### Wave 5 — dependencies, docs, config (parallel)

- `package.json`: remove `@ai-sdk/gateway` and `@openrouter/ai-sdk-provider`.
  **Keep `@ai-sdk/openai-compatible`** (R3). Then `pnpm install` to regenerate
  `pnpm-lock.yaml` — never hand-edit the lockfile.
- `AGENTS.md` (`CLAUDE.md` is a symlink to it — editing one edits both):
  rewrite line 3 and the `docs/gateways.md` bullet at 200-203.
- Docs per § 6.2 and § 6.3. **Required order:** first fold the kept half of
  `docs/gateways.md` into `docs/providers.md` (§ 6.3), then diff
  `docs/round4-web-search-tools-plan.md`'s Moonshot/Qwen findings against it and
  copy over anything missing, and only then delete
  `docs/round4-web-search-tools-plan.md`. Surgically trim
  `docs/round4-feedback.md` per § 6.2 — do not delete it.
- `providers/merge.ts`: delete the stale `resolveGatewayPriceTier()` comment
  reference near lines 105-106 per the repo's no-stale-comment rule.

### Wave 6 — verification (sequential, single agent)

Run every gate in § 7 in order. Only after all gates pass and the branch is
pushed does the preview database runbook (§ 2.4) execute — see the ordering
gate there.

### Suggested AGENTS.md replacement text

Line 3, current:

> Users bring their own API keys for LLM providers (Anthropic, Google, OpenAI,
> xAI, DeepSeek, Moonshot AI) and gateways (Vercel AI Gateway, Cloudflare AI
> Gateway, OpenRouter) and pay for what they use — see `docs/gateways.md`.

Replacement (note it also fixes the pre-existing omission of Qwen):

> Users bring their own API keys for LLM providers (Anthropic, Google, OpenAI,
> xAI, DeepSeek, Moonshot AI, Qwen) and pay for what they use — see
> `docs/providers.md`.

Replace the `docs/gateways.md` bullet (200-203) with a `docs/providers.md`
bullet describing the direct-provider content that survives per § 6.3.

## 9. Dependency removal — set expectations correctly

`package.json` removals:

| Package | Action | Reality check |
| --- | --- | --- |
| `@ai-sdk/gateway` (`^4.0.46`, line 67) | **remove from `package.json`** | **It will NOT leave `pnpm-lock.yaml` or `node_modules`.** It is also a transitive dependency of `ai@7.0.56` (which stays) and of `nuxt-studio@1.7.0`. Removing the direct dep drops exactly one lock entry (`4.0.46`); versions `4.0.44` and `3.0.155` remain via those parents. Expect **no bundle-size win**. |
| `@openrouter/ai-sdk-provider` (`^3.0.0`, line 90) | **remove** | No transitive dependents — fully leaves the lockfile. |
| `@ai-sdk/openai-compatible` (`^3.0.27`, line 71) | **KEEP** | Used by the surviving `server/utils/providers/qwen.ts` as well as the deleted Cloudflare gateway. Removing it breaks Qwen (R3). |

There is no Cloudflare-AI-Gateway npm package — that integration was raw
`fetch` plus `@ai-sdk/openai-compatible`, so nothing else to remove.

After editing `package.json`, run `pnpm install` to regenerate the lockfile.
**Never hand-edit `pnpm-lock.yaml`.**

> Because `@ai-sdk/gateway` survives transitively, the acceptance grep in § 7
> must keep excluding `pnpm-lock.yaml` — a hit there is expected, not residue.

## 10. Dangling cross-references to delete

### 10.1 `see docs/gateways.md` comments in files that SURVIVE

Nine source files carry a `docs/gateways.md` pointer. Seven are in files being
deleted anyway. **Two are in surviving files** and become dangling references
the moment that doc is renamed or trimmed (§ 6.3):

- `server/utils/chats/errors.ts:121`
- `server/utils/files/assistant-files.ts:273`

Repoint both at `docs/providers.md` or delete the reference, per the repo's
no-stale-comment rule.

### 10.2 Other dangling references in surviving files

| File | Line(s) | Reference |
| --- | --- | --- |
| `providers/merge.ts` | 105-106 | comment pointing at `resolveGatewayPriceTier()` in the deleted `shared/utils/gateway-pricing.ts`. **Comment only — no code dependency.** Delete it. |
| `server/utils/providers/qwen.ts` | 17-18 | comment citing `gateways/cloudflare.ts` as prior art for the OpenAI-compatible baseURL. Reword; the Qwen code itself is independent. |
| `server/utils/providers/moonshotai-web-search.ts` | 96-104 | comments citing `gateways/catalog.ts` as the caching pattern mirrored. Reword. |
| `server/utils/keys-rate-limit.ts` | 13, 15 | doc comment referencing the gateway catalog route. Reword. |
| `server/utils/ai/message-usage.ts` | 17-18 | `totalCost` gateway-override comment. Delete with the param (§ 3.C). |
| `shared/utils/message-metadata.ts` | 187-189 | blended-gateway-cost comment. Reword. |
| `server/utils/files/reconstruct-generated-image-parts.ts` | 84 | comment on `originProvider: 'openrouter'/'vercel-gateway'`. Reword. |
| `tests/fixtures/follow-up-turn-tool.ts` | 18 | comment. Reword. |

### 10.3 Docs with gateway sections in otherwise-surviving files

| File | Lines | What to remove |
| --- | --- | --- |
| `docs/auth-security.md` | 194, 203-204, 214-219, 232-233 | the rate-limit budget table rows for the **nine** gateway key routes plus the gateway `keyPrefix` design rationale. Keep the direct-provider rows and the general design note. |
| `docs/models-data-fetching.md` | 15 | two gateway references in the curated-vs-dynamic catalog description |
| `docs/investigations/reasoning-gap-wp8.md` | 2 hits | strip the references; the doc is otherwise unrelated (§ 6.2) |
| `AGENTS.md` | 3, 200-203 | see § 8 for replacement text |

### 10.4 Four independent hardcoded copies of the gateway id union

The union is duplicated in four places, so a grep for one form misses the
others. All four go:

1. `shared/types/gateways.d.ts:1` — `GatewayId` (file deleted)
2. `shared/utils/model-selection.ts:4` — `const gatewayIds: GatewayId[] = ['vercel','cloudflare','openrouter']`
3. `server/api/v1/chats/[slug]/index.post.ts:89` — `z.enum(['vercel','cloudflare','openrouter'])`
4. `server/api/v1/chats/[slug]/title.patch.ts:20` — same `z.enum`

(A fifth lives in `server/api/v1/gateways/[gateway]/models.get.ts:41`, in a
file being deleted wholesale.)

## 11. Surgical edits — shared layer (wave 2)

These files interlock through the same union types. Edit them together, in one
agent, after wave 1.

### `shared/utils/model-selection.ts` + `shared/types/model-selection.d.ts`

Collapse the union to a bare model-id string per § 4.1. Delete
`shared/types/model-selection.d.ts`, `toGatewaySelection()`, `isGatewayId()`,
the `gatewayIds` const (line 4 — the second of four hardcoded copies of the
union, § 10.4), `serializeModelSelection()` and `getSelectionGatewayId()`.

`parseModelSelection()` keeps its name and its two-argument shape but must
degrade a `{`-prefixed raw value to `fallbackModelId` (§ 4.1) — this is the
single most important line in the whole removal.

### `shared/utils/provider-meta.ts`

| Lines | Action |
| --- | --- |
| 1 | delete the `GatewayId` import |
| 4 | drop `'gatewayId'` from the `ProviderMetaKeyField.name` union |
| 12 | `kind: 'provider' \| 'gateway'` becomes single-valued — see the note below |
| 90-98 | delete the `vercel` entry (incl. the hardcoded `vercel.com/d?to=…ai-gateway…` URL) |
| 99-106 | delete the `openrouter` entry (incl. `openrouter.ai/settings/keys`) |
| 107-129 | delete the `cloudflare` entry (incl. the dashboard URL and its `accountId` + `gatewayId` key fields) |
| 149-166 | delete the `enabledGateways` export — consumers are `app/pages/profile/keys.vue:68` and the picker rail, both edited in wave 1 |

> **`kind` and `resolveProviderMetaByKeyProviderId()` — do NOT collapse them
> in the same pass.** `resolveProviderMetaByKeyProviderId()` (132-147) exists
> only because of the gateway id/suffix mismatch (`vercel-gateway` ≠ `vercel`),
> and after removal every persisted `MessageUsage.provider` equals its
> `providerMeta` key, making the indirection dead weight. But it is still
> called by message-usage rendering, and `kind` still drives
> `ContextMenu.client.vue`'s `'(direct)'` label. Collapsing them is a
> **separate refactor** with its own review — doing it inside this removal
> widens the blast radius onto message history rendering (R4). Leave both in
> place; note them as follow-up.

### Remaining shared files

| File | Action |
| --- | --- |
| `shared/types/chat-errors.d.ts` | lines 1, 32 — delete the `GatewayId` import, narrow `providerId?: SupportedProviderId \| GatewayId` → `SupportedProviderId`. **`ChatErrorCode` (4-23) is clean** — no gateway-named error code exists. |
| `shared/types/message-usage.d.ts` | lines 15-18 — comment-only gateway reference on `totalCost`. **Keep the field** (direct providers use it); fix the comment. |
| `shared/utils/message-metadata.ts` | lines 187-189 — blended-gateway-cost comment; reword. Verify the parse path tolerates legacy gateway values (R4 / § 4.2). |
| `shared/types/providers.d.ts` | verify against the branch diff; no gateway type is expected to live here. |
| `shared/utils/chat-test-errors.ts` | modified on this branch — verify for gateway coupling. |

## 12. Tests (wave 4)

46 test files reference gateway concepts. Baseline for cross-checking whoever
executes this:

```bash
rg -c -i "gateway|openrouter|vercel" tests/ | sort -t: -k2 -rn
```

### 12.1 Wholesale delete

```
tests/integration/api/chats-gateway.spec.ts
tests/integration/api/gateways-models.spec.ts
tests/integration/api/profile-keys-cloudflare-gateway.spec.ts
tests/integration/api/profile-keys-vercel-gateway.spec.ts
tests/integration/api/profile-keys-openrouter.spec.ts
tests/unit/components/ChatInput/ModelsTrigger/GatewayModelDetail.spec.ts
tests/unit/components/ChatInput/ModelsTrigger/GatewayModelItem.spec.ts
tests/unit/components/ChatInput/ModelsTrigger/GatewayProviderRail.spec.ts
tests/unit/components/ChatInput/ModelsTrigger/GatewayRail.spec.ts
tests/unit/components/Profile/Keys/CloudflareGateway.spec.ts
tests/unit/utils/gateway-capabilities.spec.ts
tests/unit/utils/gateway-catalog-normalize.spec.ts
tests/unit/utils/gateway-model-id.spec.ts
tests/unit/utils/gateway-pricing.spec.ts
tests/unit/utils/gateways/cloudflare.spec.ts
tests/unit/utils/gateways/index.spec.ts
tests/unit/utils/gateways/openrouter.spec.ts
tests/unit/utils/gateways/vercel.spec.ts
```

Then remove the now-empty `tests/unit/utils/gateways/` and
`tests/unit/components/ChatInput/ModelsTrigger/` gateway specs' parent if empty.

### 12.2 Surgical — high gateway density (verify carefully)

`tests/unit/components/ChatInput/ModelsTrigger.spec.ts` (101 refs),
`tests/unit/composables/chat-input.spec.ts` (93),
`tests/unit/composables/user-setting.spec.ts` (52),
`tests/unit/composables/model.spec.ts` (48),
`tests/unit/utils/models-picker.spec.ts` (34),
`tests/unit/components/ChatInput/ModelsTrigger.keys.spec.ts` (34).

These mirror the wave-1 source edits one-for-one: every gateway `describe`/`it`
goes, every direct-provider one stays.

### 12.3 Surgical — low gateway density

`tests/integration/server/assistant-files.spec.ts` (32),
`tests/integration/api/profile-settings.spec.ts` (32),
`tests/unit/utils/message-metadata.spec.ts` (21),
`tests/unit/composables/user-keys.spec.ts` (21),
`tests/integration/api/chats-single-step-characterization.spec.ts` (20),
`tests/unit/utils/provider-meta.spec.ts` (19),
`tests/unit/pages/profile/keys.spec.ts` (19),
`tests/unit/composables/selected-model-info.spec.ts` (19),
`tests/integration/api/chats-title.spec.ts` (13),
`tests/integration/api/chats-tool-loop.spec.ts` (12),
`tests/unit/components/Profile/Keys/ProviderKeyCard.spec.ts` (8),
`tests/integration/api/profile-keys-summary.spec.ts` (7),
`tests/unit/components/ProviderIcon.spec.ts` (4),
`tests/unit/components/Chat/ContextMenu.client.spec.ts` (4),
`tests/integration/server/reconstruct-generated-image-parts.spec.ts` (4),
`tests/unit/utils/message-usage.spec.ts` (3),
`tests/unit/composables/chat.spec.ts` (2),
`tests/unit/utils/ai/tool-loop.spec.ts` (1),
`tests/integration/api/chats-{project-instructions,message-id-stream,duplicate-message}.spec.ts` (1 each),
`tests/fixtures/follow-up-turn-tool.ts` (1, comment only).

### 12.4 Tool-loop tests — MUST SURVIVE, and two need REWIRING (confirmed)

These cover the **direct-provider** multi-step tool loop (R1), a surviving
feature. **This is the highest-effort task in wave 4** — budget for it.

| File | Verdict |
| --- | --- |
| `tests/unit/utils/ai/tool-loop.spec.ts` | **Clean.** Its single "gateway" hit is a test-only string literal — a tool id `'gateway.perplexitySearch'` at line 43. Rename it or leave it; no structural change. |
| `tests/fixtures/follow-up-turn-tool.ts` | **Clean.** Provider-agnostic fixture. Only a doc comment mentions gateways, and it is now **stale** — it says "no real tool sets `withFollowUpTurn()` yet — the first will arrive with Moonshot's Formula-API search", which has since landed. Reword. |
| `tests/integration/api/chats-tool-loop.spec.ts` | **REWIRE — do not delete.** |
| `tests/integration/api/chats-single-step-characterization.spec.ts` | **MIXED — split, do not delete.** |

#### `chats-tool-loop.spec.ts` — rewire to a direct-provider mock

It drives the surviving tool loop **entirely through gateway infrastructure**:

- lines 5-8 — imports `keyProviderIdForGateway`, `readOpenRouterCost`,
  `readVercelGenerationId` from `server/utils/gateways/index` (**deleted**)
- line 78 — mocks `persistGatewayGeneratedImageParts` (**deleted**)
- line 111 — `return { openrouter: { usage: { cost } } }`
- line 224-225 — request body `model: 'openai/gpt-5'`, `gateway: 'openrouter'`
- line 256 — `vi.stubGlobal('useGateway', ...)`
- lines 355-357 — stubs the three deleted gateway utils

Rewire the send to a **direct provider** (Moonshot AI is the natural choice —
it is the only real producer of the `requiresFollowUpTurn` marker) with a bare
provider model id and no `gateway` field, and drop all six gateway couplings
above.

**Delete outright:** the `it('sums the per-step openrouter cost across the
whole loop', ...)` block at line 409 — it tests `sumOpenRouterStepCosts`,
which is itself deleted (§ 3.C).

Deleting this whole file instead of rewiring it would silently drop **all**
integration coverage of a feature that survives. Do not take that shortcut.

#### `chats-single-step-characterization.spec.ts` — split

The direct-provider cases survive and must keep passing (`model: 'gpt-5-mini'`
at 233/385, `model: 'qwen3.7-plus'` at 423). The gateway cases go:

- lines 4-8 — the `server/utils/gateways/index` import (incl. `useGateway`)
- line 153 — the `persistGatewayGeneratedImageParts` mock
- lines 342-345 — the four `vi.stubGlobal` gateway calls in `beforeEach`
- `it('(c) openrouter web-search send stays single step...')` (441+) and
  `it('(c2) openrouter send without a reported cost...')` (468+)

Removing the `beforeEach` stubs while leaving the provider cases intact is the
delicate part — run this file on its own after editing.

### 12.5 `scripts/test-affected-check.mjs`

Remove the gateway mappings in the **same wave** as the test deletions (see
wave 4 note). Gateway blocks are at approximately:

- lines 104-107 (picker gateway component specs), 133 (`gateway-pricing.spec.ts`)
- lines 318-324 (`gatewayCatalogTests` array)
- lines 326-342 (`gatewayChatTests` array + key-route specs)
- lines 413, 462-463, 484 (the regex
  `^(server\/utils\/gateways\/…|shared\/utils\/gateway-(pricing|model-id|capabilities)\.ts)$`),
  487-488, 493-494, 499
- lines 788, 799, 838, 1002

Verify each line range against the file before editing — these are approximate
and the file is long. The direct-provider mappings in the same arrays must
survive.

## 13. `docs/auth-security.md` — precise edit spec

Two whole sections are gateway-specific, but the second one also documents a
**surviving** shared mechanism. Do not delete it wholesale.

### Delete: lines 181-198 — "Reused outside Better Auth: the gateway catalog route"

The entire section documents `GET /api/v1/gateways/[gateway]/models`, a route
being deleted. Nothing in it survives.

### Rewrite: lines 200-236 — "the gateway key-management routes"

This section documents `server/utils/keys-rate-limit.ts`, which **survives**,
and its rate-limit table contains one row that must stay:

| Table row | Verdict |
| --- | --- |
| `GET /api/v1/profiles/keys` (line 213) | **KEEP** — the summary endpoint survives |
| `GET/POST/DELETE /api/v1/profiles/keys/vercel-gateway` (214-216) | delete |
| `GET/POST/DELETE /api/v1/profiles/keys/openrouter` (217-219) | delete |

Retitle the section (it is no longer about gateways), keep the
`createAuthRateLimitStorage()` / `keys-rate-limit.ts` rationale and the
per-route `keyPrefix` design note, and drop the gateway-specific justification
prose ("each gateway card issues one `GET` on page load", "loading both gateway
cards at once", the comparison to the deleted catalog rule).

**Keep the closing paragraph** (lines ~238+) noting that the seven
single-provider key routes remain un-rate-limited and that extending them is a
follow-up — that statement is still true and still relevant.

## 14. Verified-clean surfaces (negative findings)

Recorded so nobody re-searches them. Each was checked explicitly.

| Surface | Result |
| --- | --- |
| `content/index.md`, `content/legal/*.md` | zero gateway hits (§ 6.4) |
| `i18n/locales/*` | only `cookie-consent.{en,uk}.ts`; zero gateway strings |
| CSS / Tailwind / safelist / theme tokens | zero hits |
| `.dev.vars.example`, `.dev.vars*`, `wrangler.jsonc` vars/secrets/bindings, `nuxt.config.ts` `runtimeConfig` | zero gateway env vars — gateway credentials were user-supplied and stored encrypted in D1, never in env |
| `.github/workflows/*.yml` | zero gateway hits; no gateway-specific job, step or env var |
| `public/` (incl. `ai.txt`, `manifest.webmanifest`) | zero hits |
| `providers/data/models-dev-snapshot.json` | zero `openrouter` occurrences |
| `modules/` (incl. `modules/cookie-consent`) | zero hits |
| `vitest.config.*`, `eslint.config.*`, `tsconfig*`, `playwright.config.ts`, `content.config.ts`, `drizzle.config.*` | zero hits |
| `tests/e2e/**` | zero gateway references — no e2e coverage to remove |
| `shared/types/providers.d.ts` | **clean** |
| `shared/utils/chat-test-errors.ts` | **clean** |
| `providers/` tree | clean except the two-line comment at `providers/merge.ts:105-106` (§ 10.2) — **no code dependency** |
| `ChatErrorCode` union | no gateway-named error code |
| `tests/setup/mocks/cloudflare*.ts` | zero gateway references (Workers platform mocks) |
| `nuxt-svgo` config | directory glob, not a file list — no change needed when deleting assets |
| `index.d.ts`, `env.d.ts` | clean (`env.d.ts`'s `cloudflare:` is the Workers binding context) |

### `cloudflare` and `vercel` disambiguation

Both words are ambiguous in this repo. **Platform usages that must stay:**

- `nuxt.config.ts` — `preset: 'cloudflare_module'`, `nitro.cloudflare`,
  `driver: 'cloudflare-kv-binding'`
- `wrangler.jsonc` — entirely (verified zero gateway hits)
- `@cloudflare/workers-types`, `env.d.ts` `H3EventContext.cloudflare`
- `app/composables/turnstile.ts:1` — Turnstile, not AI Gateway
- `.github/workflows/*` — `cloudflare/wrangler-action@v4`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
- `server/api/v1/chats/[slug]/index.post.ts:471, 505-509` —
  `attachCloudflareMeta()` (edge geo metadata)
- **"Vercel AI SDK"** in `README.md:30`, `AGENTS.md:213`, `docs/cookie-consent.md`,
  `docs/deep-research.md`, `docs/files.md`, `docs/chats/files-generation-*.md` —
  this is the `ai` package's brand name, **not** the gateway. Leave every one.
- All `@ai-sdk/*` packages except `@ai-sdk/gateway`

Vercel is **not** a deploy target for this project (Cloudflare Workers only),
so there is no ambiguity in that direction.

## 15. Open verification items for the executor

Things this plan asserts from analysis that the executor should confirm
in-flight rather than trust blindly:

1. ~~`tests/integration/api/chats-tool-loop.spec.ts` mock type~~ —
   **RESOLVED at plan time.** It drives the loop through a gateway mock and
   must be **rewired to a direct-provider mock**, and
   `chats-single-step-characterization.spec.ts` must be **split**. Both are
   fully specified in § 12.4. No further investigation needed.
2. **`app/assets/icons/cloudflare.svg`** (§ 6.5) — confirmed unreferenced, but
   re-grep for a dynamic string reference before deleting.
3. **`scripts/test-affected-check.mjs` line numbers** (§ 12.5) — verified by
   grep at plan time; re-check before editing since the file is long and every
   deletion shifts subsequent lines.
4. **`shared/utils/message-metadata.ts` legacy tolerance** (§ 4.2 / R4) — render
   an existing preview chat with gateway-served assistant messages and confirm
   nothing throws.
5. **`providers/merge.ts`** — confirmed comment-only, but re-verify there is no
   runtime import of `gateway-pricing` before deleting that file.
6. Whether the single-tab keys page shell should be collapsed (§ 3.D) — owner
   decision, not an executor decision.
