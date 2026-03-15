# Future Feature: Message Content Search

## Status

Not implemented. This is a planning document for a future improvement.

Current behavior: history search matches chat title only.

## Why Title-Only Search Exists Today

Message content is stored as rich `UIMessage['parts']` JSON (tool calls,
reasoning, file refs, plain text) in a single `messages.parts` blob column.
A `LIKE '%query%'` scan on this column:

- has no index and triggers a full table scan on `messages`
- matches JSON structure keys and non-text fields, producing false positives
- is semantically unsound — users expect to search message text, not raw JSON

## Recommended Approach: SQLite FTS5

FTS5 is SQLite's built-in full-text search engine, available in D1. It
maintains an inverted index and supports ranked results, prefix matching, and
snippet extraction — all inside D1 with no external service.

## Schema Design

### Text extraction column

`messages.parts` is rich JSON, not plain text. A dedicated column must store
only the extracted text:

```sql
ALTER TABLE messages ADD COLUMN search_text TEXT;
```

Populated at write time by extracting `type = 'text'` parts:

```typescript
function extractSearchableText(parts: UIMessage['parts']): string {
  return parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ')
}
```

### FTS5 virtual table

A content table pointing at `messages` — no data duplication, reads on demand:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid'
);
```

### Sync triggers

FTS5 content tables require explicit triggers to stay in sync:

```sql
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text)
    VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text)
    VALUES ('delete', old.rowid, old.search_text);
END;
```

Triggers run in the same transaction as the parent write — no async fan-out.

## Query Pattern

Drizzle raw SQL with BM25 ranking and snippet extraction:

```typescript
const results = await db.run(sql`
  SELECT
    c.id,
    c.slug,
    c.title,
    c.activity_at,
    snippet(messages_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
  FROM messages_fts
  JOIN messages m ON m.rowid = messages_fts.rowid
  JOIN chats c ON c.id = m.chat_id
  WHERE messages_fts MATCH ${query + '*'}
    AND c.user_id = ${userId}
  ORDER BY rank
  LIMIT ${limit}
`)
```

`MATCH 'query*'` gives prefix matching. `ORDER BY rank` uses BM25 relevance.

## API Design

Add an optional `searchIn` query param to the existing history endpoint:

```
GET /api/v1/chats/history?search=query&searchIn=content
```

- `searchIn` defaults to `title` (current behavior, unchanged)
- `searchIn=content` runs the FTS5 query instead of the title `LIKE` filter
- Both modes return the same response shape; content mode adds a `snippet`
  field per result

This keeps the current title path unchanged and introduces content search
as an opt-in mode.

## UI

A toggle in the search bar:

- `Search titles` (default)
- `Search messages`

The toggle sets `searchIn` in the query. The history composable passes it
through to the API and caches results separately per `searchIn` value.

## Migration Plan

1. Add `search_text TEXT` column to `messages` (nullable, no default)
2. Backfill existing rows: extract text from `parts`, write to `search_text`
   - Backfill must be batched (D1 has a 10-second per-request limit)
   - Run as a Durable Object task or scheduled cron, not a migration step
3. Create FTS5 virtual table and sync triggers
4. Update message INSERT path to populate `search_text`
5. Add `searchIn=content` handling to the history API

## Comparison

| Capability | LIKE scan | FTS5 |
|---|---|---|
| Index | No | Yes (inverted) |
| Relevance ranking | No | BM25 |
| Prefix match | Slow | Fast |
| Snippet extraction | Manual | Built-in |
| False positives from JSON | Yes | No (text column only) |
| D1 support | Yes | Yes (SQLite 3.45+) |
