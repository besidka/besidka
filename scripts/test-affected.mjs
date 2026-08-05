#!/usr/bin/env node

/**
 * Smart test runner that only runs tests affected by changed files
 * Usage:
 *   node scripts/test-affected.mjs \
 *      [--base=main] [--type=unit|integration|e2e|all]
 */

/* eslint-disable no-console */

import { execSync } from 'node:child_process'

import {
  filterTestsByType,
  getAffectedTests,
  getChangedFiles,
} from './test-affected-check.mjs'

const args = process.argv.slice(2)
const base = args.find(arg => arg.startsWith('--base='))?.split('=')[1] || 'HEAD'
const type = args.find(arg => arg.startsWith('--type='))?.split('=')[1] || 'all'

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
    const quotedTests = unitTests.map(test => `'${test}'`).join(' ')
    execSync(`pnpm exec vitest run --reporter=verbose --run ${quotedTests}`, {
      stdio: 'inherit',
      shell: true,
    })
  }

  if (integrationTests.length > 0 && (testType === 'integration' || testType === 'all')) {
    console.log('🔗 Running integration tests...\n')
    const quotedTests = integrationTests.map(test => `'${test}'`).join(' ')
    execSync(`pnpm exec vitest run --reporter=verbose --run ${quotedTests}`, {
      stdio: 'inherit',
      shell: true,
    })
  }

  if (e2eTests.length > 0 && (testType === 'e2e' || testType === 'all')) {
    console.log('\n🎭 Running e2e tests...\n')
    e2eTests.forEach((test) => {
      execSync(`pnpm exec playwright test '${test}'`, { stdio: 'inherit' })
    })
  }
}

// Main execution
console.log('🔍 Analyzing changed files...\n')

const changedFiles = getChangedFiles(base)

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
