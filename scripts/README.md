# Scripts Directory

## test-affected.mjs

Smart test runner that analyzes git changes and runs only affected tests.

### Usage

```bash
# Run all affected tests (unit + e2e)
node scripts/test-affected.mjs

# Run only affected unit tests
node scripts/test-affected.mjs --type=unit

# Run only affected e2e tests
node scripts/test-affected.mjs --type=e2e

# Compare against main branch
node scripts/test-affected.mjs --base=main

# Compare against specific branch/commit
node scripts/test-affected.mjs --base=origin/develop
```

### How it works

1. Detects changed files using `git diff`
2. Maps changed files to test files using predefined rules
3. Runs only the affected tests

### Examples

**Scenario 1: Only ThemeSwitcher.vue changed**
```bash
$ node scripts/test-affected.mjs

🔍 Analyzing changed files...

Changed files:
  - app/components/Sidebar/ThemeSwitcher.vue

🎯 Running 2 affected test file(s):
  - tests/unit/components/ThemeSwitcher.spec.ts
  - tests/e2e/settings/theme.spec.ts
```

**Scenario 2: Core config files changed**
```bash
$ node scripts/test-affected.mjs

🔍 Analyzing changed files...

Changed files:
  - package.json
  - vitest.config.mts

🔄 Running ALL tests (core files changed)...
```

**Scenario 3: No test mappings exist**
```bash
$ node scripts/test-affected.mjs

🔍 Analyzing changed files...

Changed files:
  - README.md
  - docs/guide.md

✨ No affected tests found. All tests skipped!
```

### Adding custom mappings

Edit the `testMappings` array in `test-affected.mjs`:

```javascript
const testMappings = [
  {
    pattern: /^app\/components\/MyComponent\.vue$/,
    tests: [
      'tests/unit/components/MyComponent.spec.ts',
      'tests/e2e/my-feature.spec.ts'
    ]
  },
  // ... more mappings
]
```

See [../docs/test-optimization.md](../docs/test-optimization.md) for detailed documentation.
