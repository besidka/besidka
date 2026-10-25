# Memory architecture (profile, project, cross-chat, knowledge)

Status: **proposal**, 2026-10-24. Nothing here is implemented yet except what
section 1 lists as "exists today". Decisions marked **(owner)** are
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
  ~$0.001–0.004 per pass at 10k in / 0.5k out.
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
- Chat search tool **on** by default (no new data processing — it reads the
  user's own chats on demand, nothing stored).
- Existing project memory: harmonised with the above — existing projects keep
  their current state; new projects follow the account toggle.

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
