# Memory architecture (profile, project, cross-chat, knowledge)

Status: **proposal**, 2026-10-24, partly implemented: section 1 lists what
exists today, and the "As built" notes in 3.3, 3.10 and section 5 record W1-W3.
Decisions marked **(owner)** are
recommendations logged per the "minimize questions" preference; the owner can
overturn any of them before the phase that depends on it starts.

Goal: make Besidka feel like Claude.ai / ChatGPT memory — a chat can know what
other chats know, "tell me everything you know about me" works, projects get
categorised memory plus knowledge files — without blowing the per-turn token
budget (the user pays every token with their own key) and with hard,
code-enforced compliance rules for sensitive data.

## 1. Where we are (audit, HEAD ffaccd56)

Exists today:

- **Project instructions** — `projects.instructions`, 10k chars, always
  injected (`server/utils/projects/instructions.ts`).
- **Project memory** — one LLM-written plain-text blob in `projects.memory`
  (`server/utils/projects/memory.ts`), per-chat summaries cached on
  `chats.projectMemorySummary`, two-stage refresh (per-chat summary, then
  merge), on the user's BYOK key, models flagged `forProjectMemory` (only
  `gemini-3.1-flash-lite`, `gpt-6-luna`).
- **Full-text chat search** — FTS5 `message_search(owner, body, body_stem)`
  with a Ukrainian stemmer, bm25 + `snippet()`, hourly backfill/GC sweeper
  (`docs/history/content-search.md`). Used only by the history UI.
- **Tools** — native/Brave/Exa web search, `generate_image`; tool loop capped
  at `TOOL_LOOP_MAX_STEPS = 4` (`server/utils/ai/tool-loop.ts`), client-chosen
  closed enum `chatToolSchema`.

Gaps and bugs found:

| # | Finding | Where |
|---|---|---|
| G1 | **Fixed in W1.** Project memory is injected only when `memoryStatus === 'ready'`; every user message flips it to `stale`, so memory vanishes from the prompt until the client-triggered refresh finishes. | `instructions.ts:27`, `persist-user-message.ts:153` |
| G2 | **Fixed in W1.** Refresh is one synchronous HTTP request over **all** messages of **all** chats in the project, unbounded input, unbounded output. | `memory.ts:122-251` |
| G3 | **Fixed in W1.** A Worker dying mid-refresh leaves `refreshing` forever; refresh returns early on that status and nothing sweeps it. Now a live KV lease decides, and a `refreshing` row without one is reported as `stale` on read. Final writes never override `disabled`, a message arriving mid-pass keeps the project `stale` (detected by comparing `memoryDirtyAt` with its start-of-pass snapshot; a second message in the same second as the existing marker is missed, an accepted limitation), and the 20-chat window never wipes existing memory when it yields nothing. The lease get/put is not atomic and the first finisher deletes the key (no owner token), an accepted limitation shared with the generation guard. | `memory.ts`, `memory-lease.ts` |
| G4 | **Fixed in W1.** Anthropic/xAI/DeepSeek/Moonshot/Qwen-only users get `unavailable`. | `resolveProjectMemoryModel` |
| G5 | Memory is not editable, not categorised, no provenance, on by default and silently spends the user's key. | `MemoryCard.vue`, schema default `idle` |
| G6 | No account-level memory, no "about me", no custom instructions. | `user_settings` |
| G7 | No cross-chat path at all outside a project's blob; FTS index is never exposed to the model. | — |
| G8 | No project files; files have no `projectId`. | `server/db/schemas/files.ts` |
| G9 | No GDPR export endpoint. | — |
| G10 | Full text history is resent every turn with no budgeting (out of scope here, but memory must not add to it unboundedly). | `chats/[slug]/index.post.ts` |

## 2. How Claude.ai does it (observed 2026-10-24)

From the owner's own account in the built-in browser (Settings → Memory, and
the `melange/*` API the page calls):

- Memory is a **virtual filesystem of small Markdown files**:
  `/profile.md` (category `you`), `/preferences.md`, `/areas/<slug>.md`,
  `/topics/<slug>.md`, `/people/<slug>.md`, and per project
  `/projects/<uuid>/index.md`, `/projects/<uuid>/areas/<slug>.md`.
- Each file: `display_name`, **one-line `description`** (the retrieval index,
  e.g. "read when drafting posts for Threads or Telegram"), `size_bytes`
  (observed 0.2–3.5 KB), `updated_at`, `category_id`, `project_uuid`.
- UI: list grouped You / Topics / …; each entry shows Summary + bullet Details
  + Delete; one global "Tell Claude what to change" box edits memory in natural
  language.
- Toggles: *Search and reference chats*, *Generate memory from chats*,
  *Include sensitive topics in memory*, *Import memory from other AI
  providers*. Project memory modal has *Use account memory*.
- A separate `sensitive_cleanup` job exists — sensitive filtering is
  write-time policy **plus** an after-the-fact purge.
- Project copies of account files say "project copy; main file at
  /areas/x.md": project memory forks, it does not reference.

Public docs (support.claude.com, claude.com/blog/memory) add: chat search is
RAG behind a visible tool call, never crosses project boundaries, incognito
chats are never searched or remembered; sensitive categories (health, race,
ethnicity, religion, politics, gender identity…) are off by default; ID
numbers, criminal history, financial account numbers and immigration status
are **never** stored even on request; deleting a chat does **not** delete the
memory derived from it (a gap we can beat). Reverse-engineered reports
(Manthan Gupta) describe `conversation_search` / `recent_chats` tools and a
`<userMemories>` block — treat as unofficial.

ChatGPT (reported): saved memories (explicit facts via a store tool) +
"reference chat history" (summaries of ~15 recent chats injected, no RAG),
project-only memory mode chosen at project creation.

## 3. Target model

Four layers, cheapest first. Each layer is independently useful and
shippable.

```
 per turn, always (cached prefix, ≤ ~2.5k tokens)
 ┌──────────────────────────────────────────────────────────────┐
 │ memory index: profile + preferences bodies,                  │
 │ every other entry as "title — description" only              │
 │ (project scope: project entries [+ account entries if on])  │
 └──────────────────────────────────────────────────────────────┘
 on demand, via tools (model decides)
   memory_read(id) / memory_list(category?)  → full entry bodies
   search_chats(query, scope)                → FTS5 snippets + chat links
   read_chat(chatId, around?)                → bounded excerpt
   search_project_knowledge(query)           → chunk hits (large projects)
 written by
   user (UI edit, "tell what to change"), memory_write tool on explicit
   user request, background extraction sweep
```

### 3.1 Memory entries (replaces the project blob, adds account memory)

New table `memory_entries`:

| Column | Notes |
|---|---|
| `id` | public id |
| `userId` | owner; see 3.7 on FK |
| `projectId` | null = account scope; set = project scope |
| `category` | `profile` \| `preferences` \| `areas` \| `topics` \| `people` |
| `slug`, `title` | unique per (user, project, category, slug) |
| `description` | **mandatory, single line, ≤ 100 chars** — the index line |
| `body` | Markdown, **≤ 2 KB** hard cap |
| `sensitivity` | `none` \| `special` (GDPR Art. 9 category) |
| `sensitiveCategory` | which Art. 9 category, nullable |
| `origin` | `user` \| `tool` \| `extraction` \| `import` |
| `sourceChatIds` | JSON array — provenance + deletion cascade (3.7) |
| `sourceMessageId` | for tool writes / undo |
| `createdAt`, `updatedAt`, `lastUsedAt` | `lastUsedAt` drives expiry |

Caps: ≤ 30 account entries, ≤ 15 per project (soft: the extractor must merge
before creating); `profile` and `preferences` bodies ≤ 1 KB each since they
are always injected. "Everything you know about me" = `memory_list()` → at
most ~30 × 2 KB ≈ 15k English tokens worst case, typical 4–8k, paid only when
asked.

**Cyrillic multiplier**: Ukrainian tokenizes at roughly 2–3 chars/token versus
~4 for English, so the same bytes cost ~1.5–2× the tokens. The owner's primary
language is the expensive one; every budget below is stated in tokens and the
index builder measures, not estimates, by character count with a per-script
factor.

`user_settings` gains (ALTER ADD COLUMN, **no SQL DEFAULT**, defaults in app
code — see the D1 rebuild rule in CLAUDE.md): `memoryEnabled`,
`chatSearchEnabled`, `memoryIncludeSensitive`, `aboutMe` (free-text custom
instructions, 4k chars). `projects` gains `useAccountMemory`.

Existing `projects.memory` blob: migrated lazily into one `topics/overview`
project entry on first read; the column is left in place and writes stop
(never dropped — no rebuild).

### 3.2 Injection and prompt caching

- The memory index goes **first** in `buildChatInstructions`, before the
  daily-date lines, so it sits in the stable cached prefix. It changes only
  when entries change, not every turn.
- Inject **last-known-good** memory regardless of extraction status (fixes
  G1). Status only drives UI.
- Budget: index ≤ **2.5k tokens** (2 × 1 KB bodies + 30 × 100-char lines ≈
  1.5k English / 2.5k Ukrainian). Over budget → drop the `preferences` body
  first, then truncate descriptions; never silently drop entries from the
  index (the model must know they exist to call `memory_read`).
- `aboutMe` (custom instructions) is injected verbatim, separate from memory.
- Models without tool support: index only, no tools. Gateway models follow
  `GatewayModel.toolCall`.

### 3.3 Memory and search tools

- Registered **server-side**, gated by the user's settings, **not** added to
  the client `chatToolSchema` enum (so they don't inherit "web search and
  image generation cannot combine").
- **Separate step budget**: memory/search tool calls get their own budget
  (3 calls per turn) and do not consume the 3 tool steps of
  `TOOL_LOOP_MAX_STEPS`; otherwise `memory_list → search_chats → read_chat`
  leaves web search zero steps. Implementation: raise the loop cap by the
  memory budget only when memory tools are registered, and count memory calls
  separately like `search-budget.ts` does for Brave/Exa.
- `search_chats` runs over the existing `message_search` table. The current
  prefix-AND query is brittle for LLM-written queries → progressive fallback
  (AND → drop rarest-missing tokens → OR, bm25-ranked). LLM text always goes
  through the `query.ts` sanitizer, never raw into `MATCH`.
- Scope: in a project with `useAccountMemory = false`, search only that
  project's chats; otherwise all of the user's non-incognito chats. The current
  chat is excluded. `message_search` has only `owner`, so project scoping must
  join `rowid → messages.id → chats.projectId` **inside** the FTS query, not
  post-filter the 200-candidate list (a small project would get zero hits).
  No FTS schema change needed.
- `read_chat` returns at most ~3k tokens (window around a hit), text parts
  only.
- Results render as visible tool chips with links to the source chats
  (transparency + citations).
- **As built (W2, 2026-10-25)** — see "Model-facing tools" in
  `docs/history/content-search.md`. Deviations from the text above: the
  fallback is AND → OR only (no "drop rarest-missing tokens" step); the tools
  are skipped on sends with a forced `toolChoice` (image generation, Google
  native `web_search`); the gate `isChatSearchToolEnabled()` returns `true`
  until the settings workstream wires `chatSearchEnabled`; the route passes
  no `projectId` until project isolation exists; and every send on a
  tool-calling model is now a tool-loop send. Giving the model the whole
  history also required blocking external markdown images at render time
  (`app/components/prose/Img.vue`), otherwise a poisoned prompt could leak
  any chat through an auto-loaded image URL.
- `memory_write` / `memory_forget`: only when the **user's current message**
  asks for it; renders a "Saved to memory · Undo" chip.

### 3.4 Extraction pipeline

- **Trigger: cron sweep, not Queues (P1).** A `*/5 * * * *` sweep (same
  pattern as `research-job-sweep.ts`) picks chats where activity is older than
  10 min and `memoryDirtyAt > memoryExtractedAt`. Why not Queues: a new
  binding and consumer for no capability the sweep lacks; the sweep reuses the
  existing pattern. Neither crons nor queue consumers run on Previews
  (`docs/cloudflare-previews.md`), so previews exercise extraction through a
  manual "extract now" endpoint, like the other hand-run maintenance
  endpoints. Queues stay a later upgrade if latency matters.
- Per tick: batch cap (e.g. 20 chats), processed **sequentially** (6
  simultaneous connections rule), within the 15-min cron wall clock.
- **Lease + heartbeat** (pattern from `docs/chats/stuck-generation-guard.md`)
  instead of a sticky `refreshing` status (fixes G3).
- **Incremental, bounded input**: only messages since the last extraction,
  capped (~12k tokens), plus the current index (titles + descriptions) so the
  model merges rather than duplicates (fixes G2).
- **Structured output**: zod schema of ops `create | update | delete` on
  entries, each op carrying `category`, `description`, `body`,
  `sensitivity`, `sensitiveCategory`. Applied after the compliance gate.
- **Trust boundary**: user-role text is primary input; assistant text is
  lower-trust context only (it echoes web/tool/file content); tool, source,
  file and reasoning parts are never fed. The extractor prompt forbids
  storing instructions ("always do X when…") that originate outside user
  messages. Assistant turns whose `messages.tools` contain `memory_list` /
  `memory_read` (a "what do you know about me" dump) are excluded from the
  extraction window so memory doesn't feed on itself.
- **Model**: cheapest flagged model on any key the user has — extend
  `forProjectMemory` to Anthropic (Haiku tier), xAI, DeepSeek etc. (fixes G4).
  ~$0.001–0.004 per pass at 10k in / 0.5k out. Superseded by the owner's
  model-choice direction in 3.9: the cheapest flagged model is only the last
  step of the resolution chain.
- Skip short chats (< ~300 chars of user text) and incognito chats.

### 3.5 Compliance gate (code-enforced, not prompt-only)

Model refusals are not a control (Anthropic's own memory-tool docs say so).
`server/utils/memory/compliance.ts` runs on **every** write path (UI, tool,
extraction, import):

1. **Never store** (hard block, even on explicit request, matches Claude):
   government ID numbers, passport/PESEL/tax ids, criminal history,
   immigration status, financial account / card numbers / IBAN, credentials,
   API keys, tokens, passwords, precise home address / live location.
   Deterministic detectors (regex + checksum: Luhn, IBAN mod-97, PESEL,
   key prefixes like `sk-`, `AIza`, JWT shape) **plus** the extractor's own
   label. Blocked op → dropped, logged as a count only (never the content).
2. **GDPR Art. 9 special categories** (health, religion/philosophical
   beliefs, political opinions, racial/ethnic origin, sex life/sexual
   orientation, trade-union membership, genetic, biometric): stored only if
   `memoryIncludeSensitive` is on (explicit opt-in screen naming the
   categories); otherwise dropped. When saved, a visible notice. Turning the
   toggle off **deletes** all `sensitivity = special` entries (Claude's
   `sensitive_cleanup` equivalent).
   **(owner)** User-authored entries (UI edit, explicit "remember this"): the
   user typing it with the toggle on counts as per-entry explicit consent
   under Art. 9(2)(a); no classifier pass. With the toggle off, UI and tool
   writes still run the extractor-style classifier and show "this looks like
   sensitive data — enable sensitive memory to save it". Never-store items
   are blocked on every path regardless.
3. **Legal-status topics the owner asked to keep out**: residence
   "legalization" (karta pobytu, visas, work permits) is immigration status
   and already sits in the never-store list above. Ongoing legal disputes and
   drug-related topics are treated as category 2 by default **(owner)**. All
   lists live in one constant so they are reviewable.

**As built (W3, 2026-10-25)**: see 3.10. The detector set, the never-store
priority over Art. 9, the count-only logging and the known limits are
documented there.

The categories and the never-store list are hardcoded in
`shared/utils/memory-policy.ts` and quoted verbatim in the privacy policy
(`docs/legal.md` flow). Not legal advice — counsel should confirm the Art. 9
position and whether a DPIA is needed before GA.

### 3.6 Project knowledge (files, notes, folders)

- `project_files(projectId, fileId)` link table; files stay in R2 / `files`.
- In-app **Markdown notes** ("memory as MD notes" in Claude projects) are just
  text files created from the UI and linked the same way.
- Text extraction on attach: text/MD/code directly; PDF via a Workers-safe
  extractor (to be evaluated) or the provider's native PDF input at send time.
- **Budget**: total extracted text ≤ **8k tokens** → full inject (cached
  prefix); above → chunk (≤ 512 tokens) into an FTS5 table and expose
  `search_project_knowledge`. The 8k threshold is a documented knob. UI shows
  "N% of project capacity" like Claude.
- Vectorize + Workers AI embeddings (`@cf/qwen/qwen3-embedding-0.6b`, one
  index, `user_id`/`project_id` metadata filters, operator-paid, cost
  negligible) is **P4**, only if FTS recall proves insufficient. Not BYOK
  embeddings: Anthropic/DeepSeek users have no embedding API and a provider
  switch would invalidate the index.
- **Local folders**: `showDirectoryPicker` works only on Chromium desktop
  (Chrome/Edge, installed PWAs keep permission); Safari macOS/iOS and Firefox
  have no API to keep a live folder. So: Chromium-desktop "link folder" =
  client reads files and uploads a snapshot on demand ("Sync" button);
  everywhere else `<input webkitdirectory>` one-time upload. Never promise
  live sync on iOS.

### 3.7 Data rights and deletion

- **Export** (Art. 15/20): `GET /api/v1/profiles/memory/export` → JSON of
  entries + settings; plain-text import (paste from another assistant →
  extraction op path → compliance gate).
- **Chat deletion**: for `origin = extraction`, entries whose
  `sourceChatIds` contain only that chat are deleted; others drop the id. For
  `user | tool | import` entries the id is dropped and the entry kept — the
  user saved it deliberately, and tidying old chats must not erase "remember
  I'm allergic to X". Claude and ChatGPT don't cascade at all.
- **Project deletion**: deletes project-scope entries.
- **Account deletion**: add `memory_entries` to `purgeUserData` explicitly.
  FK `userId → users` with cascade is consistent with every other table but
  extends the documented rebuild blast radius; **(owner)** recommendation:
  cascade FK (consistent) **and** explicit purge (belt and braces), and list
  the table in CLAUDE.md's cascade-children list.
- **Incognito chat** (per-chat flag, locked after first message): never
  searched, never extracted.
- **Pause** keeps entries but stops injection and extraction; **Reset**
  deletes all entries.

### 3.8 Defaults **(owner)**

- Auto-generation (extraction) **off by default**, one-time prompt explaining
  that it runs on the user's key and what is never stored. Rationale: EU
  operator, no counsel review yet, and it spends the user's money.
  `memory_write` on explicit request and chat search work without it.
  **Deviation (W3, 2026-10-25)**: with the single `memoryEnabled` boolean this
  does not hold. `memoryEnabled` is the master switch (off = no injection, no
  tools, no extraction), so `memory_write` does not work while it is off. W4,
  W5 and W6 must either accept that, or the owner adds a separate extraction
  toggle (an additive nullable column, no rebuild). See 3.10.
- Chat search tool **on** by default (no new data processing — it reads the
  user's own chats on demand, nothing stored).
- Existing project memory: harmonised with the above — existing projects keep
  their current state; new projects follow the account toggle.

### 3.9 Model choice (owner direction 2026-10-25)

The user chooses which model updates profile memory and which updates project
memory. `null` means "same as chat": the model the user is already chatting
with. The choice is per scope (`profile` | `project`) and may be a direct
provider model or a gateway model.

Resolution chain, in `server/utils/memory/resolve-model.ts`
(`resolveMemoryModel({ userId, scope, sourceChatId?, projectId? })`):

1. **`setting`** — `profileMemoryModel` / `projectMemoryModel` plus the paired
   `*MemoryGateway`. The key (direct provider key, or the gateway's key
   provider) must still exist, otherwise the step is skipped. A direct model
   must still be in the catalog and usable; a gateway model is not re-checked
   against the live gateway catalog at resolve time.
2. **`chat`** — the newest assistant message with `usage.model` and
   `usage.provider` among the 10 most recent assistant messages of the source
   chat. A `*-gateway` / `openrouter` provider means the chat was a gateway
   send: it is mapped back to a gateway id through `providerMeta`
   (`kind: 'gateway'`, `keyProviderId`) and the model id is kept as is.
   Otherwise the usage provider must match the catalog provider of that model.
   For project memory with no source chat, the project's 5 most recent chats
   (by `activityAt`) are scanned in order and the first with usable usage
   wins. Profile scope with no source chat skips this step without a record.
   This is the server-side equivalent of the model picker, which lives only in
   browser `localStorage` and is never sent to the server outside a chat send.
3. **`fallback`** — cheapest-first provider order
   (`MEMORY_MODEL_PROVIDER_ORDER`: openai, anthropic, qwen, deepseek, google,
   moonshotai, xai), the first provider with a saved key and a
   `forProjectMemory` model that passes the same usability filter as the
   other steps (a retired or otherwise unusable flagged model is skipped).
   The flag stays; W5 shows it as "Recommended (cheap)".

`source` is `setting | chat | fallback` (`memoryModelSources`) and records
which step decided. It is logged as
`attributes.memoryModel = { scope, source, gatewayId, providerId, modelId,
skipped, errors }` (`source` is `null` when nothing resolved) and is what the
UI can show next to a project's memory model.

A failing setting or chat step falls through to the next one. Each
fall-through is recorded in `attributes.memoryModel.skipped` as
`<step>:<reason>`: `not-in-catalog`, `unusable-model`, `no-key`, `error` (a
thrown lookup), `chat:no-usage`, `fallback:no-key`. A thrown lookup also adds
`{ step, error }` (the error message) to `attributes.memoryModel.errors`. The
saved-keys lookup is different: if `keys.findMany` throws, the resolver
rethrows, because "could not read the keys" must never be reported as "no
key". The project refresh then leaves `memoryStatus` untouched (no
`unavailable` write) and releases its lease in `finally`, as in W1. `null`
from the resolver means no step produced a model; project memory then ends
`unavailable`.

Usability filter, shared by every step of the resolver and the settings
validation (`isUsableMemoryCatalogModel`, in the light module
`server/utils/memory/catalog-usability.ts`, which only has type imports and
pure logic): the model produces text output, is not a deep-research agent, is
not an image-generation model, and is not past its `retiredAt`. A
`deprecated` model that is not yet retired stays usable. The PATCH validation
for a gateway model applies the equivalent check to the live gateway catalog
entry: rejected when `modalities.output` is declared without `text`, or when
no modalities are declared and `supportsImageGeneration` is `true`.

Known limit: a gateway model taken from the latest chat (the `chat` step) is
not catalog-checked at resolution time, because resolution does no network
calls. If it is unusable (retired upstream, image-only), the refresh fails
instead of falling through to the next step. A gateway model chosen in the
settings is checked when it is saved, not when it is used.

Accepted consequence: the `chat` step can pick an expensive model, since the
owner's rule is that the default is the model the user is chatting with, not
the cheapest one. Only the `fallback` step optimises for cost. A user who
wants cheap memory work sets an explicit model.

Resolution is two-phase. `resolveMemoryModel` only decides and logs, and
returns the selection plus a lazy `instantiate()`; the credential is read and
the AI SDK model built only when `instantiate()` runs
(`instantiateMemoryModel`). Callers record the choice first, so a failure
while building the model is still attributable. `projects.memoryProvider`
stores the key-provider id (`keyProviderIdForGateway(gatewayId)`:
`vercel-gateway`, `cloudflare-gateway` or `openrouter`) for gateway picks and
the provider id for direct picks, so it joins with `usage.provider` and with
`providerMeta`; `projects.memoryModel` stores the model id. Reasoning is `off` for every provider
except OpenAI (`low`), and gateway picks run with reasoning `off`.

### 3.10 As built (W3, 2026-10-25)

Branch `feat/w3-memory-contract-8bbac3`. W3 ships the contract only: nothing
outside the settings API reads `memoryEnabled`, `chatSearchEnabled`,
`memoryIncludeSensitive`, `aboutMe` or `useAccountMemory` yet, and no code
creates `memory_entries` rows. The one behavioural change is project memory
(resolver and redaction, below).

**Settings semantics decided in W3**

- `memoryEnabled`: the master switch. Off means no injection, no memory
  tools, no extraction; entries are kept. Default `false` (opt-in).
  **Deviation from 3.8**: 3.8 says `memory_write` works without extraction
  being on. With a single boolean it does not. W4/W5/W6 must accept this, or
  the owner adds a separate extraction toggle.
- `chatSearchEnabled`: default `true`.
- `memoryIncludeSensitive`: default `false`.
- `aboutMe`: at most 4000 characters, trimmed; an empty string stores `null`.
- `projects.useAccountMemory`: default `true`; `null` means the default.
- All defaults live in app code (`MEMORY_SETTING_DEFAULTS`); the columns are
  nullable with no SQL `DEFAULT`, per the D1 rebuild rule.

**Settings API** (`/api/v1/profiles/settings`, GET and PATCH)

- Model and gateway are a pair per scope. Sending `<scope>MemoryModel`
  replaces both columns (a missing gateway means a direct provider); sending
  `<scope>MemoryGateway` without `<scope>MemoryModel` is a 400; a `null`
  model clears both.
- Validation order: body schema (400) → `aboutMe` never-store gate (400) →
  gateway-without-model (400) → empty patch (400) → per-scope model check
  (`assertMemoryModelChoice`) → write. The whole request is rejected on any
  failure and nothing is written, including the opt-out purge.
- `aboutMe` goes through `detectNeverStore` after trimming. A hit is a 400
  (`About me contains data that cannot be stored`) whose `why` lists only the
  kind ids and labels, never the content; the count is logged through
  `recordBlockedCounts` with origin `settings-about-me`. The text itself is
  never logged.
- A direct model is checked against the curated catalog with
  `isUsableMemoryCatalogModel` (400 when unknown or unusable). A gateway model
  is checked against the live gateway catalog: not in catalog or no text
  output (declared modalities without `text`, or no modalities and
  `supportsImageGeneration: true`) is a 400, a catalog outage is a 503 (not a
  silent accept). Cloudflare needs the user's Cloudflare AI Gateway
  credentials, otherwise 400.
- A gateway choice is a catalog-hitting path, so each one first consumes the
  shared per-user gateway-catalog rate limit
  (`enforceGatewayModelsRateLimit` in
  `server/utils/gateways/catalog-rate-limit.ts`, 20 requests per 60 seconds,
  the same bucket as `GET /api/v1/gateways/[gateway]/models`); the 429
  propagates and nothing is written. Direct models, `null` models and
  boolean-only patches never touch the limiter.
- There is no key check at save time: a key can be added later, and the
  resolver falls through when it is missing.
- `memoryIncludeSensitive: false` runs the settings write and the purge of
  every `sensitivity = special` entry of the user in ONE `db.batch([...])`
  (settings statement first, `buildSensitiveMemoryPurge(userId, db)` second),
  so either both land or neither does. The response then carries
  `sensitiveEntriesDeleted` (the number of purged rows); the purge is logged
  as `attributes.memorySettings.sensitiveEntriesDeleted`. Without that flag
  (`true` or absent) the settings write is a single non-batch statement and
  no purge runs.

**Schema** (`server/db/schemas/memory-entries.ts`, migration
`20261025130157_memory_contract`)

- The migration is additive only: `CREATE TABLE memory_entries`, nine
  `ALTER TABLE ... ADD COLUMN` (eight on `user_settings`, `use_account_memory`
  on `projects`) and four `CREATE INDEX`. No `DROP TABLE`, no rebuild.
- `userId` is a cascade FK to `users` and `purgeUserData` also deletes the
  user's entries explicitly, before the R2/KV work that can abort
  (`memoryEntriesDeleted` in its result). `AGENTS.md` lists the table among
  the cascade children.
- `projectId` is a cascade FK to `projects`: deleting a project removes its
  project-scope entries (3.7).
- Two partial unique indexes, because SQLite treats `NULL`s as distinct in a
  unique index: `uq_memory_entries_account_slug (userId, category, slug)
  WHERE project_id IS NULL` and `uq_memory_entries_project_slug (userId,
  projectId, category, slug) WHERE project_id IS NOT NULL`. Plus
  `idx_memory_entries_user_project` and `idx_memory_entries_user_sensitivity`.
- `sourceChatIds` defaults to `[]` in app code (`$defaultFn`), not in SQL.
- The `user_settings` columns are `memory_enabled`, `chat_search_enabled`,
  `memory_include_sensitive`, `about_me` and the four model/gateway columns
  (`profile_memory_model`, `profile_memory_gateway`, `project_memory_model`,
  `project_memory_gateway`); the gateway columns are enum-typed in Drizzle
  only.

**Compliance gate** (`server/utils/memory/compliance.ts`)

Exported API: `detectNeverStore(text)` → sorted, merged `{ kind, start, end }`
spans; `redactNeverStore(text)` → `{ text, blocked, blockedTotal }` with each
span replaced by `[redacted]`; `evaluateMemoryEntry({ title, description,
body, sensitivity, extractorNeverStoreKind?, includeSensitive })` → a verdict
`{ allowed: true }`, `{ allowed: false, reason: 'never-store', kinds }` or
`{ allowed: false, reason: 'sensitive-disabled' }`; `recordBlockedCounts`;
`buildSensitiveMemoryPurge(userId, db)` (the returning-delete query builder,
batchable) and `purgeSensitiveMemoryEntries(userId)` (awaits it and returns
the row count).

Priority: never-store beats Art. 9. An entry with a detector hit is blocked
even when `memoryIncludeSensitive` is on; `sensitive-disabled` is only
reported when nothing matched. The title, description and body are each
scanned, and an extractor-supplied `extractorNeverStoreKind` counts like a
detector hit.

Detectors (overlapping spans merge into one, the longer kind wins):

| Kind | Rule |
|---|---|
| `payment-card` | 13-19 digits in up to 6 space/hyphen-separated groups; first digit 2-6, not one repeated digit, Luhn-valid |
| `iban` | two letters + two digits; the country length table (32 countries) when the country is known, any length 15-34 otherwise; mod-97 equals 1; also bare Polish NRB (26 digits in 2+6x4 groups) |
| `national-id` | PESEL (checksum plus a valid date, all century month bands) and US SSN (`NNN-NN-NNNN`, area not 000/666/9xx, group not 00, serial not 0000) |
| `tax-id` | NIP (checksum, `NNN-NNN-NN-NN` or 10 digits) and РНОКПП (10 digits, checksum); only when a tax keyword (NIP, TIN, VAT, ІПН, РНОКПП, ІНН/ИНН, "tax id", "податковий номер", ...) appears within 40 characters before the number |
| `passport` | keyword (passport, паспорт, paszport, pasport) within 30 non-digit characters before an optional 1-2 letter series and 6-9 digits; only the identifier is redacted |
| `api-key` | known shapes: `sk-`, `AIza`, `AQ.`, GitHub (`ghp_` etc. and `github_pat_`), Slack `xox*`, AWS `AKIA`/`ASIA`, Stripe-style `sk_`/`pk_`/`rk_` + `live_`/`test_`, `xai-`, `gsk_`, `hf_`, `npm_`, `glpat-`, SendGrid `SG.`, `Bearer <20+ chars>` |
| `jwt` | three dot-separated parts, the first two starting `eyJ` |
| `credential` | a label (password, passwd, pwd, passphrase, secret, api key, token, пароль, токен, ключ, hasło, ...) followed by `:` or `=` and a value of 6+ characters; or label + `is`/`є`/`jest`/`это` + a 6+ character value that contains a non-letter; or URL userinfo (`scheme://user:pass@`). The label stays, only the value is redacted |
| `private-key` | `-----BEGIN ... PRIVATE KEY-----` through the END marker, or to the end of the text when unterminated |

The topical classes (`criminal-history`, `immigration-status`,
`home-address`, `live-location`, `other`) have `detection: 'extractor'` in
`neverStoreKinds`: they are only enforced through `extractorNeverStoreKind`,
never by `detectNeverStore`. `neverStoreKinds` is the reviewable list quoted
in the privacy policy.

Logging contract: `recordBlockedCounts(blocked, logger, origin)` writes
`attributes.memoryCompliance = { origin, blocked, blockedTotal }` and stays
silent when nothing was blocked. Only counts per kind are logged, never the
matched text. Origins used so far: `project-memory-summary`,
`project-memory` and `settings-about-me`.

Known limits (deliberate, covered or implied by the spec):

- Cards inside a digit run of 20+ digits, or glued to a leading `+`, are
  missed.
- A bare 11-digit phone number that passes the PESEL checksum and date is
  redacted as `national-id`.
- A letters-only password in the "X is <word>" form is missed (the sentence
  form requires a non-letter in the value); the `label: value` form has no
  such requirement.
- `Token: expired` and similar 6+ character values after a credential label
  are over-redacted.
- A hyphenated word of 20+ characters after `sk-` matches the key shape.
- The topical classes above are extractor-label only (see the table note).

**Project memory now goes through the gate.** The summarise and synthesise
prompts gain one sentence forbidding card, bank, government/tax ID, passport
and credential data, and both outputs are redacted. The redaction covers the
per-chat summaries (`chats.projectMemorySummary`) and the synthesised blob
(`projects.memory`). Chats whose summary was cached before W3 keep an
unredacted summary until their next refresh; the synthesised blob is always
redacted on write, so the injected text is clean either way. Summaries and
the blob are redacted, not blocked: a hit becomes `[redacted]` and the rest of
the text is kept.

Both `generateText` calls of the project refresh also carry `maxOutputTokens`
(`PROJECT_MEMORY_LIMITS.maxSummaryChars` for the per-chat summary,
`maxMemoryChars` for the synthesis). A token budget at least as large as the
character budget is deliberately generous: it only bounds runaway output, the
character caps still do the real truncation.

**Art. 9 control on the legacy blob is PROMPT-ONLY.** `refreshLeasedProjectMemory`
reads `memoryIncludeSensitive`; when it is not `true`, one sentence is
appended to both instruction strings: omit information about health, religion
or beliefs, political opinions, racial or ethnic origin, sex life or
orientation, trade-union membership, genetic or biometric data, ongoing legal
disputes and drug use. This is a request to the model, not code enforcement:
the output is not classified or filtered, so special-category data can still
slip into `projects.memory`. Code enforcement (`evaluateMemoryEntry`) exists
only for the entry pipeline. Project memory (summaries and blob) written
before W3 is not retro-scrubbed; the instruction applies from the next refresh
of each chat summary and of the blob.

**Open follow-ups**

- Art. 9 handling of the existing project blob is prompt-only (above). W6's
  blob migration to entries should run each derived entry through
  `evaluateMemoryEntry` before saving.
- `neverStoreKindIds` in `memory-policy.ts` is a hand-written tuple, kept
  equal to the ids of `neverStoreKinds` (same ids, same order) by a unit
  test in `tests/unit/utils/memory-policy.spec.ts`.
- Nothing consumes the new settings yet: W4 (injection, tools), W5 (UI) and
  W6 (extraction) own that.

**Hand-over for W4/W5/W6**

- Writers must run `evaluateMemoryEntry` on the exact text that is persisted
  (title, description and body as stored, after any trimming or rewriting),
  not on an earlier draft.
- `memoryEntryInputSchema` accepts client-supplied `origin` and `projectId`.
  The W4 route must force `origin` itself and verify that the project belongs
  to the user: the `projectId` foreign key does not tie a project to its user.
- The patch schema skips cross-field rules for fields that are absent, so the
  handler must re-validate the merged row (stored values plus patch) before
  writing.
- Future writers should insert only when `memoryIncludeSensitive` allows it,
  inside the same statement (for example `INSERT ... SELECT ... WHERE` on the
  settings row), to close the race with the opt-out purge that runs in the
  settings PATCH batch.
- The fallback tries OpenAI first, a provider the user may not have chatted
  with; it only needs a saved key. A chosen or chat-derived model may be
  expensive (3.9); only the fallback optimises for cost.

## 4. Cost and performance

| Item | Per turn | Who pays |
|---|---|---|
| Memory index in prompt | ≤ 2.5k tokens, cached prefix on Anthropic/OpenAI | user |
| Project knowledge full-inject | ≤ 8k tokens, cached prefix | user |
| Tool calls (memory/search) | 0 unless the model decides; ≤ 3 calls, ≤ ~3k tokens each | user |
| Extraction | ~$0.001–0.004 per idle chat, not per turn | user (cheap model) |
| FTS5 queries/writes | already paid today | operator (D1) |
| Embeddings (P4 only) | ~$0.012 / 1M tokens + Vectorize ≈ $0 | operator |

Cache churn: memory index edits invalidate the Anthropic/OpenAI cache once
per edit — acceptable, edits are rare relative to turns.

## 5. Phases and parallel workstreams

Ownership is by file set so parallel sessions never touch the same files.

**P1 — quick wins, no schema change (days)**
- **W1 Project-memory fixes** — G1 last-known-good injection, G3 lease,
  bounded incremental refresh, G4 more providers. Files:
  `server/utils/projects/*`, `server/api/v1/projects/[id]/memory*`,
  `server/api/v1/chats/[slug]/project-context/*`.

  *Implemented* (branch `feat/w1-project-memory-fixes-e3c95e`, no schema
  change; behaviour documented in `docs/history/projects.md`): G1 injects the
  last-known-good memory for every status except `disabled`; G3 replaces the
  sticky `refreshing` status with a 120 s KV lease and 30 s heartbeat; G2
  bounds the refresh (20 chats considered, 6 summarised per refresh,
  per-transcript, per-message, per-summary and 4k-char memory caps, leftovers
  continue on the next refresh); G4 flags one `forProjectMemory` model per
  direct provider. Decisions: the provider order is a cost ranking (openai
  `gpt-6-luna`, anthropic `claude-haiku-5-5`, qwen `qwen3.8-flash`, deepseek,
  google, moonshotai, xai), so openai now precedes google; `qwen3.8-flash`
  because `qwen3.7-flash` only has a "from" price; 6 chats per refresh
  because a refresh is a synchronous request, unlike the 20-chat batch the W6
  cron sweep gets; the 4k-char memory cap is enforced synchronously by
  truncation, since the blob is injected into every chat turn.
- **W2 Cross-chat search tools** — `search_chats` / `read_chat`, separate
  step budget, query fallback, tool chips. Files: `server/utils/memory/tools/*`
  (new), `server/utils/ai/tool-loop.ts`, `server/utils/search/query.ts`,
  registration hook in `chats/[slug]/index.post.ts`, chip component.

**P2 — contract first, then parallel**
- **W3 Contract (blocking, small)** — `shared/types/memory.d.ts`,
  `shared/utils/memory-policy.ts` (categories, caps, never-store list), zod
  schemas for entries and API, the compliance gate
  `server/utils/memory/compliance.ts` (W4 and W6 both call it), Drizzle
  schema + additive migration (`memory_entries`, `user_settings` columns,
  `projects.useAccountMemory`).

  *Implemented* (branch `feat/w3-memory-contract-8bbac3`; details in 3.9 and
  3.10): the contract files, the additive migration, the compliance gate, the
  model-choice resolver (`server/utils/memory/resolve-model.ts`) and its
  settings validation, the settings API fields, and never-store redaction on
  project memory. Added beyond the original W3 scope: per-scope memory model
  settings (`profileMemory*`, `projectMemory*`, with gateways) and the
  resolver that replaces `resolveProjectMemoryModel`. Decisions and
  deviations: `memoryEnabled` is the master switch, so `memory_write` does
  not work while it is off (deviation from 3.8); the chosen chat model may be
  expensive by design; the existing project blob is redacted, and its Art. 9
  control is prompt-only (no code enforcement, no retro-scrub).
- Then in parallel:
  - **W4 Memory backend** — CRUD API under `server/api/v1/memory/`, index
    builder + injection in `buildChatInstructions`, `memory_read/list/write/
    forget` tools.
  - **W5 Memory UI** — `app/pages/profile/memory.vue`, entry list grouped by
    category, edit/delete, toggles + sensitive opt-in screen, "About me",
    project Memory modal with *Use account memory*.
  - **W6 Extraction sweep** — `server/utils/memory/extract.ts`,
    `server/plugins/memory-extraction-sweep.ts`, lease, structured ops,
    project blob migration.

**P3 — knowledge and rights**
- **W7 Project knowledge** — `project_files`, notes, 8k budget, chunk FTS,
  `search_project_knowledge`, folder upload (Chromium link + webkitdirectory).
- **W8 Data rights** — export/import, chat-deletion cascade, purge, incognito
  flag, privacy-policy text (`content/` legal docs).

**P4 — only if needed**: Vectorize semantic recall; Queues for lower
extraction latency; "Tell Claude what to change" NL editor (an extraction
call over the index with the user's instruction).

Every workstream: register new specs in `scripts/test-affected-check.mjs`,
run `pnpm run format && pnpm run typecheck`, inspect any generated migration
for `DROP TABLE` (must be additive only), and update this document's
decision log when a decision changes.

## 6. Open risks

- Tool-calling quality varies by provider; weak tool users may never call
  `search_chats`. Mitigation: index lines tell the model *when* to read.
- FTS recall for paraphrased questions is limited; this is the trigger for P4.
- Extraction quality on the cheapest models (duplicates, stale facts) — merge
  prompt includes the current index; `lastUsedAt` expiry.
- Memory poisoning via assistant echo of web/tool content — trust boundary in
  3.4 plus never-store gate; still worth a red-team pass before GA.
