# MCP server

`/mcp` is one MCP server (Streamable HTTP, stateless on Workers, built with
`@nuxtjs/mcp-toolkit`) with two kinds of tools on the same route:

- **Public tools** (product facts: models, providers, key guides, public
  pages). They work without a token, read only public content and never
  touch user data.
- **Private tools** (the signed-in user's chats, projects and memory). They
  need an OAuth access token issued by Besidka's own authorization server
  (Better Auth `@better-auth/mcp`, see `server/utils/auth.ts`).

How agents find the server (MCP Server Card, API catalog, `llms.txt`) is in
`docs/agent-readiness.md`. The planned documentation app will have its own
MCP server at `/docs/mcp`; this one does not serve documentation content.

## Mixed (lazy) authentication

The server follows the lazy-authentication pattern Claude documents for
connectors: a client connects anonymously and authenticates only when it
first calls a tool that needs it.

- `initialize`, `tools/list`, `ping` and every public tool work without a
  token. `tools/list` lists **every** tool, private ones included, so a client
  can show them before the user signs in. Do not use the toolkit's per-tool
  `enabled` guard on private tools: it hides them from anonymous listings.
- A `tools/call` of a private tool without a token gets **HTTP 401** before
  the MCP SDK runs, with
  `WWW-Authenticate: Bearer scope="<scopes the tool needs>", resource_metadata="<site>/.well-known/oauth-protected-resource/mcp"`.
  The client reads the protected-resource metadata, runs OAuth (dynamic
  client registration, PKCE, `/oauth/consent`) and retries with the token.
  The root `/.well-known/oauth-protected-resource` describes the origin, the
  `/mcp` one describes the MCP resource, and the 401 `resource_metadata`
  points at the `/mcp` one.
- A valid token that lacks the tool's scope gets **HTTP 403** with
  `WWW-Authenticate: Bearer error="insufficient_scope", scope="<missing>", resource_metadata="...", error_description="..."`
  (RFC 6750 section 3.1), so the client can step up in one round trip.
- An `Authorization: Bearer` header with an invalid or expired token, or a
  malformed one (`Bearer` with no token), gets **HTTP 401** with
  `error="invalid_token"` on any request, public tools included, so the
  client refreshes instead of silently falling back to anonymous. An
  `Authorization` header with **any other scheme** (`Basic`, `DPoP`) is
  ignored and the request is treated as anonymous: a gateway or proxy that
  adds its own credentials must not break the public tools. The scheme
  match is `hasBearerScheme` in `server/utils/mcp/auth.ts`.
- If the key set or the user lookup fails (D1 down), the answer is **503**,
  not 401, so a database outage does not send every client through OAuth
  again.

Why one route and not a second `/mcp/private` server: clients add one
connector URL, the public tools keep working for anonymous agents and
crawlers, and the resource identifier the tokens are bound to
(`${siteUrl}/mcp`, the `resource` option of `mcp()` in `auth.ts`) stays the
one the Server Card advertises.

All of this happens in `server/middleware/01.mcp-request-guard.ts`, which
already parsed the JSON-RPC body. The guard puts the verified identity on
`event.context.mcpAuth` (`{ userId, clientId, scopes }`, typed in
`server/types/h3-context.d.ts`). Each private tool checks it again through
`withMcpPrivateTool` (`server/utils/mcp/private-tool.ts`), so a request that
somehow reached the SDK without the guard's check still gets a tool error,
never data.

### Scopes

`shared/utils/mcp-oauth-scopes.ts` defines the scopes; the tool map is
`MCP_PRIVATE_TOOL_SCOPES` in `server/utils/mcp/tool-scopes.ts`.

| Scope | Tools |
| --- | --- |
| `chats:read` | `list_chats`, `get_chat` |
| `projects:read` | `list_projects`, `get_project`, `read_project_knowledge_item` |
| `projects:write` | `create_project`, `update_project_instructions`, `add_project_note`, `add_project_text` |
| `memory:read` | `list_memory` |
| `memory:write` | `add_memory`, `update_memory`, `delete_memory` |

`openid`, `profile`, `email` and `offline_access` are identity scopes of the
authorization server; no tool needs them. Every tool needs exactly one
resource scope. A unit test (`tool-scopes.spec.ts`) fails when a tool file
and the map disagree, or when the annotations do not match: reads set
`readOnlyHint: true`, writes `readOnlyHint: false`, and `destructiveHint:
true` is set exactly on the tools that overwrite or remove data with no
history: `delete_memory`, `update_memory` and `update_project_instructions`.

### Token verification

The provider issues a **JWT** access token (audience `${siteUrl}/mcp`) only
when the client sends RFC 8707 `resource` on authorize and token, which the
MCP spec requires and Claude does. A client that omits it gets an **opaque**
token, stored hashed in `oauth_access_tokens`. `server/utils/mcp/auth.ts`
handles both: a token with three dot-separated parts takes the JWT path, any
other token the opaque path.

**JWT path** (the fast path, no HTTP call to our own `/jwks`):

- Keys come from the `jwks` table, shaped exactly like Better Auth's `/jwks`
  endpoint (`kid` is the row id as a string, `alg` defaults to `EdDSA`, keys
  stay valid 1 day past `expiresAt`, `MCP_JWKS_GRACE_PERIOD_MS`: long
  enough to cover the 15-minute access token lifetime of a token signed just
  before rotation, short enough that a retired key stops verifying quickly).
- Verification is `verifyJwsAccessToken` from `better-auth/oauth2`, the same
  verifier `requireMcpAuth` uses, given a function key source. It caches the
  key set in memory for 5 minutes per isolate and refetches (30 s cooldown)
  when a token names an unknown `kid`, which covers key rotation.
- Checked claims match `requireMcpAuth`: `iss` equals the site URL (the
  `jwt.issuer` value in `auth.ts`: `runtimeConfig.public.baseUrl` or
  `https://besidka.com`), `aud` contains `${siteUrl}/mcp`, `exp`, and a
  required `azp`. Algorithms are limited to asymmetric ones.
- The `typ` header must be `at+jwt` (RFC 9068), the value
  `createJwtAccessToken` in `@better-auth/oauth-provider` sets
  (`MCP_ACCESS_TOKEN_TYPE`). `jose` compares it case-insensitively and
  accepts the `application/at+jwt` form. An ID token or a logout token signed
  by the same key (`typ` `JWT`, `id_token+jwt`, `logout+jwt` or none) is
  refused even with a matching audience.
- `sub` must differ from `azp`: a token whose subject is its own client is a
  client-credentials style token, never a user grant.
- `sub` must be a positive integer (a user id; client-credentials tokens,
  whose `sub` is the client id, are refused). `scope` is the space-separated
  claim. Tokens with a `cnf` claim (DPoP-bound) are refused: the server only
  supports Bearer.
- One D1 batch (`isMcpPrincipalActive`, three indexed selects) then checks
  that the user still exists, the OAuth client exists and is not disabled,
  and **a live `oauth_consents` row exists for the user and the client**. A
  deleted account, a disabled client, or a disconnected app (Disconnect on
  `/profile/connected-apps` and account recovery delete the consent rows) gets
  `401 invalid_token` on the next request, not when the access token expires
  (its lifetime is `accessTokenExpiresIn` in `auth.ts`, 15 minutes). The
  "up to 15 minutes" wording about a disconnected app no longer applies.

**Key compromise runbook.** The `jwks` table is the only trust root for the
JWT path. If a signing key is suspected leaked: delete its row from `jwks`
(or all rows, to force the plugin to mint a new key on the next token
issue), then wait at most 5 minutes, the in-memory key-set cache per isolate.
Tokens signed with the deleted key stop verifying at once after that;
signed-in clients refresh through OAuth. Do not rely on `expiresAt` for a
compromise: a rotated key stays accepted for 1 day past it, and a deleted row
is the only immediate revocation. Also revoke by consent: deleting
`oauth_consents` rows invalidates every token of those users and clients
without touching the keys.

**Opaque path**: the token is hashed the way the provider stores it with
the default `storeTokens: 'hashed'` (base64url SHA-256, no padding, no
prefix) and looked up in `oauth_access_tokens`, joined to `sessions`. The
same checks as the provider's own introspection apply: not revoked, not
expired, no `confirmation` (DPoP), a linked session that still exists and has
not expired, and a numeric `user_id`. `resources` must include
`${siteUrl}/mcp` **or be empty**. The empty case is accepted on purpose: a
client that sent no `resource` gets an unbound token, Besidka is the only
resource server its scopes mean anything to, and every tool still needs its
resource scope. A token bound to some other resource is refused. If
`auth.ts` ever sets `storeTokens` or `prefix.opaqueAccessToken`,
`hashMcpOpaqueAccessToken` must change with it.

Both paths end with the user and client check above. A lookup failure on
either path is a 503, not a 401.

The site URL must match `auth.ts` byte for byte. If `NUXT_PUBLIC_BASE_URL`
differs between the token issuer and this server (for example a preview
host), every token fails the `iss` and `aud` checks.

### Legal consent, rate limits and logging

Every private tool, reads included, runs these checks in order before its
handler:

1. **Per-user call limits** (`MCP_PRIVATE_TOOL_RATE_LIMIT` and
   `MCP_PRIVATE_WRITE_RATE_LIMIT` in `config/mcp-server.ts`): 120 private
   tool calls per minute, and 30 of them per minute for write tools, on the
   same KV limiter as the auth routes (`createAuthRateLimitStorage`, keys
   `mcp:rate-limit:all:<userId>` and `mcp:rate-limit:write:<userId>`). The
   memory and knowledge write limiters of the HTTP routes apply on top.
   A limit is a JSON-RPC tool error (`isError: true`), not an HTTP 429 or
   401, so the client does not start OAuth again.
2. **Legal consent**: the same gate as the app
   (`getLegalConsentStatus === 'current'`). Without it a connected client can
   neither read nor change anything, and the tool error tells the user to
   open the site and confirm the consent dialog. The error text carries the
   whole instruction, because MCP clients only show an error's `message`.
3. The handler. Its result is compact JSON in a single text part.

The request wide event gets `user_id`, `client_id` (the token's `azp`),
`tool_kind` and per-tool ids and counts (`project_id`, `item_id`,
`memory_entry_id`, `result_count`, `text_bytes`). They are set on the
toolkit's top-level `mcp` key, which `evlog-request-observability.ts` moves
under `attributes.mcp`. Setting `attributes.mcp` directly would be
overwritten by that move. Values must stay scalars: the move drops nested
objects. Content (message text, notes, memory bodies, search terms) is never
logged.

A failed tool call never logs the thrown error's message, bound parameters or
stack: a `DrizzleQueryError` carries the user's text in them. The request
logger gets only `attributes.mcpToolFailure` with `toolName`, `errorName`,
`errorCode`, and `causeName` and `causeCode` when the error has a cause
(`exceptionSummary` in `server/utils/evlog-attributes.ts`), plus a fresh
sanitized `Error` for the severity. `withSafeToolErrors(handler, toolName)`
takes the tool name for this. The message-search leg behind `list_chats`
(`findChatsMatchingMessageContent`) logs the same summary under
`attributes.messageSearchContent` instead of the error message.

Every `tools/call` row also says how it ended, under `attributes.mcp`:
`outcome` is `success`, `error`, `auth_required` or `insufficient_scope`,
`duration_ms` is the handler time, and `error_status` is the HTTP-style status
of a thrown error (the 4xx of a deliberate client error, otherwise 500). The
toolkit turns a thrown error into an `isError` result and still answers HTTP
200, so `server/plugins/mcp-tool-outcome.ts` reads `outcome` and `duration_ms`
from its `mcp:tool:called` hook. `outcome` is written for tools that run only
(`success` or `error`). The guard writes `method`, `tool` and `outcome` for the
401 and 403 answers, which never reach the toolkit. Rows from before this
change carry only the HTTP status; the dashboard
[Besidka · MCP tool calls](https://app.axiom.co/besidka-tnqd/dashboards/uid/besidka-mcp-tool-calls)
(Axiom uid `besidka-mcp-tool-calls`) shows them as `http_200` rather than as
successes, and keeps protocol rows (`initialize`, `tools/list`, 406 and 415
answers) out of the tool-call totals.

## Connecting a client

- Endpoint: `https://besidka.com/mcp`. Streamable HTTP. Public tools need no
  sign-in; the first call of a private tool starts OAuth in the client.
- **Claude Code**: the repo's `.mcp.json` already lists it as `besidka`
  (project scope; Claude Code asks once to approve project servers). In other
  projects run:

  ```bash
  claude mcp add --transport http besidka https://besidka.com/mcp
  ```

  Add `--scope user` to make it available in all projects.
- **Claude Desktop, claude.ai and the mobile apps**: Settings, Connectors,
  Add custom connector. Name it `Besidka`, use the URL
  `https://besidka.com/mcp` and leave the OAuth client id empty: the client
  registers itself (dynamic client registration). A connector added on
  claude.ai syncs to Desktop and mobile. These requests come from
  Anthropic's servers, not from the user's machine.
- **Cursor, VS Code and other clients**: any client that supports remote
  Streamable HTTP servers takes the same URL. A stdio-only client needs a
  bridge such as `mcp-remote`.

A quick manual check:

```bash
curl -s -X POST https://besidka.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Two request rules affect clients. A cross-site browser `Origin` gets 403;
server-side and CLI clients send none. A `POST` without `Content-Length`, or
above 32 KiB (512 KiB with a valid token), gets 413 (see
[Request limits](#request-limits)).

**Claude Code caveat (unverified).** Claude Code connects to a project
server at startup. If it does not handle a 401 on a `tools/call` in the
middle of a session, the user has to authenticate from `/mcp` in Claude
Code and retry. This has not been tested against a deployed build; check it
once the OAuth `.well-known` paths are allowed through the production WAF.

## Tools

Definitions live in `server/mcp/tools/*.ts` and stay thin. The logic is
unit-tested in `server/utils/mcp/*.ts` (public tools) and
`server/utils/mcp/private/*.ts` (private tools). Keep tool files flat in
`server/mcp/tools/`: a subdirectory sets a toolkit group, and a `.ts` file
directly in `server/mcp/` is loaded as a named handler.

### Public tools

| Tool | Source |
| --- | --- |
| `list_models` | `providers/index.ts` (curated + models.dev merge), projected by `server/utils/mcp/catalog.ts`; deprecated models hidden by default |
| `list_providers` | `providerMeta` plus the `keyGuides` collection (guide slug and URL per provider) |
| `get_key_guide` | `keyGuides` collection by provider id or slug |
| `get_page` | `guides` and `legal` collections (`byok`, `memory`, `privacy-policy`, `terms-of-use`, `cookie-policy`) |

Every public tool sets `readOnlyHint`, `idempotentHint` and
`openWorldHint: false`. Results are compact JSON text.

No tool uses the toolkit's `cache` option. With no `inputSchema` the toolkit
hands Nitro's cache the whole SDK `extra` argument (request id and every
request header, `cf-ray` included) to hash, so every call would miss, query
`CONTENT_DB` and write a new KV entry, and a caller could mint unlimited keys.
Caching is in `server/utils/mcp/cached-content.ts` instead, with keys that are
constants or a bounded enum, never request input:

| Cache | Key | Used by |
| --- | --- | --- |
| `mcp-key-guide-index` | the constant `all` | `list_providers`, `get_key_guide` (the guide index select) |
| `mcp-public-page` | the page slug (five values) | `get_page` |

Both use `swr: false` and `maxAge: 3600`: one KV entry per key with a one-hour
TTL (Nitro writes `swr` entries with no TTL). A provider, guide or page edited
in a deploy can take up to an hour to appear. The caches are bypassed in dev.
A page that is not published is not cached. `get_key_guide` still runs one
`CONTENT_DB` query for the guide body, by a path that comes from the index and
never from the caller. `cached-content.spec.ts` asserts the keys stay constant.

Nuxt Content stores a page body as a minimark tree, not markdown. Adding a
`rawbody` column to a collection would change the `CONTENT_DB` schema (see
`content.config.ts`), so `server/utils/content/minimark.ts` renders the tree
back to markdown instead. The landing markdown twin shares it.
`:privacy-email-link{}` is resolved from `runtimeConfig.public.privacyEmail`,
the same source as the page component.

### Private tools

All private tools are wrapped by `withMcpPrivateTool` (token and scope check,
call limits, consent, id-only logging, `withSafeToolErrors`). Results are
text only and capped.

| Tool | What it does | Reuses | Output cap |
| --- | --- | --- | --- |
| `list_chats` | Chats by recent activity; `search` (2+ characters) with `searchIn` `all`, `title` or `content` | `chats/history/cursor`, `search-cursor`, `findChatsMatchingMessageContent` (FTS5 `message_search`), `containsLikeEscaped` | `limit` up to 50; search results up to 200 |
| `get_chat` | Title, project id, models used, messages oldest to newest, text parts only | `messages.parts`, `usage.model` | `maxMessages` up to 200, 8,000 characters per message, 100,000 in total (the oldest are dropped first) |
| `list_projects` | Projects by recent activity, optional `search` and `archived` | `projects/cursor` | `limit` up to 50 |
| `get_project` | Name, instructions, knowledge mode, knowledge items (id, kind, title, path, media type, sizes, status, `flagged`, `pinned`) | `listKnowledgeItems` | at most 500 items (`KNOWLEDGE_LIMITS.maxItemsPerProject`) |
| `read_project_knowledge_item` | Extracted text of one item, paged with `offset` and `nextOffset` | `getKnowledgeItemText` | 50,000 characters by default, 100,000 at most |
| `create_project` | Create a project (`name`, 1 to 100 characters) and return the same row shape as `list_projects`, with the public id | the insert of `PUT /projects` (`createMcpProject`) | 100 characters; no per-user project cap exists, so none is added |
| `update_project_instructions` | Replace or clear (`null`) the instructions | same rule as `PATCH /projects/[id]/instructions` | 10,000 characters |
| `add_project_note` | Add a note | `createKnowledgeNote` (duplicate check, caps, quota, injection screening, commit) | `KNOWLEDGE_LIMITS.maxNoteChars` |
| `add_project_text` | Add text or markdown as a `file` item (`extractor: text`, `.md` names get `text/markdown`). Either `name` and `text`, or `items: [{ name, text }]` (exactly one form) | `knowledgeItemsBatchCreateSchema`, `hashKnowledgeText`, `ingestKnowledgeItems` with `commit: true` (one call for a whole batch) | single: 200,000 characters; batch: 10 items and 200,000 characters in total; the 512 KiB body cap holds for Cyrillic (see Request limits) |
| `list_memory` | Account memory, or one project's with `projectId` | `listMemoryEntries` | the entry caps (30 account, 15 per project, 4 KiB body) |
| `add_memory` | Create an entry (`category`, `title`, `description`, `body`, optional `projectId`) | `createMemoryEntry` | `MEMORY_LIMITS` |
| `update_memory` | Change category, title, description or body | `updateMemoryEntry` | `MEMORY_LIMITS` |
| `delete_memory` | Delete an entry | `deleteMemoryEntry` | |

Notes:

- The project routes resolve the project from route params
  (`resolveKnowledgeProject`), so `server/utils/mcp/private/projects.ts` has
  its own lookup with the same rules: `decodeKnowledgeEntityId` for the
  internal id, then a `(id, user_id)` match. A foreign or malformed id is a
  404.
- `list_chats` reimplements a reduced version of the history route (no
  separate pinned list; `pinned` is a flag on each chat) from the same
  helpers, because the route keeps its logic inline. Changes to history
  search should be mirrored there.
- Writes go only through the functions the HTTP routes use, so the knowledge
  caps, quota and injection screening, and the memory compliance gate
  (never-store list, sensitive topics, see `docs/memory-architecture.md` 3.5)
  and the optional TypeSafe AI memory check run unchanged. The memory and
  knowledge write rate limits of those routes apply too.
- Memory entries written through MCP are stored with `origin: 'user'` (the
  user authorised the client to write for them) and
  `complianceOrigin: 'mcp'`; the client id is in the wide event. A separate
  `'mcp'` origin would need `app/utils/memory-entry-labels.ts` and the
  extraction code to learn it.
- The chat memory-write lock (`presetMemoryWriteLock`) guards Besidka's own
  chat model after a web search. It does not apply here: the external agent
  writes with the user's explicit `memory:write` grant, and the compliance
  gate still runs on every write.
- Model and tool selection are out of scope for now. Sending messages is
  deliberately not built, see
  [Sending messages](#sending-messages-not-built). Documents arrive as text,
  see [Files and documents](#files-and-documents-text-route).
- `create_project` needs no extra gate: `withMcpPrivateTool` already applies
  the consent check and both MCP call limits (`MCP_PRIVATE_TOOL_RATE_LIMIT`,
  `MCP_PRIVATE_WRITE_RATE_LIMIT`). `PUT /projects` has no consent check of its
  own, no extra limiter and no project cap, so the tool has none either. The
  agent should call `list_projects` first; the tool does not look for a
  same-name project, and two projects with one name are allowed in the app.
- `add_project_text` with `items` runs one `ingestKnowledgeItems` call, so
  the batch is one commit and one knowledge write limit hit. Duplicates inside
  the batch or of existing items come back under `skipped` (`index`, `name`,
  `reason`); the call fails with `409` only when nothing was added, like the
  single form.
- `read_project_knowledge_item` does not return the text of a flagged item
  (suspected prompt injection) unless the caller passes `includeFlagged:
  true`. The default answer is the metadata (`id`, `title`, `status`,
  `flagged: true`), `textWithheld: true` and a `note` that explains why; the
  text is not even read from R2. The tool description tells the agent to set
  the flag only when the user asked to read that item and to treat the text as
  data.
- `list_chats` and `list_projects` validate `cursor` before querying: it must
  parse, and its row id must decode with the canonical public-id decoder
  (`decodeKnowledgeEntityId`); a search cursor must be a valid offset. A bad
  cursor is a `400` tool error asking the caller to omit it, never a `500`
  or a silent restart from the first page.

### Files and documents (text route)

There is no binary upload through MCP: no ZIP, PDF, image, XLSX or PPTX. An
agent adds a document as the text it extracted, with `add_project_text`:
a spreadsheet as CSV or a markdown table, one item per sheet or per file,
named after the source (`timesheet-2026-09.csv`); slides as markdown with one
heading per slide; a PDF or Word document as markdown. The `items` form puts
up to 10 of them into a project in one call. A project is created first with
`create_project` when it does not exist (check `list_projects`).

Why text and not bytes:

- MCP clients such as claude.ai read Google Drive files and chat attachments
  as text through their own connectors. The model never holds the bytes, so
  it cannot pass a file on. A base64 argument would also cost output tokens
  for every byte and would exceed the 512 KiB request body limit for any file
  of a realistic size.
- Besidka's own extraction (PDF, DOCX, XLSX and the text formats) runs in the
  browser, see `docs/project-knowledge-design.md` 7.1. Extraction inside the
  Worker is K4, not built. PPTX is not supported even in the web UI (K4,
  `officeparser`), so slides can only come as markdown text.
- The text then takes the normal knowledge path: caps, quota, duplicate check
  and injection screening of `ingestKnowledgeItems`.

Body budget: `MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES` is 524,288 bytes.
`JSON.stringify` leaves Cyrillic raw (2 bytes per character in UTF-8) and
turns `\n`, `"` and `\` into 2 bytes, so the worst case is 2 bytes per
character: 200,000 characters are at most 400,000 bytes, which leaves about
124 KB for the JSON-RPC envelope, the project id and the names (10 names of
200 Cyrillic characters are 4 KB). The batch total is therefore the same
200,000 characters as the single limit. `project-text-body-size.spec.ts`
builds the real `tools/call` body and fails if the limits stop fitting. Not
covered: scripts with 3 bytes per character (CJK) or a client that escapes
non-ASCII as `\uXXXX`; such a body can pass 512 KiB and the guard answers
`413` before the tool runs.

If it is ever needed: an upload-session tool that returns a one-time `PUT`
URL, never a base64 argument. It needs extraction inside the Worker, within
the CPU time and 128 MB memory limits and with the existing ZIP-bomb caps. A
new upload route must read the body with h3 `readRawBody`: Workers pre-buffers
request bodies, and a custom stream reader hangs (see Request limits).

### Sending messages (not built)

There is no `send_message` tool, by decision (owner, 2026-10-30). Every tool
above reads the user's data or changes their own records; none starts work
that spends the user's provider keys. That boundary is kept on purpose:

- **No guaranteed human approval per call.** claude.ai asks before a tool
  call, but Claude Code in auto mode, CLI harnesses and MCP servers that call
  other MCP servers may not. An agent that reads a prompt-injected page could
  then spend the user's keys, and the server cannot tell an approved call from
  an injected one. This breaks the rule that spending on a user's key needs
  their explicit consent.
- **Little distinctive value.** The caller is already a model with its own
  provider access. Relaying a prompt to another model through Besidka adds a
  hop; the only thing Besidka adds is the answer landing in chat history. A
  full mobile client is the PWA's job, not the MCP server's.
- **Legal cost.** A send through MCP is a new processing route. It would have
  to pass the per-provider Art. 49(1)(a) transfer consent that the chat UI
  shows before a send (`docs/legal-memory-sensitive-data.md`), and it needs
  updates to `docs/legal/dpia.md` and `docs/legal/art30-record.md`.
- **Engineering cost.** The generation lease and heartbeat
  (`docs/chats/stuck-generation-guard.md`), a returned result instead of a
  stream, and cost and web-search accounting would all need an MCP path.

**Revisit when** the [MCP tool calls dashboard](https://app.axiom.co/besidka-tnqd/dashboards/uid/besidka-mcp-tool-calls)
shows the private tools used by people other than the owner, or a user names
a concrete workflow that needs it.

**If it is ever built, start with a draft, not a send.** A tool such as
`create_chat_draft` would create a chat with an unsent message and return its
URL. The user presses send in the app, so consent, spend, the lease and
streaming all run on the normal path and the MCP call costs nothing. No tool
creates chats today, so this is a new tool, not a change to an existing one.

## Transport

On a Cloudflare preset the toolkit picks `providers/cloudflare`, which imports
`agents/mcp`: the Agent and McpAgent classes, a `DurableObject` import, the
MCP v2 client and server, and `mimetext`. That alone cost about 395 KiB gzip
and pushed `nuxt build` past the default 4 GB heap.

`nuxt.config.ts` registers `forceStatelessMcpTransport` right after the
toolkit module. It overwrites the `#nuxt-mcp-toolkit/transport.mjs` Nitro
virtual module so it re-exports `providers/node.js` instead. That provider is
built on the SDK's `WebStandardStreamableHTTPServerTransport` (fetch `Request`
and `Response`), runs on Workers, and with `sessions` off is stateless: each
`POST` builds a server and answers with JSON, and any `GET` returns 405.
Nothing else in the toolkit imports `agents`; the code mode executor already
has a Workers stub.

The override is a `nitro.virtual` assignment, not a hook, so module order does
not matter: the toolkit only registers a lazy template function. If a toolkit
upgrade renames the virtual module or its provider path, `agents` comes back
silently, so re-check the bundle (see below) after bumping it.

## Worker size

Measured with `wrangler deploy --dry-run` (the figure CI prints):

| | Total upload | gzip |
| --- | --- | --- |
| `main` before | 16807 KiB | 3347 KiB |
| `agents` transport | 18698 KiB | 3742 KiB |
| node transport (current) | 17313 KiB | 3461 KiB |

The deployed Worker was already above the Free plan 3 MB limit, so this is a
Workers Paid deployment. With the node transport `nuxt build` fits the default
heap again. To confirm `agents` is not bundled, search `.output/server` for
`mimetext`, `McpAgent` and `createLegacyMcpHandler`; there should be no match.

## Dependencies

`@nuxtjs/mcp-toolkit` is the only added dependency. pnpm still auto-installs
its optional peer `agents` into `node_modules`, which is why `core-js-pure`
(reached through `agents` > `mimetext`) is `false` in `allowBuilds`; it is
never bundled.

## Request limits

The toolkit calls `readBody` on every `POST` before the SDK's 4 MiB cap
applies, and JSON-RPC allowed arrays of messages, so one request could carry
many tool calls. `server/middleware/01.mcp-request-guard.ts` runs first, for
`POST /mcp` and `POST /mcp/` only:

- A `Content-Length` that is missing (a chunked upload) gets `413`. Clients
  that stream a body without a length must send one.
- Anonymous requests may send at most 32 KiB
  (`MCP_MAX_REQUEST_BODY_BYTES` in `config/mcp-server.ts`); a `tools/call` is
  a few hundred bytes. Requests with a **verified** token may send up to
  512 KiB (`MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES`), so `add_project_text`
  with 200,000 Cyrillic characters (about 400 KB), also as a batch of up to
  10 items with 200,000 characters in total, and `add_project_note` fit.
  A declared length above 512 KiB gets `413` before the token is even
  verified; between 32 and 512 KiB the token is verified first.
- On Workers, Nitro pre-buffers the request body (`request.arrayBuffer()` in
  the module handler) before any middleware runs, so the effective cap there
  is the `Content-Length` check above: a missing or oversized
  `Content-Length` is rejected with `413`, and Cloudflare's HTTP layer
  enforces the declared length, so the Worker cannot be made to buffer more
  than it declared. The streaming cap applies on the Node/dev path, where
  the body is still unread at that point: after authentication it is read
  with `readBoundedRawBody` (`server/utils/mcp/bounded-body.ts`), which
  counts the bytes actually received and answers `413` as soon as they pass
  the effective cap of the caller (32 KiB or 512 KiB), so a lying
  `Content-Length` cannot make the process buffer more. The bytes are then
  stored under the symbol h3's `readRawBody` caches them under
  (`Symbol.for('h3RawBody')`), so the toolkit's own `readBody` and the SDK's
  request stream still see the same body. An empty body is left uncached,
  exactly as `readRawBody` leaves it. `bounded-body.spec.ts` runs h3's real
  `readRawBody` and `readBody` after the bounded read; re-check it whenever
  h3 or Nitro is upgraded, because the symbol is an h3 internal.
- The bounded reader must treat every source h3's `readRawBody` reads as a
  prepared body: `event._requestBody`, `event.web.request.body`, the symbol,
  `req.rawBody` and `req.body`. On Workers Nitro's `localFetch` runs a
  `node-mock-http` `IncomingMessage` whose bytes sit on `req.body` and which
  never emits `data` or `end`; a reader that waits on the stream there never
  settles, and the runtime cancels the request with "your Worker's code had
  hung". That is the bug commit 504326de shipped (it checked only the first
  three sources) and `f9921c12` inherited. The unit tests run h3 on Node, so
  the Workers case has its own mock-request tests; verify any change here
  with `wrangler dev` and a `POST /mcp` `tools/list`, not only with vitest.
- A body that is a JSON array gets `400`, signed in or not. MCP 2025-06-18
  dropped batching, so the server never needs it.
- A non-empty body that is not a JSON object gets `400` with a JSON-RPC parse
  error (`-32700`). The guard decides on authentication from the parsed body,
  so it must never pass on a body the SDK might read differently. A leading
  byte order mark is stripped first, as `Request.json()` does.

These answer a JSON-RPC error with `id: null`.

## Unused toolkit routes

The toolkit registers `/mcp/deeplink` (an IDE install link) and
`/mcp/badge.svg`. Neither is needed, and `?ide=__proto__` made the badge
answer 500. Both are 404s through `routeRules` in `nuxt.config.ts`
(`MCP_DISABLED_TOOLKIT_ROUTES`), in dev and production.

## Tool errors

Every tool handler is wrapped by `withSafeToolErrors`
(`server/utils/mcp/safe-tool.ts`). The toolkit returns the message of any
thrown error to the caller, which would expose a raw `queryCollection` or D1
error. The wrapper keeps the message of a deliberate 4xx evlog `createError`
(for example the 404 "No key guide for ...") and turns anything else into a
fixed message, after logging the original on the request wide event. Tools
throw evlog's `createError`, not h3's, so the toolkit shows the message
without a `[404]` prefix.

## Operational notes

- `server/middleware/evlog-auth.ts` excludes `/mcp` and `/.well-known/**`, so
  an MCP request does no cookie session lookup; a private tool call costs one
  D1 batch for the user and client check plus the consent read.
- The toolkit tags every wide event with a top-level `mcp` object, which
  `mcp.logging: false` does not stop. `server/plugins/evlog-request-observability.ts`
  moves it under `attributes.mcp` so the `besidka-prod` Axiom schema does not
  grow (see `docs/axiom-map-fields.md`). The move drops `session_id`, cuts
  strings to 120 characters and arrays to 10 items, because the method, tool
  and id values come from the caller.
- `/mcp` is in the robots disallow list. A browser `GET` redirects to `/`.
- The toolkit registers 404 JSON stubs for
  `/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-authorization-server` and
  `/.well-known/openid-configuration`. The `removeMcpToolkitOAuthStubs`
  module in `nuxt.config.ts` removes them, and the root routes in
  `server/routes/.well-known/` forward those paths to Better Auth, which
  serves the real authorization-server and protected-resource metadata
  (`/.well-known/oauth-protected-resource/mcp` included). Until the
  production WAF allows these paths, OAuth discovery cannot work in
  production (see `docs/agent-readiness.md`).
- Requests with a cross-site `Origin` get 403; requests without `Origin`
  (CLI clients) pass.
- `GET /mcp` (including `Accept: text/event-stream`) returns 405 with a
  JSON-RPC error, so no stream is held open. `DELETE /mcp` returns an empty
  200.
