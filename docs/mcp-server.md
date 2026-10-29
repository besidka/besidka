# Public MCP server

`/mcp` is a public, read-only, unauthenticated MCP server (Streamable HTTP,
stateless on Workers) built with `@nuxtjs/mcp-toolkit`. It exposes only public
product facts. It has no session, no D1 user table, no key and no write path.

## Scope

This `/mcp` server serves public product information only. It is
unauthenticated and read-only, and it never touches user data. How agents find
it (MCP Server Card, API catalog, `llms.txt`) is in
`docs/agent-readiness.md`.

A future authenticated MCP server, for example one that reads a user's own
chats, would need a real authorization server and the OAuth work described in
`docs/agent-readiness.md` ("Auth metadata"). Do not add private tools to this
server. The planned documentation app will have its own MCP server at
`/docs/mcp`; this one does not serve documentation content.

## Connecting a client

- Endpoint: `https://besidka.com/mcp`. Streamable HTTP, no auth, read-only.
- **Claude Code**: the repo's `.mcp.json` already lists it as `besidka`
  (project scope; Claude Code asks once to approve project servers). In other
  projects run:

  ```bash
  claude mcp add --transport http besidka https://besidka.com/mcp
  ```

  Add `--scope user` to make it available in all projects.
- **Claude Desktop, claude.ai and the mobile apps**: Settings, Connectors,
  Add custom connector. Name it `Besidka`, use the URL
  `https://besidka.com/mcp` and leave the OAuth client id empty. A connector
  added on claude.ai syncs to Desktop and mobile. These requests come from
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
above 32 KiB, gets 413 (see [Request limits](#request-limits)).

## Tools

Definitions live in `server/mcp/tools/*.ts` and stay thin. The logic is pure
and unit-tested in `server/utils/mcp/*.ts`.

| Tool | Source |
| --- | --- |
| `list_models` | `providers/index.ts` (curated + models.dev merge), projected by `server/utils/mcp/catalog.ts`; deprecated models hidden by default |
| `list_providers` | `providerMeta` plus the `keyGuides` collection (guide slug and URL per provider) |
| `get_key_guide` | `keyGuides` collection by provider id or slug |
| `get_page` | `guides` and `legal` collections (`byok`, `memory`, `privacy-policy`, `terms-of-use`, `cookie-policy`) |

Every tool sets `readOnlyHint`, `idempotentHint` and `openWorldHint: false`.
Results are compact JSON text.

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

- A `Content-Length` that is missing (a chunked upload) or above 32 KiB
  (`MCP_MAX_REQUEST_BODY_BYTES` in `config/mcp-server.ts`) gets `413`. A
  `tools/call` is a few hundred bytes. Clients that stream a body without a
  length must send one.
- A body that is a JSON array gets `400`. MCP 2025-06-18 dropped batching, so
  the server never needs it.

Both answer a JSON-RPC error with `id: null`. The batch check reads the body
with h3's `readRawBody`, which caches the bytes on the request, so the
toolkit's own `readBody` and the SDK's request stream still see the body.

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
  an MCP request does no session lookup.
- The toolkit tags every wide event with a top-level `mcp` object, which
  `mcp.logging: false` does not stop. `server/plugins/evlog-request-observability.ts`
  moves it under `attributes.mcp` so the `besidka-prod` Axiom schema does not
  grow (see `docs/axiom-map-fields.md`). The move drops `session_id`, cuts
  strings to 120 characters and arrays to 10 items, because the method, tool
  and id values come from the caller.
- `/mcp` is in the robots disallow list. A browser `GET` redirects to `/`.
- The toolkit registers `/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-authorization-server` and
  `/.well-known/openid-configuration` (and `/**` suffixes) as 404 JSON stubs
  (`not_found`, `OAuth is not configured for this MCP server.`,
  `Cache-Control: no-store`).
- Requests with a cross-site `Origin` get 403; requests without `Origin`
  (CLI clients) pass.
- `GET /mcp` (including `Accept: text/event-stream`) returns 405 with a
  JSON-RPC error, so no stream is held open. `DELETE /mcp` returns an empty
  200.
