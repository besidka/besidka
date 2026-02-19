#!/usr/bin/env node

/**
 * Check whether changed files affect tests of a given type.
 *
 * Can be used in two ways:
 *   1. Imported — getChangedFiles(), getAffectedTests(), filterTestsByType()
 *   2. Direct run — writes has-tests=true|false to $GITHUB_OUTPUT
 *
 * Usage (direct):
 *   node scripts/test-affected-check.mjs \
 *      [--base=main] [--type=unit|integration|e2e|all]
 */

/* eslint-disable no-console */

import { execSync } from 'node:child_process'
import { existsSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function getChangedFiles(base = 'HEAD') {
  try {
    let gitCommand

    if (base === 'HEAD') {
      gitCommand = 'git diff --name-only HEAD'
        + ' && git ls-files --others --exclude-standard'
    } else {
      gitCommand = `git diff --name-only ${base}...HEAD`
    }

    const output = execSync(
      gitCommand,
      { encoding: 'utf-8', shell: true },
    )

    const files = output.split('\n').filter(Boolean)

    return [...new Set(files)]
  } catch {
    console.warn(
      'Could not get git diff, running all tests',
    )

    return []
  }
}

export function getAffectedTests(changedFiles) {
  const affectedTests = new Set()
  const filesModuleTests = [
    'tests/unit/composables/chat-files.spec.ts',
    'tests/unit/composables/file-manager.spec.ts',
    'tests/unit/utils/files.spec.ts',
    'tests/unit/utils/upload-with-progress.spec.ts',
    'tests/integration/api/files-upload.spec.ts',
    'tests/integration/api/files-delete.spec.ts',
    'tests/integration/server/convert-files-for-ai.spec.ts',
    'tests/e2e/chat/files.spec.ts',
  ]

  const testMappings = [
    {
      pattern:
        /^app\/components\/Sidebar\/ThemeSwitcher\.vue$/,
      tests: [
        'tests/unit/components/ThemeSwitcher.spec.ts',
        'tests/e2e/settings/theme.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/ui\/Button\.vue$/,
      tests: [
        'tests/unit/components/ThemeSwitcher.spec.ts',
        'tests/e2e/settings/theme.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/ChatInput\/Files\/.*\.vue$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/components\/Chat\/Files\.vue$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/composables\/(chat-files|file-manager)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/utils\/(files|upload-with-progress)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/api\/v1\/files\/.*\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/routes\/files\/.*\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/api\/v1\/storage\/index\.get\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/utils\/(file-governance|convert-files-for-ai|file-share-access)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^shared\/types\/files\.d\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/db\/schemas\/(files|storages|image-transform-usage-monthly|chat-shares)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/db\/schema\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/composables\/.*\.ts$/,
      tests: (file) => {
        const name = file.match(/\/([^/]+)\.ts$/)?.[1]
        const testFile
          = `tests/unit/composables/${name}.spec.ts`

        return existsSync(testFile) ? [testFile] : []
      },
    },
    {
      pattern: /^app\/utils\/.*\.ts$/,
      tests: (file) => {
        const name = file.match(/\/([^/]+)\.ts$/)?.[1]
        const testFile
          = `tests/unit/utils/${name}.spec.ts`

        return existsSync(testFile) ? [testFile] : []
      },
    },
    {
      pattern:
        /^(nuxt\.config\.ts|vitest\.config\.mts|playwright\.config\.ts|package\.json|pnpm-lock\.yaml)$/,
      tests: 'all',
    },
    {
      pattern: /^app\.config\.ts$/,
      tests: ['tests/e2e/settings/theme.spec.ts'],
    },
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

export function filterTestsByType(tests, testType) {
  if (tests === 'all') return 'all'

  return tests.filter((test) => {
    if (testType === 'unit') {
      return test.startsWith('tests/unit/')
    }
    if (testType === 'integration') {
      return test.startsWith('tests/integration/')
    }
    if (testType === 'e2e') {
      return test.startsWith('tests/e2e/')
    }

    return true
  })
}

const isDirectRun
  = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const args = process.argv.slice(2)

  const base = args
    .find(arg => arg.startsWith('--base='))
    ?.split('=')[1] || 'HEAD'
  const type = args
    .find(arg => arg.startsWith('--type='))
    ?.split('=')[1] || 'all'

  const changedFiles = getChangedFiles(base)

  if (changedFiles.length === 0) {
    console.log('No changed files detected.')
    writeOutput('has-tests', 'false')
    process.exit(0)
  }

  console.log('Changed files:')
  changedFiles.forEach(
    file => console.log(`  - ${file}`),
  )
  console.log()

  const affectedTests = getAffectedTests(changedFiles)
  const filtered = filterTestsByType(affectedTests, type)

  const hasTests = filtered === 'all'
    || (Array.isArray(filtered) && filtered.length > 0)

  if (hasTests && Array.isArray(filtered)) {
    console.log(
      `Found ${filtered.length} affected ${type} test(s):`,
    )
    filtered.forEach(
      test => console.log(`  - ${test}`),
    )
  } else if (hasTests) {
    console.log(
      `Core files changed — all ${type} tests affected`,
    )
  } else {
    console.log(`No affected ${type} tests found`)
  }

  writeOutput('has-tests', hasTests ? 'true' : 'false')
}

function writeOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT

  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`)
  }

  console.log(`\n${key}=${value}`)
}
