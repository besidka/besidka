# Memory architecture (profile, project, cross-chat, knowledge)

Status: **proposal**, 2026-10-24, **implemented on `feat/memory-p3`** as of
2026-10-26 (not yet on `main`). Section 1 is the pre-W1 audit, the "As built"
notes in 3.3 and 3.10 to 3.16 and section 5 record W1-W6c, 3.17 records the
2026-10-26 security audit of the memory feature, 3.18 the "tell Besidka what to
remember" editor, 3.19 the TypeSafe AI (Jev) checks and their delta audit, and
the decision log (section 7) records the owner decisions after W6. Project
knowledge (3.6) is documented in `docs/project-knowledge-design.md`.
Decisions marked **(owner)** are
recommendations logged per the "minimize questions" preference; the owner can
overturn any of them before the phase that depends on it starts.

**The GDPR Art. 9 sensitive-topics opt-in was removed from v1 on 2026-10-25
(owner).** Special-category text is rejected on every memory write path and is
never stored; there is no toggle, runtime flag, provider allowlist or transfer
filter. The decision, its reasons and the conditions for revisiting it are in
section 7. Passages below that describe the earlier opt-in design have been
rewritten or marked as history.

Goal: make Besidka feel like Claude.ai / ChatGPT memory — a chat can know what
other chats know, "tell me everything you know about me" works, projects get
categorised memory plus knowledge files — without blowing the per-turn token
budget (the user pays every token with their own key) and with hard,
code-enforced compliance rules for sensitive data.

## 1. Where we are (audit, HEAD ffaccd56)

> Superseded for project memory: the blob pipeline described here was retired in
> W6b, see 3.13.

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
| G6 | No account-level memory, no "about me", no custom instructions. **Fixed:** account memory in W4; the free-text "About me" is now the account `profile` entry (section 7, "About me becomes a profile entry"). | `user_settings` |
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
  write-time policy **plus** an after-the-fact purge. Besidka copies neither
  the toggle nor the purge in v1: sensitive topics are refused at write time
  and never stored (section 7).
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
| `slug`, `title` | unique per (user, project, category, slug); the slug is always derived on the server from the title (or is the category for `profile`/`preferences`), a client slug is ignored (3.17) |
| `description` | **mandatory, single line, ≤ 100 chars** — the index line |
| `body` | Markdown, **≤ 4 KB** hard cap (**≤ 1.5 KB** for the always-injected `profile` and `preferences`); raised from 2 KB / 1 KB in W6c (3.15) |
| `sensitivity` | `none` \| `special`. Every row written since the opt-in removal is `none`; `special` survives only on legacy rows (3.11) |
| `sensitiveCategory` | the Art. 9 category of a legacy `special` row, otherwise null |
| `origin` | `user` \| `tool` \| `extraction` \| `import` |
| `sourceChatIds` | JSON array — provenance + deletion cascade (3.7) |
| `sourceMessageId` | for tool writes / undo |
| `createdAt`, `updatedAt`, `lastUsedAt` | `lastUsedAt` is set by `memory_list`/`memory_read`; there is **no expiry** by `lastUsedAt`, it is only the tie-break for which entry leaves an over-budget index first (3.3) |

Caps: ≤ 30 account entries, ≤ 15 per project (soft: the extractor must merge
before creating); `profile` and `preferences` bodies ≤ 1.5 KB each since
they are always injected. "Everything you know about me" = `memory_list()` →
at most ~30 × 4 KB ≈ 30k English tokens worst case, typical 4–10k, paid only
when asked.

**Cyrillic multiplier**: Ukrainian tokenizes at roughly 2–3 chars/token versus
~4 for English, so the same bytes cost ~1.5–2× the tokens. The owner's primary
language is the expensive one; every budget below is stated in tokens and the
index builder measures, not estimates, by character count with a per-script
factor.

`user_settings` gains (ALTER ADD COLUMN, **no SQL DEFAULT**, defaults in app
code — see the D1 rebuild rule in CLAUDE.md): `memoryEnabled`,
`chatSearchEnabled`, `memoryIncludeSensitive` (kept in the table but unused
since the opt-in removal, section 7), `aboutMe` (free-text custom
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
- Budget: index ≤ **2.5k tokens** (2 × 1.5 KB bodies + 30 × 100-char lines, the
  1 KB figure below predates W6c; measured numbers in 3.15; originally ≈
  1.5k English / 2.5k Ukrainian). Over budget → drop the `preferences` body
  first, then truncate descriptions; never silently drop entries from the
  index (the model must know they exist to call `memory_read`).
- The free-text "About me" is now the account `profile` entry, so it travels
  inside the memory index (its body is always injected, 1.5 KB cap). Text that
  could not be converted (`about_me` still set: too long, a profile entry
  already exists, memory off, or rejected by the compliance gate) is never
  injected; it waits on the Memory page until the user edits and saves it as
  an entry or discards it (see "About me becomes a profile entry", section 7).
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
  project's chats; otherwise all of the user's chats, never a chat excluded
  from memory (3.7). The current
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
  are skipped on sends with a forced `toolChoice` (image generation) or an
  `exclusiveNativeWebSearch` provider tool set (Google native `web_search`,
  xAI native `web_search` with reasoning off); the gate `isChatSearchToolEnabled()` returned `true`
  until W4 wired `chatSearchEnabled` (see 3.11); the route passes
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
  entries, each op carrying `category`, `description`, `body` and the
  evidence quote (3.12). There are no sensitivity fields: the server
  classifier decides (3.5, 3.11). Applied after the compliance gate.
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
- Skip short chats (< ~300 chars of user text). Chats excluded from memory
  are never extracted (3.7).

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
   label. Since the 2026-10-26 audit (3.17) home address, immigration or
   residence status and criminal history also have narrow deterministic
   detectors in `evaluateMemoryEntry`, so they are refused on every write path,
   not only through the extractor label. Blocked op → dropped, logged as a
   count only (never the content).
2. **GDPR Art. 9 special categories are rejected and never stored (owner,
   2026-10-25).** Health, religion/philosophical beliefs, political opinions,
   racial/ethnic origin, sex life/sexual orientation, trade-union membership,
   genetic and biometric data are detected by a deterministic classifier
   (`classifySensitiveCategories`, `server/utils/memory/sensitivity.ts`:
   English, Ukrainian and Polish, with Russian patterns in the same rule
   table). It runs inside `evaluateMemoryEntry`, so every write path gets the
   same verdict: UI/API create and edit, the `memory_write` tool, extraction
   (the op is dropped as `sensitive-topic`) and the one-time About-me migration
   (the text stays in `about_me`, outcome `rejected`). The import from
   another assistant (`POST /api/v1/memory/import`, 3.15) runs the same
   extraction op pipeline and therefore `evaluateMemoryEntry` on every op.
   A hit is a 422 on the interactive paths ("Sensitive topics (health,
   religion, politics…) are not saved to memory."), with the detected category
   ids in `why` and never the text. There is no opt-in, no setting, no
   per-entry consent and no exception for what the user types: the older
   design stored such data behind an explicit consent toggle, and that was
   removed from v1 (section 7). Never-store items are checked first and win.
3. **Legal-status topics the owner asked to keep out**: residence
   "legalization" (karta pobytu, visas, work permits) is immigration status
   and already sits in the never-store list above. Ongoing legal disputes and
   drug-related topics are classifier categories (`legal-dispute`, `drugs`)
   and are rejected like category 2 **(owner)**. The category lists live in
   `shared/utils/memory-policy.ts` so they are reviewable.

**As built (W3, 2026-10-25)**: see 3.10. The detector set, the never-store
priority over Art. 9, the count-only logging and the known limits are
documented there.

**Optional model second opinion (2026-10-26)**: a user who saves a TypeSafe
AI key gets an extra, add-only check by the Jev decision model on top of this
gate (3.19). The gate itself stays deterministic, runs first and is final for
what it refuses.

The categories and the never-store list are hardcoded in
`shared/utils/memory-policy.ts` and quoted verbatim in the privacy policy
(`docs/legal.md` flow). Not legal advice — counsel should confirm the Art. 9
position and whether a DPIA is needed before GA; the open legal questions are
the reason the opt-in is out of v1 (section 7).

### 3.6 Project knowledge (files, notes, folders)

- `project_files(projectId, fileId)` link table; files stay in R2 / `files`.
- In-app **Markdown notes** ("memory as MD notes" in Claude projects) are just
  text files created from the UI and linked the same way.
- Text extraction on attach: text/MD/code directly; PDF via a Workers-safe
  extractor (to be evaluated) or the provider's native PDF input at send time.
- **Budget (as built in P3)**: the fixed 8k-token threshold sketched here was
  replaced. Knowledge is injected in full only when it fits
  `min(64k, 7% × context window)` tokens of the model the message is sent with
  (`KNOWLEDGE_BUDGET.absoluteCapTokens` and `contextWindowShare` in
  `shared/utils/project-knowledge-policy.ts`) **and** a per-send fit check
  confirms the whole request still fits the window; otherwise the model gets
  the knowledge search and read tools. Design, numbers and the owner decision:
  `docs/project-knowledge-design.md`.
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

- **Export** (Art. 15/20): `GET /api/v1/memory/export` (path changed in W4, see 3.11) → JSON of
  entries + settings; plain-text import (paste from another assistant →
  extraction op path → compliance gate; built in W6c, `POST /api/v1/memory/import`,
  see 3.15). **Known gap (audit finding 15, 3.17)**: the export leaves out
  the processing records (`memory_backfill_jobs`, the consent timestamp
  `user_settings.memory_extraction_enabled_at`, the per-chat extraction
  columns, the project memory lifecycle columns, `use_account_memory` of
  projects without entries) and all project knowledge
  (`project_knowledge_items`, including notes that exist only on the server).
  Whether this export is the Art. 15/20 vehicle is an owner/counsel decision;
  until then the narrower scope must be stated in the privacy policy.
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
- **Per-chat memory exclusion** (built 2026-10-26, audit finding 16): "Don't
  use this chat for memory". Deliberately not called incognito: the chat is
  still stored, still in the user's own history, sidebar and history search;
  only memory stops using it. Column `chats.memory_excluded` (nullable
  boolean, null reads as false, no SQL `DEFAULT` so the column add never
  rebuilds `chats`). SQL filters write it as `memory_excluded IS NOT 1` so
  NULL stays included (`<> 1` or `ne(col, true)` would drop NULL rows).
  - Filtered at every selection path: the sweep query, `backfillEligibleChats`
    (start count, queue cursor and estimate), the project Refresh chat list,
    and inside the `search_chats` FTS query before the candidate limit.
    `read_chat` answers the same 404 as a missing chat, so it is no existence
    oracle. `extractChatMemory` also skips the chat as `memory-excluded` for
    every trigger, before the model call and again after it, so a toggle that
    lands while a pass is in flight never re-cites the chat.
  - `PATCH /api/v1/chats/:slug/memory` (`{ excluded }`, behind
    `assertNotCrossSiteRequest` and the shared `write` rate-limit bucket since
    #560, ownership in the
    `UPDATE ... WHERE`) writes the flag first, then, when turning it on, runs
    the chat-deletion cascade `detachChatsFromMemory` for that chat:
    extraction entries sourced only from it are deleted, other entries drop
    the citation, `user`/`tool`/`import` entries are never deleted. A project
    chat also marks its project memory stale. `activity_at` is not touched, so
    a toggle never makes a chat due. Turning it off only clears the flag:
    nothing removed comes back, and messages before the chat's watermark are
    not re-read.
  - A branch of an excluded chat is created excluded. A new chat can be
    created excluded from the new-chat input (next to the project picker on
    desktop, a row in the overflow menu on mobile).
  - UI: a toggle in the history row actions menu and in the chat page's "More
    features" sidebar menu; a "Not used for memory" indicator on the history
    row and at the top of the chat. A deliberate `memory_write` inside an
    excluded chat still records that chat in `sourceChatIds` (the user asked
    for it explicitly); the flag stops learning, not explicit saves.
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
  users who never touched the setting. See 3.12.
- Turning "Generate memory from chats" **off** (legal research P1-11,
  2026-10-26) asks in-page "Keep entries" or "Delete them" (Cancel changes
  nothing). "Delete them" calls `POST /memory/entries/delete-extracted`
  after the PATCH succeeds: it deletes the caller's entries with origin
  `extraction` (chat passes, "Update memory now" and backfill) in every
  scope. Entries the user or the assistant edited become `user`/`tool`, and
  imported entries keep `import` even after extraction appended to them, so
  an entry is deleted only when extraction is its sole author.
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

This subsection records W3 as shipped. Where later work or the 2026-10-25 opt-in
removal (section 7) changed a point, the passage says so.

Branch `feat/w3-memory-contract-8bbac3`. W3 shipped the contract only: nothing
outside the settings API read `memoryEnabled`, `chatSearchEnabled`,
`memoryIncludeSensitive`, `aboutMe` or `useAccountMemory`, and no code
created `memory_entries` rows (W4 changed that, see 3.11). The one behavioural change is project memory
(resolver and redaction, below).

**Settings semantics decided in W3**

- `memoryEnabled`: the master switch. Off means no injection, no memory
  tools, no extraction; entries are kept. W3 shipped it default `false`; **W6
  changed the default to `true`** and added the separate
  `memoryExtractionEnabled` (default `false`), which resolves the 3.8
  deviation (see 3.12).
- `chatSearchEnabled`: default `true`.
- `memoryIncludeSensitive`: shipped with default `false`. Since the opt-in
  removal (section 7) nothing reads it: PATCH ignores the key (the body schema
  strips unknown keys), GET returns a constant `false`, and the column stays
  in `user_settings` because dropping it would rebuild the table (D1 rules in
  AGENTS.md).
- `aboutMe`: **legacy, null-only since the About-me migration.** The settings
  PATCH accepts only `null` (the user removing leftover text); any string is a
  400 from the body schema. GET moves the text into the `profile` entry (see
  "About me becomes a profile entry", section 7). The column stays (no
  rebuild).
- `projects.useAccountMemory`: default `true`; `null` means the default. It is
  settable since #532 (see 3.13, "Use account memory").
- All defaults live in app code (`MEMORY_SETTING_DEFAULTS`); the columns are
  nullable with no SQL `DEFAULT`, per the D1 rebuild rule.

**Settings API** (`/api/v1/profiles/settings`, GET and PATCH)

- Model and gateway are a pair per scope. Sending `<scope>MemoryModel`
  replaces both columns (a missing gateway means a direct provider); sending
  `<scope>MemoryGateway` without `<scope>MemoryModel` is a 400; a `null`
  model clears both.
- Validation order: body schema (400, which also rejects any non-null
  `aboutMe`) → gateway-without-model (400) → empty patch (400) → per-scope
  model check (`assertMemoryModelChoice`) → write. The whole request is
  rejected on any failure and nothing is written. The former `aboutMe`
  never-store (400) and sensitive-topic (422) gates, and their
  `settings-about-me` origin, are gone: the same checks now run once inside
  `createMemoryEntry` during the migration.
- GET runs `migrateAboutMeToProfileEntry` before reading the row (swallowed
  and logged as `attributes.memoryMigration.aboutMeError` on failure, so the
  GET never fails because of it) and returns `aboutMe` plus
  `aboutMeNotMigratedReason` (see the outcome table in section 7).
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
- The settings write is a single statement, except when it turns extraction on:
  then the forward-only stamp on the user's chats runs in the same `db.batch`
  (3.12). There is no purge step: the opt-out purge and its
  `sensitiveEntriesDeleted` response field were removed with the opt-in.

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
  `memory_include_sensitive` (unused, see above), `about_me` and the four
  model/gateway columns
  (`profile_memory_model`, `profile_memory_gateway`, `project_memory_model`,
  `project_memory_gateway`); the gateway columns are enum-typed in Drizzle
  only.

**Compliance gate** (`server/utils/memory/compliance.ts`)

Exported API: `detectNeverStore(text)` → sorted, merged `{ kind, start, end }`
spans; `redactNeverStore(text)` → `{ text, blocked, blockedTotal }` with each
span replaced by `[redacted]`; `evaluateMemoryEntry({ title, description,
body, sensitivity, extractorNeverStoreKind? })` → a verdict `{ allowed: true }`,
`{ allowed: false, reason: 'never-store', kinds }` or `{ allowed: false, reason:
'sensitive-topic', detectedCategories }`; `recordBlockedCounts`;
`recordSensitiveDetection`. The W3 opt-in helpers (`includeSensitive` input,
the `sensitive-disabled` verdict, `buildSensitiveMemoryPurge`,
`purgeSensitiveMemoryEntries`) no longer exist.

Priority: never-store beats sensitive-topic. An entry with a detector hit is
blocked as never-store; `sensitive-topic` is only reported when nothing
matched. The title, description and body are each scanned, and an
extractor-supplied `extractorNeverStoreKind` counts like a detector hit. The
classifier itself is described in 3.11.

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
matched text. Origins used by the current code: `memory-api`, `memory-tool`,
`memory-extraction`, `extraction` (sweep totals) and `about-me-migration`. The
W3 origins `project-memory-summary` and `project-memory` belonged to the retired
blob pipeline.

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

**Project memory and the gate (history).** In W3 the summarise and synthesise
prompts of the blob pipeline gained one sentence forbidding card, bank,
government/tax ID, passport and credential data, and both outputs were redacted
(a hit became `[redacted]`, the rest of the text was kept). The Art. 9 control
on that blob was prompt-only: one instruction sentence, no classification of
the output. W6b retired the blob pipeline (3.13), so nothing writes
`projects.memory` any more. Project memory is now entries, and every entry goes
through `evaluateMemoryEntry`, sensitive-topic classifier included. What is left
of the old design is the dormant column: text that predates the gate may remain
in it, it is never injected once entries are in use, and an unconverted blob
(migration pass failed) is still injected as is until the migration succeeds
(3.13).

**Open follow-ups**

- Resolved: the blob migration runs every derived entry through
  `evaluateMemoryEntry` (3.12, 3.13), so the Art. 9 handling of the old project
  blob is code-enforced for everything that becomes an entry.
- `neverStoreKindIds` in `memory-policy.ts` is a hand-written tuple, kept
  equal to the ids of `neverStoreKinds` (same ids, same order) by a unit
  test in `tests/unit/utils/memory-policy.spec.ts`.
- W4 now consumes the settings (injection, tools, see 3.11); W5 (UI) and W6
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
- Superseded by the opt-in removal (section 7): the original hand-over asked
  writers to guard inserts on the opt-in inside the same statement. There is
  no opt-in and no purge any more, so inserts guard only the cap and project
  ownership (3.11).
- The fallback tries OpenAI first, a provider the user may not have chatted
  with; it only needs a saved key. A chosen or chat-derived model may be
  expensive (3.9); only the fallback optimises for cost.

### 3.11 As built (W4, 2026-10-25)

> Body caps quoted in this section (2 KB, and 1 KB for profile and preferences)
> are the W4 values; W6c raised them to 4 KB and 1.5 KB, see 3.15.

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
  `evaluateMemoryEntry` on the trimmed title, description and body.
  `never-store` is a 422 whose `why` lists kind labels only; `sensitive-topic`
  is a 422 with the shared `SENSITIVE_TOPIC_REFUSAL_MESSAGE` and a `why` that
  names the detected category ids (classifier below). There is no opt-in to
  read from `user_settings`. The client-supplied `origin` is ignored: the
  route forces `user`, the tools force `tool`.
- **Create is one atomic statement**: `INSERT ... SELECT ... WHERE <cap guard>
  AND <project ownership guard> RETURNING id`, run through `db.all(sql)`. The
  cap (`maxAccountEntries` 30 / `maxProjectEntries` 15, counted per scope with
  `project_id IS ?`) is therefore exact under concurrency. The row is always
  inserted with `sensitivity = 'none'` and a null `sensitive_category`. Zero
  rows is diagnosed (404 / 409 limit). A unique-index violation (walked through
  the `.cause` chain, D1 wraps it) is a 409, never a 500.
- **Update** reads the stored row, builds the merged row, re-validates it with
  `memoryEntryInputSchema` (so the 1 KB `profile`/`preferences` rule applies to
  merged values), re-runs the gate on the merged text, then does a typed
  `UPDATE ... WHERE id AND user_id RETURNING`. It never writes `sensitivity`
  or `sensitiveCategory`, so a legacy `special` row keeps its label until the
  user deletes it. It is read-merge-write with no version check: concurrent
  patches are last write wins.
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
singleton exists, 422 never-store or sensitive topic. The export is
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
- **Budget** (`shared/utils/memory-tokens.ts`): since 2026-10-26
  `estimateMemoryTokens(text, family)` reuses the project knowledge factors
  (`KNOWLEDGE_CHARS_PER_TOKEN`, `countKnowledgeChars` +
  `estimateKnowledgeTextTokens`) for the tokenizer family of the send's model
  (`resolveKnowledgeTokenFamily`, threaded from the chat route through
  `buildMemoryInstructions` and `loadMemoryIndex`; the backfill estimate uses
  the memory model's family; the Memory page uses `default`). The former flat
  Latin 4 / Cyrillic 2.5 / other 1.5 under-counted Cyrillic on Claude (1.1),
  Qwen (1.5), DeepSeek and Kimi (1.8), so a full Ukrainian index could exceed
  its 2500-token budget there; it now trims further on those models (with 4
  profile + 4 preferences bodies at the cap a Ukrainian index on Claude also
  collapses the profile body). The measurements below were taken with the
  flat figures. Trim order (owner, 2026-10-26: the always-injected core is
  touched last), stopping at the first step that fits: descriptions of the
  other entries are cut to 60, 40, 20 and 0 characters; then those entry
  lines are dropped one by one, `drop-least-recently-used` (never-used
  entries first, then the oldest `lastUsedAt`, ties broken by the last index
  position); only when no such entry is left does the `preferences` body
  become a line, and last of all the `profile` body. A body collapse frees
  room, so dropped entries then come back, most recently used first, while
  they fit (when all come back, the drop step is not recorded). `profile`
  and `preferences` are never dropped. Steps that would change nothing are
  skipped and not recorded. A dropped entry stays stored and reachable
  through `memory_list`; the wide event logs `memoryIndex.droppedEntries`.
  With realistic caps (profile and preferences are one per scope, so at most
  two of each with a project) a full Ukrainian account plus project keeps
  both profile bodies on every family: on Claude the two preferences bodies
  collapse (the four bodies alone exceed the budget), on `default` 16
  never-used lines are dropped instead. The figures below predate this
  order. Measured with 100-character descriptions and two 1 KB bodies: 30 account
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
  forge an index line. Legacy `special` entries are always skipped,
  silently (`isInjectable`); new rows are never `special`.
- `buildChatInstructions` pushes the memory block **first**, then the project prompt,
  the chat-search line and the date clauses. Both call sites (the main
  `streamText` and the search-answer continuation) get the same
  `memoryInstructions`, computed once per send in
  `server/utils/memory/chat-context.ts`. A project chat loads project entries
  plus account entries unless `projects.useAccountMemory === false`. Nothing
  in `docs/providers/anthropic.md`'s invalidator list is affected: the block
  is stable text and changes only with entries.
- **Decision (2026-10-26): a leftover `aboutMe` is never injected.** The
  former `aboutMe` block kept text the compliance gate rejected flowing into
  every chat. Since then `loadMemoryRuntimeSettings` does not read the column
  at all: a migrated text travels as the `profile` entry, and an un-migrated
  one (too long, profile entry exists, memory off, rejected, entries full) is
  only shown on the Memory page as "Earlier about me (not used in chats)"
  with three actions: "Keep as new entry" (saves it directly: `profile`, or
  `topics` when a Profile entry exists, since `profile` is a singleton),
  "Edit and keep" (the entry modal, prefilled, so the user can remove what
  the gate refused) and "Discard old text".

**Flags** (`server/utils/memory/tools/enabled.ts`, `chat-context.ts`)

- `loadMemorySettingsFailClosed`: the route reads `user_settings` once per
  send. If the read throws, memory and chat search are both treated
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
them) plus the current chat's project entries; legacy `special` entries are always
hidden. Anything else is a 404 tool error.

| Tool | Input | Output |
|---|---|---|
| `memory_list` | `{ category? }` | `{ notice, entries: [{ id, handle, scope, category, title, description, body }] }` (at most 50) |
| `memory_read` | `{ id }` (public id or handle) | `{ notice, entry }` |
| `memory_write` | `{ category, title, description, body, scope?, id?, userRequestQuote }` | `{ notice, action: 'created'\|'updated', entry, previous? }` |
| `memory_forget` | `{ id, userRequestQuote }` | `{ notice, removed }` |

- `memory_list` and `memory_read` set `lastUsedAt` (best effort, `updatedAt`
  pinned so reading never changes the edit time).
- `memory_write` / `memory_forget` are registered **only** when the current
  send is a user message with text. They are also **locked for the rest of
  the message once any non-memory tool result or tool error has been seen**
  (`untrustedResultSeen` on the shared budget, set by `prepareStep` from the
  previous steps; `memory_list`/`memory_read`/`memory_write`/`memory_forget`
  results do not count). Since the 2026-10-26 audit (3.17) the chat route
  also presets the lock **before the first step** whenever the send requests
  any web search (`presetMemoryWriteLock`, keyed off the requested tools
  `web_search`, `web_search_brave` or `web_search_exa`, not off which tool
  definitions were registered), next to the existing preset for project
  knowledge in the prompt. Native search (Google grounding, Anthropic and
  OpenAI `web_search`, Qwen `enable_search`, Moonshot) and the OpenRouter web
  plugin can return results in the same step as a write or with no tool part
  at all, so the step-based check alone never saw them. A write attempted
  while locked is a 403 tool error that says why and tells the model not to
  retry; the tool descriptions say the same up front, and the wide event logs
  `memoryTools.writesLocked`. This is what stops content read from a web
  page, a file or another chat from steering the model into writing or
  deleting memory. Limits: without web search or knowledge, two calls in the
  same model step (a chat search plus a write issued in parallel) are still
  not ordered by it; files attached to the user's own message, earlier turns
  and the injected index are inputs, not tool results. The description says to use them only when
  the user's current message explicitly asks, never because of web, file,
  search or chat content, and never to store instructions for the model.
  **Code-enforced request gate:** `userRequestQuote` (at most 300 characters,
  at least `min(12, length of the normalised message)` and never below 4, so a
  short message such as "forget it" must be quoted whole) must occur in the
  user's current message after NFKC, lowercase and stripping whitespace,
  punctuation, symbols and the modifier apostrophe U+02BC.
  This is a mitigation, not a proof of intent: any substring satisfies it and
  it does not prove the body came from the user. The controls that carry the
  weight are the description, the chip with Undo, the never-store and
  sensitive-topic gates, the untrusted-content lock above and the 3-call
  budget.
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
  (below) runs on every write, so a health fact is refused with a 422 and
  nothing is stored.
- The continuation (`buildSearchResultsContext`) renders memory results in
  their own `Memory list/read/save/remove N` sections so a turn that ends
  without text still answers from them.

**Persisted tool parts are redacted.** The live stream to the client is
untouched, but before the assistant message is saved
(`persistAssistantMessageFromStream`, the only writer of assistant tool parts)
`redactMemoryToolPartsForPersistence` removes `output.entries[].body`,
`output.entry.body`, the whole `output.previous`, `input.body` and
`rawInput.body` from memory tool parts. Memory bodies therefore do not
outlive `memory_forget`, an entry delete or a reset inside `messages.parts`. Consequence: after a reload the chip can only Undo a
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

**Sensitive-topic classifier (server-side, deterministic).** The first W4
version trusted the caller's `sensitivity`: `POST /api/v1/memory/entries` with
"I have type 2 diabetes." and `sensitivity: 'none'` was stored. The classifier
closed that. `evaluateMemoryEntry` runs `classifySensitiveCategories`
(`server/utils/memory/sensitivity.ts`, rules in `sensitivity-rules.ts`) over
the title, description and body, after the never-store check. Classification is
deterministic only: no LLM ever labels or infers sensitive attributes, and the
`memory_write` tool and the extractor have no `sensitivity` or
`sensitiveCategory` fields.

- **Verdict.** A classifier hit, or a declared `sensitivity: 'special'` /
  non-null `sensitiveCategory` in an API body (`readDeclaredSensitivity`), is a
  `sensitive-topic` refusal. Interactive paths answer 422 with the message
  "Sensitive topics (health, religion, politics…) are not saved to memory.",
  a `why` of "This entry looks like sensitive data (health)." (category ids,
  never the text; "This entry is marked sensitive." when only a declared value
  triggered it) and a `fix` of "Remove the sensitive details and save again."
  Nothing is stored. Precedence: never-store, then sensitive-topic. One
  verdict for every path and every category, including the `people` category:
  there is no opt-in, per-entry consent or third-party special case.
- **Persisted rows.** Every row the service writes is `sensitivity = 'none'`
  with a null category. `special` and `sensitive_category` remain in the
  schema only for rows written before the removal. Those legacy rows are
  skipped by the index builder, hidden from the memory tools, shown to the
  extractor with the body hidden and locked (3.14), and still count toward the
  caps. The entries API still lists them, so the user can delete them.
- **Logging.** `attributes.memoryCompliance.sensitive = { origin, categories }`
  (ids only), merged across the writes of one request when the logger exposes
  its context; extraction logs once per pass; Origins: `memory-api`,
  `memory-tool`, `memory-extraction`, `about-me-migration`.
- **Vocabulary.** One auditable table covers all ten
  `memorySensitiveCategories` in English, Ukrainian and Polish (the table also
  carries Russian patterns), each pattern with examples that a spec requires
  it to match (this is what catches typos), plus a homoglyph guard. Matching
  is NFKC + lowercase, apostrophes folded, Unicode-aware word boundaries (not
  `\b`) and stems for inflected languages. Precision over recall: anything that
  is also an ordinary word needs a personal frame or an unambiguous noun ("I
  vote for tabs" and "diagnosed with a flaky test" are not flagged; voting
  needs a political noun; bare 'diet', 'church' in street names, 'Gay Street',
  'European Union', 'tennis court', 'weed', zodiac 'cancer', 'fingerprint
  sensor', 'Face ID', bare 'рак' / 'rak' / 'cancer' are not flagged).
- **Accepted limits.** Flagged although neutral: 'My pastor said hi', 'Ислам
  Махачев' (first name), 'Hindus in India statistics', 'political party
  registration rules', product-persona text with bare health words
  ('therapist', 'medication', 'allergic', 'pregnant', 'insulin'),
  'catholic'/'muslim' used bare. Not flagged although personal: 'I voted for
  Trump', 'I vote Labour', 'Głosowałem na PiS', 'I take drugs', "I'm a
  recovering addict", 'He died of cancer', 'I got divorced', 'Я розлучився', an
  unlisted condition after 'my diagnosis is', named politicians, slang,
  misspellings and mixed-script homoglyphs. Because a hit is now a refusal
  and not a label, a false positive is visible to the user as a 422 on a
  benign entry (they can reword it), while a miss stores special-category
  text. 'convicted of' / 'charged with' (with a crime word) land in
  `legal-dispute`, which overlaps the extractor-only never-store
  `criminal-history` kind (follow-up: decide whether that kind gets a
  deterministic detector). The extractor still carries a `neverStore` label for
  the topical never-store kinds (criminal history, immigration status, home
  address, live location): a model flag the server cannot verify and the only
  detector for those kinds.
- **No LLM pass**: it would spend the user's key on every write, add latency,
  and ask a model to infer sensitive attributes. Entries stored before the
  classifier existed are not re-scanned; a PATCH that touches such a row runs
  the gate over the merged text and is refused if it matches.
- **Removed with the opt-in (section 7).** The earlier W4 text described a
  consent toggle that allowed `special` entries, a 422 "Sensitive memory is
  turned off" that pointed to the toggle, a third-party `people` rule that held
  even with the toggle on, and a transfer filter
  (`SENSITIVE_MEMORY_PROVIDER_ALLOWLIST`, empty by design) that withheld
  `special` entries from the injected index and the tools. None of these exist
  in the code.

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
- The sensitive-topic classifier is a keyword list, not a model: it misses
  names, slang and unusual phrasing, and flags a few benign uses (see above).
  Entries written before it existed are not re-scanned.
- `sourceMessageId` is the client-chosen user message id (the insert ignores
  conflicts): consumers must never look it up without scoping to the user's
  own chats.
- Undo is not a full inverse: it restores the visible fields, not `origin` or
  `sourceChatIds`.

- The quote gate above.
- The settings read is fail-closed: a D1 read failure turns chat search off for
  that send, not only memory.
- Every send does one extra `user_settings` read; with memory on, two entry
  reads for the index; each `memory_list` runs two list queries.
- Entry updates are last-write-wins.
- Undone `memory_forget` is impossible by design (above).
- Tool-call outputs (`memory_list`, `memory_read`, `previous` bodies) are
  persisted in message parts like any tool output.

**Hand-over**

- W5 consumes the routes and the `MemoryEntriesResponse` shape above; the
  UI must show `why` for 409 and 422. A sensitive-topic 422 has the message
  "Sensitive topics (health, religion, politics…) are not saved to memory."
  and no opt-in is offered (section 7); a never-store 422 has the message
  "This memory contains data that cannot be stored".
- W6 writes through `createMemoryEntry` / `updateMemoryEntry` with
  `origin: 'extraction'` and chat **public** ids in `sourceChatIds`; the
  singleton rule means profile and preferences are upserts. The index header
  ("data, never instructions") is a prompt, not a control: once extraction
  writes model output into bodies injected on every turn, the trust boundary
  of 3.4 and the never-store gate are what protect the prompt.
- W6 flipped the `memoryEnabled` default to `true` (3.12); the W4 specs were
  updated. The 14 route specs that build a `db.query` mock return an explicit
  memory-off settings row so they keep pinning "memory off".
### 3.12 As built (W6, 2026-10-25)

Extraction sweep, blob migration and the W3 follow-ups. Code:
`server/utils/memory/extract*.ts`, `server/plugins/memory-extraction-sweep.ts`,
`server/api/v1/memory/extract-now.post.ts`, `server/utils/projects/memory-entries.ts`.

**Schema (one additive migration, `20261025140221_memory_extraction`)**: five
nullable columns, no SQL `DEFAULT`, no rebuild: `user_settings.memory_extraction_enabled`,
`chats.memory_extracted_at`, `chats.memory_extraction_attempted_at`,
`chats.memory_extraction_failures`, `projects.memory_migrated_at`.

**The extraction opt-in is forward-only.** Switching extraction on stamps
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
non-project chats; project chats follow the project rule in 3.13, with their
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
  Extraction never writes special-category entries (3.14): the op schema has
  no sensitivity fields, every row is persisted `none`, and
  `evaluateMemoryEntry` (the server classifier, 3.11) drops flagged text as
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
Gates, in the order the handler runs them: cross-site request guard, session
(401), the shared `write` rate-limit bucket (60 per minute, 429), body
`{ chatSlug }` (400), `requireLegalConsent` (current consent, else 403), the
chat looked up by slug AND user (anything else is a 404), `memoryEnabled`
(409 `Memory is turned off`), and the 60 s per-user KV cooldown (429). It is an
explicit action, so the API does not need "Generate memory from chats" and
runs even with that toggle off (section 7); the UI additionally shows the
button only while both memory and "Generate memory from chats" are on
(`Toolbar.vue`). It ignores the 10-minute idle rule. The cooldown key is
written only after a pass that ends `extracted` or `failed`, so a `skipped` or
`leased` result does not start it. A chat excluded from memory is skipped
inside `extractChatMemory` (`memory-excluded`), as for every trigger. Responds
with counts and the model source/id only.

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
retired in W6b (3.13), so nothing writes `projects.memory` any more. Known
limit: Art. 9 text that predates W3 may remain in the dormant blob column; it
is never injected once entries are in use and extraction never reads it as
anything but a grounding source for `create` ops.

**Settings API (for W5).** GET and PATCH carry `memoryExtractionEnabled`
(default false) and `memoryEnabled` (default true). The sensitive opt-in is not
part of v1: PATCH strips `memoryIncludeSensitive`, GET returns a constant
`false` (deprecated), and the stored column is ignored by the server (it was
not dropped because that would rebuild `user_settings`, see the D1 rules in
AGENTS.md). Model
validation failures throw (503 catalog outage, 429 rate limit, 400 unknown
model) and nothing is saved. `aboutMe` accepts only `null`.

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
- Turning extraction (or `memoryEnabled`) back on records the cut-over
  `memory_extraction_enabled_at` and stamps the chats that may hold activity
  from the off period (never stamped, or stamped before their last activity),
  so that period is never mined. Since the 2026-10-26 audit (3.17) it no
  longer rewrites every chat on every toggle, and turning it on is limited to
  once per 10 s per user (KV timestamp, 429).
- The KV lease and the `extract-now` cooldown are check-then-set, not atomic;
  a burst can run duplicate passes on the caller's own key. Results stay safe
  (unique slugs, origin rule); an owner-token or Durable Object lease is the
  upgrade if it matters.
- Chat deletion is wired: both delete routes (single and bulk) call
  `detachChatsFromMemory` before the row delete, which deletes `extraction`
  entries whose only source is the deleted chat and drops the id elsewhere
  (3.7). A pass whose model call outlives the delete re-reads the chat
  afterwards and is skipped as `chat-unavailable` (audit finding 9, 3.17).
  Since 2026-10-26 every write that records the chat as a source (the
  create `insert ... select`, the merge and source-only updates) also carries
  `exists (select 1 from chats where id = ? and user_id = ?)`, so a delete
  that lands between that re-read and the write leaves nothing behind; the
  op and every later op of the pass are dropped as `chat-unavailable`. A
  narrow window remains: a pass whose write lands between the detach and the
  row delete (the chat row still exists then) can still write.
- Memory extraction, import and the project refresh call `generateText`
  with `output: Output.object({ schema, name: 'MemoryExtraction' })` and read
  `result.output` (2026-10-26; `generateObject` is deprecated in AI SDK 7).
  The research clarifier still uses `generateObject`.
- The topical never-store classes are detected by the extractor's
  `neverStore` flag and, for home address, immigration status and criminal
  history, by narrow deterministic detectors (3.17); live location and
  "other" stay extractor-only. Art. 9 data is classified by the server (3.11), not by
  the extractor, and extraction drops flagged ops (3.14). User-pasted text that
  contains instructions is still user-role text (prompt-level defence only).
- The extraction sweep is not run on Previews (no crons); use `extract-now`.

### 3.13 Project memory as entries (W6b, 2026-10-26)

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
  never processed twice. Too-short windows accumulate, as in 3.12;
- moving chats (single or bulk) no longer calls an LLM and the chat page no
  longer posts a refresh after every send; they only mark the project `stale`.
  Updating project memory is the explicit Refresh button, or the opt-in sweep
  (next paragraph).

**Project chats are swept only with the opt-in (owner, 2026-10-26).** The
sweep extracts a project chat into project-scope entries only when
`memoryEnabled` is not off AND `memoryExtractionEnabled` is on, the chat's
project exists, belongs to the same user and is not `disabled`, and the chat has
activity after the recorded cut-over (see the final decision section, "No
background model calls without an explicit opt-in"). With the toggle off the
only project paths are the explicit Refresh button and `extract-now`. The model
is the project memory model from `resolveMemoryModel` (scope `project`) on the
user's own key. Selection, lease, caps, trust boundary and the compliance gate
are the same as in 3.12.

**The sweep settles the project card (2026-10-30).** Every project chat
message, create, move, delete and branch marks the project `stale` and sets
`memory_dirty_at`, but a sweep pass used to bump the metadata only when it
applied ops and never cleared the mark, so a project whose chats were all
swept read "Out of date" until the manual Refresh. After a sweep pass that
extracted, or skipped as `no-user-text`, `nothing-durable` or `too-short`,
`settleProjectMemoryAfterSweepPass` (`server/utils/projects/memory-sweep-settle.ts`)
re-evaluates the project in one guarded `UPDATE`: it sets `ready`, or `idle`
without entries (the same `projectMemorySettledStatus` the manual Refresh
uses), and `memory_dirty_at` and `memory_error` to null, only when the row is
`stale`, `failed` or `unavailable` (never `disabled` or `refreshing`; a
successful pass proves the key works, so a card left failed or unavailable by
an earlier manual Refresh recovers), the dirty mark is strictly older than the pass
start (a message or move that arrived mid-pass keeps it `stale`), and no chat
is left for the sweep. A chat is left when it is in the project, memory-included,
newer than its project watermark, newer than the user's
`memory_extraction_enabled_at`, and not parked. Parked means it is waiting for
more user text (`memory_extraction_failures` 0) or is capped on failures
without activity since the last attempt: the sweep never selects it again
until a new message, so it cannot keep the card stale (a too-short chat settles
the card, as the manual Refresh does). Decision: chats from before the cut-over
never count, because the forward-only rule means the sweep will never read
them; a project with only those chats left is up to date for automatic
purposes, and Refresh still reads them on request. No model call is added and
what is extracted is unchanged; failed passes do not settle, so a chat that
will be retried keeps the project `stale`.

**Copy for the UI (W5).** Project card hint: "Press Refresh to update this
project's memory. Turn on 'Generate memory from chats' in your memory settings
to keep it up to date automatically." Memory tab note next to "Generate memory
from chats": "Runs on your own API key, only for chats you use after turning it
on. Past chats are only read when you build memory from them yourself."

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

**Use account memory is settable (#532).** `PATCH /api/v1/projects/:id/memory`
takes either `{ enabled, useAccountMemory? }` or a strict
`{ useAccountMemory }` alone; the second form changes only the sharing choice
and leaves the enabled state, the entries and refresh untouched
(`setProjectUseAccountMemory`, ownership in the `UPDATE ... WHERE`, a foreign
project reads as 404). It stores an explicit `true` or `false`; `null` stays
the "never chosen" state and reads as the default `true`. The card returns
`useAccountMemory`, and the project card shows a "Use account memory" toggle
(`Projects/MemoryCard.vue`, `project-memory-account-toggle`). With it off, the
chat's memory index holds only the project's entries, the memory tools see
only project scope (`accountVisible` is false), and `search_chats` is limited
to that project's chats (3.3, 3.11). No schema change: the column has existed since W3.

**Open for the owner.** The project cap stays at 15 entries (`maxProjectEntries`):
if "not that big" means more entries, raising it grows the project part of the
index (budget 2.5k tokens shared with account memory, 3.2) roughly linearly.

### 3.14 Special-category data is never stored (extraction and every other path)

Decision from the legal research (GDPR Art. 9; CJEU C-184/20 and C-252/21 on
data that indirectly reveals special categories; OpenAI's prohibition on
inferring sensitive attributes), made final by the owner on 2026-10-25 (section
7): no sensitive opt-in in v1, so there is no mode in which extraction or any
other path may store such data.

- **Automatic extraction never writes special-category entries.** The
  extraction output schema has no `sensitivity`/`sensitiveCategory`, so the
  model is not asked to label sensitive attributes; the prompt tells it to
  record the plain fact and drop the sensitive reason ("vegetarian", not
  "vegetarian for religious reasons"), to omit facts that only make sense
  with such a reason, and that the server rejects such data anyway. Server
  side every extraction op (create, merged create and update, on the exact
  persisted text) goes through `evaluateMemoryEntry` with `sensitivity:
  'none'`, which runs the deterministic classifier (`classifySensitiveCategories`,
  3.11). A hit is dropped and counted as `sensitive-topic`; the detected
  category ids (never the text) are logged once per pass under
  `memoryCompliance.sensitive` with origin `memory-extraction`. The blob-only
  pass (3.13) uses the same pipeline. Every persisted extraction row is
  `sensitivity: 'none'`.
- Legacy `special` rows (written before the removal) are loaded into the
  extraction index with their body hidden but are left out of the rendered
  `<memory-index>`, so the model never sees them, and they are locked: an
  update or delete is dropped as `locked` and a create with the same slug as
  `duplicate`. They still count toward the scope cap.
- The other paths use the same gate: UI/API writes and `memory_write` get a 422
  (3.11); the About-me migration (section 7) runs the same gate and keeps rejected text in `about_me`.
- The classifier is merged and wired in, so there is no ship gate on it. Its
  recall limits (names, slang, unusual phrasing; see 3.11) apply to extraction
  as well; the prompt instruction remains the first line of defence.

### 3.15 Rich memory, backfill and import (W6c, 2026-10-26)

Owner request: entries were too thin (one or two bullets per topic) while
Claude.ai keeps topics of 1.9-3.5 KB with ~15 detailed bullets. Server side
only; the UI (W5) builds on the contracts below.

**Caps.** `maxBodyBytes` 2048 -> **4096** (areas, topics, people),
`maxAlwaysInjectedBodyBytes` 1024 -> **1536** (profile, preferences). Index
budget unchanged (2500 tokens). Measured with `estimateMemoryTokens`, 30
account entries with 100-char descriptions and bodies at the cap built from
realistic bullet lines: 4 profile + 4 preferences + 22 others costs 3996
(Latin) / 3775 (Cyrillic) tokens untrimmed and settles at 2330 / 2301 after
`preferences-body` and `descriptions-60`, never touching the profile bodies.
With profile-only bodies the profile body is first trimmed at 6 (Latin) / 7
(Cyrillic) full-size profile entries; each extra full-size profile body costs
~355 tokens. **Owner call, not built**: a per-category count cap of at
most 4 profile and 4 preferences entries would guarantee the profile body is
never collapsed; today only the 30-entry account cap and the per-scope
singleton slug for `profile` and `preferences` exist. The cap is in bytes, so Cyrillic (2 B/char) fits fewer characters
but costs the same or fewer tokens.

**Extraction prompt aims for rich, merged topics.** The prompt states the hard
limits the models kept violating (title <= 80 chars, description one line
<= 100, body bytes per category), asks for a markdown bullet list of concrete
durable facts with names, dates, numbers and versions in the user's language,
topic granularity like Claude (Career, Dev tools, Hobbies, Projects/areas, one
People entry per person), and shows the existing bodies (index body budget
12000 -> 48000 chars, ordered by `updatedAt` desc, the rest `bodyHidden`).
New op **`append`**: only the new bullet lines; the server drops lines already
present (normalised compare) and appends the rest within the category cap
(`cap-reached` otherwise); it works on editable entries even when the body is
hidden, so merging no longer depends on the body budget. `update` is a full
rewrite for corrections only; `create` for a topic without an entry. Per pass:
10 ops (15 with a legacy blob), `maxOutputTokens` 4000 -> 12000 clamped to the
resolved model's output limit where the catalog knows it (Cloudflare gateway
models are never clamped), background passes get a 150 s model timeout
(request-bound refresh and import keep 90 s because of the edge limit).
The trust boundary, the never-store gate and the sensitive-topic classifier are
untouched: richness never relaxes them.

**Editable family.** Chat extraction passes may update, append to and delete
rows with `origin` `extraction` or `import`; `user` and `tool` rows stay
locked. The import pass is narrower (it ingests text the user did not write):
it may create freely but append to or update only rows with `origin` `import`
and never deletes, so a pasted document cannot rewrite what chats produced or
the always-injected profile and preferences. Every extraction write is
compare-and-set on the row it read (editable origin, `sensitivity = 'none'`,
same `updated_at` and body; `append` re-reads and recomputes against the fresh
body), so a user edit made during the model call is never overwritten and two
concurrent passes keep each other's lines (`conflict` otherwise).
Decision for the owner: a user-authored entry for a topic locks that topic
against extraction, whose same-topic `create` collides as `duplicate`.

**Grounding (fix of the "I'm vegetarian" drop).** The preview dropped "I'm
vegetarian" as `ungrounded` because the evidence floor was 20 chars and 3
words, and typographic apostrophes (`I’m`) did not match. The normaliser now
maps typographic quotes, dashes and ellipses to ASCII. Rule: the quote must be
a verbatim substring of the user's text (or, for the legacy blob, of the blob,
for `create` only) and, in both branches, shares a content token (>= 4 letters
or digits; exact match or a common prefix of >= 5 chars so inflected forms
match) with the text being stored (for `update` only the changed delta, for
`append` the new lines), and either (a) is >= 20 chars and >= 3 words, or (b)
is >= 8 chars and sentence-aligned in the user text. A quote like "thanks a
lot for your help" next to an unrelated injected body fails; URLs, emails and
domains in the stored text must still occur verbatim in the user text.
Evidence is a provenance filter, not proof: the token check is measured
against text the same model wrote. Evidence is
never persisted and the classifier checks only title, description and body, so
the plain fact ("Vegetarian") is stored and the sensitive reason is not.
Known limits: generic 4-letter words can still be the shared token; employer
or place names that look medical can still trip W4's classifier
rules (not changed here).

**Backfill: "Build memory from past chats"** (account chats only).
Forward-only extraction is unchanged; this is an explicit, cancelable job.
State lives in the new table `memory_backfill_jobs` (migration
`20261025204559_memory_backfill_jobs`: `CREATE TABLE` plus two indexes, no
SQL default, cascade FK on `users`; a partial unique index on `user_id WHERE
status = 'running'` allows one running job per user atomically; added to the
cascade list in AGENTS.md and to `purgeUserData`). The queue is a keyset
cursor over the user's non-project chats (`activity_at desc, id desc`, created
before the job started); counters are updated with atomic increments, so the
cron sweep and the drive endpoint can both advance a job. The model is resolved
once at job start (`resolveMemoryModel`, scope `profile`) and the same
selection is used for every chat, so the estimate does not lie. A job reaches at most `MEMORY_LIMITS.backfillMaxChats` (200) chats of its
window; the start count and the estimate aggregate only that capped set, so
they always describe exactly the chats the job will read
(`backfillCappedChatIds`, `server/utils/memory/backfill-queue.ts`). The window
comes from `resolveBackfillWindow`, without any schema change:

- No finished job yet: a fresh window, every eligible chat created up to now,
  from the newest.
- The latest finished job stopped before its queue ran out (it reached the
  chat cap, was cancelled, or failed): the new job **continues** it. It keeps
  that job's `created_before` and starts after its `cursor_activity_at` /
  `cursor_chat_id`, which are copied into the new row, so no chat is paid for
  twice and older history stays reachable 200 chats at a time. The sheet
  says "next N older chats".
- The latest job completed because its queue ran out: every past chat has
  been read. GET answers `reason: 'all-chats-read'` and POST answers 409
  `All past chats were already read`, and no job is created. Chosen over
  "start fresh only if new eligible chats exist" because a fresh job always
  starts from the newest chats and would re-read (and re-bill) the old ones
  too, while bounding it below by the old cutoff would need a stored lower
  bound, which is a schema change; chats created after the cutoff are the
  forward sweep's job anyway.
- **Start over (2026-10-26).** In the `all-chats-read` state the sheet offers
  "Read all past chats again". It loads `GET ?restart=true` (the estimate of a
  fresh window from the newest chat, never `all-chats-read`) and starts only
  when the user confirms, with `POST { restart: true }`; that explicit action
  is the consent to re-read and re-bill chats earlier runs already read.
  `resolveBackfillWindow(..., { restart: true })` ignores every earlier job,
  and the job caps (200 chats, 4M tokens) are unchanged.
- A memory Reset (`account` or `all` scope) calls `clearBackfillWindow`: it
  cancels a running job and deletes every backfill job of the user, so the
  next backfill starts fresh from the newest chats. A project reset leaves
  the backfill alone (backfill reads account chats only).

Passes run with
`trigger: 'backfill'`: gate `memoryEnabled !== false` and
`memoryExtractionEnabled === true` (a job is cancelled when either is switched
off, or when the user resets memory), project chats skipped, the chat's history
up to its current `memory_extracted_at` (the opt-in stamp, so the pre-opt-in
history; messages after the stamp belong to the forward sweep; history the
forward sweep already extracted may be read again, merging keeps that
harmless but it is paid work), limited like any pass to the newest 120
messages / 36000 chars of a chat, `memory_extracted_at` advanced only when it
was NULL, no attempted/failures stamping. The cron path uses a 150 s model
timeout, the request-bound drive endpoint at most 90 s (or the remaining step
budget). A D1 step claim (`lease_until`, one atomic `UPDATE ... RETURNING`)
serialises the cron ticks and the drive endpoint; it is released only while
it still holds the value that step wrote, so a step that outlived its lease
never clears the claim of the step that took the job over. Memory read by the
model is redacted of never-store data first (all chat passes, not only
import).

**Throughput (2026-10-27).** The first production run (200 chats, Claude
Haiku, the TypeSafe AI pre-filter on) processed 29 chats in 12 minutes: the
drive endpoint took 2 chats per step behind a 10 s cooldown, and the only
background path was the `*/5` sweep at 3 chats per tick, about 5.5 hours for
200 chats. Now:

- A dedicated `* * * * *` cron (`server/plugins/memory-backfill-sweep.ts`,
  `NUXT_MEMORY_BACKFILL_SWEEP_ENABLED`, `NUXT_MEMORY_BACKFILL_SWEEP_MAX_RUNTIME_MS`
  = 45 s) runs `sweepBackfillJobs` every minute. The `*/5` sweep still
  services backfill from the budget its normal batch leaves; at :00, :05 and
  so on both fire and the job lease serialises them.
- `sweepBackfillJobs` reads up to `backfillJobsPerTick` (20) running jobs,
  least recently progressed first, and serves them round-robin in slices of
  `backfillChatsPerJobSlice` (5) chats, each slice its own leased step, until
  the tick budget or `backfillChatsPerTick` (60) is spent. A job leaves the
  rotation when its lease is held elsewhere, when it finished, or when a slice
  processed fewer chats than asked. Chats inside a job stay strictly
  sequential (see the decision log). A chat starts only while budget is left
  and keeps the 150 s background model timeout; the lease covers it, so a slow
  last chat can delay the next tick's turn for that job but never double-step
  it, and is far inside the 15-minute cron wall limit.
- The drive endpoint runs up to `backfillChatsPerStep` (10) chats per step,
  starting none with less than 30 s of its 60 s budget left, behind a 3 s
  drive cooldown (`MEMORY_LIMITS.backfillDriveCooldownMs`, shared with the
  client loop); the start cooldown stays 10 s.
- **Kill switch.** `NUXT_MEMORY_BACKFILL_SWEEP_ENABLED=false` stops every
  cron path from touching backfill jobs: the dedicated minute cron returns at
  once, and the `*/5` extraction sweep receives the flag as
  `isBackfillEnabled` and skips its `sweepBackfillJobs` call (extraction of
  new chats is unaffected; it has its own `NUXT_MEMORY_EXTRACTION_SWEEP_ENABLED`).
  Running jobs stay `running` and resume when the flag is back. The
  interactive drive (`POST /memory/backfill/step`) is user-driven and is not
  gated: an open sheet still advances its own job, and `POST /memory/backfill`
  still starts one, so the switch stops background spend, not user-initiated
  work.
- **Transient provider failures.** A chat whose model call fails with a rate
  limit (429), an overload or server error (408, 425, 5xx, 529, including a
  provider-side 504) or a dropped connection ("fetch failed", "Network
  connection lost", socket hang up, ECONNRESET), before any tokens were spent,
  is not recorded: the step stops, `retried_chat_id` and `chat_attempts` stay
  stamped, and the job leaves this tick's rotation, so the chat is retried at
  the next tick or step. The retry reuses the existing attempt budget
  (`maxChatAttempts`, 2): the second transient failure is recorded as a failed
  chat, as before. Permanent, recorded at once: invalid key, model not found,
  400/401/403/404/422, a refusal or malformed output, a 429 whose body says the
  quota or billing is exhausted (`insufficient_quota`, "credit balance",
  "exceeded your current quota"; an unknown 429 stays transient), and the
  deadline this pass set itself (`AbortSignal.timeout`, 90 s interactive, 150 s
  background: a `TimeoutError` or `AbortError`). A deadline abort means the chat
  is too slow or long, and a retry would charge the user's key again for a
  call whose usage was never recorded. The classifier is
  `isTransientMemoryExtractionError` (`extract-error.ts`); the status wins over
  `isRetryable`, it walks `lastError` and `cause` (the AI SDK wraps retried
  failures in a `RetryError`), and `extractChatMemory` reports it as
  `isTransientFailure` on a failed result.
- **Client backoff.** The step response carries `isBusy` (the cron holds the
  job's lease) and `isRetryPending` (a chat waits for a later step). The
  client then waits 10 s (`MEMORY_BACKFILL_BUSY_BACKOFF_MS`) before the next
  drive instead of 3.25 s, so on production, where the cron usually holds the
  lease, the sheet polls about every 10 s, and a provider blip cannot burn
  both attempts of a chat within seconds.
- **Idle cron events.** evlog's `sampling.keep` (status >= 400, duration >=
  1000 ms) only force-keeps; with no `sampling.rates` configured every event is
  kept, so a no-op minute would be ingested 1,440 times a day. The backfill
  cron therefore returns without `logger.emit` when it serviced no job,
  processed no chat and failed none; any failure or real work still emits.

Expected rates for one job (sequential chats): a chat that is too short or
that the pre-filter skips costs about 0.5 to 2.5 s, a full extraction with a
fast model about 5 to 15 s. With the sheet open that is about 25 to 60 chats
per minute for skip-heavy history and 5 to 10 for extraction-heavy history;
in the background (45 s of starts per minute) about 20 to 60 and 4 to 8.
The owner's run (28 of 29 chats skipped) finishes 200 chats in roughly 5 to
10 minutes either way. Limits checked: cron CPU is 30 s per invocation for
intervals under an hour (the 60-chat cap bounds it; per-chat CPU is estimated,
not measured, at tens of ms, since waiting on D1, KV and the providers does
not count), a
paid Worker has 10,000 subrequests per invocation (a chat is about 30), and
each chat holds at most one model stream plus sequential D1/KV calls, well
under the 6 simultaneous connections.

API (all session-scoped; POSTs have the cross-site guard):

- `GET /api/v1/memory/backfill` -> `{ job, estimate, reason }`. No running job:
  `estimate` is a dry-run for the resolved model (null with `reason`
  `memory-disabled | extraction-disabled | all-chats-read | no-model | estimate-failed | estimate-cooldown` when unavailable; the dry-run estimate covers the next job's window, carries `continuesPreviousRun`, and is cached per user for 10 minutes, keyed by model and window; a failed estimate is cached as a failure marker for 60 s, and a cache miss computes at most once per 30 s per user (`lookupBackfillEstimate`), so flipping the memory model cannot force a recompute on every GET) and
  `job` is the latest finished job or null; a running job: its progress.
- `POST /api/v1/memory/backfill` -> `{ job }`: START only (409 when a gate
  fails, no model, every past chat was already read, or one is already
  running; 10 s start cooldown). It never
  drives, so a retry or a second tab can never begin a second full-history
  run.
- `POST /api/v1/memory/backfill/step` -> `{ job, isBusy, isRetryPending }`:
  drives ONE bounded step of
  the running job inline (up to 10 chats, 60 s step budget, no chat started
  with under 30 s left, model timeout min(90 s, remaining), 3 s per-user
  cooldown -> 429); 409 `No running backfill` when
  none runs (it never starts one). This is how previews (no crons) progress
  when the UI calls it repeatedly.
- `POST /api/v1/memory/backfill/cancel` -> `{ job }`, idempotent.
- Progress (`shared/types/memory-backfill.d.ts`): `{ id, status
  (running|completed|cancelled|failed), startedAt, finishedAt, totalChats,
  processedChats, createdEntries, updatedEntries, skippedChats, failedChats,
  dropped, model: { source, providerId, gatewayId, modelId } | null, estimate }`.
- Estimate: `{ chats, userChars, transcriptChars, inputTokens, outputTokens,
  overheadTokensPerChat, pricePerMillion: { input, output } | null, costUsd |
  null, approximate: true, model }`. Characters come from one SQL aggregate over
  `messages.parts` with `json_each` (supported on D1; text parts only, capped per
  message and per chat), tokens from `estimateMemoryTokens` on a sampled script
  mix plus a per-chat overhead (instructions and the index, which dominates for
  many short chats), prices from the model's price metadata (direct models: the
  upper-bound parse of the "from" price underestimates tiered models; gateway
  models: the cached catalog). Unknown price gives null cost. Everything is
  approximate. A job fails when >= 5 chats failed and failures exceed half of the
  processed chats, 5 chats fail in a row, the stored model's key is gone, or the
  actual token spend (accumulated on the job row as `inputTokens`/`outputTokens`)
  exceeds 1.5x the consented estimate or reaches the hard ceiling
  `MEMORY_LIMITS.backfillMaxTokens` (4M input plus output tokens), which
  applies even when the estimate failed at start (`spend-limit` either way).
  A job completes after `backfillMaxChats` chats. The backfill sheet states
  both limits. Only the last 5 finished jobs per user are kept.
- Cost lever, not built: batching several short chats into one backfill pass
  would cut the per-chat overhead.

**Import from another assistant** (`POST /api/v1/memory/import`). Body
`{ text }` (<= 60000 chars). It is the legacy-blob pass generalised
(`extractMemoryFromText`): pasted text is user-provenance and grounds create,
append and update; never-store text is redacted before anything is sent;
chunks of 24k chars, at most 3 per request, one shared deadline (90 s), the
rest reported as `truncated` with `consumedChars` so the client can resubmit
`text.slice(consumedChars)` (the cooldown is written before the first model call
to stop parallel POSTs and released again when the result is `truncated`, so
the continuation is not blocked); up to 20 ops per chunk; no `delete` ops; the same compliance gates, caps
and merge behaviour; created rows get `origin: 'import'`, updated rows keep
theirs; `user` and `tool` rows stay locked. Requires `memoryEnabled !== false`
only (explicit action), 60 s per-user cooldown after a model call (429), 409
when no model resolves or an import is running, 400 when nothing storable is
left, per-user lease. Response:
`{ created, updated, appended, dropped, blocked, chunks, truncated,
consumedChars, model: { source, modelId } | null }`; the text is never stored,
echoed or logged. `MEMORY_IMPORT_PROMPT` (`shared/utils/memory-import-prompt.ts`)
is the prompt the UI shows for the user to run in the other assistant (list
everything it remembers as topics with bullet details, concrete facts, the
user's language, skip sensitive topics, plain text).

### 3.16 As built (W5, Memory tab UI)

Short note; the contracts it consumes are in 3.11, 3.12 and 3.15. W5 shipped in
two parts (#509, then #514), and later workstreams added cards to the same
page; this section lists the page as it is on `feat/memory-p3`.

- Page `app/pages/profile/memory.vue` (profile layout, signed-in only,
  `noindex`). It stacks the components under `app/components/Profile/Memory/`:
  `Controls.vue` (Use memory, Generate memory from chats, chat search),
  `NeverKept.vue` (the never-store kinds from `shared/utils/memory-policy.ts`),
  `Models.vue` with `ModelPicker.client.vue` (account and project memory
  models, 3.9), `ExtraChecks.vue` (the TypeSafe AI key status card, 3.19),
  `CacheInfo.vue` and `Entries.vue`, in that order. The page has no sensitive
  opt-in card (section 7).
- `Entries/` holds the entry list (`Essentials.vue` for `profile` and
  `preferences`, `Group.vue`, `Row.vue`, `DetailModal.client.vue`, `Empty.vue`),
  the toolbar (`Toolbar.vue`: "Update now" calls `extract-now` and shows only
  while both toggles are on, plus the backfill and import entry points), the
  sheets (`BackfillSheet.client.vue`, `ImportSheet.client.vue`) and the project
  memory list (`Projects.vue`, `Project.vue`). `Entries.vue` also mounts the
  "tell Besidka what to remember" box (`Instruct/Box.vue` and
  `Instruct/Preview.vue`, 3.18).
- State: `app/composables/memory-settings.ts` (optimistic PATCH with per-key
  rollback on error), `memory-backfill.ts`, `memory-projects.ts`,
  `chat-memory-exclusion.ts` (the per-chat "Don't use this chat for memory"
  toggle, 3.7); copy and helpers in `app/utils/memory-backfill.ts` and
  `app/utils/memory-instruct-diff.ts`.

### 3.17 Security audit 2026-10-26

Scoped source-only audit of the memory and project knowledge code on
`feat/memory-p3` (no High or Critical finding; tenant isolation held). The
memory-side findings and what was done; the knowledge findings 5-8 are
handled separately.

| # | Finding | Disposition |
|---|---|---|
| 1 | Medium: the memory-write lock missed web search in the same step or without a tool part | Fixed: the route presets the lock before the first step on any requested web search (3.11) |
| 2 | Medium: every off-to-on extraction toggle rewrote all chat rows | Fixed: per-chat stamps stay (they floor the account sweep and cap backfill), restamp only chats with activity since their stamp, 10 s per-user enable cooldown (3.12) |
| 3 | Low: a client `slug` skipped the compliance gate | Fixed: slug removed from the entry input, always derived from the gated title (3.1) |
| 4 | Low: the backfill estimate scanned the full history with an easy-to-bypass cache | Fixed by bounding: the estimate aggregates only the at most `backfillMaxChats` chats of the next job's window (3.15); the cache is additionally keyed by window |
| 9 | Low: extraction could attach entries to a chat deleted during the model call | Fixed: a missing chat ends the pass as `chat-unavailable`, and every write carries an atomic `exists(chat owned by user)` guard; a narrow detach-to-delete window remains (3.12) |
| 10 | Low: never-store detectors missed non-ASCII digits, other separators, spaced PESEL, NIP keyword after the number, AWS secrets with `/`, Polish `hasło to X` | Fixed in `compliance.ts` with table-driven positive and negative specs |
| 11 | Low: the sensitive-topic classifier missed hidden characters, unaccented Polish and Latin look-alikes in Cyrillic | Fixed in `sensitivity.ts`: format characters and stray marks stripped, look-alikes folded, a diacritic-folded Polish pass |
| 12 | Low: home address, immigration and criminal history were enforced only by the extractor label | Fixed: narrow deterministic detectors in `evaluateMemoryEntry` (`topical-never-store.ts`), so every write path refuses them with the unchanged 422 |
| 13 | Low: a backfill with a failed estimate had no spend cap | Fixed: hard per-job ceilings `backfillMaxChats` (200) and `backfillMaxTokens` (4M), stated in the backfill sheet; a later job continues after the previous job's cursor instead of re-reading the same chats, and starting is refused once every past chat was read (3.15) |
| 14 | Low: each sweep tick read every idle chat of opted-in users | Fixed by bounding: the chats index range starts at the opt-in cut-over, and since 2026-10-26 the partial index `idx_chats_memory_due` holds only dirty, non-excluded chats (section 7, "D1 cost of the sweep") |
| 15 | Info: the export omits processing records and knowledge | Docs only: recorded as a known gap (3.7) |
| 16 | Info: incognito chats are documented but not built | Built 2026-10-26 as the per-chat memory exclusion flag (3.7) |

**Follow-up from the delta verification (2026-10-26).**

- Card separators: `/` and `_` count only inside a whole, isolated card
  layout (4-4-4-4 up to 19 digits, or 4-6-5 Amex) with one separator
  throughout, and Luhn still applies. Commas are not card separators. The
  wider join had flagged 15-39% of comma-joined numbers, comma-thousand
  numbers and y/m/d date lists in 5000-trial runs, and `redactNeverStore`
  writes `[redacted]` into extraction input, import chunks and the legacy
  `projects.memory` blob. It is now 0% on those inputs; four space-separated
  4-digit numbers stay at about 6% because that is a real card layout.
- Topical detectors: the street rule needs a house number plus a capitalised
  street name (a case-preserving view), or an address cue ("my address:",
  "I live at", "mieszkam przy" plus a capitalised name, "мешкаю за
  адресою"). Permit, protection, refugee, green card, visa and immigration
  status terms need a first-person or possessive status statement ("my work
  permit expires", "I have temporary protection"). Criminal-record terms need
  a possessive or "has a criminal record".
- Classifier normalisation: Latin letters lose their accents after
  decomposition (`diabétes`), Polish diacritics and Cyrillic letters are
  kept, and look-alikes inside a mixed-script word are folded to the word's
  main script in both directions (`hіv`, `дiабет`); the `heroinę` escape still
  works.
- Smoke-test gaps (2026-10-26): a 48-snippet labelled smoke test (EN, PL,
  UK) showed 11 gate errors, now all fixed and pinned in
  `compliance-evasion.spec.ts` as a table with the expected label of every
  snippet. Political opinion: party votes without "for" ("I vote Labour",
  "Green" only with an election or party cue, so "I vote green for the logo"
  stays clean), quoted or named parties after a vote verb ("Głosowałam na
  Lewicę", "голосувала за «Європейську Солідарність»"), and the election
  noun before the verb ("на останніх виборах я голосувала за"). Ethnic
  origin: "I'm half/part/a quarter <demonym>" over a fixed demonym list,
  "mixed-race", "biracial", and "of/my <demonym> descent|heritage". Religion:
  identity words (Catholic, Muslim, atheist, religious, katolik, віруюч,
  верующ…) now need a first-person, possessive, named-person ("Anna is",
  "Анна —", "Anna jest"), "raised", "converted to" or "Religion:" frame, and
  the frame takes negations, because "I'm not religious" is belief data too.
  Extracted entries are often elliptical, so an identity word that starts a
  line or sentence and ends its clause also counts ("Devout Catholic",
  "Atheist", a `Religion` title over a `Catholic` body, "Католичка, ходить
  до церкви"), except a bare "Christian", which is also a first name.
  Worship places take one word in between ("attends Catholic mass", "goes
  to the temple"), and "votes Labour", "prays five times a day" and "is in
  a trade union" match without a subject.
  An essay on the Catholic Church is no longer caught: 0% of generated essay
  sentences against 67.5% before. Trade unions: "trade union" needs a
  membership or possessive frame, so a CRM for a union client is clean.
  Orientation: "Мій найкращий друг — гей" (possessive plus dash). Spaced
  letters: three or more single letters separated by spaces or tabs are
  joined before matching (`d i a b e t e s`), never across a line break; an
  accepted edge is a leading article joining in (`a d i a b…`). Never-store:
  a strong password label followed by a prepositional phrase and a colon
  ("пароль від пошти: …", "hasło do poczty: …") with a digit or symbol in
  the value and no URL, and a PIN of 4 to 8 digits after "PIN", "PIN code",
  "PIN-код" or "kod PIN" with a colon or a copula ("PIN is 4821"); only the
  digits are redacted. The 5000-trial number and date generators from the
  delta verification are unchanged at 0% (four spaced 4-digit numbers stay
  at about 5%, a real card layout). Known remaining gaps: ethnic origin in
  PL and UK, prayer nouns (`молитв`, `modlitw`) still match on their own,
  and "I vote Green." with no election cue is not caught.
- Medication names (QA 2026-10-26): "I take sertraline every morning." was
  allowed in every field, while the title `Medication` over "Takes sertraline"
  was blocked. The gate was never field-dependent: `evaluateMemoryEntry`
  joins title, description and body with newlines and runs one pass, so one
  sentence gets one verdict wherever it sits. The blocked case matched only
  the bare noun `medications?` in the title; no rule knew a drug name or an
  intake frame. Health now has three English rules over a curated list of
  prescription names and brands (SSRIs and other psychiatric drugs, ADHD
  stimulants, diabetes, thyroid, blood pressure, statins, anticoagulants,
  biologics, opioids): a first-person intake frame ("I take", "I'm on",
  "I was prescribed", "I have been taking"), an extractor-style frame
  ("Takes", "is on", "prescribed me") and "my sertraline". A bare drug name
  is never a cue, so "sertraline is an SSRI" in an essay stays allowed (0 of
  2000 generated essay sentences flagged). Left out on purpose: over-the-
  counter drugs and supplements (ibuprofen, vitamin D, melatonin), lithium
  (batteries) and the PL, UK and RU drug vocabulary.
- Saved text: every write is still checked, so editing an entry whose saved
  text a rule now rejects is a 422 even for a title-only change. Its `why`
  names the match and says it is in the saved text, its `fix` says to edit
  the saved text or cancel and delete the entry; deleting never runs the gate.
- Write rate limit (2026-10-26): before this, `/api/v1/memory/*` had no
  request-volume limit (Better Auth's limiter covers `/api/auth/*` only, the
  Cloudflare "API flood limit" rule covers `/api/v1/chats/` and
  `/api/v1/files/` only, and import, extract-now and backfill start had
  per-action cooldowns but no ceiling). `server/utils/memory/rate-limit.ts`
  is the one memory limiter, a KV per-user counter with named buckets on the
  same storage as the knowledge write limit (`createAuthRateLimitStorage`):
  the `write` bucket (60 per minute, shared) runs right after the session
  check on entry create, edit and delete, reset, delete-extracted, import,
  extract-now, backfill start and the chat memory-exclusion PATCH (#560), and
  answers 429 with `Retry-After`. New
  memory limits are added as buckets there, not as parallel limiters.

### 3.18 Tell Besidka what to remember (2026-10-26)

A free-text box in the Memory tab (account scope, under the entries toolbar,
shown while memory is on) and in the project Memory card (project scope).
The user writes loose facts or instructions in any language ("I moved to
Kraków. Forget the coffee thing."). The model sorts them into the existing
category and topic entries. Nothing is written until the user has seen and
ticked each change. Import stays as it is; this box is the everyday path.

**Two steps, preview then apply.**

- `POST /api/v1/memory/instruct/preview` `{ text (1..4000 chars), projectId? }`
  makes one `generateText` + `Output.object` call on the user's own key
  (`resolveMemoryModel`, the same model and gateway rules as import) and
  writes nothing. It needs memory on (409 otherwise). Without a usable
  key it returns 409 with why and fix. The response is
  `{ projectId, operations[], blocked, model, capacity: { total, limit } }`,
  where each operation is
  `{ key, kind: create|update|delete, status: ready|rejected, category, id,
  updatedAt, before, after, reason, rejection: { message, why } | null }`.
- `POST /api/v1/memory/instruct/apply`
  `{ projectId?, operations: 1..20 of create { category, title, description,
  body } | update { id, updatedAt, title, description, body } | delete { id,
  updatedAt } }` makes no model call. It answers
  `{ projectId, created, updated, deleted, skipped, entries, deletedIds }`.

**Preview rules** (`server/utils/memory/instruct*.ts`):

- Never-store data is redacted from the text before the model call, as
  import does.
- The model sees the scope's index through `renderMemoryExtractionIndex`
  with every origin editable, because the user is instructing directly.
  Bodies are shown for profile and preferences, plus up to 8 entries that
  share words with the text (diacritics folded, five-letter stem), within
  16k chars. The rest show `[body hidden]`.
- Entries are referenced by `category/slug` and mapped to ids on the
  server. Unknown refs are rejected.
- Every create and update passes `memoryEntryInputSchema` and
  `evaluateMemoryEntry`. A never-store or sensitive operation comes back as
  a rejected row carrying the 422 message, and is never applied.
- **Add-only for unseen bodies:** an update to an entry whose body the model
  was not shown only appends lines that are not stored yet, so no stored
  fact can be dropped blind. A `create` for an existing profile or
  preferences entry becomes such an update.
- **Delete-quote rule:** a delete must carry a verbatim quote of the user's
  request to forget, and that quote must appear in the text. Otherwise the
  row is rejected as "Not removed". The prompt allows deletes only on an
  explicit ask, and the UI leaves deletes unticked until the user ticks
  them.
- Creates past the cap (30 account, 15 per project, counting proposed
  deletes) are rejected. A second op on the same entry is rejected, and
  updates that change nothing are dropped.

**Apply** re-validates every operation as ordinary entry CRUD:

- Ownership is checked with `assertOwnedProject` plus a user and scope
  WHERE.
- Update and delete targets must still carry the preview's `updatedAt`;
  otherwise it returns 409 "Memory changed since the preview".
- The field rules and the compliance gate run again (400 or 422).
- Profile and preferences stay single, the cap must hold after deletes, and
  each entry can be targeted once.
- Writes go in one `db.batch()`: deletes, then updates, then guarded
  inserts. Each statement is keyed on owner, scope and `updatedAt` (inserts
  on the cap and project ownership), so a concurrent edit is never
  overwritten. A statement that lands nothing in a race is counted as
  `skipped`. Written rows get origin `user`.

**Rate limits:** the shared memory limiter (`server/utils/memory/rate-limit.ts`,
KV-backed `createAuthRateLimitStorage`, like the knowledge write limiter)
with its own buckets: `instruct-preview` allows 6 per minute (it spends the
user's tokens), `instruct-apply` 30 per minute. Both answer 429 with
`Retry-After`. They are separate from the `write` bucket (60 per minute) of
the other memory write routes (3.17).

**Logging:** only counts, kinds and the model id, under
`attributes.memoryInstruct` (phase, scope, chars, status, op counts, applied
counts, usage, model id, failure label). Compliance counts go under
`memoryCompliance` with origin `memory-instruct`. The text is never logged,
stored or echoed.

### 3.19 TypeSafe AI Jev checks (2026-10-26)

The public explainer for all of memory, including this check, is `/memory`
(`content/guides/memory.md`, `docs/seo.md` "The memory explainer"). Its copy
quotes the behaviour documented in 3.1 to 3.19, so re-check it when any of
those change.

TypeSafe AI Jev is an optional helper that runs on the user's own TypeSafe AI
key. One key powers seven roles (`JEV_ROLE_IDS` in `shared/utils/jev-policy.ts`).
Saving the key is the opt-in: every role is then on, each has its own switch,
and deleting the key stops all of them. No role can allow what a deterministic
rule refused, and no role can delete user content. Reading order of this
section:

1. **J0: foundation** - the shared client, settings, the one role table, the
   API every role uses.
2. **Memory checks** - the first role, the add-only check on memory writes.
3. **J1 to J6** - one section per role, in order: Auto web search, extraction
   pre-filter, prompt-injection screening, re-ranking, share check, past-chat
   retrieval.
4. **Delta audit fixes (#560)** - the findings of the 2026-10-26 delta audit
   and where each one is described.
5. **Legal and consent** - recipient, transfer basis and consent version.

#### J0: foundation (shared client, settings, role table)

The memory check (next section) is the first of seven roles that share one
client in `server/utils/jev/`. The same key powers all of them. Each role is
assistive. Six of the seven fail toward what Besidka does without the key: when
TypeSafe AI errors, times out or is rate-limited, the answer is the built-in
behaviour. The exception is `pastChatRetrieval` (J6), which fails toward
acting: without a key it does not pre-search, but a Jev failure makes it
search. The "Failure direction" column below is the single statement of this
for every role; each role's section repeats it in the same words.

**Settings.** `user_settings.typesafe_roles` is a nullable JSON column. `null`
means every role is on. A role is on unless it is explicitly `false`. With no
TypeSafe AI key every role is off, whatever the column says. The roles are
toggled on the Smart checks tab under "TypeSafe AI checks". The column is
nullable with no SQL default, so the migration is a plain `ADD COLUMN`.

**Policy.** Thresholds, timeouts and size caps are constants in
`shared/utils/jev-policy.ts` (the memory check keeps its own in `jev-check.ts`).
The thresholds come from the 2026-10-26 synthetic eval and are re-tuned on
real traffic. Timeouts: 800 ms on the send path, 1,500 ms for the share check
(`JEV_SHARE_CHECK_TIMEOUT_MS`, a modal the user is already waiting on), 2,500
ms in the background, including the memory check on interactive writes.

**Role table.** One row per role, in the order `JEV_ROLE_IDS` lists them.
Constants are from `shared/utils/jev-policy.ts` unless a file is named;
`JEV_MODEL_ID` is `jev-1.14.0` for all of them. Timeouts:
`JEV_SEND_PATH_TIMEOUT_MS` 800 ms, `JEV_SHARE_CHECK_TIMEOUT_MS` 1,500 ms,
`JEV_BACKGROUND_TIMEOUT_MS` 2,500 ms.

| Role id | Section | What is sent, and when | Thresholds and caps | Timeout | Failure direction |
|---|---|---|---|---|---|
| `memoryChecks` | Memory checks | Entry text after never-store removal plus a short source excerpt, before an entry is saved. Add-only: it can block what the gate allowed, never allow what the gate blocked | Block at or above 0.5 (`MEMORY_JEV_SENSITIVE_THRESHOLD`), reject ungrounded below 0.5 (`MEMORY_JEV_GROUNDING_THRESHOLD`); at most 100 questions or 90,000 characters per call; source window 300 characters, source cap 9,000 (all in `server/utils/memory/jev-check.ts`) | 2,500 ms (`MEMORY_JEV_TIMEOUT_MS`) | Fails open to the built-in gate alone |
| `autoWebSearch` | J1 | Only in the Auto web search mode, each message: the message and the last three turns, never-store removed. A URL, a domain or a recency phrase searches with no Jev call | `w1_live`: search at or above 0.2 (`searchAtOrAbove`); `recentTurns` 3; each turn capped at 4,000 characters (`JEV_SEND_PATH_MAX_TURN_CHARS`) | 800 ms | Searches, as without a key |
| `extractionPrefilter` | J2 | Before memory is generated from a chat (opt-in extraction, backfill, project Refresh; never extract-now or import): chat text after never-store removal, in chunks. Nothing worth remembering skips the model extraction. Highest exposure: chat text can hold Art. 9 data | `e1_durable`: skip only when every piece scores below 0.4 (`skipBelow`); chunks of up to 8,000 tokens (`maxChunkTokens`) | 2,500 ms per call | Extracts as usual |
| `injectionScreening` | J3 | Project knowledge files and notes (chunks of the extracted text) and the title and snippet of each Brave and Exa result fetched through Besidka, never-store removed. A flagged file waits for the user's review; a flagged result is left out of context; nothing is deleted. A chat model's own built-in search cannot be checked | `i2_attack`: flag at or above 0.3 (`flagAtOrAbove`); chunks of 2,000 tokens; 3 concurrent calls; 24 calls per knowledge request; re-screen 10 items per sweep, 12 calls per item, 5 attempts, 14-day queue | 2,500 ms for knowledge, 800 ms for search results | Undecided text is used unscreened: search results are kept with no notice, knowledge is stored `ready` and queued for the hourly re-screen |
| `rerank` | J4 | Past-chat and project-knowledge search: the query and passages, never-store removed, each cut to about 300 tokens, up to 30 per search | Up to 30 candidates (`maxCandidates`); passages 300 tokens (`maxPassageTokens`); drop below 0.5 (`dropBelow`), and only while at least `limit` candidates remain | 800 ms | Original BM25 order |
| `sharePiiCheck` | J5 | When the share window opens, before a public link is published: the chat text being shared, with never-store values, emails and phone numbers removed. Warning only, never blocks | `p1_personal`: warn at or above 0.3 (`warnAtOrAbove`); chunks of 25,000 tokens; request debounce 400 ms (`JEV_SHARE_CHECK_DEBOUNCE_MS`) | 1,500 ms | Detector warnings plus a generic "check before sharing" reminder; Generate untouched |
| `pastChatRetrieval` | J6 | Sends where `search_chats` and `read_chat` are not registered (a model or gateway without tool calling, a forced `toolChoice`, or image generation), only while **Search and reference chats** is on, each message: the message and the last three turns, never-store removed. If the message refers to an earlier, separate conversation, Besidka searches the user's past chats in its own database and adds excerpts. A listed phrase searches with no Jev call | `s1_previous`: search at or above 0.25 (`preSearchAtOrAbove`); 3 hits; excerpts capped at 1,500 tokens; message 2,000 characters, each turn 600 | 800 ms | **Searches anyway** (the one role that fails toward acting). Without a key or with the role off: no pre-search |

**Logging.** Each role writes one wide-event field, `attributes.<role>Jev`
(for example `attributes.rerankJev`), with counts, scores, statuses and
latency only, never text. The memory check keeps its existing
`attributes.memoryJev` shape.

**SDK seam.** `experimental_decide` from `ai` 7.0.153 with
`@ai-sdk/typesafe-ai` 3.0.27 accepts per-question `instructions` (a string or
a JSON object) and `criteria: { true, false }` for boolean questions. The
provider rewrites `boolean` to `noul` and sends a JSON-object state unchanged,
so no raw `fetch` is needed. Fragile seams to re-check on every upgrade:

- The `experimental_` prefix: the name and options can change in a patch
  release.
- The answer shape `{ type: 'boolean', probability }`.
- `Experimental_DecisionRefusalError`, thrown on a refusal answer. The client
  classifies it as `error`, so the role fails safe.
- `providerOptions.typesafe.longContext` must stay off on the send path. The
  eval measured a p95 of 840 ms at 50k tokens, which breaks the 800 ms budget.

**API for role PRs (J1-J6).** Every role builds on these; none of them
throws on a Jev failure:

- `resolveJevRoleModel({ db, userId, role, logger? })` in
  `server/utils/jev/roles.ts`: the pinned decision model when the user has a
  key and the role is on, else `null` (one D1 read for the key and, only with a
  key, one for `typesafe_roles`; a read or decrypt failure logs `key-error`).
  `resolveJevRoleApiKey` is the same without building the model.
- `isJevRoleEnabled({ typesafeRoles, hasTypesafeKey }, role)`: the pure
  check, `false` without a key.
- `jevDecide({ model, state, questions, timeoutMs, abortSignal? })` in
  `server/utils/jev/client.ts`: one call with no retries, returning
  `{ ok: true, probabilities, inputTokens, latencyMs }` or
  `{ ok: false, status, latencyMs }`, where `status` comes from
  `classifyJevFailure` (`unauthorized`, `rate-limited`, `timeout`, `network`,
  `error`).
- `recordJevRoleLog(role, { status, calls?, questions?, inputTokens?,
  latencyMs?, counts?, scores? }, logger)` in `server/utils/jev/logging.ts`:
  numbers and a status only, summed across calls in one request.
- `shared/utils/jev-policy.ts`: `JEV_AUTO_WEB_SEARCH`,
  `JEV_EXTRACTION_PREFILTER`, `JEV_INJECTION_SCREENING`, `JEV_RERANK`,
  `JEV_SHARE_PII_CHECK`, `JEV_PAST_CHAT_RETRIEVAL` (question id, verbatim
  wording and criteria, threshold, size cap, timeout), the phrase lists
  `JEV_RECENCY_PHRASES` and `JEV_PAST_CHAT_PHRASES` with `matchesJevPhrases`
  (whole words, so "now" never matches "know" and "курс" never matches
  "курсор"; only `JEV_PHRASE_STEMS` may continue), and
  `JEV_URL_OR_DOMAIN_PATTERN` (a scheme, `www.` or a web TLD from a short
  list, so `index.ts`, `app.vue` and `package.json` do not force a search). The state keys the wordings refer to are
  the eval's: `message` and `recent_turns` (web search, past chats),
  `transcript` (pre-filter), `text` (injection), `chat` (share check),
  `query` plus `passage_<i>` (rerank).

**Settings API.** `GET /api/v1/profiles/settings` returns `typesafeRoles`
(`null` or a partial role map). `PATCH` takes `typesafeRoles` as a strict
partial map of booleans, merged into the stored object with SQLite
`json_patch` in the same UPDATE, so two toggles saved at once cannot drop each
other; `null` resets every role to on. The `memoryChecks` role is honoured by
`resolveMemoryJevChecker`.

#### Memory checks (`memoryChecks`)

An optional second opinion on memory writes, on the user's own TypeSafe AI
key. It is add-only: the deterministic gate (3.5) stays the gate, and Jev can
only block an entry the gate allowed, never allow one the gate blocked.

**Key type.** `providerMeta.typesafe` has its own kind, `memory-check`, and a
fourth tab, **Smart checks** (renamed from **Memory checks** in J0; the tab id and the deep links are unchanged), on `/profile/keys` (`?provider=typesafe` and
`?tab=memory-checks` deep links pass `resolveSafeNextPath`). The key is
stored encrypted in `keys` like the others (`provider = 'typesafe'`; the
column is a text enum, so `db:generate` produced no migration). It is not a
chat provider: it is not in the model catalog, so it never appears in the
chat or memory-model pickers, the memory-model resolver never considers it,
it is never routed through a gateway, and `useUserKeys().hasAnyKey` ignores
it. Saving it calls `GET https://api.typesafe.ai/v1/models` with the key
(`verifyMemoryJevApiKey`, 5 s timeout): a 401 or 403 refuses the save with a
why and a fix; a network error, a timeout or another status still saves,
because memory checks fail open anyway. `/profile/memory` shows "Memory
checks: TypeSafe AI Jev (on)" or a link to add the key. Saving the key is the
user's opt-in to the spend and to the recipient. Each role has its own toggle
in the "TypeSafe AI checks" section of the Smart checks tab (see "J0:
foundation" above); deleting the key stops all of them. The key guide is
`content/key-guides/typesafe-ai-api-key.md`, with its video since #556
(`key-guide-typesafe*.mp4`, recorded when the tab was still called Memory
checks). Its public page also carries the long-form Jev explainer inside a
`::key-guide-article` block, which the keys card hides (`docs/key-guides.md`).

**Code.** `server/utils/memory/jev-check.ts`, through `experimental_decide`
from `ai` with `@ai-sdk/typesafe-ai`:

- `resolveMemoryJevChecker({ db, userId, logger })` reads and decrypts the
  saved key and returns a checker, or `null` without a key. A failed read or
  decryption logs `key-error` and returns `null`.
- `createMemoryJevChecker({ apiKey })` refuses an empty key, so the SDK can
  never fall back to its `TYPESAFE_AI_API_KEY` environment variable. The
  decrypted key is passed per checker; there is no operator key.
- `check(candidates)` runs `evaluateMemoryEntry` on every candidate first and
  sends only the ones it allows. Gate-refused text, including its never-store
  values, never leaves Besidka. Extraction ops the extractor itself flagged
  as never-store, and ops whose evidence fails the deterministic grounding
  check, are not sent either.
- Questions per candidate: one boolean per Art. 9 category (health, religion
  or belief, political opinion, racial or ethnic origin, sex life or
  orientation, trade union, genetic, biometric) and one never-store
  question, each quoting the candidate text, with the criteria wording from
  the research run. `legal-dispute` and `drugs` stay gate-only. The boolean
  type is used because the SDK drops `confidence` on choice answers.
- Grounding (one more boolean) only where there is a source text. The source
  is redacted for never-store values, capped at 9,000 characters, and dropped
  (no grounding question) when the gate would refuse it, so flagged source
  text is never sent either.
- Thresholds: `MEMORY_JEV_SENSITIVE_THRESHOLD = 0.5` (block at or above) and
  `MEMORY_JEV_GROUNDING_THRESHOLD = 0.5` (reject below), the research's
  working threshold. Model pinned to `jev-1.14.0`, not `jev-latest`, so a
  model update cannot move the tuned thresholds silently.
- Batching: all candidates of one write in one call, split only past 100
  questions or 90,000 question characters. The calls share one
  `MEMORY_JEV_TIMEOUT_MS` (2,500 ms) budget with `maxRetries: 0`.
- Fail-open: a missing key, 401, 403, 429, 529, any other status, a network
  error or the timeout leaves every unanswered candidate `clear`, so the
  write proceeds on the gate alone.

**Where it runs.** Every write path that reaches the gate behind the consent
gate (`requireLegalConsent`, or `currentLegalConsentCondition` in the sweep
and backfill queries):

| Path | Checks | Source for grounding | Result on a Jev hit |
|---|---|---|---|
| Chat extraction (sweep, Update now), backfill, project refresh, legacy blob | (a) + (b) | A window of 300 characters around the op's evidence quote in the user's own text | Op dropped as `extra-check-sensitive` or `extra-check-ungrounded` |
| Import | (a) + (b) | The same window in the pasted chunk | Same |
| Instruct preview | (a) + (b) | The redacted instruction, plus the saved entry's text for an update | Row `rejected` with `rejection.kind = 'extra-check'` |
| Instruct apply | (a) | None (no model text left to ground) | 422, `data.kind = 'extra-check'` |
| Manual create and edit (`/api/v1/memory/entries`) | (a) | None (the user typed it) | 422, `data.kind = 'extra-check'` |
| `memory_write` tool | (a) | None | 422 folded into the tool error |

The extraction family resolves the checker in `extract.ts` and runs one
batched pre-pass in `MemoryExtractionApplier.run()`, before any write; the
verdict is applied in `evaluate()` after the gate allowed the exact persisted
values. `createMemoryEntry` and `updateMemoryEntry` take an optional `jev`
in their context and call `assertMemoryJevAllowed` after the gate. The
About-me migration runs on `GET /api/v1/profiles/settings`, outside the
consent gate, so it passes no checker and never calls Jev. Jev is not used
for "worth remembering"; the separate `extractionPrefilter` role (J2) is.

**Logging.** One wide-event field per request,
`attributes.memoryJev: { model, questions, blocked, groundingRejected,
gateDisagreements, latencyMs, status }`, summed across calls in the request
through `getContext()`. `gateDisagreements` maps each Art. 9 category id or
`never-store` to how many candidates Jev flagged that the gate passed; it is
the list to mine for new deterministic rules. No text is logged.

**Fragile seams to re-check on every `ai` or `@ai-sdk/typesafe-ai` upgrade.**

- `experimental_decide` is experimental in `ai@7`: its name, its options
  (`state`, `questions`, `maxRetries`, `abortSignal`) and the answer shape
  `{ type: 'boolean', probability }` can change in a patch release.
- The provider package is about six weeks old and ships patches weekly. It
  maps the SDK `boolean` question to the API's `noul`; a renamed or
  remapped type breaks every check, which then fails open silently except for
  `status: 'error'` in the logs.
- `createTypeSafeAi` falls back to `TYPESAFE_AI_API_KEY` when `apiKey` is
  empty. The empty-key guard in `createMemoryJevChecker` must stay.
- The SDK's choice answer drops `confidence`; another reason the checks use
  booleans only.
- `@ai-sdk/provider` and `provider-utils` must stay at the versions the
  provider pins (4.0.34 and 5.0.68 at the time of writing), so the whole
  `@ai-sdk/*` train is bumped together. `pnpm why @ai-sdk/provider` should
  list one 4.x copy; the 3.x copy belongs to `nuxt-studio` (`ai@6`).
- Thresholds were tuned on `jev-1.14.0`. A model bump needs the research run
  repeated before the pin moves.

**Smoke test (2026-10-26, synthetic text, owner's key).** One batched call
through the real module: 6 candidates in, the card-number candidate refused by
the gate and not sent, 5 sent as 48 questions; 351 ms; 7,206 input tokens
(about $0.0003). Jev flagged "half Nigerian" as racial or ethnic origin (the
gate passed it), rejected "Uses React and Next.js" against a source saying
"We use Vue 3 and Nuxt", and cleared the language preference, the job and the
Criminal Minds line.

#### J1: Auto web search (`autoWebSearch`)

Auto is a modifier on the chosen search provider (the model's built-in
search, Brave or Exa), not a provider of its own: Jev decides per message
whether that provider searches.

**UI.** `ChatInput/ToolsMenu/WebSearchSection.vue` (the "+" menu, see
`docs/chats/chat-input-tools-menu.md`) has an **Auto** row with a one-line hint
and an info disclosure, shown only when `useUserKeys().keyStatusForProvider(
'typesafe') === 'saved'` and the role settings have loaded with
`autoWebSearch` on (`useAutoWebSearch()` in `app/composables/
auto-web-search.ts`, which fetches `/api/v1/profiles/settings` only once the
key is known to be saved, so users without a key pay no extra request). With
search Off the toggle is disabled with "Pick a provider above to use Auto."
The preference is per browser, `prefStorage` key `settings_web_search_auto`
(`on`/`off`). The trigger reads **Auto** instead of **Search** while it
applies. The Exa level heading is now **Depth**, so its "Auto" level is not
confused with this mode.

**Request.** `POST /api/v1/chats/[slug]` takes
`webSearchMode: 'auto' | 'always'` (default `always`), a separate field; the
`tools` enum has no sentinel. `PUT /api/v1/chats/new` ignores the field: it
never asks Jev and persists the chosen tools (see "First message" below). The client sends `auto` only with the
preference on and a web-search tool in `tools`, and falls back to `always`
once the key is known missing or the role known off. While those are still
loading it sends `auto` and lets the server decide, so a chat's first POST
fired on mount keeps its chip.

**Server.** The request is validated before Jev sees anything (delta audit
finding 3, 2026-10-26): `collectAutoWebSearchCandidateTools` returns the
tools Auto may pick from (the default tools plus, in Auto, the persisted
tools a retry reuses), and the gateway tool allowance, model tool support,
the image-generation conflict, the Brave/Exa key presence and the transfer
consent are all checked on that superset. Auto only removes web-search tools
or reuses persisted ones, so validating the superset is sound, and a send
that ends in 400 or 403 never discloses the message to TypeSafe AI. One
consequence: the Brave or Exa key row is read even when Jev then skips the
search. Only then does `resolveAutoWebSearch` in
`server/utils/chats/auto-web-search.ts` run, before `persistUserMessage` and
the provider switch. In order:

1. `always`, or no web-search tool chosen: tools unchanged, no D1 read.
2. `resolveJevRoleApiKey` (key read, decrypt, `typesafe_roles` read): no key
   or role off means tools unchanged and no chip, exactly as without a key.
3. A message already persisted under the same id reuses its persisted tools
   and calls nothing (`counts.reused`). That covers a retry of the same
   message id and a retry of a new chat's first message its first POST
   already decided; the chip is derived from whether those tools search.
4. Guards: `JEV_URL_OR_DOMAIN_PATTERN` or `matchesJevPhrases(text,
   JEV_RECENCY_PHRASES)` forces the search with no Jev call (`forced`).
5. One `decideSendPathJev` call with `state = { message, recent_turns }`
   (the last `JEV_AUTO_WEB_SEARCH.recentTurns` persisted turns with text),
   each text never-store-redacted and capped at
   `JEV_SEND_PATH_MAX_TURN_CHARS`, on `JEV_SEND_PATH_TIMEOUT_MS`. Search when
   `p >= JEV_AUTO_WEB_SEARCH.searchAtOrAbove` (`searched`), else drop only the
   web-search tool (`skipped`). Any failure, refusal or missing answer
   searches (`fallback`).

**First message.** The PUT persists the chosen tools and never calls Jev (no
model is validated there). The chat's first POST sees one persisted user
message and no reply; unless the KV marker
`auto-web-search-first-message:<chatId>:<messageId>` exists it passes the
PUT's tools as both chosen and default with `persistedTools: null`, so Jev
decides with the full validation above. `recordFirstMessageAutoWebSearchDecision`
then writes the resolved tools onto the user row and sets the marker (one
day). A retry of that message finds the marker and takes the reuse branch.
A KV failure on either side only means the retry asks Jev again (one more
call, the safe direction). Persisted `messages.tools` are always the resolved set, so
`hasSameTools` and the duplicate and replay paths work per message id
unchanged. A skip removes the search tool from `requestedTools`, so the
search prompt nudge, the Brave/Exa lines, the external tool registration,
the key lookup and the `presetMemoryWriteLock` lock (which keys on
`requestedTools`) all drop for that message only.

**Reopening a chat after a skip.** The skipped message persists without a
search tool, so `findLastUserMessageTools` alone would show search as Off.
`resolveInitialChatTools` (`app/composables/chat.ts`) restores the saved
provider (`settings_web_search_tool`) when Auto is preferred, the last user
message has no tools and its reply was `skipped` or is still missing (a new
chat's pending first message). A turn the user sent with search Off keeps
Off. Without the Auto preference it is `findLastUserMessageTools` unchanged.

**Chip.** The outcome is stored as `usage.autoWebSearch` on the assistant
message (`searched`, `skipped`, `forced`, `fallback`), in both the streamed
finish metadata and the persisted row (`addAutoWebSearchUsage`).
`Chat/AutoWebSearchChip.vue` renders "Auto: searched the web" or "Auto: no web
search needed" under the answer, on the owner's chat page only (not on shared
chats). A turn whose usage capture failed has no chip. For a reused decision
the chip says searched or skipped.

**Logging.** `attributes.autoWebSearchJev` via `recordJevRoleLog`: `status`,
`calls`, `questions`, `inputTokens`, `latencyMs`, `scores` (the rounded
probability) and `counts` keyed by outcome plus `reused`. No text.

**J6 seam.** `server/utils/jev/send-path.ts` holds the shared send-path
pieces: `readSendPathTurns`, `buildSendPathJevState` and
`decideSendPathJev({ model, state, questions })`, which takes any question
map. `autoWebSearchJevQuestions()` and `readAutoWebSearchAnswer(result)` are
exported separately, so past-chat retrieval can merge its question into the
same call and read both answers from one result. J6 shipped first with its
own call (`decidePastChatSearch` in `server/utils/memory/tools/
pre-retrieval.ts`, `recent_turns` as `User: …` strings capped by
`JEV_PAST_CHAT_RETRIEVAL.maxTurnChars`), and the two roles run at different
points of the send (Auto before tool validation, J6 only when tool calling is
off), so they overlap only for a model without tool calling that uses its
built-in search in Auto. Batching them means one shared state first: move J6
to `buildSendPathJevState`, decide both before tool validation, and pass the
merged question map to `decideSendPathJev` once.

**Tests.** `tests/unit/utils/chats/auto-web-search.spec.ts`,
`tests/integration/api/chats-auto-web-search.spec.ts` (no key identical to
`always`, skip, search, 401 and timeout fallback, forced, recent turns,
retry and first-message reuse, role off),
`tests/integration/api/chats-new-auto-web-search.spec.ts`,
`tests/unit/composables/auto-web-search.spec.ts`,
`tests/unit/components/Chat/AutoWebSearchChip.spec.ts`, and Auto cases in the
`WebSearchMenuItems`, `WebSearchTrigger` and `chat` specs.

#### J2: Extraction pre-filter (`extractionPrefilter`)

`extractLeasedChatMemory` (`server/utils/memory/extract.ts`) asks Jev one
question, `JEV_EXTRACTION_PREFILTER.question` (`e1_durable`), about the
window's transcript right after the `too-short` branch and before
`loadMemoryExtractionIndex` and `resolveExtractionModel`, so a skip pays for
neither the index read nor the model call. The transcript is the one
`loadMemoryExtractionWindow` already built, never-store redacted per message.
The logic lives in `server/utils/memory/extract-prefilter.ts`.

- **Chunking.** A transcript over `maxChunkTokens` (8,000, estimated with
  `estimateMemoryTokens`, so Cyrillic splits into more pieces than Latin) is
  split at line breaks into pieces under the cap and scored one piece per call,
  sequentially. The chat is skipped only when every piece scores below
  `skipBelow` (0.40); the first piece at or above it ends the check and the
  extraction runs. Calls use the background timeout (2,500 ms) each.
- **Skip.** Stamps the watermark through `memoryExtractionAdvance` with the
  chat's own `advanceMode`, exactly as the `no-user-text` branch does, and
  returns `status: 'skipped'`, `reason: 'nothing-durable'`. The failure
  counters are not incremented. The chat leaves the due query until new
  activity arrives.
- **Never pre-filtered.** `explicit` (extract-now, "Update memory now"), the
  import path (separate code), and a sweep pass of a project that still
  carries the legacy blob (the pass also migrates the blob, which a skip would
  leave undone). The project Refresh button (`manual` trigger) is
  pre-filtered.
- **Backfill.** Pre-filtered like the sweep: it is where the saving is
  largest. The progress counters already treat `skipped` as processed, so a
  `nothing-durable` skip raises `skippedChats` and `processedChats` and adds no
  tokens. The cost estimate stays an upper bound, and the confirm step of the
  backfill sheet says so when the key and the role are on.
- **Fail-safe.** No key, role off, or any Jev failure (401, 403, 429, 529,
  timeout, network, refusal, a missing answer, one failing piece after others
  scored low) runs the extraction as today. The status is in the log only.
- **Logging.** `attributes.extractionPrefilterJev`: `status`, `calls`,
  `questions`, `inputTokens`, `latencyMs`, `scores` and `counts.skipped`. For
  a chat that was extracted after being scored, the highest piece score picks
  a tenth bucket and three counts are added, for example `chatsAtScore0.4`,
  `proposedAtScore0.4` and `entriesAtScore0.4` (entries the model proposed and
  entries that were saved). Extracted chats that produce nothing in the
  lowest buckets mean `skipBelow` can go up; entries there mean it is right.
  Chats that were skipped appear only as `counts.skipped` and a score, so
  "skipped but would have extracted" needs a periodic shadow run (log the
  score, extract anyway, compare).
- **UI.** `nothing-durable` has a label in the toolbar's skip-reason map
  ("Nothing new worth remembering in that chat."); extract-now is never
  pre-filtered, so the toolbar does not show it today. The backfill sheet's
  "Chats skipped" counter includes these skips.

#### J3: Prompt-injection screening (`injectionScreening`)

Jev screens third-party text with the policy `JEV_INJECTION_SCREENING`
(`i2_attack` at or above 0.3). The core is `screenTextsForInjection` in
`server/utils/jev/injection-screening.ts`, and every caller fails toward
Besidka's behaviour without a key.

- **Chunking.** Each text is cut at line breaks into chunks of at most
  `maxChunkTokens` (2,000), estimated with the Cyrillic-aware knowledge
  estimate (`default` family). A longer line is sliced at
  `maxChunkTokens` × the fewest characters per token, so a chunk never
  exceeds the cap. The eval found a long document dilutes a one-line
  injection, which is why a whole file is never sent as one state.
- **Calls.** One call per chunk, state `{ text }`, the verbatim question.
  Never-store values are redacted from each chunk before it leaves. Calls run
  in waves of at most `maxConcurrentCalls` (3), under the Workers
  six-connection limit. A text is flagged on its first chunk at or above the
  threshold, and its remaining chunks are not sent.
- **Failure.** The first failed call (401, 403, 429, 529, timeout, network,
  refusal, or a missing probability) stops screening for the request. Every
  text not decided by then is `unscreened`. Search results treat it as
  clean; project knowledge stores it `ready` and queues it (below).
- **Budget.** `maxCalls` caps the calls one request may make. Project
  knowledge requests use `maxCallsPerKnowledgeRequest` (24, 8 waves of 3, at
  most about 20 s at the 2.5 s timeout), so a 1 MB batch (about 130 chunks)
  no longer blocks an upload for minutes: what the budget does not reach is
  `unscreened` and queued. Searches are bounded by their 8 or 10 results.
- **Logging.** `attributes.injectionScreeningJev`: status, calls, input
  tokens, latency, the maximum score per text, and counts
  `knowledgeFlagged|Clean|Unscreened` or `searchFlagged|Clean|Unscreened`.
  Never text.

**Project knowledge (ingestion time).** `screenKnowledgeTexts`
(`server/utils/knowledge/injection-screening.ts`) runs inside
`ingestKnowledgeItems` (after the capacity checks, before the rows are
built), `createKnowledgeNote` and `updateKnowledgeNote` (only when the body
changes), with the background timeout (2,500 ms per call). Only items with
status `ready` and text are sent, and the key is read once per request.

- A flagged item is stored with `extract_status = 'flagged'` and
  `extract_error = null`. Its text is written to R2 as usual and counts
  toward the quota. Nothing is deleted.
- `flagged` is a value of the text enum `knowledgeExtractStatuses`, so
  `db:generate` reports no change. The upload request schema accepts only
  `knowledgeUploadExtractStatuses` (`ready`, `no-text`, `failed`), so a client
  cannot send `flagged` itself.
- Exclusion: the pack build and every context filter keep only `ready`, and
  `loadKnowledgeSendData` also drops `flagged` rows. The second filter is
  needed because images and native PDFs are attached by media type, not by
  status, so a flagged PDF with "send as PDF" would otherwise still be sent.
- **Allow anyway**: `PATCH /api/v1/projects/:id/knowledge/items/:itemId/allow`
  (`allowFlaggedKnowledgeItem`). It is owner-only through
  `resolveKnowledgeItem` (user and project in the `WHERE`), behind
  `assertNotCrossSiteRequest`, the knowledge write rate limit and
  `requireLegalConsent`. One UPDATE matched on user, project and
  `extract_status = 'flagged'` sets `ready` and moves `updated_at` forward,
  then the change is committed so the pack picks the item up. A `ready` item
  comes back unchanged, any other status is a 409.
- An allowed item is not screened again until its text changes: a note
  rename keeps the status, a new body is screened again. Saving the same body
  of a flagged note is not a repair (repair is `failed` or `no-text` only), so
  it cannot be used to skip the review.
- Items added before this change are not screened retroactively.
- **Unscreened queue** (delta audit finding 2, 2026-10-26). An item stored
  `ready` with an `unscreened` verdict (upload, new note, changed note body)
  gets a KV key `knowledge-unscreened:u<user>:p<project>:i<item>`
  (`server/utils/knowledge/unscreened.ts`, TTL `rescreenQueueTtlSeconds`, 14
  days), so no migration is needed. The hourly knowledge sweep
  (`sweepProjectKnowledge`) first runs `rescreenUnscreenedKnowledgeItems`
  within half of its runtime budget: one KV list page of at most
  `rescreenItemsPerSweep` (10) keys, users one at a time, items one at a
  time. A user without a current legal consent is deferred (no Jev call);
  without a key or with the role off the keys are dropped (the behaviour
  without a key); an item that is gone, foreign or no longer `ready` is
  dropped; otherwise `rescreenQueuedItem` screens the next
  `rescreenMaxCallsPerItem` (12, at most 4 waves, so about 10 s at the
  2.5 s timeout) chunks of the current R2 text, cut exactly as at ingest.
  The KV value keeps `{ attempts, nextChunk, updatedAt }`, so a long item
  advances over several runs (a 1 MB item of about 130 chunks needs about 11
  hourly runs) and a changed `updated_at` starts it over. `clean` (all
  chunks done) drops the key, `flagged` sets the status (guarded on
  `updated_at`, so a note edited meanwhile is not flagged for its old text)
  and bumps `knowledge_version`, a failed call counts one attempt and the
  run goes on with the user's next item, so one item that keeps timing out
  never holds the others back. After `rescreenMaxAttempts` (5) failed runs
  the item leaves the queue (`abandoned`) and stays `ready`, unscreened;
  the UI does not show that, since it reads only D1 rows. The item counts
  as `ready` (and is sent) until the sweep finishes it, usually within the
  hour for a short item. A failed queue write is logged as
  `attributes.knowledge.unscreenedQueueFailed` and leaves the item as before.
  The sweep result carries `rescreen` counts; a re-screen failure is logged
  as `knowledgeRescreenFailure` and the R2 pass still runs.
- UI: the row badge "needs review", and in the item sheet and the note editor
  the alert "Possible prompt injection, review it" with **Allow anyway**
  (`InjectionReview.vue`, `allowItem` in `useProjectKnowledge`). The upload
  sheet counts flagged files as added and lists them as needing review.

**Brave and Exa results (send path).** `resolveExternalSearchScreener`
(`server/utils/search/injection-screening.ts`) is resolved in the chat route
only when Brave or Exa search is requested, next to the search key reads, and
passed to `getBraveWebSearchTools` and `getExaWebSearchTools`. Inside
`execute`, after the results arrive, each result's title and snippet is
screened with the send-path timeout (800 ms per call) and the tool's abort
signal.

- Flagged results are removed from the tool output, and
  `notice: "N search result(s) were withheld as possible prompt injections."`
  is added. Withheld URLs never become `source-url` citations. The
  search-answer continuation renders the notice after the results.
- A Jev failure keeps every result. No notice is added.
- Worst-case added latency per search is about 4 waves × 800 ms. The typical
  cost is 3-4 waves at the eval's p50 of about 180 ms.
- Only the title and snippet are screened, so no other free-text metadata
  reaches the model: Exa's `author` is dropped in `normalizeExaResults`, and
  `publishedDate` is kept only when it is an ISO date (`isIsoDateString`, as
  Brave already did). The URL is kept for citations.

**Not screened.** Results of a chat model's own built-in search (native
provider and gateway search) reach the model with no server hook, so they
cannot be screened. The Privacy Policy, the `/memory` guide and the key-guide
FAQ say so. Images are not screened beyond their extracted text.

Native PDFs (delta audit finding 1, 2026-10-26). Screening reads the text a
PDF's extractor produced, never the attached pages, so:

- A `ready` PDF sent as a PDF is screened on its text layer only; text that
  lives in page images or overlays reaches a PDF-reading model unscreened.
- A `no-text` or `failed` PDF (a scan, a broken file) has no text to screen,
  yet "Send as PDF" stays available for it, because sending the pages is the
  only way such a file reaches the model (transcription is not built).
  Refusing it would change behaviour for users without a TypeSafe AI key.
  Instead the item sheet marks it **"Not screened for prompt injection"**
  (`knowledge-item-sheet-native-pdf-unscreened`), and a `ready` PDF's toggle
  says screening reads the extracted text only. The `/memory` guide and the
  TypeSafe AI key-guide FAQ say both. `isNativePdfCandidate` is unchanged:
  a flagged PDF is still dropped by `loadKnowledgeSendData`.

**Write lock unchanged.** A clean verdict never relaxes anything. The memory
write lock is still preset for every requested web search and raised by any
non-memory tool result (`presetMemoryWriteLock`, `createToolLoopPrepareStep`).
A spec asserts the lock with an all-clean screening.

**Adversarial residual risk** (DPIA risk 24). Text written to manipulate Jev
into flagging a legitimate document can only cause a review prompt for a file
(one click puts it back) or withhold one web result with a visible note. It
can never delete content. A false negative leaves the existing defences: the
write lock, the data-not-instructions wrapping and the memory gate.

#### J4: Re-ranking (`rerank`)

Re-ranking orders the candidates of two searches with Jev. It never adds a
result the search did not find.

**Where it runs.**

- `search_chats` (`server/utils/memory/tools/search-chats.ts`): after the
  best hit per chat is picked (one candidate per chat, BM25 order) and before
  the final slice to `limit`. The snippet of each candidate is the passage.
- `search_project_knowledge` (`server/utils/knowledge/tools/index.ts`) and
  the pre-retrieval of models without tool calling
  (`prepareKnowledgeExcerpts` in `server/api/v1/chats/[slug]/index.post.ts`):
  on the MiniSearch results before the chunk and token caps. `search()` stays
  synchronous. The searcher exposes `searchCandidates()` (the ranked list,
  at most 30) and `capHits()` (the existing cap loop); `search()` is the two
  composed. `searchKnowledgeWithRerank` in `server/utils/knowledge/rerank.ts`
  is the async path both callers share, and without a resolver or a model it
  is exactly `search()`.

**Request.** One call to `rerankWithJev` (`server/utils/jev/rerank.ts`): the
shared state holds the query and every passage as a top-level key
(`{ query, passage_0, passage_1, ... }`), and every candidate is a boolean
question whose `instructions` are only the fixed `JEV_RERANK.task` naming
its key, "Is `passage_<i>` relevant to `query`?", with `JEV_RERANK.criteria`.
Delta audit finding 6 (2026-10-26): a passage is third-party text (another
chat's excerpt or a knowledge chunk), and in the question's `instructions`
it could steer its own relevance score, so it moved into the state, the
channel Jev treats as data and references by backtick path (the TypeSafe
provider docs). Top-level keys are used because nested-path resolution is
not documented. The trade-off: every question now sees every passage, where
before each question saw only its own, and the wording departs from the
2026-10-26 eval's `{ task, passage }` form, so `dropBelow` may need re-tuning
on real traffic. The per-question limit (32k tokens, state plus one
question) is far above 30 × 300 tokens. At most 30
candidates are judged (`maxCandidates`); passages and the query are cut to
about 300 tokens (`maxPassageTokens`), which matters for pre-retrieval, where
the query is the whole user message. The query and every passage go through
`redactNeverStore` first and are truncated afterwards, so a cut can never
leave half of a redacted value. The send-path timeout (800 ms) applies,
including the pre-retrieval before the first token.

**Order and the cut.** Candidates are sorted by descending probability, the
BM25 position breaking ties. Candidates below `dropBelow` (0.5) are dropped
only when at least `limit` candidates remain above it (`limit` is the tool
limit, `searchMaxChunks` for knowledge tools and `preRetrievalMaxChunks` for
pre-retrieval); otherwise the whole sorted list is returned. The result
therefore never has fewer entries than the BM25 order would have had.

**Model resolution.** `createJevRerankModelResolver` is created once per send
and is lazy and memoized: the key and the role settings are read on the first
search that has two or more candidates, so a send whose tools never search
costs no D1 read. The route builds it after `requireLegalConsent`, and
`resolveJevRoleModel` already honours the `rerank` toggle.

**Safe direction.** Without a key, with the role off, with fewer than two
candidates, on 401, 403, 429, 529, a timeout, a network error, a refusal, an
answer that misses any candidate, or any exception while building the
request, the original order comes back unchanged. No migration.

**Logging.** `attributes.rerankJev`: `status`, `calls`, `questions`,
`inputTokens`, `latencyMs`, `counts.candidates`, `counts.moved` (positions in
the first `limit` slots that differ from the BM25 order), `counts.dropped`,
`counts.redacted` (never-store values removed from the query and passages)
and the rounded scores, highest first. Repeated searches in one request add
up. No text is logged.

**Known limit: cross-lingual retrieval.** Re-ranking cannot find what was not
retrieved. `search_chats` retrieves with SQLite FTS5 and project knowledge
with MiniSearch, both lexical, so a query in Ukrainian does not retrieve a
chat or document written in English, and Jev never sees it. The eval's
cross-lingual gain (NDCG@5 0.98 against 0.48 for BM25) applies only to
candidates that already share a retrieved pool. Closing this needs another
way to build the shortlist (translated queries, recent chats, or embeddings),
which is not part of this role. The `/memory` guide FAQ says the same.

**Fragile seams.** `JEV_RERANK` wording and `dropBelow` come from a synthetic
eval of 8 queries with passages of one or two sentences; re-tune them on the
logged scores. The `search_chats` snippet is only 32 FTS5 tokens
(`SEARCH_CHATS_SNIPPET_TOKEN_COUNT`), so the relevance judgement there sees
less text than the eval did; widening it is a separate change.

#### J5: Share check (`sharePiiCheck`)

A warning in the share modal that the chat may hold personal data. It never
blocks Generate and never changes what is shared.

**Endpoint.** `POST /api/v1/chats/[slug]/share/check` (next to the other share
routes) takes `{ showFiles, showMetadata }` and returns
`{ warnings: [{ kind, source }], checked }`. It never returns or logs text.
It sits behind `assertNotCrossSiteRequest` (#560), is ownership-scoped (`chats.slug` plus `user_id`, else 404) and limited by
the `share-check` bucket of `enforceMemoryRateLimit` (20 per minute, one
counter per user). It is not behind `requireLegalConsent`, because it stores
nothing and the deterministic half needs no key; only the Jev call is gated on
`hasUserLegalConsent`, so a user without current consent gets detector
warnings and `checked: false`.

**What is read.** `collectSharedChatSegments` in
`server/utils/chats/share-pii-check.ts` builds the text a visitor would see:
the title, then each user and assistant message through `filterPublicParts`
(`server/utils/chats/share-public-parts.ts`, the function the shared view uses
too), taking text and reasoning parts, and file names only when
`showFiles`. Tool parts, images and file contents are not read.
`showMetadata` is accepted for contract symmetry but exposes only timestamps,
usage and tool names, so it changes nothing and the modal does not re-check on
that toggle.

**Order.**

1. Deterministic detectors, always: email and phone patterns (reserved
   example domains and `.test` addresses are ignored; the phone patterns need
   a `+` prefix with 8 to 15 digits, or a 9 to 12 digit national grouping with
   a 2 or 3 digit lead, so numeric tables and dates do not fire) plus the
   never-store detectors from `compliance.ts` (payment card by Luhn, IBAN,
   PESEL, keyword-gated tax numbers including РНОКПП, passport). A bare
   РНОКПП without a keyword is left to Jev. Secrets (keys, JWTs, credentials)
   are deliberately not part of this warning. One `{ kind, source: 'detector' }`
   per kind.
2. Every match is replaced by `[redacted]` in the text kept for Jev, including
   matches that raised no warning (a reserved-domain email, say).
3. Jev, only with a saved key, the role on and current legal consent
   (`resolveJevRoleModel`, then `hasUserLegalConsent`): the redacted segments
   are packed into chunks of up to `JEV_SHARE_PII_CHECK.maxChunkTokens` (25,000
   estimated tokens, the conservative default family so Cyrillic is not
   undercounted), and one oversized message is split in halves. Each chunk is
   one `p1_personal` question under the `chat` state key through `jevDecide`,
   sequentially, sharing one `AbortSignal.timeout(1500)`. A score at or above
   0.30 adds `{ kind: 'personal-data', source: 'typesafe' }` and stops.

**`checked`.** True only when Jev answered for every chunk it was asked about
(or flagged one), or when there was no text to check. False without a key,
role or consent, and on any Jev failure (401, 429, 529, timeout, network,
refusal, a missing answer). Detector warnings are returned either way.

**Logging.** `attributes.sharePiiCheckJev` through `recordJevRoleLog`: calls,
questions, input tokens, latency, scores, and counts of chunks, detector
warnings and a flag. Existing keys `userId` and `chatSlug` are the only other
fields. No text.

**Modal.** `ShareModal.client.vue` runs `runShareCheck` from `useChatShare()`
once the modal is open, its share settings have loaded and a debounce
(`JEV_SHARE_CHECK_DEBOUNCE_MS`, 400 ms) has passed, and again when "Show images
& file names" changes. The request is aborted when the inputs change or the
modal closes; any failure, including a 429, becomes `status: 'error'` with no
toast. One slot sits next to the files and memory notes and always shows one
of four states: a skeleton, the warning, a quiet "no personal data found"
(`checked: true`), or "Check the chat for personal data before sharing."
(`checked: false` without warnings, or an error). The warning names up to
three kinds, says anyone with the link can read the chat, that the user's own
contact details count, and adds an emphasized line about search engines while
indexing is on (client-side, no re-check). The slot is `min-h-36 sm:min-h-28`
in every state. The height was computed, not measured: a DaisyUI alert is 24 px
of block padding plus a 2 px border and 20 px per `text-sm` line, and the
longest state (the warning with the indexing sentence, about 180 characters)
wraps to 4 lines at the 512 px modal and about 5 on a 375 px phone, so 112 px
and 144 px leave one spare line. A previous result stays on screen while a
re-check is pending, so only the very first check shows the skeleton.

**Safe direction.** No key, role off, no consent, any Jev failure, or a failed
request: the detector warnings (if any) plus the generic reminder, Generate
untouched.

**Memory page skeleton.** `memory-checks-skeleton` in
`app/components/Profile/Memory/ExtraChecks.vue` is now two `h-5` lines in a
`grid gap-1`, the height of the saved state (two `text-sm` lines), so the card
no longer jumps when the key status resolves. The content wrapper is
`min-h-11` (the same two lines), so the one-line "add a key" state takes the
same height and users without a key see no shift either.

#### J6: Past-chat retrieval (`pastChatRetrieval`)

Pre-retrieval of past chats for sends where `search_chats` and `read_chat`
are not registered. Tools stay registered exactly as before for
tool-calling models, with no per-message tool churn, so the provider's prompt
cache is untouched; this role only covers `toolCallingAllowed === false` (a
model or gateway without tool calling, a forced `toolChoice`, or image
generation) while **Search and reference chats** is on in the settings.

- **Gate.** `isChatSearchToolEnabled(memorySettings) && !toolCallingAllowed
  && userMessageText !== null`, in `index.post.ts` right after the user text
  is read. `resolveJevRoleModel({ role: 'pastChatRetrieval' })` runs first:
  with no TypeSafe AI key, or with the role switched off, nothing else runs,
  not even the phrase guard, so the send is identical to before.
- **Decision.** `decidePastChatSearch` in
  `server/utils/memory/tools/pre-retrieval.ts`. A message containing a
  `JEV_PAST_CHAT_PHRASES` entry forces the search with no Jev call. Otherwise
  one `s1_previous` question runs over `{ recent_turns, message }` (the last
  three text turns before the message as `User: …` / `Assistant: …`, each cut
  to 600 characters, the message cut to 2,000, never-store values removed
  from all of it) with the 800 ms send-path timeout; a probability at or
  above 0.25 searches. Any Jev failure (401, 429, 529, timeout, network,
  refusal, or a missing answer) also searches: skipping a needed search is the
  costlier mistake, and a pre-search is one cheap indexed D1 query.
- **Search.** The existing `searchChats` with the same owner, current-chat
  exclusion, `memory_excluded` and project scoping (the project id is passed
  under the same condition as the tool registration), `limit: 3`, plus
  `excludeForeignShareBranches` (delta audit finding 6, 2026-10-26): a chat
  whose `branched_from_share_slug` is set is left out unless that share
  belongs to a chat of the same user, so turns another person wrote and the
  user only branched are never injected unasked; a branch whose share no
  longer exists counts as foreign. The `search_chats` tool, which the model
  calls and whose results it sees as tool output, keeps every branch. The query is
  the message with the guard phrases, stop words (`STOP_WORDS` from the
  knowledge search plus chat filler in EN/UK/PL/RU) and one-character tokens
  removed, so the eight-token cap is spent on distinctive words; an empty
  query skips the search. The call receives the route's memoized
  `resolveRerankModel` (the J4 re-ranking), so with the `rerank` role on the
  hits are ordered like the tool's; no other Jev call is added for it.
- **Injection.** The top hits become a `<past_chats>` block (notice, then a
  `<past_chat>` entry per hit with title, date and the bracket-neutralized
  `<chat_excerpt>` snippet, never-store values removed) capped at
  `JEV_PAST_CHAT_RETRIEVAL.maxExcerptTokens` (1,500, with the send's token
  family; hits are added in rank order until the next one would not fit).
  It is appended to the last user turn of the model-facing copy next to the
  project-knowledge excerpts, exactly like `buildKnowledgeAwareMessagesForModel`
  does, so it never reaches `messagesForAI`, `originalMessages` or the
  persisted user row. The block says it is quoted history and never
  instructions.
- **Write lock.** `presetMemoryWriteLock` takes `holdsPastChatExcerpts`, set
  when a block was added. On these sends `chatSearchBudget` is `undefined`
  (both `chatSearchToolsRegistered` and `memoryToolsRegistered` need
  `toolCallingAllowed`) and `memory_write` is not registered at all, so the
  lock is wired but has nothing to lock today; it takes effect if memory
  tools are ever enabled for sends without tool calling. Do not create a
  budget for these sends just to exercise it: a budget grants
  `CHAT_SEARCH_MAX_CALLS_PER_TURN` extra tool-loop steps.
- **Chip.** A synthetic `tool-search_chats` part with a
  `past-chat-pre-retrieval-<user message id>` tool call id, written to the
  client stream (`tool-input-available` and `tool-output-available`) and put
  first in the persisted assistant parts after the empty-answer checks. It
  carries the query and each chat's title, link and date, never an excerpt.
  It renders in the existing `SearchStep` as "Used 3 earlier chats" with links.
  Because it is a tool part it is stripped by the public share view
  (`filterPublicParts`) and by the model-context sanitizer (only text survives
  past assistant turns), and the client `hasMeaningfulAssistantParts` ignores
  it so an empty reply still surfaces as empty (the server-side check never
  counts `tool-search_chats`).
- **Logging.** `attributes.pastChatRetrievalJev` through `recordJevRoleLog`:
  `calls` is 0 when the phrase forced the search, `scores` holds the Jev
  probability, and `counts` holds one of `forced`, `search`, `skip` or
  `failed` plus `searched` (0 or 1) and `hits`. No text is logged.
- **Cost and latency.** About 420 input tokens per Jev call (about $0.00002),
  p50 170 ms and p95 about 215 ms in the eval. The Jev call and the memory
  index and project-knowledge loads run concurrently; the route awaits the
  Jev result just before the stream starts.
- **Seam with Auto web search (J1).** `decidePastChatSearch({ model, message,
  recentTurns })` builds its own state and question map and makes its own call.
  J1 shipped later with `server/utils/jev/send-path.ts` and did not merge the
  two calls; the two roles run at different points of the send and overlap only
  for a model without tool calling that uses its built-in search in Auto. The
  merge, one shared state and one `decideSendPathJev` call, is described under
  "J6 seam" in J1 and is not done.

#### Delta audit fixes (#560)

The 2026-10-26 security audit of the Jev roles (J0 to J6) was fixed in #560.
The behaviour is described in the section of the role it changed; this is the
index, so a reader can see the whole set in one place.

| Finding | Fix | Described in |
|---|---|---|
| 1. A native PDF's pages are never screened, only its extracted text | A scan keeps "Send as PDF" and is marked "Not screened for prompt injection"; a `ready` PDF's toggle says screening reads the text layer only | J3, "Native PDFs" |
| 2. Ingest screening stopped on the first Jev failure and stored the rest `ready` forever | Per-item KV re-screen queue (14 days), re-screened by the hourly knowledge sweep (10 items per run, 12 chunks per item, 5 attempts); 24 Jev calls per knowledge request | J3, "Unscreened queue" |
| 3. Auto web search asked Jev before the send was validated | The chat POST validates the superset of tools Auto may pick, then asks; the new-chat PUT never calls Jev; the first POST decides and sets a one-day marker | J1, "Server" and "First message" |
| - Exa `author` and non-ISO `publishedDate` reached the model unscreened | Both dropped from model-facing results; only title and snippet are screened | J3, "Brave and Exa results" |
| - Cross-site and volume guards missing on two new routes | `PATCH /chats/:slug/memory` and `POST /chats/:slug/share/check` call `assertNotCrossSiteRequest`; the memory exclusion route uses the shared `write` rate-limit bucket | 3.7 (per-chat exclusion), J5 |
| 6. Re-ranked passages could steer their own score; pre-retrieval could inject another person's turns | Passages and query moved into the shared state as `passage_<i>` keys; past-chat pre-retrieval skips chats branched from another user's share (or a share that no longer exists) | J4, "Request"; J6, "Search" |
| 5. Transfer consent covered four gateway vendors and not router models | Consent for more gateway vendors and one generic router consent (`docs/legal.md`) | `docs/legal.md`, the DPIA and the Art. 30 record |
| 12. TypeSafe AI described inconsistently as controller and processor | Independent controller towards Besidka; its DPA is its contract with the account holder | Privacy Policy, DPIA, Art. 30 record, `docs/legal.md` |

The numbers are the audit's own; "-" marks a fix without a finding number.

#### Legal and consent

TypeSafe AI, Inc. is a US recipient, not on the Data Privacy
Framework, relying on the SCCs (Module 2) and the UK Addendum in its DPA, which
marks sensitive-data safeguards "N/A". It is listed in the Privacy Policy, the
Art. 30 record and the DPIA (risk rows 20 to 24, section 3.7a). The consent
modal names recipients by category ("the AI providers ... whose keys I add (for ... memory)"), so the
consent version stays `2026-11-a`. Research and test results:
`typesafe-jev-findings.md` in the session scratchpad.

## 4. Cost and performance

| Item | Per turn | Who pays |
|---|---|---|
| Memory index in prompt | ≤ 2.5k tokens, cached prefix on Anthropic/OpenAI | user |
| Project knowledge full-inject | ≤ min(64k, 7% × context window) tokens plus a per-send fit check, cached prefix (`docs/project-knowledge-design.md`) | user |
| Tool calls (memory/search) | 0 unless the model decides; ≤ 3 calls, ≤ ~3k tokens each | user |
| Extraction | ~$0.001–0.004 per idle chat, not per turn | user (cheap model) |
| FTS5 queries/writes | already paid today | operator (D1) |
| Embeddings (P4 only) | ~$0.012 / 1M tokens + Vectorize ≈ $0 | operator |

Cache churn: memory index edits invalidate the Anthropic/OpenAI cache once
per edit — acceptable, edits are rare relative to turns.

## 5. Phases and parallel workstreams

Ownership is by file set so parallel sessions never touch the same files.

**As built: how the plan was actually split (checked against the commit history, 2026-10-26).**
The P1/P2/P3 grouping below is the plan. The work shipped on three branches,
and the workstream names did not map one to one onto them:

| Plan | Branch and PRs | What it holds |
|---|---|---|
| P1 | W1 #500, W2 #501 | Project-memory fixes and `search_chats` / `read_chat` |
| P2 | umbrella `feat/memory-p2`: W3 #508, W5 part 1 #509, W6 #510, W4 #511, W5 part 2 #514; then #515 to #521 and #523, #524 | Contract and gate, backend, extraction sweep, the Memory tab, removal of the sensitive opt-in (#515, #516), project memory as entries (#517, #518), About me as a profile entry (#519), rich entries with backfill and import (W6c, #520, #521), opt-in extraction (#523, #524) |
| P3 | umbrella `feat/memory-p3`: K0 #522, K1 #525, K2 #526, K3 #527, then #532 to #560 | Project knowledge (W7), Claude-parity and client-only extraction (#532), the two 2026-10-26 audits (#533, #534, #535, #536), per-chat exclusion (#542), "tell Besidka what to remember" (#543), open backend items (#544), the consent gate (#545, #547), the TypeSafe AI key and memory checks (#549), the `/memory` guide (#550), and the Jev roles J0 to J6 with their delta audit (#552 to #555, #557 to #560) |

W5 (the Memory tab) landed inside P2, not P3; W8 (data rights) was spread over
W4, W6c, the audits and #542 rather than built as one workstream. The
as-built sections are 3.10 (W3), 3.11 (W4), 3.12 (W6), 3.13 to 3.15 (W6b,
special-category data, W6c), 3.16 (W5), 3.17 and 3.18 to 3.19, and
`docs/project-knowledge-design.md` sections 15 and 16 (W7).

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
  control is prompt-only (no code enforcement, no retro-scrub). History: the
  blob pipeline was retired in W6b (3.13) and Art. 9 is now code-enforced on
  every path (3.11, 3.14).
- Then in parallel:
  - **W4 Memory backend** — CRUD API under `server/api/v1/memory/`, index
    builder + injection in `buildChatInstructions`, `memory_read/list/write/
    forget` tools.

    *Implemented* (branch `feat/w4-memory-backend-aaf9e2`, no schema change;
    details and decisions in 3.11): entries service and CRUD/reset/export API,
    index builder with the Cyrillic-aware budget and its injection first in
    both instruction call sites, the four memory tools with a request-quote
    gate and the Undo chip, `chatSearchEnabled`/`memoryEnabled` wired
    (fail-closed), and the chat-deletion cascade.
  - **W5 Memory UI** — `app/pages/profile/memory.vue`, entry list grouped by
    category, edit/delete, toggles (no sensitive opt-in, section 7), "About me",
    project Memory modal with *Use account memory*.

    *Implemented* in two parts (#509, #514) and extended by later PRs; see
    3.16. The "About me" box became the account `profile` entry (section 7).
  - **W6 Extraction sweep** — `server/utils/memory/extract.ts`,
    `server/plugins/memory-extraction-sweep.ts`, lease, structured ops,
    project blob migration.

    *Implemented* (branch `feat/w6-memory-extraction-b4d3e2`; see 3.12).

**P3 — knowledge and rights**
- **W7 Project knowledge** — dynamic budget `min(64k, 7% × context window)`
  with a per-send fit check (`docs/project-knowledge-design.md`),
  `search_project_knowledge`, folder upload (Chromium link +
  webkitdirectory).

  *Implemented* (K0 #522, K1 #525, K2 #526, K3 #527, close-out #541): not the
  `project_files` link table and chunk FTS this plan named. Items are rows in
  `project_knowledge_items` (metadata only), extracted text and a per-project
  search pack live in R2, and search is MiniSearch BM25 built in the Worker
  (`docs/project-knowledge-design.md` sections 9, 15 and 16).
- **W8 Data rights** — export/import, chat-deletion cascade, purge, a way to
  keep a chat out of memory, privacy-policy text (`content/` legal docs).

  *Implemented* piecemeal: export (3.11), import (3.15), the chat-deletion
  cascade (3.11), account purge (3.7), the privacy policy and consent gate
  (#545), and, in place of an "incognito" flag, the per-chat memory exclusion
  `chats.memory_excluded` (3.7, #542). The export's known gaps are in 3.7 and
  3.17.

**P4 — only if needed**: Vectorize semantic recall; Queues for lower
extraction latency. The "tell Besidka what to change" natural-language editor
this list once held shipped early (3.18, #543).

Every workstream: register new specs in `scripts/test-affected-check.mjs`,
run `pnpm run format && pnpm run typecheck`, inspect any generated migration
for `DROP TABLE` (must be additive only), and update this document's
decision log when a decision changes.

## 6. Open risks

- Tool-calling quality varies by provider; weak tool users may never call
  `search_chats`. Mitigation: index lines tell the model *when* to read.
- FTS recall for paraphrased questions is limited; this is the trigger for P4.
- Extraction quality on the cheapest models (duplicates, stale facts) — merge
  prompt includes the current index; expiry by `lastUsedAt` is not built.
- Memory poisoning via assistant echo of web/tool content — trust boundary in
  3.4 plus never-store gate; still worth a red-team pass before GA.

## 7. Decision log

### No sensitive opt-in in v1 (owner, 2026-10-25)

**Decision.** v1 does not let a user store special-category (GDPR Art. 9)
data in memory, with or without consent. The earlier plan (an explicit-consent
toggle, "Include sensitive topics in memory", like Claude's) is dropped, not
deferred behind a flag.

**What v1 does instead**

- A deterministic English, Ukrainian and Polish classifier (the rule table also
  has Russian patterns) rejects special-category text on every write path: the
  entries API (create and edit), the `memory_write` tool, extraction (the op is
  dropped as `sensitive-topic`) and the About-me migration. Interactive paths answer 422 with
  one shared message, `SENSITIVE_TOPIC_REFUSAL_MESSAGE`. The import from
  another assistant (3.15) uses the same gate. Details: 3.5, 3.11, 3.14.
- The classifier categories are health, religion or belief, political opinion,
  racial or ethnic origin, sex life or orientation, trade union, genetic,
  biometric, plus ongoing legal disputes and drug use (owner extension).
- Every row written is `sensitivity = 'none'`. There is no runtime flag, no
  provider allowlist and no transfer filter, because nothing sensitive is
  stored to protect or to transfer.
- `user_settings.memory_include_sensitive` stays in the database, unused. It
  was not dropped because dropping a column makes Drizzle rebuild
  `user_settings`, and on D1 that rebuild can cascade-delete every child table
  (the D1 migration rules in AGENTS.md). PATCH ignores the key and GET returns a
  constant `false`.
- Removed from the code and the design: the opt-in toggle and consent dialog,
  the opt-out purge (`buildSensitiveMemoryPurge`, `purgeSensitiveMemoryEntries`,
  `sensitiveEntriesDeleted`), the `sensitive-disabled` verdict, SQL opt-in
  guards on create and update, the third-party `people` special case, the
  `SENSITIVE_MEMORY_PROVIDER_ALLOWLIST` transfer filter and its "withheld" line
  in the index, and the planned `NUXT_PUBLIC_MEMORY_SENSITIVE_OPT_IN_ENABLED`
  flag.
- Legacy `special` rows from before the removal are never injected, hidden from
  the tools and locked for extraction; the user can still delete them.

**Why** (full research and sources: `docs/legal-memory-sensitive-data.md`)

- Explicit consent under Art. 9(2)(a) is lawful in principle, but shipping it
  needs a consent dialog with versioned text, per-user consent receipts, a
  DPIA, an Art. 30 record, a verified transfer story per provider and legal
  pages that currently say the opposite. None of that exists, and the Privacy
  Policy still says Besidka has no lawful basis for special-category data.
- BYOK providers differ: DeepSeek (PRC), Moonshot and Qwen (Singapore) have no
  EU adequacy decision, gateways cannot be pinned to a provider, and
  extraction would send chat content to a third-party model that may infer
  Art. 9 data (CJEU C-184/20).
- Dropping the feature keeps memory shippable now without waiting for counsel.
  The classifier is a safeguard, not a legal conclusion; its misses are listed
  in 3.11.

**Revisit when all of these hold**

1. Counsel (a Polish *radca prawny* or data-protection specialist) signs off on
   the Art. 9(2)(a) basis and the replacement legal wording.
2. A DPIA and an Art. 30 record exist for memory and chat storage.
3. Per-user consent receipts exist: the `CONSENT_DB` receipts table
   (`consent_receipts`) is pseudonymous today, with no user id and no kind
   column, so it needs a user-linked extension that still respects the
   `CONSENT_DB` isolation rule.
4. Each provider that would receive sensitive memory has verified adequacy or
   EU-US Data Privacy Framework status (dataprivacyframework.gov), and gateway
   sends are either pinned or excluded.

Path to revisit is option (b) in `docs/legal-memory-sensitive-data.md` section
6: consent dialog, receipts, re-consent, an allowlist-gated injection and the
withdrawal purge, rebuilt from the removed design (the git history before
#515 and #516 has it).

### About me becomes a profile entry (owner, 2026-10-25)

**Decision.** The free-text "About me" (`user_settings.about_me`) is no longer
a separate feature. It becomes the account `profile` memory entry: edited on
the Memory page like any entry, counted in the index, covered by the
compliance gate. The settings PATCH keeps `aboutMe` only as a null-only field
(the user removing leftover text); the column stays, no migration, no table
rebuild (D1 rules in AGENTS.md).

**Migration flow** (`server/utils/memory/about-me-migration.ts`,
`migrateAboutMeToProfileEntry({ db, userId, logger, settings?, recordCompliance? })`).
It runs from the settings GET, which the settings sync plugin calls on every
app load, so every user is covered without a cron or a one-off script. The GET
reads `user_settings` once and passes `{ aboutMe, memoryEnabled }` in as
`settings` (the migration reads the row itself only when `settings` is
omitted), so a user whose `about_me` is already `NULL` costs no extra query.
The GET also passes `recordCompliance: false`: a `rejected` text is retried on
every load and would otherwise log the same `memoryCompliance` counts each
time, so only `memoryMigration.aboutMe = 'rejected'` is recorded there. Steps,
in order; every skip leaves `about_me` untouched:

1. Read the trimmed `about_me` and the resolved `memoryEnabled` (null counts as
   on). Empty → `empty`; memory off → `memory-off`.
2. Size: the `profile` body cap is `maxAlwaysInjectedBodyBytes` (1536
   **bytes** since W6c, 3.15, `memoryByteLength`) against `about_me`'s 4000
   characters. Over the cap → `too-long`. Text is never truncated. 768
   Cyrillic characters is exactly 1536 bytes.
3. `profile` is a singleton per account scope: an existing entry → `profile-exists`
   (never overwritten). The 409 "already exists" that `createMemoryEntry` throws
   when a concurrent call wins the race is mapped to the same outcome.
4. `createMemoryEntry` with `origin: 'user'`, compliance origin
   `about-me-migration`, category `profile`, title `About me`, body = the
   trimmed text, description = the first non-empty line with whitespace
   collapsed, cut at the last word boundary to fit `maxDescriptionChars` (100)
   with an ellipsis when cut (`Things I wrote about myself` if there is no
   text). A compliance refusal (never-store 422 or sensitive-topic 422) →
   `rejected`, no throw. The 409 `Memory limit reached` (the account already
   holds `maxAccountEntries` = 30 entries) → `entries-full`, no throw.
5. On success, `UPDATE user_settings SET about_me = NULL`. The cleared column
   is the migration marker, so there is no flag and no migration table.

**Atomicity.** `createMemoryEntry` is a guarded `insert ... select` plus a
read-back, so it cannot join a `db.batch` with the clear. The order is insert
first, clear second: a crash between them leaves the text in both places
(injected twice) rather than in neither. The next call heals it: when the
existing profile entry has the title `About me` and exactly this body, the
clear is completed and the call counts as `migrated`. Any other existing
profile entry is untouched. Concurrent calls therefore end with one entry and
a cleared column.

**Caches.** The memory index is built from D1 on each send (no KV cache), so
nothing needs invalidating; the next chat after the migration sees the entry.

**Outcomes**

| Outcome | `about_me` after | Profile entry | GET `aboutMeNotMigratedReason` | Chat injection |
| --- | --- | --- | --- | --- |
| `migrated` | `NULL` | created | `null` | in the memory index |
| `empty` | unchanged (null/blank) | none | `null` | nothing |
| `memory-off` | unchanged | none | `memory-off` | nothing (entries are not injected while memory is off) |
| `too-long` | unchanged | none | `too-long` | nothing |
| `profile-exists` | unchanged | existing one untouched | `profile-exists` | index (existing entry) only |
| `rejected` | unchanged | none | `rejected` | nothing |
| `entries-full` | unchanged | none | `entries-full` | nothing |

`aboutMeNotMigratedReason` is derived from the migration outcome of the same
GET and is `null` whenever the column is empty after the migration (so a call
that lost a race to a concurrent migration reports `null`). The UI uses it to
show the leftover text as "Earlier about me (not used in chats)" with the
matching explanation until the user saves it as an entry or removes it
(`PATCH aboutMe: null`).
A migration that throws (a D1 error, or a 409 that is neither the singleton
conflict nor the account cap) is logged as
`attributes.memoryMigration.aboutMeError` and reported as `null`.

`entries-full`: the account is at the 30-entry cap, so there is no room for the
profile entry. Nothing is created and the text stays in `about_me` (not
injected) and is shown with "Your account memory is full (30 entries). Delete
one and this converts automatically." The user frees an entry; the migration
runs again on the next load (the next GET) and converts the text. The cap is
told apart from a lost singleton race by looking for an existing profile entry
first, then by counting the account's entries.

Turning **Use memory** on from the Memory page re-reads the settings GET (so a
`memory-off` text converts right away) and refreshes the entries list, instead
of waiting for the next app load.

**Logging.** Only the outcome label, never the text:
`attributes.memoryMigration.aboutMe = 'migrated' | <reason>`. The frequent
`empty` outcome is not logged. The compliance gate logs counts and category ids
under `memoryCompliance` with origin `about-me-migration`, as everywhere else.

**Owner decisions (overridable)**

1. **No truncation.** Text over 1536 bytes stays in `about_me` and is shown as
   "Earlier about me (not used in chats)" until the user shortens it into an
   entry or removes it. Truncating would silently drop what the user wrote.
   Alternative: raise the `profile` cap or split the text into several entries.
2. **An existing profile entry is never overwritten.** Merging two texts is a
   judgement the server should not make; the user decides on the Memory page.
3. **Memory-off users are not migrated.** The migration runs when they switch
   memory on (the next GET). While memory is off nothing about the user is
   injected, the leftover text included.
4. **A full account is not migrated.** At the 30-entry cap the text stays
   (not injected) instead of evicting an entry the user chose to keep or
   failing the settings GET; it converts once the user deletes an entry.

**Resolved (2026-10-26).** Text rejected by the classifier (`rejected`) used to
keep flowing into every chat through the `aboutMe` block. No skipped text is
injected any more (see "Decision (2026-10-26)" in section 6); the Memory page
notice is the only place it appears.

### No background model calls without an explicit opt-in (owner, 2026-10-26)

**Rule.** This replaces the earlier rule "Project memory updates automatically
(owner, 2026-10-25)", which let the cron sweep extract project chats without
the extraction opt-in. Nothing runs in the background on a user's key unless
the user switched **both** `memoryEnabled` (null counts as on) and
`memoryExtractionEnabled` ("Generate memory from chats", default off, explicit)
on. For project and non-project chats alike the sweep selects a chat only then;
with the toggle off nothing runs in the background: no project sweep and no
history backfill. A per-project Disable still excludes that project.

**Cut-over (no implicit history).** The sweep never walks old history just
because a chat has no watermark. When extraction becomes effective (the toggle
on, or `memoryEnabled` false to true while it is on) the settings PATCH records
`user_settings.memory_extraction_enabled_at` (additive nullable column, no
default) and still stamps `chats.memory_extracted_at` as before (the account
backfill ceiling depends on it). Account chats are limited by that stamp.
Project chats share their watermark (`project_memory_summary_updated_at`) with
the explicit Refresh button, so stamping it would hide a project's history from
Refresh; they use the cut-over column instead: the sweep takes a project chat
only when its activity is after `memory_extraction_enabled_at`, and reads only
messages after the later of that time and the project watermark. A user who
enabled extraction before the column existed has no cut-over recorded and is
not swept for project chats until they switch the toggle once. Old history is
processed only through the explicit "Build memory from past chats" backfill with
its cost estimate (enabling extraction never creates a job).

**Explicit actions keep working with the toggle off** but still require
`memoryEnabled`: the project "Refresh memory" button (reads the project's
history from its own watermark, within its per-click limits) and
`POST /api/v1/memory/extract-now` (works for project and non-project chats; it
reads from the chat's own watermark, ignores idle and cut-over, never stamps
attempted/failures).

**Why.** No spend and no memory creation without consent: a background model
call on the user's own API key, reading their chats, is only acceptable after an
explicit opt-in. The earlier owner rule favoured not regressing the old
automatic project refresh; that was withdrawn for exactly this reason. Model for
every run is unchanged (`resolveMemoryModel`, project scope for project chats),
and the compliance gate applies like everywhere else.

**D1 cost of the sweep.** `selectDueChats` starts from the opted-in users, not
from `chats`: `user_settings` (filtered by a partial index `idx_user_settings_extraction_enabled`
on `(user_id) WHERE memory_extraction_enabled = 1`, with the same predicate in
the query) joined to `chats` through the composite index `idx_chats_user_activity`
on `(user_id, activity_at)`, then a LEFT JOIN to `projects` by primary key. Both
indexes and the cut-over column ship in one additive migration
(`ALTER TABLE ... ADD` and two `CREATE INDEX`, no `DROP TABLE`). Query plan on
the generated SQL until 2026-10-26 (superseded by the due-chats partial index
below, which is what `extract-sweep.spec.ts` asserts now):

```
SCAN user_settings USING INDEX idx_user_settings_extraction_enabled
SEARCH chats USING INDEX idx_chats_user_activity (user_id=? AND activity_at>? AND activity_at<?)
SEARCH projects USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
```

Expected rows read per `*/5` tick: with nobody opted in about 0 (a probe of an
empty partial index; no `chats` rows and no other `user_settings` rows). With K
opted-in users: K index entries and K `user_settings` rows, plus each such
user's idle chats through the composite index and one `projects` primary-key
lookup per project-chat row; D1 billing counts index entries as reads, so
roughly twice the row count for index-driven reads. Since the 2026-10-26 audit
(3.17) the selection also requires
`activity_at > coalesce(memory_extraction_enabled_at, 0)` at the top level, so
the index range starts at the opt-in cut-over: chats idle since before the
opt-in are never read (the enable restamps them, so they were never due).
Caveats: within that range the `row_number` window still reads every due chat
of an opted-in user active since the opt-in (the per-user cap and the pool
apply after the window), a legacy opt-in without a recorded cut-over keeps the
unbounded range, and the plan was verified in the in-memory harness without
`ANALYZE`, not measured on D1.

**Due-chats partial index (2026-10-26, audit 14 follow-up).** The caveat that
already-extracted idle chats in the range were read and then filtered is gone:
migration `20261026133213_memory_chat_exclusion` (one `ALTER TABLE chats ADD
memory_excluded` and one `CREATE INDEX`, nothing else) adds
`idx_chats_memory_due` on `(user_id, activity_at)` with the predicate
`memory_excluded IS NOT 1 AND ((project_id IS NULL AND (memory_extracted_at IS
NULL OR memory_extracted_at < activity_at)) OR (project_id IS NOT NULL AND
(project_memory_summary_updated_at IS NULL OR project_memory_summary_updated_at
< activity_at)))`, so the index holds only dirty chats that memory may use. A
partial index is only usable when a top-level AND term of the query repeats
its predicate, so the sweep adds `chatIsMemoryIncluded()` and
`chatHasUnextractedActivity()` (`server/utils/memory/chat-memory-filters.ts`),
which repeat it term for term with inline literals. The join from
`user_settings` to `chats` is a `CROSS JOIN` with the user equality in the
WHERE: with two partial indexes and no `ANALYZE`, SQLite otherwise flips the
loop to `SCAN chats USING INDEX idx_chats_memory_due` and probes
`user_settings` per chat, which reads every dirty chat of every user, opted in
or not. `CROSS JOIN` pins `user_settings` as the outer loop. Plan now
(asserted in `extract-sweep.spec.ts`):

```
SCAN user_settings USING INDEX idx_user_settings_extraction_enabled
SEARCH chats USING INDEX idx_chats_memory_due (user_id=? AND activity_at>? AND activity_at<?)
SEARCH projects USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

The temp B-tree is the window's per-user sort by
`coalesce(memory_extraction_attempted_at, 0), activity_at` over the due chats
only; an index cannot serve it because its first key is an expression, and an
expression-leading index would lose the `activity_at` range. The cost is one
extra index entry write when a chat becomes dirty or clean;
`idx_chats_user_activity` stays: other per-user, activity-ordered chat reads use it.

### Decisions recorded 2026-10-26 (owner and orchestrator)

One line each, with the reason. Where a decision has an open follow-up, the
issue is named.

- **No automatic expiry; `last_used_at` only breaks ties.** An entry the user
  or the model saved is never deleted for age, because silently dropping what
  someone asked to be remembered is worse than a stale line they can delete.
  `lastUsedAt` (set by `memory_list` and `memory_read`) only orders which
  entry leaves an over-budget index first (3.1, 3.3).
- **`profile` and `preferences` are singletons per scope.** They are injected
  in full on every turn, so one body each bounds the always-on budget (2 x
  1.5 KB), and a unique slug makes a second create a 409 "edit it instead"
  (3.11).
- **15 entries per project stay for v1.** A project's entries share the 2.5k
  token index with account memory, and the extractor merges before creating;
  raise the cap only on real usage data, not in advance (`MEMORY_LIMITS`).
- **Memory writes stay locked when documents or web results are in the
  prompt.** Project knowledge, web search results (including provider-native
  search) and pre-retrieved past-chat excerpts are third-party text, and a
  stored entry outlives the chat, so a clean TypeSafe AI verdict never
  relaxes the lock (`presetMemoryWriteLock`, 3.11, 3.19 J3). The user can
  still ask for the save in a message without those sources.
- **The Anthropic characters-per-token factor is pending a `count_tokens`
  measurement.** `KNOWLEDGE_CHARS_PER_TOKEN.anthropic` (Latin 3.2, Cyrillic
  1.1) comes from reports, not from a tokenizer run, and Anthropic publishes
  no tokenizer; it stays conservative until measured. The endpoint is free.
  Run it for one English prose sample, one Ukrainian prose sample and one code
  sample, and once with a one-word message for the fixed overhead:

  ```bash
  count_tokens() {
    curl -s https://api.anthropic.com/v1/messages/count_tokens \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "content-type: application/json" \
      -d "$(jq -n --rawfile text "$1" '{model: "claude-sonnet-5-5", messages: [{role: "user", content: $text}]}')" \
      | jq .input_tokens
  }
  count_tokens sample-en.txt
  count_tokens sample-uk.txt
  count_tokens sample-code.txt
  printf 'ok' > sample-overhead.txt && count_tokens sample-overhead.txt
  python3 -c "import sys; print(len(open(sys.argv[1], encoding='utf-8').read()))" sample-uk.txt
  ```

  Characters per token for a sample is its code-point count divided by
  (`input_tokens` minus the overhead call). Apply the rule from
  `docs/project-knowledge-design.md` 5.4 (minimum of prose and code, times 0.9,
  rounded down to 0.1) and update `KNOWLEDGE_CHARS_PER_TOKEN.anthropic` and the
  5.4 table. Tracked in #537.
- **KV leases are non-atomic, and that is accepted.** The memory lease, the
  `extract-now` cooldown and the knowledge pack lease are get-then-put, so a
  burst can run two passes on the caller's own key; every write is idempotent
  (unique slugs, origin rules, merges), so the cost is one wasted model call.
  The upgrade (an owner token or a Durable Object per user) is #538.
- **Live location is label-only.** It is enforced only by the extractor's
  `neverStore` label, a model flag the server cannot verify; unlike a home
  address (number plus street, or a cue phrase) it has no stable textual shape
  a narrow deterministic rule can match without also refusing ordinary text
  about places. The leftover is a documented residual (3.5, 3.14, 3.17).
- **All TypeSafe AI roles are on once the key is saved.** Saving the key is
  the opt-in to the spend and to the recipient (the key exists only for these
  checks), each role has its own switch under Smart checks, and deleting the
  key stops all of them (3.19, J0). `typesafe_roles = null` means every role
  is on.
- **The consent version is not bumped for the TypeSafe AI roles.** The consent
  text names recipients by category ("the AI providers ... whose keys I
  add"), and TypeSafe AI is one of them, so a bump would force every user to
  re-consent without a change in what they consented to; the Privacy Policy,
  the DPIA and the Art. 30 record name TypeSafe AI itself. The version stays
  `2026-11-a` (3.19, Legal and consent).
- **The chat-input redesign is planned.** The chat input has grown a project
  picker, the memory exclusion toggle, a web-search menu with Auto, and the
  files button; a redesign is planned and is not part of this work.
- **Deferred work is tracked as issues #537 to #540.** #537: project
  knowledge K4 and P4 (pinned files, provider Files APIs, PPTX, image captions
  and OCR, the `unpdf` fallback, provider-side search, a note edit flow, and
  the Anthropic factor above). #538: atomic leases with Durable Objects, and
  a Vectorize evaluation for projects above the 2 MB text cap. #539: a token
  budget for chat history on 128k to 262k context models. #540: moving the
  deep-research clarifier from `generateObject` to `generateText` with
  `output`.

### Backfill throughput without parallel chats (2026-10-27)

**Decision.** A backfill job processes its chats strictly one after the
other, also after the throughput fix (3.15). Speed comes from a dedicated
minute cron, from using each tick's budget instead of a fixed 3 chats, from
larger interactive steps (10 instead of 2) and from a 3 s drive cooldown.

**Why not 2 or 3 chats of one job at once.** Each pass loads the user's memory
index before the model call and applies its ops against that snapshot.
`extract-apply.ts` drops an update whose base changed meanwhile as `conflict`
and refuses a create whose slug a parallel pass just took, so two passes over
neighbouring chats (often the same topic) would silently lose ops or write
near-duplicates; sequential passes see each other's entries and merge. The
cursor and the single `retried_chat_id` attempt marker also assume one chat in
flight. Parallelism across different users' jobs is safe for memory but needs
the explicit binding capture of the async-context rules and a connection
budget (each chat holds a model stream, plus Jev calls with up to 3 in
flight); it is not needed while jobs are few.

**Revisit when** extraction-heavy jobs (most chats reach the model) must go
faster than about 8 chats per minute. Options, cheapest first: run the Jev
pre-filter for the next chats while the current chat's model call runs
(checks overlap, writes stay sequential); serve different users' jobs
concurrently within a tick; batch several short chats into one pass (also
the cost lever noted in 3.15).

**Spinner.** The toolbar's running states use a CSS-animated
`lucide:loader-circle` instead of daisyUI's `loading-spinner`, whose SMIL mask
starts as a dot (`stroke-dasharray 0,150`, round caps) and next to the
reserved-width label read as a stray dot; the stacked labels are left-aligned
so the icon sits next to the text.

### Transient failures cost delay, not the job (2026-10-28)

**Decision.** A provider blip must cost a minute of delay, not the job. At
the throughput-fix pace, five consecutive fast failures during a 429/5xx
burst could end a job as `consecutive-failures` within seconds. A transient
failure that spent no tokens now stops the step and retries the chat at the
next tick or step (3.15); the abort rules (5 in a row, more than half of at
least 5) are unchanged and only see recorded chats.

**Why the second transient failure is recorded as failed, not skipped.** The
attempt budget is the existing `maxChatAttempts` (2). Skipping on the second
failure would walk a whole queue through an outage as `skipped` and end the
job `completed` with nothing read. Recording it as failed keeps the honest
count: a sustained outage needs two ticks per chat and five chats in a row,
about 10 minutes, to fail a job, instead of a few seconds. A failure after
tokens were spent (the call reached the model) is recorded at once so the
usage is counted.

**Accepted.** The interactive drive shares the attempt budget with the cron,
which is why the client backs off 10 s after a retry-pending step. Our own
deadline (`TimeoutError`) is not transient: a chat that hits it is recorded as
failed at once rather than paid for twice with no usage recorded, so "before
tokens were spent" stays true for every retried chat.

### Per-project automatic updates override the account switch (2026-10-30)

**Decision.** Each project has its own automatic-update setting with three
states: `inherit` (default, stored as NULL), `on` and `off`. `on` and `off`
beat the account switch "Generate memory from chats"
(`user_settings.memory_extraction_enabled`); `inherit` follows it. Memory
turned off in the account settings (`memory_enabled = false`) still blocks
everything, and the legal consent requirement is unchanged. A disabled project
(`memory_status = 'disabled'`) is never swept whatever its setting. Account
chats are untouched: the override is for project chats only.

**`on` is the explicit per-project opt-in to background spend.** It is the
same consent as the account switch, narrowed to one project: Besidka reads the
project's chats on the user's own key about 10 minutes after the last message
in a chat. It therefore follows the "no background model calls without an
explicit opt-in" rule above: default `inherit`, set in the app behind a
confirm, forward-only. A connected app (MCP `update_project`) may set only
`inherit` or `off`, never `on`, because a tool call cannot prove that a human
approved spend (`docs/mcp-server.md`, "What MCP does not do").

**Forward-only cut-over per project.** `projects.memory_auto_update_enabled_at`
is the project's own cut-over. The sweep reads a project chat only when its
last activity is after the applicable cut-over: for `on` the later of the
account cut-over (only while the account switch is on) and the project stamp;
for `inherit` the account cut-over, or the later of the two when the project
has a stamp. The stamp is set when the project becomes `on` from another state,
and when it returns to `inherit` from `off`, so messages written while
automatic updates were off are never read behind the user's back. Re-saving
`on` or `inherit` keeps it, `inherit` from `on` keeps it, `off` clears it so a
later `on` starts a fresh cut-over. The Refresh button still reads earlier
chats on demand.

**One rule, three places.** The rule lives in `resolveProjectAutoUpdate`
(`shared/utils/project-memory-auto-update.ts`) for the extraction gate, the
card and the MCP tools, and in one SQL twin, `projectChatSweepCondition`
(`server/utils/memory/project-auto-update.ts`), shared by the sweep selection
and the "chats left for the sweep" settle check, so the two cannot drift. The
sweep query has two disjoint arms: the existing opted-in-user arm, and an
override arm driven from `projects WHERE memory_auto_update = 'on'` for users
whose account switch is off. A project that is not effective is never settled
by the sweep: its "Out of date" mark clears only through a manual Refresh.

**Schema.** Two nullable columns on `projects`, no SQL default (additive
migration `20261030194122_project_memory_auto_update`, only `ALTER TABLE ...
ADD`).
