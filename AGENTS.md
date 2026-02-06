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
- `useDb(event?)` - Get Drizzle D1 database instance
- `useKV(event?)` - Get Cloudflare KV instance
- `useServerAuth(event?)` - Get Better Auth instance
- `useSession(event?)` - Get current user session

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
- For D1 and KV: use `event.context.cloudflare.env.{BINDING}`
- For R2: use `(globalThis as any).__env__['R2_BUCKET']` - this is intentional and correct, do NOT change to `event.context.cloudflare.env`

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
const storage = useFileStorage(event)

// Wrong - useFileStorage() calls useEvent() inside parallel callback
await Promise.allSettled(
  keys.map(async (key) => {
    await useFileStorage().delete(key)  // May hang in production
  }),
)
```

**DELETE requests with body**: Per RFC 9110, DELETE request bodies have "no generally defined semantics" and Cloudflare's edge network may strip them. Use POST for bulk operations requiring a body:
```typescript
// Wrong - body may be stripped by edge network
$fetch('/api/v1/files/bulk', { method: 'DELETE', body: { ids } })

// Correct - POST preserves body
$fetch('/api/v1/files/bulk', { method: 'POST', body: { ids } })
```

## File Management

Files are stored in Cloudflare R2 with metadata in D1. Key components:

**API Endpoints** (`server/api/v1/files/`):
- `GET /` - List files with pagination and search
- `DELETE /[id]` - Delete single file
- `PATCH /[id]/name` - Rename file
- `POST /bulk` - Bulk delete files (uses POST because DELETE with body is unreliable per RFC 9110)

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
- Use `$fetch` with `query` option, not query strings in URLs:
  ```typescript
  // Correct
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

  // Wrong - implicit returns broken across lines
  if (condition)
    return value

  files.map((file, index) =>
    file.name)
  ```
- Prefix unused variables with `_`
- Do not add inline comments within functions unless explicitly requested. For large functions (80+ lines), a JSDoc-style comment above the function is acceptable
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
- Add types explicitly for reactive variables where not inferred:
  ```typescript
  // Correct
  const count = ref<number>(0)
  const name = shallowRef<string>('')

  // Wrong
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
- Custom runtime hooks: declare types in `app/types/runtime-hooks.d.ts`, not in `index.d.ts`
- Nuxt hooks registered via `nuxtApp.hook()` do not require cleanup in `onUnmounted`
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
  const log = useLogger(event)  // Auto-created, auto-emitted

  // Accumulate context throughout request
  log.set({ user: { id: user.id, plan: user.plan } })
  log.set({ cart: { items: 3, total: 9999 } })

  // Non-critical errors (swallowed, logged as context)
  try {
    await cache.set(key, value)
  } catch (exception) {
    log.set({
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

  // log.emit() called automatically at request end
})
```

**Reference files:**
- Wide events patterns: `.ai/skills/evlog/references/wide-events.md`
- Structured errors: `.ai/skills/evlog/references/structured-errors.md`

### Frontend Error Handling

**IMPORTANT:** Always use `parseError` from evlog when catching errors from `$fetch`:

```typescript
import { parseError } from 'evlog'

try {
  await $fetch('/api/checkout')
} catch (err) {
  const exception = parseError(err)

  // exception.message - user-facing title (required)
  // exception.why - technical reason (optional)
  // exception.fix - actionable solution (optional)
  // exception.link - documentation URL (optional)
  useErrorMessage(exception.message || 'Something went wrong', exception.why)
}
```

**Why `parseError`?** When the server throws `createError()`, it's serialized to an HTTP response. The client needs `parseError()` to extract all structured fields (`message`, `why`, `fix`, `link`) from the error response.

**Pattern for all client-side error handling:**
- Catch as `err` (unknown type)
- Use `parseError(err)` to extract structured fields
- Pass `exception.message` as title, `exception.why` as description
- Never use `exception?.data?.message` or `exception.statusMessage`

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

## Documentation References

### Nuxt

When implementing complex features, making architectural decisions, or answering questions about Nuxt best practices, use the **Nuxt MCP server** tools efficiently.

**IMPORTANT: Token-efficient usage**
- NEVER read MCP resources directly (`resource://nuxt-com/*`) - they consume 70k+ tokens
- NEVER use `list_documentation_pages` as the first step - it returns ~80k chars (~30k tokens)
- ALWAYS infer the documentation path directly and use `get_documentation_page`

**Path patterns (use these to infer paths directly):**

| Category | Pattern | Example |
|----------|---------|---------|
| Composables | `/docs/4.x/api/composables/{kebab-case}` | `useState` → `use-state` |
| Components | `/docs/4.x/api/components/{kebab-case}` | `NuxtLink` → `nuxt-link` |
| Utils | `/docs/4.x/api/utils/{kebab-case}` | `clearNuxtData` → `clear-nuxt-data` |
| Commands | `/docs/4.x/api/commands/{name}` | `nuxi` commands |
| Config | `/docs/4.x/api/configuration/{name}` | `nuxt-config` |
| Getting Started | `/docs/4.x/getting-started/{topic}` | `installation`, `state-management` |
| Guide | `/docs/4.x/guide/{category}/{topic}` | `guide/concepts/rendering` |

**Workflow (direct fetch first):**
```
1. Infer path from topic (e.g., useState → /docs/4.x/api/composables/use-state)
2. Call get_documentation_page(path: "...") directly (~2-3k tokens)
3. Only if error/404 → fall back to list_documentation_pages as last resort
```

**Common composable paths:**
- `useState` → `/docs/4.x/api/composables/use-state`
- `useFetch` → `/docs/4.x/api/composables/use-fetch`
- `useAsyncData` → `/docs/4.x/api/composables/use-async-data`
- `useNuxtApp` → `/docs/4.x/api/composables/use-nuxt-app`
- `useRuntimeConfig` → `/docs/4.x/api/composables/use-runtime-config`
- `useHead` → `/docs/4.x/api/composables/use-head`
- `useRoute` → `/docs/4.x/api/composables/use-route`
- `useRouter` → `/docs/4.x/api/composables/use-router`
- `useCookie` → `/docs/4.x/api/composables/use-cookie`
- `useError` → `/docs/4.x/api/composables/use-error`

**Other tools (use sparingly):**
- `list_modules` / `get_module` - Only for module compatibility questions
- `list_deploy_providers` / `get_deploy_provider` - Only for deployment questions
- `list_blog_posts` / `get_blog_post` - Only for release notes/announcements

Always use version "4.x" for this project.

### DaisyUI

When working with DaisyUI components or answering questions about DaisyUI, fetch the official LLM documentation:

**URL**: https://daisyui.com/llms.txt

This file contains DaisyUI 5 component specifications, class names, theming instructions, and implementation guidelines.
