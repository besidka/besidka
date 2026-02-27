## Project Overview

Besidka is an open-source AI chat application that runs on Cloudflare Workers. Users bring their own API keys for LLM providers (Google, OpenAI) and pay for what they use.

## Package Manager

Use **pnpm** exclusively for this project. Do not use npm, npx, bun, bunx, or other package managers.

## Commands

```bash
# Development
pnpm run dev              # Start dev server with .dev.vars environment
pnpm run build            # Build for production (Cloudflare Workers)
pnpm run preview          # Build and run with wrangler locally

# Type checking & Linting
pnpm run typecheck        # Run Nuxt type checking
pnpm run lint             # Run ESLint
pnpm run format           # Run ESLint with --fix

# Testing
pnpm run test             # Run Vitest in watch mode
pnpm vitest run           # Run tests once
pnpm vitest run path/to/file.test.ts  # Run specific test file

# Database (Drizzle + D1)
pnpm run db:generate      # Generate migrations from schema changes
pnpm run db:migrate       # Apply migrations
pnpm run db:studio        # Open Drizzle Studio
pnpm run db:reset         # Reset local D1 database and regenerate

# Cloudflare
pnpm run cf-typegen       # Generate Cloudflare env types
pnpm run deploy           # Build and deploy to Cloudflare Workers
```

## Architecture

### Directory Structure

- `app/` - Frontend Nuxt application (Vue 3 components, composables, pages)
- `server/` - Backend Nitro server (API routes, database, utilities)
- `shared/` - Code shared between client and server (types, utility functions)
- `providers/` - LLM provider configurations (Google, OpenAI models)

### Project Docs

- `docs/files.md` - Files functionality, upload flow, and Workers constraints

### Tech Stack

- **Framework**: Nuxt 4 with Nitro server preset for Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Storage**: Cloudflare KV for caching, R2 for file storage
- **Auth**: Better Auth with email/password, Google, GitHub OAuth
- **AI**: Vercel AI SDK with resumable streams
- **UI**: Tailwind CSS v4 + DaisyUI v5 (see [DaisyUI Reference](#daisyui-reference))

### Key Patterns

**Shared types import**: Always use the `#shared` alias for importing types and utilities from the `shared/` directory. Never use relative imports.
  ```typescript
  // Correct - use #shared alias
  import type { User } from '#shared/types/auth.d'
  import type { Chat } from '#shared/types/chats.d'
  import type { Providers, Provider, Model } from '#shared/types/providers.d'
  import { getModel } from '#shared/utils/model'

  // Wrong - relative imports
  import type { User } from '../../shared/types/auth.d'
  import { getModel } from '../shared/utils/model'
  ```

**Server utilities auto-import**: Functions in `server/utils/` are auto-imported. Key utilities:
- `useDb()` - Get Drizzle D1 database instance
- `useKV()` - Get Cloudflare KV instance
- `useServerAuth()` - Get Better Auth instance
- `useUserSession()` - Get current user session

**Server utility imports**: When a server utility is not auto-imported (e.g., nested helpers), use the `~~/` alias. Never use relative imports in server code.
  ```typescript
  // Correct - use ~~ alias
  import { getReasoningStepsCount } from '~~/server/utils/chats/test/steps-count'

  // Wrong - relative imports
  import { getReasoningStepsCount } from './utils'
  import { getReasoningStepsCount } from '../../utils/chats/test/steps-count'
  ```

**Database schema**: Defined in `server/db/schemas/*.ts`, exported from `server/db/schema.ts`. Uses snake_case column naming.

**API routes**: Located in `server/api/v1/`. Chat endpoints stream AI responses.

**Composables**: Frontend state/logic in `app/composables/`. The `useChat()` composable manages chat state with AI SDK.

**Environment**: Runtime config in `nuxt.config.ts`. Secrets go in `.dev.vars` (gitignored), with example in `.dev.vars.example`.

### Cloudflare Bindings

Configured in `wrangler.jsonc`:
- `DB` - D1 database binding
- `KV` - KV namespace binding
- `R2_BUCKET` - R2 storage bucket
- `IMAGES` - Cloudflare Images binding

**Binding access patterns**:
```ts
// @ts-ignore
import { env } from 'cloudflare:workers'
```

- For D1 and KV: use `const { KV } = env`
- For R2: use `const { R2_BUCKET } = env` 

This is intentional and correct, do NOT change to `event.context.cloudflare.env`

**Simultaneous connection limit**: Workers can only have **6 simultaneous connections** to external services (R2, KV, fetch). Operations beyond 6 are queued. If queued operations wait too long, the Worker hangs with "script will never generate a response" error.

```typescript
// Wrong - spawns many parallel connections, causes hang with 7+ files
await Promise.allSettled(
  keys.map(async (key) => {
    await storage.delete(key)  // Each is a separate connection
  }),
)

// Correct - R2 supports batch delete (single connection)
await storage.delete(keys)

// Correct - sequential operations for KV (no batch delete API)
for (const key of keys) {
  await kv.delete(key)
}
```

**Async context in parallel execution**: When using `Promise.all`/`Promise.allSettled`, always capture binding references before entering parallel loops to avoid async context loss:
```typescript
// Correct - capture before parallel execution
const storage = useFileStorage()

// Wrong - useFileStorage() calls useEvent() inside parallel callback
await Promise.allSettled(
  keys.map(async (key) => {
    await useFileStorage().delete(key)  // May hang in production
  }),
)
```

**Async context default usage**: Inside a normal request lifecycle, prefer
`useEvent()`/auto-imported composables directly and avoid threading `event`
through utility function signatures. Pass or capture explicit references only
in risky async fan-out contexts (parallel callbacks, timers, detached jobs).

**DELETE requests with body**: Per RFC 9110, DELETE request bodies have "no generally defined semantics" and Cloudflare's edge network may strip them. Use POST for bulk operations requiring a body:
```typescript
// Wrong - body may be stripped by edge network
$fetch('/api/v1/files/delete/bulk', { method: 'DELETE', body: { ids } })

// Correct - POST preserves body
$fetch('/api/v1/files/delete/bulk', { method: 'POST', body: { ids } })
```

### Async Context and Connection Guidance

#### Default Rule

- In normal request flow, use `useEvent()`/auto-imported utilities directly.
- Do not thread `event` through utility signatures unless needed.

#### Background Runtime Rule

- In infra utilities that may run outside request handlers (`db`, `kv`,
  `storage`, shared `utils`), do not call `useEvent()`.
- For runtime config in such utilities, use `useRuntimeConfig()` directly.
- Scheduled/queue/background paths must rely on bindings + runtime config, not
  request context.

#### Explicit Capture Rule

- Capture bindings or context explicitly only in risky fan-out contexts:
  - `Promise.all` / `Promise.allSettled` loops,
  - delayed callbacks/timers,
  - detached/background async jobs.

#### Connection Saturation Rule

- Prefer sequential operations for per-item R2/KV calls.
- Use batch APIs when available (for example, R2 batch delete where applicable).

## File Management

Files are stored in Cloudflare R2 with metadata in D1. Key components:

**API Endpoints** (`server/api/v1/files/`):
- `GET /` - List files with pagination and search
- `DELETE /[id]` - Delete single file
- `PATCH /[id]/name` - Rename file
- `POST /delete/bulk` - Bulk delete files (uses POST because DELETE with body is unreliable per RFC 9110)

**Composables**:
- `useFileManager()` - File browser state (files, selection, search, pagination)
- `useChatFiles()` - Chat attachment handling with upload progress

**UI Components** (`app/components/ChatInput/Files/`):
- `Modal.client.vue` - File manager modal with tabs
- `Modal/Select.client.vue` - Browse/select existing files
- `Modal/Upload.client.vue` - Upload new files
- `Trigger.vue` - Modal trigger button
- `DropZone.client.vue` - Drag-drop upload zone

**Patterns**:
- For GET data needed during component setup/mount, use `useFetch` or
  `useLazyFetch` (prefer `useLazyFetch` when navigation must not block).
- Use `$fetch` for mutation requests and imperative user-triggered actions.
- Use `$fetch` with `query` option, not query strings in URLs:
  ```typescript
  // Correct for imperative/user-triggered fetches
  $fetch('/api/v1/files', { query: { offset, limit } })
  // Wrong - causes Vue Router warnings
  $fetch(`/api/v1/files?offset=${offset}&limit=${limit}`)
  ```
- Delayed loading indicators (300ms threshold) prevent visual jumps on fast responses
- Sticky header/footer in modals: use `shrink-0` for fixed areas, `flex-1 min-h-0 overflow-y-auto` for scrollable content
- Client-only components (modals, interactive widgets):
  - Use `.client.vue` suffix for components that should only render on client
  - Use `<Lazy` prefix when referencing them in templates (e.g., `<LazyChatInputFilesModal>`)
  - Wrap in `<ClientOnly>` when a skeleton fallback improves UX
- Skeleton loading:
  - Use `skeleton` alone for text or logo elements
  - Use `skeleton skeleton--default` for box or line areas
  - Ensures consistent appearance across light/dark themes

## Code Style

- ESLint with `@stylistic` plugin enforces 2-space indentation, no semicolons, single quotes
- Max line length: 80 characters (imports, URLs, strings exempt)
- When line length limit requires breaking single-line statements, use explicit braces:
  ```typescript
  // Correct - explicit braces when breaking lines
  if (condition) {
    return value
  }

  files.map((file, index) => {
    return file.name
  })

  files.findIndex((file) => {
    return file.storageKey === storageKey
  })

  // Wrong - implicit returns broken across lines
  if (condition)
    return value

  files.map((file, index) =>
    file.name)

  files.findIndex(file =>
    file.storageKey === storageKey)
  ```
- Remove unused variables entirely instead of prefixing with `_`. For function parameters, omit them from the signature:
  ```typescript
  // Correct - omit unused parameter
  export default defineEventHandler(async () => {

  // Wrong - underscore prefix
  export default defineEventHandler(async (_event) => {
  ```
  Use `_` prefix only when the parameter cannot be omitted (e.g., it precedes a used parameter):
  ```typescript
  // Correct - _ prefix needed to reach second parameter
  files.map((_file, index) => index)
  ```
- **Never remove `console.log`, `debugger` statements, or commented-out code without explicit confirmation from the user.** If you think something should be removed, ask first.
- Do not add inline comments within functions unless explicitly requested. For large functions (80+ lines), a JSDoc-style comment above the function is acceptable
- Strictly follow this code style guide; when asked to refactor, apply it across the entire requested scope.
- Use descriptive variable names, avoid abbreviations:
  ```typescript
  // Correct
  files.map((file, index) => ...)

  // Wrong
  files.map((f, i) => ...)
  ```
  When a descriptive name conflicts with an outer scope variable, use a shorter form:
  ```typescript
  const file = getFile()
  files.map((f, index) => f.id === file.id)
  ```
- Be consistent with index naming - prefer `index` over `i` or `idx`. For nested loops, use logical prefixes:
  ```typescript
  rows.forEach((row, rowIndex) => {
    row.columns.forEach((column, columnIndex) => ...)
  })
  ```
- Add types explicitly for reactive variables where not inferred. Primitives should use `shallowRef`:
  ```typescript
  // Correct
  const isOpen = shallowRef<boolean>(false)
  const count = shallowRef<number>(0)
  const name = shallowRef<string>('')

  // Wrong
  const isOpen = ref(false)
  const count = ref(0)
  const name = shallowRef('')
  ```
- For `async` functions, use `try/catch` for error handling instead of `.then().catch()` chaining.
- For `try/catch` use `catch (exception) {}` instead of `catch (e) {}` or `catch (error) {}` for clarity.
- **NEVER use `console.log()` or `console.error()` in server code.** Use evlog instead (see [Logging](#logging) section below).
- Use `throw createError()` from evlog instead of `throw new Error()` for HTTP errors with structured context:
  ```typescript
  import { createError } from 'evlog'

  throw createError({
    message: 'Payment failed',           // User-facing message
    status: 402,                         // HTTP status code
    why: 'Card declined by issuer',      // Technical reason
    fix: 'Try a different card',         // Actionable solution
  })
  ```
- In frontend code, use `exception.message` for error titles, not `exception.statusMessage`.
- Add an empty line after variable declarations and before return statements:
  ```typescript
  // Correct
  function processData(items: Item[]) {
    const filtered = items.filter(item => item.active)
    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name))

    doSomething(sorted)

    return sorted
  }

  // Wrong
  function processData(items: Item[]) {
    const filtered = items.filter(item => item.active)
    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name))
    doSomething(sorted)
    return sorted
  }
  ```
- When returning from a block after a `catch`, add a blank line before
  the `return` for readability:
  ```typescript
  // Correct
  try {
    await cache.get(key)
  } catch (exception) {
    logger.set()

    return null
  }

  // Wrong
  try {
    await cache.get(key)
  } catch (exception) {
    logger.set()
    return null
  }
  ```
- Use early exit (guard clauses) to avoid deep nesting:
  ```typescript
  // Correct
  function handleSubmit(data: FormData) {
    if (!data.isValid) {
      return
    }

    processData(data)
  }

  // Wrong
  function handleSubmit(data: FormData) {
    if (data.isValid) {
      processData(data)
    }
  }
  ```

## Reviews

- When `/review` is requested, include style preferences from this file
  in the review analysis.

### Vue/Nuxt Patterns

- Use async functions with `await nextTick()` instead of callback style:
  ```typescript
  // Correct
  async function handleClick() {
    await nextTick()
    doSomething()
  }

  // Wrong
  function handleClick() {
    nextTick(() => {
      doSomething()
    })
  }
  ```
- Use `shallowRef()` for primitives instead of `ref()` for better performance
- Rely on Nuxt auto-imports; avoid explicit imports unless required to resolve errors
- For GET requests on component setup/mount, use `useFetch`/`useLazyFetch`
  instead of custom `$fetch` calls in `onMounted`.
- For `$fetch`/`useFetch`/`useLazyFetch`/`useAsyncData`/`useLazyAsyncData`,
  prefer Nuxt/Nitro route-type inference.
- Do not add explicit generic response types for those APIs by default
  (for example, avoid `$fetch<Foo>()` and `useFetch<Foo>()`).
- Add explicit response generics only when typecheck cannot be solved with
  inferred route types, and keep that exception minimal and local.
- Custom runtime hooks: declare types in `app/types/runtime-hooks.d.ts`, not in `index.d.ts`
- Nuxt hooks registered via `nuxtApp.hook()` do not require cleanup in `onUnmounted`
- Runtime DOM selectors must not use `data-testid`. Reserve `data-testid` for
  tests only; use explicit JS hook classes (`js-*`) for runtime queries:
  ```vue
  <!-- Good -->
  <dialog class="js-files-modal modal modal-bottom sm:modal-middle" />
  ```
  ```typescript
  // Good
  const isFilesModalOpen = !!document.querySelector(
    'dialog.js-files-modal[open]',
  )
  ```
  ```vue
  <!-- Bad -->
  <dialog
    data-testid="files-modal"
    class="modal modal-bottom sm:modal-middle"
  />
  ```
  ```typescript
  // Bad
  const isFilesModalOpen = !!document.querySelector(
    'dialog[data-testid="files-modal"][open]',
  )
  ```
- Tests must prefer `data-testid` selectors and must not rely on `js-*` hook
  classes when a test id is available.
- If an element needs both runtime JS querying and test automation querying,
  include both selectors on the element (`js-*` class + `data-testid`) and keep
  usage separated:
  runtime code uses `js-*`, tests use `data-testid`.
- When editing large components (100+ lines), check for existing composable declarations before adding new ones (e.g., `useNuxtApp()`, `useRoute()`, `useRouter()`). Search the entire `<script setup>` block to avoid duplicate declarations that cause "Cannot redeclare block-scoped variable" errors

### Watchers

**Choosing the right watcher:**
- Use `watch()` when you need access to **old and new values**, or when watching a specific source explicitly
- Use `watchEffect()` or `watchPostEffect()` when you need side effects that depend on **multiple reactive dependencies** - they auto-track all accessed refs
- In `.client.vue` components or those wrapped in `<ClientOnly>`, use `flush: 'post'` to ensure DOM is updated before callback runs:
  ```typescript
  watch(source, callback, { flush: 'post' })
  watchPostEffect(() => { /* DOM is ready */ })
  ```

**Cleanup with `onCleanup`**: Use the `onCleanup` callback (third argument) to cancel stale async operations. This runs before the next callback execution and when the watcher stops:
```typescript
watch(id, (newId, _oldId, onCleanup) => {
  const controller = new AbortController()
  fetch(`/api/${newId}`, { signal: controller.signal })
  onCleanup(() => controller.abort())
})

watchEffect((onCleanup) => {
  const controller = new AbortController()
  fetch(`/api/${id.value}`, { signal: controller.signal })
  onCleanup(() => controller.abort())
})
```

**Performance considerations:**
- Avoid `deep: true` on large objects - traverses all nested properties
- Prefer getter functions over reactive objects: `watch(() => obj.prop, cb)` instead of `watch(obj, cb, { deep: true })`
- Never use `flush: 'sync'` unless absolutely necessary (cache invalidation) - triggers on every mutation without batching

## Logging

**IMPORTANT: Never use `console.log()` or `console.error()` in server code.** Use evlog for structured logging and error handling.

This project uses [evlog](https://evlog.dev) for structured logging with wide events. See `.ai/skills/evlog/` for detailed patterns and examples.

### Server-Side Logging

**Wide Events** - Use `useLogger(event)` to accumulate request context that auto-emits at request end:

```typescript
// server/api/checkout.post.ts
import { useLogger, createError } from 'evlog'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)  // Auto-created, auto-emitted

  // Accumulate context throughout request
  logger.set({ user: { id: user.id, plan: user.plan } })
  logger.set({ cart: { items: 3, total: 9999 } })

  // Non-critical errors (swallowed, logged as context)
  try {
    await cache.set(key, value)
  } catch (exception) {
    logger.set({
      cache: {
        operation: 'write',
        error: exception instanceof Error ? exception.message : String(exception),
      },
    })
  }

  // Critical errors (thrown with structured context)
  throw createError({
    message: 'Payment failed',
    status: 402,
    why: 'Card declined by issuer',
    fix: 'Try a different payment method',
  })

  // logger.emit() called automatically at request end
})
```

**Logger naming and helpers**
- Prefer the variable name `logger` instead of `log`.
- When passing a logger into helper functions, place it last in the
  parameter list so primary inputs come first.

**Reference files:**
- Wide events patterns: `.ai/skills/evlog/references/wide-events.md`
- Structured errors: `.ai/skills/evlog/references/structured-errors.md`

### Frontend Error Handling

**IMPORTANT:** Always use `parseError` from evlog when catching errors from `$fetch`:

```typescript
import { parseError } from 'evlog'

try {
  await $fetch('/api/checkout')
} catch (exception) {
  const parsedException = parseError(exception)

  // parsedException.message - user-facing title (required)
  // parsedException.why - technical reason (optional)
  // parsedException.fix - actionable solution (optional)
  // parsedException.link - documentation URL (optional)
  useErrorMessage(
    parsedException.message || 'Something went wrong',
    parsedException.why,
  )
}
```

**Why `parseError`?** When the server throws `createError()`, it's serialized to an HTTP response. The client needs `parseError()` to extract all structured fields (`message`, `why`, `fix`, `link`) from the error response.

**Pattern for all client-side error handling:**
- Catch as `exception` (unknown type)
- Use `parseError(exception)` to extract structured fields
- Pass `parsedException.message` as title, `parsedException.why` as description
- Never use `parsedException?.data?.message` or `parsedException.statusMessage`

## Automated Checks

**CRITICAL: Pre-completion validation**:
- Before saying "task complete" or finishing any task that modifies `.ts` or `.vue` files, you MUST run:
  ```bash
  pnpm run format && pnpm run typecheck
  ```
- If either command reports errors, fix all issues before completing the task
- Do NOT skip this step - it prevents Stop hook failures and ensures code quality

**Running the checks:**
1. After making changes to `.ts` or `.vue` files, run `pnpm run format && pnpm run typecheck`
2. Review the output for any errors or warnings
3. Fix all reported issues
4. Re-run the checks until they pass without errors
5. Only then mark the task as complete

**Common fixes:**
- `@stylistic/max-len` - Break long lines (max 80 chars, exclude imports/URLs/strings from counting)
- `@stylistic/*` formatting - Run `pnpm run format` to auto-fix
- `no-console` - Warnings only, can be ignored unless explicitly requested to fix
- Type errors - Must be fixed; use proper types, check for missing imports or wrong types
- Unused variables - Prefix with underscore (`_variable`) or remove if truly unused
- For infra utility changes, verify no accidental `useEvent()` usage in
  request-agnostic modules.

**Stop hooks**: These still run after each response as a safety net, but should not be relied upon as the primary validation mechanism.

## Commit Messages

Conventional commits with types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `security`, `legal`, `kludge`

Subject must be sentence-case or lower-case.

## GitHub Actions

**Token usage**: Always use `${{ github.token }}` instead of `${{ secrets.GITHUB_TOKEN }}`:

```yaml
# Correct - recommended syntax
env:
  GH_TOKEN: ${{ github.token }}
  GITHUB_TOKEN: ${{ github.token }}

# Wrong - deprecated syntax
env:
  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Both refer to the same automatically-generated token, but `github.token` is GitHub's current recommendation for:
- Clearer semantics (context value, not a user-configured secret)
- Shorter, more readable syntax
- Consistency with official documentation

**Permissions**: Token permissions are controlled by the workflow's `permissions` block, not the syntax used to access it.

## Project security best practices

- Always run snyk_code_scan tool for new first party code that is generated in a Snyk-supported language.
- If any security issues are found based on newly introduced or modified code or dependencies, attempt to fix the issues using the results context from Snyk.
- Rescan the code after fixing the issues to ensure that the issues were fixed and that there are no newly introduced issues.
- Repeat this process until no new issues are found.

## Documentation References

### Nuxt

Before using Nuxt MCP docs, check local Nuxt best-practice guidance in the
skills directory: `.ai/skills/nuxt/SKILL.md`.

When implementing complex features, making architectural decisions, or answering questions about Nuxt best practices, use all the nested MD files in `.ai/skills/nuxt/references/`

**IMPORTANT: Token-efficient usage**

NEVER read MCP resources directly (`resource://nuxt-com/*`) - they consume 70k+ tokens

### DaisyUI

When working with DaisyUI components or answering questions about DaisyUI, fetch the official LLM documentation:

**URL**: https://daisyui.com/llms.txt

This file contains DaisyUI 5 component specifications, class names, theming instructions, and implementation guidelines.
