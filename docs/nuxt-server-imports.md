# Server handlers on the portable `nuxt/server` API

Nuxt 4.6 ships a portable server surface (`nuxt/server`) that Nuxt 5 keeps on
Nitro v3 / h3 v2. Every handler under `server/api`, `server/routes` and
`server/middleware` imports `defineEventHandler` and the request helpers from
it, so the handlers do not change when the server runtime moves to h3 v2.

## Rules

- Import `defineEventHandler` and the helpers together from `nuxt/server` in
  the same file. `readValidatedBody`, `getValidatedQuery`, `useSession` and
  friends throw `NUXT_E8012` when the handler was defined with h3's
  auto-imported `defineEventHandler`, because they need the portable event.
- `experimental.nitroAutoImports` stays on, so auto-imported names are still
  h3's. The explicit `nuxt/server` import is what opts a file in.
- The portable event is a Proxy over the real h3 v1 event. `event.req` (web
  `Request`), `event.res.{status,statusText,headers}` and `event.url` (`URL`)
  are web-standard; `event.context` is the real context.
- Response headers: `event.res.headers.set(name, value)`, or
  `applyResponseHeaders(event, headers)` from
  `~~/server/utils/http/apply-response-headers` for several at once.
- Request headers: `getRequestHeader(event, name)` from `nuxt/server`.
- Route params: always call `getDecodedRouterParams(event)` from
  `~~/server/utils/http/get-decoded-router-params`, never
  `getRouterParams(event, { decode: true })` directly. `nuxt/server` has no
  `getValidatedRouterParams`; parse the returned params with the schema's
  `safeParse` instead. The `nuxt/server` decode calls `decodeURIComponent`
  without a `try/catch`, so a malformed sequence such as `%zz` or `%E0%A4%A`
  throws `URIError` and surfaces as a 500. The helper turns it into an evlog
  400 (`Invalid route parameter`) and rethrows anything else.
- Validators passed to `readValidatedBody` stay `schema.safeParse` functions.
  A validator function returns the `safeParse` result unchanged, so the
  `if (body.error) throw createError(...)` evlog branch keeps its error shape.
  Passing the schema itself would make `nuxt/server` throw its own generic 400
  (`Validation failed`) and skip the evlog `why`/`fix` fields.
- `readValidatedBody` from `nuxt/server` always JSON-parses the body and
  ignores `Content-Type`. Malformed JSON throws a generic 400
  `Invalid JSON body` with no evlog `why`/`fix`; the `body.error` evlog branch
  only runs after a successful parse. Plain `readBody` sites keep h3's more
  lenient parser.

## Logger

evlog types its event as the h3 v1 shape (`method`, `path`), which the portable
`RequestEvent` omits, so `useLogger(event)` no longer type-checks in a handler.
Use `useRequestLogger(event)` from
`~~/server/utils/logging/request-logger`. At runtime evlog only reads
`event.context.log`, which the portable event shares with the real one. Drop
the helper once evlog accepts the portable event type.

## Utilities

- Utilities that take the request event type it as `RequestEvent` from
  `nuxt/server`.
- Utilities that default `event` to `useEvent()` (`server/utils/chats/share.ts`,
  `server/utils/files/*`, `attachCloudflareMeta`) may be called without the
  event from the synchronous part of a handler; they resolve the raw event
  themselves. In detached or stream-completion code (`waitUntil`, stream
  `onFinish`/`onEnd`, `Promise.all` fan-out, timers, scheduled paths) pass the
  captured event explicitly. The `chats/share.ts` helpers accept
  `Pick<RequestEvent, 'context'>` so the portable handler event can be passed.
- `useRuntimeConfig(event)` became `useRuntimeConfig()`, matching the rest of
  `server/utils`.

## Tests

`tests/setup/vitest.setup.ts` mocks `nuxt/server` with
`tests/setup/mocks/nuxt-server.ts`: a `vi.stubGlobal(name, ...)` of any
exported helper still wins, otherwise the real helper runs against the
web-standard event. Specs build events with `req`, `res`, `url` and
`context` as needed.
