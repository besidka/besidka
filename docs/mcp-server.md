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

Only `list_providers` is cached (`cache: '1h'`). The tool has no input, so the
Nitro cache key is constant and the toolkit sets `swr: false`: one KV entry
with a one-hour TTL. A provider or guide added in a deploy can take up to an
hour to appear in this tool. `get_key_guide` is not cached on purpose, because
its key would be attacker-chosen.

Nuxt Content stores a page body as a minimark tree, not markdown. Adding a
`rawbody` column to a collection would change the `CONTENT_DB` schema (see
`content.config.ts`), so `server/utils/mcp/minimark.ts` renders the tree back
to markdown instead. `:privacy-email-link{}` is resolved from
`runtimeConfig.public.privacyEmail`, the same source as the page component.

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

## Operational notes

- `server/middleware/evlog-auth.ts` excludes `/mcp` and `/.well-known/**`, so
  an MCP request does no session lookup.
- The toolkit tags every wide event with a top-level `mcp` object, which
  `mcp.logging: false` does not stop. `server/plugins/evlog-request-observability.ts`
  moves it under `attributes.mcp` so the `besidka-prod` Axiom schema does not
  grow (see `docs/axiom-map-fields.md`).
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
