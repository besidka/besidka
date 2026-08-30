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
  automatically.

Why standalone over content-table-with-triggers: triggers run in the same
transaction as the write and add an extra layer of DB-side logic to reason
about and to keep bug-free; a best-effort, always-non-throwing app-level write
plus an hourly reconciling sweeper gives the same eventual consistency
guarantee with far simpler failure semantics — a missed write or delete is
invisible to users and self-heals within the hour, instead of failing (or
silently corrupting) a user-facing request.

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
