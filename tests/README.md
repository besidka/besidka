# Besidka Test Suite

This directory contains comprehensive tests for the Besidka application using Vitest (unit/integration) and Playwright (E2E).

## Test Structure

```
tests/
├── setup/                      # Test configuration and utilities
│   ├── vitest.setup.ts        # Global Vitest setup
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
