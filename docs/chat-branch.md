# Chat branching

Scope:
- branch creation flow (backend + frontend),
- message copying and identity,
- auto-regenerate behavior after branching,
- duplicate detection in the chat POST endpoint,
- pitfalls when adding new per-message columns.

Main files:
- `server/api/v1/chats/branch/index.post.ts`
- `server/api/v1/chats/[slug]/index.post.ts`
- `server/api/v1/chats/[slug]/index.get.ts`
- `app/composables/chat.ts`
- `app/components/Chat/ContextMenu.client.vue`
- `app/components/Chat/Message.vue`

## What branching does

Branching creates a new chat from a subset of an existing chat's messages.
The user picks a message and the backend copies everything from the first
message up to and including the selected one into a new chat.

## Backend flow

1. Validate the request (`chatSlug` + `messageId`).
2. Load the source chat with all messages.
3. Find the branch point by matching `messageId` against `publicId` or `id`.
4. Slice messages from index 0 to branchIndex (inclusive).
5. Create a new chat row (title prefixed with `Branch:`).
6. Batch-insert the copied messages via `db.batch()`.
7. Refresh project activity and mark project memory stale.

### Why `db.batch()` instead of multi-row `.values([])`

Drizzle's `.values([...])` (array form) generates a single
`INSERT ... VALUES (row1), (row2), ...` SQL statement. This causes two
problems:

1. **Parameter limit**: D1/SQLite limits ~100 bound parameters per statement.
   Each message row binds ~7 params, so ≥15 rows would exceed the limit.
2. **Custom type bug**: the `publicId()` custom type on the `id` column breaks
   with array inserts — Drizzle calls `toDriver(undefined)` for the omitted
   `id` column, producing `null` instead of letting SQLite auto-assign the
   rowid.

`db.batch()` sends each INSERT as a separate SQL statement in a single HTTP
round-trip. Each statement has ~7 parameters (safe) and handles `id`
auto-assignment correctly.

## Frontend flow

1. User right-clicks a message (desktop) or long-presses 500ms (mobile).
2. Context menu appears with "New chat from here".
3. Frontend calls `POST /api/v1/chats/branch` with `chatSlug` + `messageId`.
4. On success, navigates to `/chats/{newSlug}`.

## Auto-regenerate after branching

When the branched chat loads, `app/composables/chat.ts` has an `onMounted`
hook:

```typescript
onMounted(() => {
  if (
    (chat?.messages.length === 1
      || chat?.messages.at(-1)?.role === 'user')
    && shouldAutoRegenerate.value
  ) {
    chatSdk.regenerate()
  }
})
```

A branched chat where the last message is from the user (common when branching
at a user message) triggers `regenerate()` automatically, which sends a
`POST /api/v1/chats/{slug}` to get an AI response.

## Duplicate detection and the publicId problem

### The problem

When `regenerate()` fires, it re-sends the last user message to the backend.
The backend must decide: is this a new message or a re-send of an existing one?

The duplicate check compares the incoming message against the last persisted
user message. If it determines the message is new, it INSERTs — but using the
same `publicId` that already exists from the branch copy. This violates the
UNIQUE constraint on `public_id`.

### What triggers the mismatch

The duplicate check compares content **and** settings:

- `parts` (message text and attachments)
- `tools` (e.g. `["web_search"]`)
- `reasoning` (e.g. `"off"`, `"medium"`, `"high"`)

`tools` and `reasoning` come from the **frontend's current state**, not from
the stored message:

- `tools` is initialized from the last message's tools.
- `reasoning` is read from `localStorage` (`settings_reasoning_level`).

If the user changed their reasoning level after creating the original message
(e.g. from `"medium"` to `"off"`), the stored reasoning differs from the
sent reasoning. The check fails, the backend treats it as a new message, and
the INSERT hits the UNIQUE constraint.

### The fix

The duplicate check now compares message IDs first:

```typescript
const isDuplicateUserMessage = (
  newMessage.role === 'user'
  && lastPersistedMessage?.role === 'user'
  && (
    newMessage.id === lastPersistedMessage.id        // ← ID match
    || (
      hasSameParts(...)
      && hasSameTools(...)
      && lastPersistedMessage.reasoning === body.data.reasoning
    )
  )
)
```

If the frontend sends a message whose `id` matches the `publicId` of a
persisted message, it is the same message — regardless of reasoning, tools, or
any other setting changes. The backend takes the UPDATE path (a no-op) instead
of INSERT.

## Adding new per-message columns

When adding a new column to the messages table that is user-configurable per
message (like `reasoning` or `tools`), follow this checklist:

### 1. Branch handler: copy the column

In `server/api/v1/chats/branch/index.post.ts`, add the new column to the
`db.insert(schema.messages).values({...})` inside the batch map. Otherwise the
branch will lose that column's value.

### 2. Chat GET: include the column

In `server/api/v1/chats/[slug]/index.get.ts`, add the column to the
`messages.columns` selection. Otherwise the frontend won't receive it.

### 3. Chat POST duplicate detection: do NOT add to content comparison

Do **not** add new user-configurable columns to the `isDuplicateUserMessage`
content comparison branch. The ID comparison already handles re-sends. Adding
more fields to the content branch only increases the risk of false negatives
(treating a re-send as a new message) when the user changes settings between
page loads.

The content comparison branch exists as a fallback for edge cases where the
message ID doesn't match (e.g. regenerating after client-side message ID
changes). It should compare the minimum needed to identify truly identical
messages, not every possible setting.

### 4. Frontend transport: check what's sent

The `prepareSendMessagesRequest` in `app/composables/chat.ts` sends the current
tool/reasoning state. If the new column is sent from the frontend and stored
on the server, ensure the frontend's current value for that column is
consistent with what the backend expects, or rely on the ID-based duplicate
check.

### 5. Test both paths

Write tests that verify the duplicate detection works when the new column's
value differs between the stored message and the incoming message. The ID-based
check should short-circuit, preventing a UNIQUE constraint violation on
`public_id`.
