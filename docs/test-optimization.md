# Test Optimization Guide

Run only the tests affected by your changes - **70-90% faster** test feedback during development.

## Quick Start

```bash
# During development (fastest)
pnpm test:unit:changed        # Only changed unit tests (~2-5s)

# Before committing (smart)
pnpm test:affected            # All affected tests (~5-10s)

# Before pushing (complete)
pnpm test:all                 # Full suite (~30-45s)
```

## Available Commands

### Unit Tests
```bash
pnpm test:unit                # All unit tests
pnpm test:unit:changed        # Only changed (Vitest --changed)
pnpm test:unit:related        # Related to specific files
pnpm test:unit:watch          # Watch mode
```

### Integration Tests
```bash
pnpm test:integration         # All integration tests
pnpm test:integration:watch   # Watch mode
```

### E2E Tests
```bash
pnpm test:e2e                 # All e2e tests
pnpm test:e2e:ui              # Interactive mode
pnpm test:e2e:debug           # Debug mode
```

### Smart/Affected Tests
```bash
pnpm test:affected            # All affected (unit + e2e)
pnpm test:affected:unit       # Only affected unit tests
pnpm test:affected:e2e        # Only affected e2e tests
```

## How It Works

### 1. Vitest `--changed` (Unit Tests Only)

```bash
pnpm test:unit:changed
```

Uses Vitest's built-in git integration to:
- Detect uncommitted changes
- Find test files that import changed files
- Run only those tests

**Best for:** Quick feedback during active coding

### 2. Smart Affected Tests (Unit + E2E)

```bash
pnpm test:affected
```

Custom script (`scripts/test-affected.mjs`) that:
- Analyzes git changes
- Maps files to tests using predefined rules
- Runs all affected tests (including e2e)

**Best for:** Pre-commit verification

## File-to-Test Mapping

### Component Changes

| Changed File | Affected Tests |
|--------------|----------------|
| `app/components/Sidebar/ThemeSwitcher.vue` | `tests/unit/components/ThemeSwitcher.spec.ts`<br>`tests/e2e/settings/theme.spec.ts` |
| `app/components/ui/Button.vue` | `tests/unit/components/ThemeSwitcher.spec.ts`<br>`tests/e2e/settings/theme.spec.ts` |

### Auto-mapping

- `app/composables/foo.ts` → `tests/unit/composables/foo.spec.ts`
- `app/utils/bar.ts` → `tests/unit/utils/bar.spec.ts`

### Core Files (Run All Tests)

Changes to these files run the complete suite for safety:
- `package.json`
- `nuxt.config.ts`
- `vitest.config.mts`
- `playwright.config.ts`
- `pnpm-lock.yaml`

## Recommended Workflow

### Daily Development

```bash
# Terminal 1: Dev server
pnpm dev

# Terminal 2: Watch mode (auto-runs tests)
pnpm test:unit:watch

# Or: Manual quick checks
pnpm test:unit:changed
```

### Before Committing

The pre-commit hook (`.husky/pre-commit`) automatically runs:
1. ESLint fixes (lint-staged)
2. Type checking
3. Affected tests

```bash
git commit -m "Your changes"
# Automatically runs: pnpm test:affected
```

### Before Pushing

```bash
pnpm test:all
```

Ensures complete coverage before pushing to remote.

## Customizing Test Mappings

Edit `scripts/test-affected.mjs` to add custom mappings:

```javascript
const testMappings = [
  {
    pattern: /^app\/components\/MyComponent\.vue$/,
    tests: [
      'tests/unit/components/MyComponent.spec.ts',
      'tests/e2e/my-feature.spec.ts'
    ]
  },
  // Dynamic mapping
  {
    pattern: /^app\/services\/.*\.ts$/,
    tests: (file) => {
      const name = file.match(/\/([^/]+)\.ts$/)?.[1]
      return [`tests/unit/services/${name}.spec.ts`]
    }
  }
]
```

## CI/CD Integration

### GitHub Actions Example

```yaml
# Pull Requests: Run only affected tests (fast)
- name: Run affected tests
  if: github.event_name == 'pull_request'
  run: node scripts/test-affected.mjs --base=origin/main

# Main branch: Run complete suite
- name: Run all tests
  if: github.ref == 'refs/heads/main'
  run: pnpm test:all
```

See `.github/workflows/test-optimization-example.yml.disabled` for full example.

## Performance Comparison

| Command | Time | Tests | Use Case |
|---------|------|-------|----------|
| `test:unit:changed` | ~2-5s | 2-5 | Active coding |
| `test:affected:unit` | ~5-10s | 5-15 | Pre-commit |
| `test:unit` | ~10-15s | All unit | Full unit suite |
| `test:e2e` | ~20-30s | All e2e | Full e2e suite |
| `test:all` | ~30-45s | All | Complete coverage |

**Time saved:** 70-90% faster during development!

## Handling Side Effects

### Problem

Component A uses Component B. When B changes, should A's tests run?

### Solution

Add explicit mappings in `scripts/test-affected.mjs`:

```javascript
{
  pattern: /^app\/components\/ComponentB\.vue$/,
  tests: [
    'tests/unit/components/ComponentB.spec.ts',  // Direct test
    'tests/unit/components/ComponentA.spec.ts',  // Uses ComponentB
  ]
}
```

### Safety Net

1. **Pre-commit:** Runs affected tests
2. **Pre-push:** Run full suite manually
3. **CI (main):** Always runs complete suite

This multi-layer approach catches any missed dependencies.

## Troubleshooting

### "No affected tests found"

**Cause:** Changed files don't have test mappings

**Solutions:**
- Add test coverage for the file
- Add mapping in `scripts/test-affected.mjs`
- File might not need tests (docs, assets)

### Tests passing locally but failing on main

**Cause:** Missing indirect dependency in mappings

**Solutions:**
1. Identify the missing dependency
2. Add explicit mapping
3. Run `pnpm test:all` before pushing

### Too many tests running

**Cause:** Overly broad mappings

**Solutions:**
1. Make mappings more specific
2. Split large test files
3. Improve component isolation

## Advanced Usage

### Compare against specific branch
```bash
node scripts/test-affected.mjs --base=main
node scripts/test-affected.mjs --base=origin/develop
```

### Run only specific test type
```bash
node scripts/test-affected.mjs --type=unit
node scripts/test-affected.mjs --type=e2e
```

### Combine options
```bash
node scripts/test-affected.mjs --base=main --type=unit
```

## Best Practices

### ✅ Do

- Use `test:unit:changed` during active development
- Use `test:affected` before committing (automatic via hook)
- Run `test:all` before pushing
- Add mappings for component dependencies
- Update mappings when architecture changes

### ❌ Don't

- Skip tests completely
- Forget to update mappings when adding dependencies
- Rely solely on affected tests in CI for main branch
- Ignore "no tests found" warnings

## Summary

- **Fast development:** `pnpm test:unit:changed`
- **Pre-commit:** Automatic via hook (`pnpm test:affected`)
- **Pre-push:** `pnpm test:all`
- **CI/CD:** Affected on PRs, full on main

For complete command reference, see [TEST_COMMANDS.md](../TEST_COMMANDS.md).
