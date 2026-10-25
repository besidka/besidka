# Besidka Test Suite

This directory contains comprehensive tests for the Besidka application using Vitest (unit/integration) and Playwright (E2E).

## Test Structure

```
tests/
├── setup/                      # Test configuration and utilities
│   ├── vitest.projects.ts     # Which spec directories run in `node` vs `nuxt`
│   ├── vitest.setup.common.ts # Setup for every project (no DOM access)
│   ├── vitest.setup.dom.ts    # Setup for the `nuxt` project only (DOM)
│   ├── vitest.setup.node.ts   # Setup for the `node` project only
│   ├── mocks/                 # Mock implementations
│   │   ├── auth.ts           # Authentication mocks
│   │   ├── cloudflare.ts     # D1/KV/bindings mocks
│   │   └── api.ts            # MSW API handlers
│   └── fixtures/              # Test data
│       ├── chats.ts
│       ├── users.ts
│       └── messages.ts
├── unit/                       # Unit tests
│   ├── composables/           # Composable tests
│   └── components/            # Component tests
├── integration/                # Integration tests
│   ├── middleware/            # Middleware tests
│   └── api/                   # API route tests
└── e2e/                        # End-to-end tests
    ├── auth.setup.ts           # Setup project: creates authenticated storage state
    ├── auth/                  # Authentication flows
    ├── chat/                  # Chat functionality
    ├── settings/              # Settings & preferences
    └── helpers/               # E2E test helpers
```

## Vitest Projects: `node` vs `nuxt`

`vitest.config.mts` defines two Vitest projects. Every spec file under
`tests/unit` and `tests/integration` runs in exactly one of them.

| Project | Environment | Setup files |
|---------|-------------|-------------|
| `node` | plain Node, no DOM, no Nuxt app | `vitest.setup.common.ts`, `vitest.setup.node.ts` |
| `nuxt` | `@nuxt/test-utils` Nuxt app + happy-dom | Nuxt entry, `vitest.setup.common.ts`, `vitest.setup.dom.ts` |

Both projects share one Vite config (aliases, auto-imports, the Vapor strip
plugin), `mockReset`, `globals`, coverage and the `threads` pool. Nuxt is
booted once per Vitest run, not once per project.

### Which directories run where

The rule is per top-level directory and lives in
`tests/setup/vitest.projects.ts`:

- `node`: `tests/unit/{assets,config,content,db,middleware,providers,scripts,
  server,utils,workers}` and `tests/integration/{api,server}`.
- `nuxt`: `tests/unit/{components,composables,layouts,pages,plugins,
  service-worker}` and `tests/integration/pages`.
- `nuxtSpecExceptions`: a short list of spec files inside a `node` directory
  that need a real DOM or Nuxt app (for example specs that read `window` or
  use `mountSuspended`). They run in `nuxt`.

`tests/unit/config/vitest-projects.spec.ts` fails when a new top-level spec
directory is not classified, when a spec sits outside a classified directory,
or when an exception is stale. Add a new directory to `nodeSpecDirectories` or
`nuxtSpecDirectories`; do not add it to both.

### What a `node` spec can and cannot use

- Auto-imports, `#shared`, `~~` aliases and `vi.mock` all work.
- `useRuntimeConfig()` returns the real resolved Nuxt runtime config (the same
  object a Nuxt app would expose, provided by the config as
  `nuxtRuntimeConfig`). It is a per-file copy, so a spec may mutate it.
- `useNuxtApp()` is not available: the Nuxt app does not exist (`NUXT_E1001`).
- `window`, `document`, and the `@nuxt/test-utils/runtime` helpers
  (`mountSuspended`, `mockNuxtImport`, `registerEndpoint`) need the `nuxt`
  project.

### Opting a spec in a `node` directory into `nuxt`

Add its path to `nuxtSpecExceptions` in `tests/setup/vitest.projects.ts`. That
list is the only opt-in. A `// @vitest-environment nuxt` pragma at the top of
the spec does not work for a file selected by the `node` project, because the
Nuxt entry setup and `environmentOptions` exist only in the `nuxt` project.
To move a spec the other way, delete its entry from the list; the spec then
has to pass without DOM globals.

A spec in a `nuxt` directory cannot opt out: move or split it into a `node`
directory instead (for example, pure logic into `tests/unit/utils`).

### Why

Profiling showed that test bodies are about a quarter of the worker time.
Booting the Nuxt environment (0.2-0.5 s per file) dominates. Pure
server, provider, config and util specs do not need it, so they run in plain
Node. `tests/setup/vitest.setup.ts` could not be shared because it touched
`document.cookie`, `window.history` and `window.matchMedia` at module scope.

## Running Tests

### Unit Tests
```bash
# Run all unit tests
pnpm run test:unit

# Run specific unit test file
pnpm exec vitest tests/unit/composables/validation.spec.ts
```

### Integration Tests
```bash
# Run all integration tests
pnpm run test:integration
```

### E2E Tests
```bash
# Run all E2E tests
pnpm run test:e2e

# Run with UI
pnpm run test:e2e:ui

# Run in headed mode (see browser)
pnpm run test:e2e:headed

# Debug mode
pnpm run test:e2e:debug

# Run specific browser
pnpm run test:e2e:chromium
```

`test:e2e` runs the `setup` Playwright project first, which creates
`.playwright/auth-user.json`. Non-auth specs then reuse this authenticated
state by default.

### All Tests
```bash
# Run all tests (unit + integration + e2e)
pnpm run test:all
```

### Coverage
```bash
# Generate coverage report
pnpm run coverage

# View coverage in UI
pnpm run coverage:ui

# View HTML report
open coverage/index.html
```

## Test Development

### Writing Unit Tests

```typescript
import { describe, it, expect } from 'vitest'
import { useValidation } from '../../../app/composables/validation'

describe('useValidation', () => {
  const { Validation } = useValidation()

  describe('required', () => {
    const rule = Validation.required()

    it('should validate non-empty strings', () => {
      expect(rule.validate('hello')).toBe(true)
    })

    it('should have correct error message', () => {
      expect(rule.message).toBe('This field is required')
    })
  })
})
```

### Writing E2E Tests

```typescript
import { test, expect } from '@playwright/test'

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/chats/new')
    await expect(page).toHaveURL('/chats/new')
  })
})
```

### E2E Auth Strategy

- Active non-auth specs run with preloaded authenticated `storageState`.
- Auth flows are covered in dedicated specs under `tests/e2e/auth/`.
- Auth specs should override storage state to empty:

```typescript
test.use({
  storageState: {
    cookies: [],
    origins: [],
  },
})
```

- API-first auth helpers live in `tests/e2e/helpers/auth.ts`.

### Using Test Helpers

```typescript
import { signIn, createChat, sendMessage } from '../helpers'

test('chat flow', async ({ page }) => {
  await signIn(page, 'test@example.com', 'password')
  await createChat(page, 'Hello!')
  await sendMessage(page, 'How are you?')
})
```

## Test Coverage

Current coverage targets:
- **Overall**: 70% minimum
- **Critical paths**: 85% minimum (auth, forms, chat)

View coverage reports:
- HTML: `coverage/index.html`
- LCOV: `coverage/lcov.info`
- JSON: `coverage/coverage-final.json`

## Mocking

### Cloudflare Bindings
Tests use in-memory mocks for Cloudflare services:
- **D1**: `better-sqlite3` in-memory database
- **KV**: `Map` implementation
- **Assets**: Mocked fetch

### Authentication
Mock sessions and users available in `tests/setup/mocks/auth.ts`:
```typescript
import { createMockUser, createMockSession } from '../setup/mocks/auth'

const user = createMockUser({ email: 'test@example.com' })
const session = createMockSession({ userId: user.id })
```

### API Calls
MSW handlers in `tests/setup/mocks/api.ts` mock API endpoints:
- Auth endpoints
- Chat CRUD operations
- API key management

## CI/CD Integration

Tests run automatically in GitHub Actions:
1. Unit & integration tests
2. E2E tests (chromium only in CI)
3. Coverage upload to Codecov
4. Playwright report artifacts

## Troubleshooting

### E2E Tests Fail Locally
E2E tests require the dev server running:
```bash
# Terminal 1
pnpm run dev

# Terminal 2
pnpm run test:e2e
```

Or use the built-in web server (configured in `playwright.config.ts`).

### Import Errors in Unit Tests
Use relative imports for app code:
```typescript
// ✅ Correct
import { useValidation } from '../../../app/composables/validation'

// ❌ Incorrect
import { useValidation } from '~/app/composables/validation'
```

### Coverage Thresholds Failing
Update thresholds in `vitest.config.mts` if needed:
```typescript
coverage: {
  thresholds: {
    lines: 70,
    functions: 70,
    branches: 70,
    statements: 70,
  },
}
```

## Test Implementation Status

### ✅ Completed
- [x] Test infrastructure setup
- [x] Validation composable tests (44 tests)
- [x] E2E authentication tests (8 tests)
- [x] E2E chat tests (8 tests)
- [x] E2E theme tests (5 tests)
- [x] Test helpers and mocks

### 🔄 In Progress
- [ ] Form system unit tests
- [ ] Component unit tests
- [ ] Auth & chat composable tests
- [ ] Integration tests (middleware, API)

### 📋 Planned
- [ ] Additional E2E scenarios
- [ ] Performance tests
- [ ] Accessibility tests
- [ ] Visual regression tests

## Best Practices

### Test Selectors (CRITICAL)
**ALWAYS use `data-testid` attributes** - never rely on generic selectors:

✅ **DO:**
```typescript
// Component
<button data-testid="theme-switcher">Switch Theme</button>

// Test
const button = page.getByTestId('theme-switcher')
```

❌ **DON'T:**
```typescript
// Component
<button>Switch Theme</button>

// Test - FRAGILE!
const button = page.locator('button')
```

**Selector Priority:**
1. ✅ `data-testid` - Most reliable and explicit
2. ⚠️ ARIA roles/labels - Good for accessibility, but can change
3. ❌ Generic elements (`button`, `div`, `input`) - Fragile and ambiguous
4. ❌ CSS classes - Change frequently with styling
5. ❌ Text content - May change with i18n or copy updates

### General Practices

1. **Test Isolation**: Each test should be independent
2. **Descriptive Names**: Use clear, descriptive test names
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Mock External Dependencies**: Don't call real APIs in tests
5. **Add data-testid FIRST**: Before writing tests, add data-testid to components
6. **Test User Behavior**: Focus on what users do, not implementation
7. **Keep Tests Fast**: Unit tests should run in milliseconds
8. **Clean Up**: Reset state between tests

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [MSW Documentation](https://mswjs.io/)
- [Nuxt Testing Guide](https://nuxt.com/docs/getting-started/testing)
