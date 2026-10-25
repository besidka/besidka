# Memory architecture (profile, project, cross-chat, knowledge)

Status: **proposal**, 2026-10-24, partly implemented: section 1 lists what
exists today, and the "As built" notes in 3.3, 3.10, 3.11, 3.12, 3.14, 3.15 and section 5 record W1-W6.
Decisions marked **(owner)** are
recommendations logged per the "minimize questions" preference; the owner can
overturn any of them before the phase that depends on it starts.

Goal: make Besidka feel like Claude.ai / ChatGPT memory — a chat can know what
other chats know, "tell me everything you know about me" works, projects get
categorised memory plus knowledge files — without blowing the per-turn token
budget (the user pays every token with their own key) and with hard,
code-enforced compliance rules for sensitive data.

## 1. Where we are (audit, HEAD ffaccd56)

> Superseded for project memory: the blob pipeline described here was retired in
> W6b, see 3.14.

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
  native `web_search`); the gate `isChatSearchToolEnabled()` returned `true`
  until W4 wired `chatSearchEnabled` (see 3.12); the route passes
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
   under Art. 9(2)(a); the server still classifies (W4, 3.12) to set the
   entry's `special` label and category, but never refuses. With the toggle
   off, UI and tool writes run the same classifier and are refused with "this
   looks like sensitive data — enable sensitive memory to save it". Never-store items
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

- **Export** (Art. 15/20): `GET /api/v1/memory/export` (path changed in W4, see 3.12) → JSON of
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
  **Resolved (W6, 2026-10-25)**: W3 shipped one `memoryEnabled` boolean
  (default off), which made `memory_write` depend on the extraction opt-in.
  W6 splits it: `memoryEnabled` is the master "use memory" switch and now
  defaults to **ON** (null = on), so the injected index, `memory_write` and
  chat search work without extraction; `user_settings.memory_extraction_enabled`
  ("Generate memory from chats", null = off) is the extraction opt-in. The
  sweep needs both. Consequence for W4: injection and tools are default-on for
  users who never touched the setting. See 3.11.
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

Gateway models from the latest chat (the `chat` step) are catalog-checked
(W6): `getCachedGatewayCatalog` (KV-cached, stale copy served on an upstream
failure) or, for Cloudflare, the cached catalog fetched with the user's
credentials. An unusable one is skipped and resolution falls through to the
fallback instead of failing the refresh. New skip reasons: `chat:not-in-catalog`,
`chat:unusable-model` (not a text-output model, via the shared
`isTextGatewayModel`), `chat:catalog-unavailable` (cold cache plus outage; also
recorded in `errors`), and `chat:no-key` now also covers missing Cloudflare
credentials. A gateway model chosen in the settings is still only checked when
it is saved, not when it is used.

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

Branch `feat/w3-memory-contract-8bbac3`. W3 shipped the contract only: nothing
outside the settings API read `memoryEnabled`, `chatSearchEnabled`,
`memoryIncludeSensitive`, `aboutMe` or `useAccountMemory`, and no code
created `memory_entries` rows (W4 changed that, see 3.12). The one behavioural change is project memory
(resolver and redaction, below).

**Settings semantics decided in W3**

- `memoryEnabled`: the master switch. Off means no injection, no memory
  tools, no extraction; entries are kept. W3 shipped it default `false`; **W6
  changed the default to `true`** and added the separate
  `memoryExtractionEnabled` (default `false`), which resolves the 3.8
  deviation (see 3.11).
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
| `credential` | a label (password, passwd, pwd, passphrase, secret, api key, token, пароль, токен, ключ, hasło, ...) followed by `:` or `=` and a value of 6+ characters; or label + `is`/`є`/`jest`/`это` + a 6+ character value that contains a digit or symbol (`_` counts as a letter, so `user_id` is not enough); or URL userinfo (`scheme://user:pass@`). The label stays, only the value is redacted |
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
  form requires a digit or symbol in the value); the `label: value` form has no
  such requirement.
- A bare `key` is not a credential label (`primary key: user_id`, `cache key:
  user:123` stay intact); `api key`, `apikey`, `secret`, `token`, `токен` and
  `ключ` are.
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
- W4 now consumes the settings (injection, tools, see 3.12); W5 (UI) and W6
  (extraction) still own theirs.

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

### 3.12 As built (W4, 2026-10-25)

Branch `feat/w4-memory-backend-aaf9e2`, umbrella child of `feat/memory-p2`. W4
is the backend: the entries API, the index and its injection, the four memory
tools with their chip, the wired flags and the chat-deletion cascade. No schema
change and no migration; everything sits on the W3 table.

**Entries service** (`server/utils/memory/entries.ts`, `entry-slug.ts`)

- One service for the routes and the tools: `createMemoryEntry`,
  `updateMemoryEntry` (returns `{ entry, previous }`), `deleteMemoryEntry`
  (returns the deleted snapshot), `getMemoryEntry`, `listMemoryEntries`,
  `findMemoryEntryBySlug`, `resetMemoryEntries`, `buildMemoryExport`,
  `toMemoryEntryWire`. Every query has `userId` in its `WHERE`; project scope
  additionally requires `projects.user_id = userId` (`assertOwnedProject`).
  Malformed hashids (the library throws on foreign characters) decode to
  "not found", never a 500.
- **Writes are compliance-gated on the persisted strings.** The service
  parses with `memoryEntryInputSchema` (zod trims), then runs
  `evaluateMemoryEntry` on the trimmed title, description and body, with
  `includeSensitive` read from `user_settings`. `never-store` is a 422 whose
  `why` lists kind labels only; `sensitive-disabled` is a 422 (see the Art. 9 classifier below). A user-authored
  write with the opt-in on is allowed (typing it is consent, #508). The
  client-supplied `origin` is ignored: the route forces `user`, the tools
  force `tool`.
- **Create is one atomic statement**: `INSERT ... SELECT ... WHERE <cap guard>
  AND <Art. 9 opt-in guard> AND <project ownership guard> RETURNING id`, run
  through `db.all(sql)`. The cap (`maxAccountEntries` 30 / `maxProjectEntries`
  15, counted per scope with `project_id IS ?`) and the opt-in guard are
  therefore exact under concurrency, and an opt-out purge that lands between
  the check and the write cannot be beaten. Zero rows is diagnosed (404 /
  409 sensitive / 409 limit). A unique-index violation (walked through the
  `.cause` chain, D1 wraps it) is a 409, never a 500.
- **Update** reads the stored row, builds the merged row, re-validates it with
  `memoryEntryInputSchema` (so the 1 KB `profile`/`preferences` rule and the
  `sensitiveCategory` rule apply to merged values), re-runs the gate, then does
  a typed `UPDATE ... WHERE id AND user_id AND <opt-in guard> RETURNING`.
  Patching `sensitivity` to `none` clears a stale `sensitiveCategory`. It is
  read-merge-write with no version check: concurrent patches are last write
  wins.
- **Singleton categories.** `profile` and `preferences` are one per scope:
  their slug is always the category name, so the partial unique index enforces
  it and matches the "2 x 1 KB always injected" budget. A second create is a
  409 "edit it instead". Moving an entry into a singleton category sets the
  slug to the category name (409 on collision); moving out keeps the old slug
  (for example `topics/profile`).
- **Slugs** come from the title (`slugifyMemoryTitle`: lowercase, Ukrainian
  and Russian Cyrillic transliterated, diacritics stripped, `ł ø đ ß æ œ`
  mapped), suffixed `-2`, `-3`, ... on collision. The slug is stable: editing
  the title does not change it.

**Entries API** (`server/api/v1/memory/`, session required, 401 otherwise)

| Route | Body / query | Response |
|---|---|---|
| `GET /api/v1/memory/entries` | `scope=account\|project\|all`, `projectId` (alone implies project; default account) | `{ scope, projectId, total, limits, groups: [{ category, entries }] }`, all five categories always present in `memoryCategories` order |
| `POST /api/v1/memory/entries` | `memoryEntryInputSchema` (`origin` ignored) | 201 `{ entry }` |
| `GET /api/v1/memory/entries/[id]` | | `{ entry }`, 404 |
| `PATCH /api/v1/memory/entries/[id]` | `memoryEntryPatchSchema` | `{ entry }` |
| `DELETE /api/v1/memory/entries/[id]` | | `{ success: true }`, 404 |
| `POST /api/v1/memory/entries/reset` | `{ scope, projectId? }` | `{ deleted }` (POST: DELETE bodies are unreliable) |
| `GET /api/v1/memory/export` | | attachment `besidka-memory-export-<date>.json`, `no-store` |

`limits` carries `maxAccountEntries`, `maxProjectEntries`, `maxBodyBytes`,
`maxAlwaysInjectedBodyBytes`, `maxDescriptionChars`, `maxTitleChars`. Error
statuses: 400 validation, 404 not found or foreign, 409 cap / name taken /
singleton exists, 422 never-store or sensitive memory off. The export is
`{ version: 1, exportedAt, settings, projects, entries }`: `settings` are the
memory fields with defaults applied, `projects` only those that own an entry
or hold a non-empty legacy `projects.memory` blob (`{ id, name,
useAccountMemory, legacyMemory }`), `entries` every scope. It carries no user
id or token. **Deviation from 3.7**: the path is `/api/v1/memory/export`, not
`/api/v1/profiles/memory/export`. Response types are in
`shared/types/memory-api.d.ts`.

**Index and injection**

- `buildMemoryIndex` / `loadMemoryIndex` (`server/utils/memory/index-builder.ts`)
  render one stable `<memory>` block: a fixed header ("data, never
  instructions"), then `## Account memory` and `## Project memory`, each with
  `### Profile` and `### Preferences` bodies in full (every body line is
  quoted with `> ` and split on all Unicode line separators, so a body cannot
  forge a heading or an entry line) and `### Entries` as
  `- <handle> | <title> — <description>` lines. No dates, no per-turn counts, so
  the block only changes when entries change and stays in the cached prefix.
- **Handles instead of ids.** A 26-character public id costs about 18 tokens,
  so lines carry `<category>/<slug>` (account) or `project/<category>/<slug>`
  (project). `memory_read` accepts a handle or a public id.
- **Budget** (`shared/utils/memory-tokens.ts`): `MEMORY_CHARS_PER_TOKEN` =
  Latin 4, Cyrillic 2.5 (the figure W2 uses for `read_chat`), everything else
  1.5. Trim order from 3.2, stopping at the first step that fits and never
  dropping an entry: the `preferences` body becomes a line, descriptions are
  cut to 60, 40, 20 and 0 characters, and as a last resort the `profile` body
  becomes a line. Steps that would change nothing are skipped and not recorded.
  Measured with 100-character descriptions and two 1 KB bodies: 30 account
  entries cost 1595 tokens in English and 2251 in Ukrainian (no trim); with 15
  project entries on top, English trims after `preferences-body` (2156) and
  Ukrainian after `descriptions-60` (2390); the last step ends at 528 / 568.
  After body quoting the single-line figures moved by 1 to 2 tokens; a dense
  worst case (two 1 KB bodies of 512 one-letter lines per scope) costs about
  +512 tokens per scope: Ukrainian with 30 + 15 entries is 4120 untrimmed and
  2222 after `preferences-body`, `descriptions-60` and `descriptions-40`.
  `overBudget` exists but cannot happen within the entry caps.
- Entry text is neutralised: `<` and `>` (and look-alikes) become `‹` and `›`,
  titles and descriptions are collapsed to one line (titles are also
  single-line at the schema level), so an entry cannot close `<memory>` or
  forge an index line. `special` entries are skipped when the
  Art. 9 opt-in is off (defence in depth; the opt-out purge normally removed
  them).
- `buildChatInstructions` pushes the memory block **first**, then the `aboutMe`
  block (a one-line header and the text verbatim), then the project prompt,
  the chat-search line and the date clauses. Both call sites (the main
  `streamText` and the search-answer continuation) get the same
  `memoryInstructions`, computed once per send in
  `server/utils/memory/chat-context.ts`. A project chat loads project entries
  plus account entries unless `projects.useAccountMemory === false`. Nothing
  in `docs/providers/anthropic.md`'s invalidator list is affected: the block
  is stable text and changes only with entries or `aboutMe`.
- **Decision: `aboutMe` is injected whenever it is set, independent of
  `memoryEnabled`.** It is user-authored custom instructions, not extracted
  memory (3.2: "separate from memory"); only the index and the tools follow
  `memoryEnabled`. The owner can overturn this.

**Flags** (`server/utils/memory/tools/enabled.ts`, `chat-context.ts`)

- `loadMemorySettingsFailClosed`: the route reads `user_settings` once per
  send. If the read throws, memory, chat search and `aboutMe` are all treated
  as off for that send and `attributes.memorySettings.error` is logged: a
  failed read must never re-enable something the user turned off.
- `chatSearchEnabled` gates `search_chats`/`read_chat`
  (`isChatSearchToolEnabled(settings)`); `memoryEnabled` gates the index and
  the memory tools (`isMemoryToolsEnabled(settings)`). Nulls fall back to
  `MEMORY_SETTING_DEFAULTS`. Both families need the same tool-calling support
  and no forced `toolChoice`. The chat-search tools get a `projectId` only
  when the chat's project has `useAccountMemory === false` (project isolation,
  3.3).
- One `ChatSearchBudget` (3 calls per message) is shared by all six tools, and
  the loop grants the same extra `chatSearchSteps` when either family is
  registered. `isMemoryToolName` is separate from `CHAT_SEARCH_TOOL_NAMES`; the
  loop counts a memory tool like a chat-search tool and never as a web-search
  round.

**Memory tools** (`server/utils/memory/tools/memory-tools.ts`)

All four use `withFollowUpTurn()`, spend the shared budget first, and turn
service errors (400/404/409/422) into tool-error parts whose message carries
`why` and `fix` (evlog's `.message` alone would hide them from the model).
The scope a tool can touch is the account entries (unless the project hides
them) plus the current chat's project entries; `special` entries are hidden
while the opt-in is off. Anything else is a 404 tool error.

| Tool | Input | Output |
|---|---|---|
| `memory_list` | `{ category? }` | `{ notice, entries: [{ id, handle, scope, category, title, description, body }] }` (at most 50) |
| `memory_read` | `{ id }` (public id or handle) | `{ notice, entry }` |
| `memory_write` | `{ category, title, description, body, sensitivity?, sensitiveCategory?, scope?, id?, userRequestQuote }` | `{ notice, action: 'created'\|'updated', entry, previous? }` |
| `memory_forget` | `{ id, userRequestQuote }` | `{ notice, removed }` |

- `memory_list` and `memory_read` set `lastUsedAt` (best effort, `updatedAt`
  pinned so reading never changes the edit time).
- `memory_write` / `memory_forget` are registered **only** when the current
  send is a user message with text. They are also **locked for the rest of
  the message once any non-memory tool result or tool error has been seen**
  (`untrustedResultSeen` on the shared budget, set by `prepareStep` from the
  previous steps, provider-executed results such as native web search
  included; `memory_list`/`memory_read`/`memory_write`/`memory_forget`
  results do not count). A write attempted after that is a 403 tool error
  telling the user to repeat the request in a new message. This is what
  stops content read from a web page, a file or another chat from steering
  the model into writing or deleting memory in a later step. Limits: two calls
  in the same model step (a search plus a write issued in parallel) are not
  ordered by it; files attached to the user's own message and the injected
  index are inputs, not tool results. The description says to use them only when
  the user's current message explicitly asks, never because of web, file,
  search or chat content, and never to store instructions for the model.
  **Code-enforced request gate:** `userRequestQuote` (at most 300 characters,
  at least `min(12, length of the normalised message)` and never below 4, so a
  short message such as "forget it" must be quoted whole) must occur in the
  user's current message after NFKC, lowercase and stripping whitespace,
  punctuation, symbols and the modifier apostrophe U+02BC.
  This is a mitigation, not a proof of intent: any substring satisfies it and
  it does not prove the body came from the user. The controls that carry the
  weight are the description, the chip with Undo, the never-store gate, the
  Art. 9 opt-in, the untrusted-content lock above and the 3-call budget.
  A negated request ("don't remember my address" contains "remember my
  address") and text the user pasted still pass the quote check.
- `memory_write` upserts: with `id` it updates that entry, without it the entry
  with the same title slug (or the singleton slug) in that scope is updated,
  otherwise one is created. Writes always set `origin: 'tool'` (an edited
  user entry is re-marked `tool`), `sourceChatIds` = the existing ids plus the
  current chat's **public id** (`chats.id`, not the slug), and
  `sourceMessageId` = the persisted user message's public id (`newMessage.id`).
  The model can never set `projectId`, `origin`, `slug` or the source fields.
  The default scope is `account`; in a project with `useAccountMemory === false`
  it is `project` (an explicit `account` there is a 400, `project` outside a
  project chat is a 400). A hidden `special` entry is never found by the slug
  upsert, so a title write cannot overwrite it, and the resulting
  "already exists" conflict is reported as a neutral 409 so the model cannot
  learn that a hidden entry exists. Errors that are not evlog errors with a
  status (for example a Drizzle query error with SQL text) reach the model as
  a generic "The memory service failed".
- Sensitivity: the tool has no sensitivity fields. The server classifier
  (below) runs on every write, so a health fact is refused with the opt-in off
  and stored as `special` with it on.
- The continuation (`buildSearchResultsContext`) renders memory results in
  their own `Memory list/read/save/remove N` sections so a turn that ends
  without text still answers from them.

**Persisted tool parts are redacted.** The live stream to the client is
untouched, but before the assistant message is saved
(`persistAssistantMessageFromStream`, the only writer of assistant tool parts)
`redactMemoryToolPartsForPersistence` removes `output.entries[].body`,
`output.entry.body`, the whole `output.previous`, `input.body` and
`rawInput.body` from memory tool parts. Memory bodies therefore do not
outlive `memory_forget`, an entry delete, a reset or the Art. 9 opt-out purge
inside `messages.parts`. Consequence: after a reload the chip can only Undo a
created entry (an update's `previous` is gone).

**Chip** (`app/components/Chat/Reasoning/MemoryStep.vue`,
`app/utils/memory-step.ts`): a reasoning step like the search chips.
`memory_write` shows "Saved to memory" with an **Undo** button: `created`
sends `DELETE /api/v1/memory/entries/<id>`, `updated` sends
`PATCH /api/v1/memory/entries/<id>` with `previous` (so it goes through the
same schema, merged-row check and compliance as any edit); a 404 counts as
already undone (the id is URL-encoded; the button has an accessible name
with the entry title and a polite "Undone" live region). Undo does not expire:
a stale chip can delete or overwrite a later edit of that entry. **`memory_forget` has no Undo** (re-creating needs the full
snapshot and a way to restore `origin` and provenance): it reads "Removed from
memory". `memory_list`/`memory_read` show a count and an expandable title list,
never bodies. Local type `MemoryStepScope = 'account' | 'project'` (the shared
`MemoryScope` is `profile | project`, a different notion).

**Chat deletion** (`server/utils/memory/chat-deletion.ts`): both delete routes
call `detachChatsFromMemory` first (before the search-index removal and
before `db.delete(chats)`, so a failed cascade has no side effects), with the
owned chat ids (public ids). An `extraction` entry whose remaining `sourceChatIds` would
be empty is deleted; every other entry citing a deleted chat drops the id and
keeps its `updatedAt`; `user | tool | import` entries are never deleted and an
untouched empty-provenance entry is never affected. It reads the user's
provenance-carrying entries and decides in JavaScript (a `json_each ... IN`
clause would blow the D1 100-parameter limit for 90 bulk ids), then writes in
`db.batch` chunks of 50. A failed cascade aborts the delete so extraction
memory from a deleted chat is never left behind silently. Project deletion
already removes project-scope entries through the cascade FK.

**Legacy blob and entries (merge with W6).** The chat route used to inject
`projects.memory` on every send. W6's migration copies that text into a
`topics/overview` project entry and leaves the column, so once a project uses
entries (`projectUsesMemoryEntries`: `memoryMigratedAt` set or any entry scoped
to the project) the route passes no blob to `buildProjectSystemPrompt`
(`resolveLegacyProjectMemory`, `server/utils/projects/legacy-memory.ts`).
Project instructions and name stay. A failing lookup keeps the old behaviour
(blob injected) and logs `attributes.projectMemory.dedupeError`. It does not
depend on `memoryEnabled`: with memory off and entries present, no project
memory is injected (paused). The export also carries `memoryExtractionEnabled`.

**Art. 9 classifier (server-side, deterministic).** The first W4 version
trusted the caller's `sensitivity`: `POST /api/v1/memory/entries` with
"I have type 2 diabetes." and `sensitivity: 'none'` was stored with the opt-in
off. `evaluateMemoryEntry` now also runs `classifySensitiveCategories`
(`server/utils/memory/sensitivity.ts`, rules in `sensitivity-rules.ts`) over
the title, description and body, after the never-store check. Classification is
deterministic only: no LLM ever labels or infers sensitive attributes (the
`memory_write` tool and the extractor no longer have `sensitivity` or
`sensitiveCategory` fields; the server assigns them).

- Effective sensitivity is `special` when the declared value is `special`
  (only the user's own API call can declare it) or the classifier matched.
  The effective category is the declared one, else the first classified, else
  `null`. The allowed verdict carries the effective values and
  `detectedCategories`, and every writer persists them: API create and PATCH
  (on the merged row), `memory_write` and extraction. The atomic SQL guards use
  the effective sensitivity, so the opt-out race stays closed.
- A stored `special` row is sticky for tool and extraction updates: only the
  user's own PATCH can downgrade it.
- Opt-in OFF and flagged: 422 "Sensitive memory is turned off", `why` names the
  detected category ids ("looks like sensitive data (health)"), never the text,
  `fix` says to turn on sensitive memory in the memory settings. Nothing is
  stored. This replaces the earlier 409. Opt-in ON: stored as `special` with
  the server-chosen `sensitiveCategory` (typing it is consent, #508), which is
  what lets the opt-out purge find it later.
- **Third-party data.** An entry in the `people` category whose effective
  sensitivity is `special` is always refused (422 "Sensitive data about
  another person cannot be stored"), even with the opt-in ON: the user cannot
  consent for someone else. Precedence: never-store, then third-party, then
  opt-in. Special data about a third party written into another category
  (for example "my wife has cancer" in a topic) is not detectable.
- **Transfer filter.** `SENSITIVE_MEMORY_PROVIDER_ALLOWLIST`
  (`shared/utils/memory-policy.ts`) is deliberately EMPTY: the owner fills it
  after checking EU adequacy / EU-US Data Privacy Framework certification on
  dataprivacyframework.gov. `isSensitiveMemoryProviderAllowed` is false for
  any gateway send (no provider pinning exists yet) and for any provider not
  listed. When it is false, `special` entries are left out of the injected
  index, and `memory_list`, `memory_read` and id-based `memory_write` hide them
  (the route passes `includeSensitive && allowed` as the tools' visibility;
  the compliance gate still reads the real opt-in). The index then carries one
  fixed line saying that some sensitive memories are withheld for the current
  provider, without a count or any content. With every visible entry withheld
  there is no index and no line. W6's `sensitiveOptInEnabled` runtime flag is
  independent of this.
- Logging: `attributes.memoryCompliance.sensitive = { origin, categories,
  thirdParty }` (ids only), merged across the writes of one request when the
  logger exposes its context; extraction logs once per run.
- The vocabulary is one auditable table covering all ten
  `memorySensitiveCategories` in English, Ukrainian, Polish and Russian, each
  pattern with examples that a spec requires it to match (this is what catches
  typos), plus a homoglyph guard. Matching is NFKC + lowercase, apostrophes
  folded, Unicode-aware word boundaries (not `\b`) and stems for inflected
  languages. Precision over recall: anything that is also an ordinary word
  needs a personal frame or an unambiguous noun ("I vote for tabs" and
  "diagnosed with a flaky test" are not flagged; voting needs a political
  noun; bare 'diet', 'church' in street names, 'Gay Street', 'European Union',
  'tennis court', 'weed', zodiac 'cancer', 'fingerprint sensor', 'Face ID',
  bare 'рак' / 'rak' / 'cancer' are not flagged).
- Accepted limits. Flagged although neutral: 'My pastor said hi', 'Ислам
  Махачев' (first name), 'Hindus in India statistics', 'political party
  registration rules', product-persona text with bare health words
  ('therapist', 'medication', 'allergic', 'pregnant', 'insulin'),
  'catholic'/'muslim' used bare. Not flagged although personal: 'I voted for
  Trump', 'I vote Labour', 'Głosowałem na PiS', 'I take drugs', "I'm a
  recovering addict", 'He died of cancer', 'I got divorced', 'Я розлучився', an
  unlisted condition after 'my diagnosis is', named politicians, slang,
  misspellings and mixed-script homoglyphs. 'convicted of' / 'charged with' (with
  a crime word) land in `legal-dispute`, which overlaps the extractor-only
  never-store `criminal-history` kind (follow-up: decide whether that kind gets a
  deterministic detector). The extractor still carries a `neverStore` label for
  the topical never-store kinds (criminal history, immigration status, home
  address, live location): a model flag the server cannot verify and the only
  detector for those kinds.
- No LLM pass: it would spend the user's key on every write, add latency, and
  ask a model to infer sensitive attributes. A no-op extraction (only a new
  source chat) does not re-classify a legacy `none` row, and entries stored
  before this change are not re-labelled; a title-only PATCH on such a row
  with the opt-in off is refused.

**Other behaviour fixed in the review pass**

- `PATCH /api/v1/memory/entries/[id]` is the user's own edit (and the chip's
  Undo), so it re-marks the entry `origin: 'user'`: a hand-edited extraction
  entry is no longer deleted when its only source chat is deleted. Service and
  tool callers keep their own `origin` argument.
- Mutating memory routes (POST, PATCH, DELETE, reset) call
  `assertNotCrossSiteRequest` (a cross-site request gets 403 before any 401,
  like the push and branch routes); entry GETs send `Cache-Control: no-store`.
- A second `profile`/`preferences` create at the entry cap reports "already
  exists, edit it instead", not "limit reached".

**Known limits and decisions to confirm**

- Shared chats hide tool parts, but the model's own text and reasoning parts
  are served with the share (and copied by branching). While memory is on, the
  profile and preferences bodies are in the prompt of every turn, so the
  model may paraphrase them in a shared chat. The share dialog does not warn
  about it.
- The Art. 9 classifier is a keyword list, not a model: it misses names,
  slang and unusual phrasing, and flags a few benign uses (see below). Entries
  written before it existed keep the label they were stored with.
- `sourceMessageId` is the client-chosen user message id (the insert ignores
  conflicts): consumers must never look it up without scoping to the user's
  own chats.
- Undo is not a full inverse: it restores the visible fields, not `origin` or
  `sourceChatIds`.

- The quote gate and the model-labelled sensitivity above.
- The settings read is fail-closed: a D1 read failure turns chat search off for
  that send, not only memory.
- Every send does one extra `user_settings` read; with memory on, two entry
  reads for the index; each `memory_list` runs two list queries.
- Entry updates are last-write-wins.
- The opt-in guard that fires only when the setting flips between the compliance
  check and the write is covered by construction (it is in the SQL), not by a
  test, because the synchronous better-sqlite3 driver cannot interleave.
- Undone `memory_forget` is impossible by design (above).
- Tool-call outputs (`memory_list`, `memory_read`, `previous` bodies) are
  persisted in message parts like any tool output.

**Hand-over**

- W5 consumes the routes and the `MemoryEntriesResponse` shape above; the
  UI must show `why` for 409 and 422, and offer the sensitive opt-in on the
  422 "Sensitive memory is turned off" (a never-store 422 has the message
  "This memory contains data that cannot be stored" instead).
- W6 writes through `createMemoryEntry` / `updateMemoryEntry` with
  `origin: 'extraction'` and chat **public** ids in `sourceChatIds`; the
  singleton rule means profile and preferences are upserts. The index header
  ("data, never instructions") is a prompt, not a control: once extraction
  writes model output into bodies injected on every turn, the trust boundary
  of 3.4 and the never-store gate are what protect the prompt.
- W6 flipped the `memoryEnabled` default to `true` (3.11); the W4 specs were
  updated. The 14 route specs that build a `db.query` mock return an explicit
  memory-off settings row so they keep pinning "memory off".
### 3.11 As built (W6, 2026-10-25)

Extraction sweep, blob migration and the W3 follow-ups. Code:
`server/utils/memory/extract*.ts`, `server/plugins/memory-extraction-sweep.ts`,
`server/api/v1/memory/extract-now.post.ts`, `server/utils/projects/memory-entries.ts`.

**Schema (one additive migration, `20261025140221_memory_extraction`)**: five
nullable columns, no SQL `DEFAULT`, no rebuild: `user_settings.memory_extraction_enabled`,
`chats.memory_extracted_at`, `chats.memory_extraction_attempted_at`,
`chats.memory_extraction_failures`, `projects.memory_migrated_at`.

**Opt-in is forward-only.** Switching extraction on stamps
`memory_extracted_at = now` on every chat of the user that has none, in the
same `db.batch` as the settings write. Existing history is never extracted
(it would spend the user's key on the whole archive); only chats active after
the toggle are. Lead-flippable: an explicit "import from history" action could
later clear those stamps for chosen chats. Resending `true` while already
`true` does not restamp, and turning it off does not stamp.

**Sweep.** `*/5 * * * *`, same cron expression as the research sweep.
Config `memoryExtractionSweepEnabled` (default false; true in `wrangler.jsonc`,
safe because the per-user opt-in is off), `...BatchSize` 20,
`...MaxRuntimeMs` 120000. Selection is a core `chats JOIN user_settings` query (for
non-project chats; project chats follow the project rule in 3.14, with their
own watermark):
extraction on, `memory_enabled` null or true, `activity_at` at least 10 min
old, `memory_extracted_at` null or older than `activity_at`, attempt backoff
30 min, failure cap 3 (reset by newer activity), ordered by
`COALESCE(attempted_at, 0), activity_at`. The pool is `batch * 4`; at most 5
chats per user per tick; chats run sequentially until the runtime budget is
used. A chat without any user text in its window skips the LLM call and
advances `memory_extracted_at`. A chat with 1-299 chars of user text also
skips the call but does NOT advance it: the text accumulates across passes,
and the chat is marked "waiting" (`memory_extraction_failures = 0` with
`memory_extraction_attempted_at` set). The sweep reselects a waiting chat only
when `activity_at > attempted_at`, so an unchanged short chat is never picked
up again. `failures` NULL with an attempt stamp means a crashed pass
(retried after the backoff), `failures >= 1` a failed pass (backoff, cap 3
lifted by newer activity).
`memory_extraction_attempted_at` is stamped before the call and cleared on
success; a failure increments `memory_extraction_failures`.

**Lease.** `memory-extraction:<chatId>` through the generic
`acquireMemoryLease` (120 s TTL, 30 s heartbeat, W1's pattern). The KV
get-then-put is not atomic, so the design does not rely on it for safety:
slug uniqueness, the extraction-origin rule and idempotent merges make a
double pass harmless, and the lease only avoids paying twice.

**Input and trust boundary.** Only `text` parts. User text is the primary
source, assistant text is labeled low-trust, tool, source, file and reasoning
parts are never read. Assistant turns whose `tools` column or tool parts name
`memory_list`/`memory_read` are excluded. The prompt wraps the transcript as
untrusted data and forbids storing instructions that originate outside the
user's words. The window is capped (36k chars) and bounded to the messages
after `memory_extracted_at`. The current entry index of the scope (account
entries for non-project chats, the project's entries for project chats) is part
of the prompt so the model merges rather than duplicates.

**Ops and writes.** `generateObject` returns `create | update | delete` ops
(flat schema, max 10 per pass, 15 with a legacy blob). Identity is
`(category, slug)` from the index, never a model-supplied id. Code enforces
what the prompt only requests:

- **Evidence grounding (addition to the original design)**: each create or
  update op must carry a verbatim quote that occurs in the window's user text
  (or the legacy blob); otherwise it is dropped as `ungrounded`. This is the
  code-level defence against assistant echo of web/tool/file content.
- **Extraction only edits what extraction wrote**: update and delete apply only
  to `origin = 'extraction'` rows. Entries written by the user, a tool or an
  import are shown to the model as locked context and are never changed by the
  sweep (owner principle: the user chooses). `special` rows are hidden from
  the extractor and locked.
- Every op runs `memoryEntryInputSchema`/`memoryEntryPatchSchema` (and the
  merged row for updates) and `evaluateMemoryEntry` on the exact persisted
  text, with the extractor's `neverStore` label as `extractorNeverStoreKind`.
  Extraction never writes special-category entries (3.15): the op schema has
  no sensitivity fields, every row is persisted `none`, and
  `evaluateMemoryEntry` (the server classifier, 3.12) drops flagged text as
  `sensitive-topic`.
- Caps (`maxAccountEntries`/`maxProjectEntries`), merge-before-create (a
  create colliding with an extraction-origin slug becomes an update, with any
  other origin it is dropped as `duplicate`), writes scoped by `userId` and
  `projectId`, `sourceChatIds` appended, deduped and capped.
- A project chat is skipped when the project belongs to another user (the FK
  does not tie them) or its memory is `disabled`.

**Model and cost transparency.** `resolveMemoryModel` with scope `profile`
(non-project chat) or `project`, `sourceChatId` set. Results of the `setting`
and `fallback` steps are cached per tick by `(userId, scope, projectId)`; a
`chat` result depends on the chat and is not cached. Each sweep logs
`attributes.memoryExtraction = { chatsProcessed, messages, userChars,
ops: { proposed, applied, dropped }, models: [{ source, providerId,
gatewayId, modelId, chats }], usage }`: counts and ids only. Errors log the
error class name, never a message. Per-call 90 s abort timeout.

**`POST /api/v1/memory/extract-now`.** For previews, where crons do not run.
Session-authed, cross-site request guard, body `{ chatSlug }`. The chat is
looked up by slug AND user, anything else is a 404. Needs the same two
flags (409 otherwise), ignores the 10-minute idle rule, 60 s per-user KV
cooldown (429). Responds with counts and the model source/id only.

**`GET /api/v1/memory/entries/[id]/sources`.** Resolves an entry's provenance
for the UI: `MemoryEntry.sourceChatIds` holds chat public ids, but chat URLs
are `/chats/<slug>`. Session-authed, `no-store`. The entry is loaded through
`getMemoryEntry` (404 `Memory entry not found` for a missing or foreign
entry), then at most `MEMORY_LIMITS.maxSourceChatIds` ids are looked up in one
`inArray` query filtered by the caller's `userId`, so another user's chat id
inside `sourceChatIds` is never leaked and the D1 bound-parameter limit is
safe. Deleted chats are omitted and the order of `sourceChatIds` is kept.
Responds `{ chats: Array<{ id, slug, title }> }`, `title` being `''` when the
chat has none. Code: `server/utils/memory/entry-sources.ts`.

**Legacy project blob.** `projects.memory_migrated_at` is the marker. On the
first extraction pass of a project with a non-empty blob and no marker, the
blob is added to the prompt as `<legacy-memory>` (quotable as evidence), so the
same op pipeline and compliance gate classify it (this is the retro-scrub W3
left open for never-store data). After a successful pass the marker is set
and never-store matches are redacted in place in `projects.memory`. The column
is kept and never nulled (rollback, also on disable) but nothing writes it any
more once entries are in use: `projectUsesMemoryEntries(project, userId, db?)` in
`server/utils/projects/memory-entries.ts` is true when the marker is set or any
entry exists, and it is **the single function W4's index builder and prompt
caller use**. `buildProjectSystemPrompt` takes `memoryEntriesActive` (default
false = unchanged); W4's caller in `chats/[slug]/index.post.ts` must pass
`await projectUsesMemoryEntries(project, userId)`. The W1 blob pipeline is
retired in W6b (3.14), so nothing writes `projects.memory` any more. Known
limit: Art. 9 text that predates W3 may remain in the dormant blob column; it
is never injected once entries are in use and extraction never reads it as
anything but a grounding source for `create` ops.

**Settings API (for W5).** GET and PATCH carry `memoryExtractionEnabled`
(default false) and `memoryEnabled` (default true). The sensitive opt-in is not
part of v1: PATCH strips `memoryIncludeSensitive`, GET returns a constant
`false` (deprecated), and the stored column is ignored by the server. Model
validation failures throw (503 catalog outage, 429 rate limit, 400 unknown
model) and nothing is saved. A flagged `aboutMe` is rejected with 422.

**Known limits.**

- Timestamps are second-resolution; a message created in the same second as the
  newest consumed one could be missed (practically excluded by the 10-minute
  idle rule, possible with `extract-now`).
- Short windows accumulate: nothing is consumed until the user text in the
  window reaches 300 chars (fixed after a live preview found chunked chats
  never extracting).
- A window is bounded to the newest 120 messages / 36k characters; older
  unseen messages in the same pass are not revisited.
- Branching a chat copies messages: share-branched chats ignore messages
  within 30 s of the chat's creation, and any message older than the chat is
  ignored (own-chat branches keep original timestamps). W4 may also stamp
  `memory_extracted_at` in the branch endpoints as defence in depth.
- Turning extraction (or `memoryEnabled`) back on stamps every chat that is
  not already up to date, so the period it was off is never mined.
- The KV lease and the `extract-now` cooldown are check-then-set, not atomic;
  a burst can run duplicate passes on the caller's own key. Results stay safe
  (unique slugs, origin rule); an owner-token or Durable Object lease is the
  upgrade if it matters.
- Extraction entries are not yet removed when their source chat is deleted
  (W8 data rights owns the cascade); `sourceChatIds` already records the link.
- `generateObject` is deprecated in AI SDK 7 but still works (the research
  clarifier uses it too); move both to `generateText` with an `output`
  setting together.
- The extractor is the only detector for the topical never-store classes (its
  `neverStore` flag); Art. 9 data is classified by the server (3.12), not by
  the extractor, and extraction drops flagged ops (3.15). User-pasted text that
  contains instructions is still user-role text (prompt-level defence only).
- The extraction sweep is not run on Previews (no crons); use `extract-now`.

### 3.14 Project memory as entries (W6b, 2026-10-26)

Owner feedback on the pr-512 preview: the project card showed one capped blob
(4000 chars) and its sections were glued together. Both are addressed.

**Formatting bug (not a data bug).** The stored blob was intact (`**Heading**`
paragraphs separated by `\n\n`, 2625 chars on the PIT-37 project; redaction,
truncation and the synthesis join all preserve newlines, covered by a test).
The cause was `unwrap="p"` on the card's `MDCCached`: MDC then strips every
top-level `<p>` so a multi-paragraph document renders as adjacent inline text
(`...penalties.Key Learnings`). Removed in `Projects/MemoryCard.vue` and
`Chat/ProjectInstructions.vue`; unit tests render the real MDC component.

**Unified server side.** The W1 blob pipeline is retired. "Refresh memory" is an
explicit user action implemented by `refreshProjectMemoryFromChats`
(`server/utils/projects/memory-refresh.ts`):

- requires `memoryEnabled !== false` (409 otherwise), not
  `memoryExtractionEnabled`: clicking Refresh is the explicit consent for this
  project; a `disabled` project does nothing;
- project lease (`project-memory-refreshing:<id>`), model resolved once with
  `resolveMemoryModel({ scope: 'project', projectId })`, then `extractChatMemory`
  with `trigger: 'manual'` over the project's chats, newest activity first, at
  most 20 considered and 6 sent to the model per click (only chats that reach
  the model count; the rest keep the project `stale`), strictly sequential;
- the same op pipeline and compliance gate as the sweep (evidence grounding,
  extraction-origin-only edits, never-store, caps, merge-before-create);
- **Project chats keep their own watermark**, `chats.project_memory_summary_updated_at`
  (the otherwise unused W1 column, no migration), for BOTH the sweep and the
  manual refresh; non-project chats keep `memory_extracted_at`. This also keeps
  the forward-only opt-in stamp on `memory_extracted_at` from hiding a project's
  history from the sweep or an explicit refresh, and one project message is
  never processed twice. Too-short windows accumulate, as in 3.11;
- moving chats (single or bulk) no longer calls an LLM and the chat page no
  longer posts a refresh after every send; they only mark the project `stale`.
  Updating project memory is the server sweep's job (next paragraph) plus the
  explicit Refresh button.

**Project chats are swept automatically (owner rule, 2026-10-25).** Project
memory used to update itself after chats in every project where it was enabled;
that must not regress when the blob pipeline goes away. The cron sweep extracts
project chats into project-scope entries whenever the account master
`memoryEnabled` is not off AND the chat's project exists, belongs to the same
user and has `memoryStatus != 'disabled'`. It does **not** depend on
`memoryExtractionEnabled`, which governs only account/profile extraction from
non-project chats. The per-project Disable/Enable stays the user's explicit
switch: disabling a project stops its sweep. The model is the project memory
model from `resolveMemoryModel` (scope `project`) on the user's own key.
Selection, lease, caps, trust boundary and the compliance gate are the same as
in 3.11.

**Copy for the UI (W5).** Project card hint: "Projects keep their memory up to
date automatically; turn it off per project." Memory tab note next to
"Generate memory from chats": "This setting covers your account memory. Project
memory updates automatically unless you turn it off in the project."

**Abuse limits and errors.** The refresh and the enable toggle are guarded by
the cross-site request check; a per-project KV cooldown
(`project-memory-refresh-cooldown:<projectId>`, 60 s) is set after any pass
that made a model call, and a refresh inside it answers 429 (the enable toggle
just enables); a per-click deadline (60 s) stops starting new chat passes
(leftover chats keep the project `stale`). A pass is skipped as
`project-changed` when its chat moved to another project (or out of projects)
meanwhile; manual passes never run in profile scope. Partial failure settles
`stale` with `memoryError` set to the first failure's class label; a failed
refresh surfaces as a structured 502 whose `why` is the class label only.
There is no longer a `project-context/refresh` endpoint: nothing calls it.

**Legacy blob.** The first refresh runs a blob-only pass (`extractProjectLegacyBlob`)
when `memory_migrated_at` is null and `projects.memory` is non-blank: same op
pipeline, the blob is the only grounding text. `memory_migrated_at` is set and
never-store text is redacted in place when the pass applied something or the
blob is blank; otherwise the blob stays injected and the card carries
`memoryError: "Existing project memory could not be converted automatically; it
is kept as is."`. The column is never nulled. From then on injection is single
source: `projectUsesMemoryEntries` (marker or any entry) suppresses the blob.
Entries created from chats suppress an unconverted blob in the prompt
(single-source injection), but the card keeps returning it as `legacyMemory`
while `memory_migrated_at` is null, so it never silently vanishes; the blob
pass sends and grounds on the redacted blob and its text can ground `create`
ops only. Disabling a project keeps the blob (and the entries).

**Card contract (for W5).** `shared/types/project-memory.d.ts`
`ProjectMemoryCardResponse`, returned by `GET`, `PATCH { enabled }` and
`POST .../refresh` on `/api/v1/projects/:id/memory`:

```
{ projectId, memoryStatus, memoryUpdatedAt, memoryDirtyAt, memoryProvider,
  memoryModel, memoryError, usesEntries, legacyMemory, total, limits, groups }
```

`total/limits/groups` are W4's `MemoryEntriesResponse` pieces for the project
scope (`groups` by category, entries in the wire shape, edit/delete through the
existing `/api/v1/memory/entries/:id` endpoints with the project filter).
`memoryStatus` is display-resolved (`refreshing` without a live lease reads as
`stale`); `memoryProvider`/`memoryModel` are the last model used (also bumped
by sweep passes, together with `memoryUpdatedAt` and status `ready`);
`legacyMemory` is the unconverted blob while `memory_migrated_at` is null and the blob is non-blank (also when entries already exist: show it read-only as "Earlier project memory (not converted yet)").
`POST .../refresh` returns the card, so no second call is needed. Disabling
(`PATCH { enabled: false }`) keeps the entries and the blob, stops injecting
and refreshing (the old behaviour cleared the blob; deleting entries is left to
the user); enabling refreshes only when memory is on. Tool writes into a disabled
project are refused too.

**Open for the owner.** The project cap stays at 15 entries (`maxProjectEntries`):
if "not that big" means more entries, raising it grows the project part of the
index (budget 2.5k tokens shared with account memory, 3.2) roughly linearly.

### 3.15 Special-category data in automatic extraction (2026-10-26)

Decision from the legal research (GDPR Art. 9; CJEU C-184/20 and C-252/21 on
data that indirectly reveals special categories; OpenAI's prohibition on
inferring sensitive attributes):

- **Automatic extraction never writes special-category entries.** The
  extraction output schema has no `sensitivity`/`sensitiveCategory`, so the
  model is not asked to label sensitive attributes; the prompt tells it to
  record the plain fact and drop the sensitive reason ("vegetarian", not
  "vegetarian for religious reasons"), to omit facts that only make sense
  with such a reason, and that the server rejects such data anyway. Server
  side every extraction op (create, merged create and update, on the exact
  persisted text) goes through `evaluateMemoryEntry` with `sensitivity:
  'none'`, which runs W4's deterministic classifier
  (`classifySensitiveCategories`, 3.12). A hit is dropped and counted as
  `sensitive-topic`; the detected category ids (never the text) are logged
  once per pass under `memoryCompliance.sensitive` with origin
  `memory-extraction`. The blob-only pass (3.14) uses the same pipeline.
  Every persisted extraction row is `sensitivity: 'none'`.
- Existing (legacy) `special` rows are loaded into the extraction index with
  their body hidden but are left out of the rendered `<memory-index>`, so the
  model never sees them, and they are locked: an update or delete is dropped as
  `locked` and a create with the same slug as `duplicate`. They still count
  toward the scope cap.
- `aboutMe` goes through the same classifier: flagged text is always rejected
  (422) with a structured why/fix that names categories only.
- The classifier is merged and wired in, so there is no ship gate on it any
  more. Its recall limits (names, slang, unusual phrasing; see 3.12) apply to
  extraction as well; the prompt instruction remains the first line of defence.

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

    *Implemented* (branch `feat/w4-memory-backend-aaf9e2`, no schema change;
    details and decisions in 3.12): entries service and CRUD/reset/export API,
    index builder with the Cyrillic-aware budget and its injection first in
    both instruction call sites, the four memory tools with a request-quote
    gate and the Undo chip, `chatSearchEnabled`/`memoryEnabled` wired
    (fail-closed), and the chat-deletion cascade.
  - **W5 Memory UI** — `app/pages/profile/memory.vue`, entry list grouped by
    category, edit/delete, toggles + sensitive opt-in screen, "About me",
    project Memory modal with *Use account memory*.
  - **W6 Extraction sweep** — `server/utils/memory/extract.ts`,
    `server/plugins/memory-extraction-sweep.ts`, lease, structured ops,
    project blob migration.

    *Implemented* (branch `feat/w6-memory-extraction-b4d3e2`; see 3.11).

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
