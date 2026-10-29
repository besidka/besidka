# Public MCP server

`/mcp` is a public, read-only, unauthenticated MCP server (Streamable HTTP,
stateless on Workers) built with `@nuxtjs/mcp-toolkit`. It exposes only public
product facts. It has no session, no D1 user table, no key and no write path.

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

## Worker size

Measured with `wrangler deploy --dry-run` (the figure CI prints):

| | Total upload | gzip |
| --- | --- | --- |
| `main` before | 16807 KiB | 3347 KiB |
| with MCP | 18697 KiB | 3742 KiB |

The delta is about 395 KiB gzip. What is attributable to the new code is the
`agents/mcp` entry (the Agent and McpAgent classes, the `DurableObject`
import, and the MCP v2 client and server it imports) and `mimetext`, pulled
in by `agents` for its email support. The rest of the delta is the toolkit
and the MCP SDK v1; per-chunk size diffs between builds are not reliable
because Rollup re-partitions chunks. There is one copy of
`@modelcontextprotocol/sdk` (1.32.2) in `node_modules`. The deployed Worker
was already above the Free plan 3 MB limit, so this is a Workers Paid
deployment.

Build memory: `nuxt build` runs out of the default 4 GB heap with the MCP
dependencies. CI already sets `NODE_OPTIONS=--max-old-space-size=6144`, which
is enough; a local `pnpm run build` needs the same.

## Dependencies

`agents` is the toolkit's optional peer on Cloudflare presets. `agents/mcp`
imports `@modelcontextprotocol/server` and `@modelcontextprotocol/client` (v2)
statically, so both are direct dependencies; without them the Nitro build
fails with "Cannot resolve @modelcontextprotocol/server". `core-js-pure`
(reached through `agents` > `mimetext`) is `false` in `allowBuilds`.

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
- A `GET /mcp` with `Accept: text/event-stream` opens an idle SSE stream that
  stays open. Stateless clients do not need it. Rate-limit or reject it
  before relying on this endpoint under load.
