#!/usr/bin/env node

/**
 * Smart test runner that only runs tests affected by changed files
 * Usage:
 *   node scripts/test-affected.mjs \
 *      [--base=main] [--type=unit|integration|e2e|all]
 */

/* eslint-disable no-console */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const base = args.find(arg => arg.startsWith('--base='))?.split('=')[1] || 'HEAD'
const type = args.find(arg => arg.startsWith('--type='))?.split('=')[1] || 'all'

// Get changed files from git
function getChangedFiles() {
  try {
    let gitCommand
    if (base === 'HEAD') {
      // Get both staged and unstaged changes, plus untracked files
      gitCommand = 'git diff --name-only HEAD && git ls-files --others --exclude-standard'
    } else {
      // Compare against specified base branch
      gitCommand = `git diff --name-only ${base}...HEAD`
    }

    const output = execSync(gitCommand, { encoding: 'utf-8', shell: true })
    const files = output.split('\n').filter(Boolean)
    // Remove duplicates
    return [...new Set(files)]
  } catch {
    console.warn('Could not get git diff, running all tests')
    return []
  }
}

// Map changed files to test files
function getAffectedTests(changedFiles) {
  const affectedTests = new Set()

  // File-to-test mapping rules
  const testMappings = [
    // Component tests
    {
      pattern: /^app\/components\/Sidebar\/ThemeSwitcher\.vue$/,
      tests: [
        'tests/unit/components/ThemeSwitcher.spec.ts',
        'tests/e2e/settings/theme.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/ui\/Button\.vue$/,
      tests: [
        'tests/unit/components/ThemeSwitcher.spec.ts', // Uses Button component
        'tests/e2e/settings/theme.spec.ts',
      ],
    },
    // Composables tests
    {
      pattern: /^app\/composables\/.*\.ts$/,
      tests: (file) => {
        const name = file.match(/\/([^/]+)\.ts$/)?.[1]
        const testFile = `tests/unit/composables/${name}.spec.ts`
        return existsSync(testFile) ? [testFile] : []
      },
    },
    // Utils tests
    {
      pattern: /^app\/utils\/.*\.ts$/,
      tests: (file) => {
        const name = file.match(/\/([^/]+)\.ts$/)?.[1]
        const testFile = `tests/unit/utils/${name}.spec.ts`
        return existsSync(testFile) ? [testFile] : []
      },
    },
    // Global changes that affect everything
    {
      pattern: /^(nuxt\.config\.ts|vitest\.config\.mts|playwright\.config\.ts|package\.json|pnpm-lock\.yaml)$/,
      tests: 'all',
    },
    // App config changes
    {
      pattern: /^app\.config\.ts$/,
      tests: ['tests/e2e/settings/theme.spec.ts'], // Theme colors are in app config
    },
    // Test files themselves
    {
      pattern: /^tests\/.*\.spec\.ts$/,
      tests: file => [file],
    },
  ]

  for (const file of changedFiles) {
    for (const mapping of testMappings) {
      if (mapping.pattern.test(file)) {
        const tests = typeof mapping.tests === 'function'
          ? mapping.tests(file)
          : mapping.tests

        if (tests === 'all') {
          return 'all'
        }

        if (Array.isArray(tests)) {
          tests.forEach(test => affectedTests.add(test))
        }
      }
    }
  }

  return Array.from(affectedTests)
}

// Filter tests by type
function filterTestsByType(tests, testType) {
  if (tests === 'all') return 'all'

  return tests.filter((test) => {
    if (testType === 'unit') return test.startsWith('tests/unit/')
    if (testType === 'integration') return test.startsWith('tests/integration/')
    if (testType === 'e2e') return test.startsWith('tests/e2e/')
    return true
  })
}

// Run tests
function runTests(tests, testType) {
  if (!tests || tests.length === 0) {
    console.log('✨ No affected tests found. All tests skipped!')
    return
  }

  if (tests === 'all') {
    console.log('🔄 Running ALL tests (core files changed)...\n')
    if (testType === 'unit' || testType === 'all') {
      execSync('pnpm run test:unit', { stdio: 'inherit' })
    }
    if (testType === 'integration' || testType === 'all') {
      execSync('pnpm run test:integration', { stdio: 'inherit' })
    }
    if (testType === 'e2e' || testType === 'all') {
      execSync('pnpm run test:e2e', { stdio: 'inherit' })
    }
    return
  }

  console.log(`🎯 Running ${tests.length} affected test file(s):\n`)
  tests.forEach(test => console.log(`  - ${test}`))
  console.log()

  const unitTests = tests.filter(t => t.startsWith('tests/unit/'))
  const integrationTests = tests.filter(t => t.startsWith('tests/integration/'))
  const e2eTests = tests.filter(t => t.startsWith('tests/e2e/'))

  if (unitTests.length > 0 && (testType === 'unit' || testType === 'all')) {
    console.log('📝 Running unit tests...\n')
    execSync(`vitest run --reporter=verbose --run ${unitTests.join(' ')}`, {
      stdio: 'inherit',
      shell: true,
    })
  }

  if (integrationTests.length > 0 && (testType === 'integration' || testType === 'all')) {
    console.log('🔗 Running integration tests...\n')
    execSync(`vitest run --reporter=verbose --run ${integrationTests.join(' ')}`, {
      stdio: 'inherit',
      shell: true,
    })
  }

  if (e2eTests.length > 0 && (testType === 'e2e' || testType === 'all')) {
    console.log('\n🎭 Running e2e tests...\n')
    e2eTests.forEach((test) => {
      execSync(`npx playwright test ${test}`, { stdio: 'inherit' })
    })
  }
}

// Main execution
console.log('🔍 Analyzing changed files...\n')

const changedFiles = getChangedFiles()

if (changedFiles.length === 0) {
  console.log('No changed files detected. Run all tests with: pnpm test:all')
  process.exit(0)
}

console.log('Changed files:')
changedFiles.forEach(file => console.log(`  - ${file}`))
console.log()

const affectedTests = getAffectedTests(changedFiles)
const filteredTests = filterTestsByType(affectedTests, type)

runTests(filteredTests, type)
