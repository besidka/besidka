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

## clean-gh-runs.sh

Bulk delete GitHub Actions workflow runs by title pattern. Useful for cleaning up dependency bump runs from Dependabot or automated tools.

### Usage

```bash
# Use default patterns (deps bumps + npm_and_yarn)
./scripts/clean-gh-runs.sh

# Auto-confirm without prompt
./scripts/clean-gh-runs.sh --yes

# Custom patterns
./scripts/clean-gh-runs.sh "chore(deps)" "build:"

# Increase search limit
./scripts/clean-gh-runs.sh --limit 500

# Show help
./scripts/clean-gh-runs.sh --help
```

### Default patterns

The script searches for runs with titles containing:
- `chore(deps-dev): bump`
- `chore(deps): bump`
- `npm_and_yarn`

### How it works

1. Fetches recent workflow runs via `gh run list`
2. Filters runs by title patterns using `jq`
3. Shows preview and asks for confirmation
4. Deletes matching runs sequentially

### Examples

**Quick cleanup with defaults:**
```bash
$ ./scripts/clean-gh-runs.sh --yes

🔍 Searching for workflow runs matching patterns...
   - "chore(deps-dev): bump"
   - "chore(deps): bump"
   - "npm_and_yarn"

📋 Found 20 matching workflow run(s):

  [21600762800] chore(deps): bump the production-dependencies group... (completed/success)
  [21600574134] chore(deps-dev): bump the development-dependencies... (completed/success)
  ...

🗑️  Deleting workflow runs...
  ✓ Deleted run 21600762800
  ✓ Deleted run 21600574134
  ...

✅ Done! Deleted 20 run(s).
```

**Custom patterns:**
```bash
$ ./scripts/clean-gh-runs.sh "ci:" "test:"

🔍 Searching for workflow runs matching patterns...
   - "ci:"
   - "test:"

📋 Found 5 matching workflow run(s):
...
```
