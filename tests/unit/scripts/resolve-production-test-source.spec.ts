import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  E2E_JOB_NAME_PATTERN,
  E2E_REQUIRED_STEPS,
  REQUIRED_JOB_STEPS,
  SKIP_BLOCKING_PATTERNS,
  findFullSuiteGaps,
  findSkipBlockingPaths,
  isFullSuiteRun,
  isSkipSafePath,
  resolveTestSource,
  selectMergedPullRequest,
} from '../../../scripts/ci/resolve-production-test-source.mjs'

const fullSuiteJobSteps: Record<string, string[]> = {
  'Lint & typecheck': [
    'Run ESLint',
    'Run TypeScript type checks',
    'Check that migrations are committed',
  ],
  'Unit tests': [
    'Run all unit tests',
    'Run cookie-consent module tests',
  ],
  'Integration tests': ['Run all integration tests'],
  'Build': ['Build application'],
}

const e2eShardPrefix = /^E2E tests \(/

const mainSha = 'f'.repeat(40)
const prHeadSha = 'a'.repeat(40)

const context = {
  repository: 'owner/repo',
  sha: mainSha,
  eventName: 'push',
  ref: 'refs/heads/main',
}

function createPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 442,
    merged_at: '2026-10-13T11:00:00Z',
    merge_commit_sha: mainSha,
    base: { ref: 'main' },
    head: { ref: 'feat/branch', repo: { full_name: 'owner/repo' } },
    ...overrides,
  }
}

function createRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    head_sha: prHeadSha,
    head_branch: 'feat/branch',
    head_repository: { full_name: 'owner/repo' },
    conclusion: 'success',
    created_at: '2026-10-13T10:00:00Z',
    pull_requests: [],
    ...overrides,
  }
}

function createStep(name: string, conclusion = 'success') {
  return { name, conclusion, status: 'completed' }
}

function createJob(
  name: string,
  stepNames: string[],
  conclusion = 'success',
) {
  return {
    name,
    conclusion,
    status: 'completed',
    steps: [
      createStep('Set up job'),
      ...stepNames.map(stepName => createStep(stepName)),
      createStep('Complete job'),
    ],
  }
}

function createFullSuiteJobs(shardCount = 3) {
  const requiredJobs = Object.entries(fullSuiteJobSteps)
    .map(([name, stepNames]) => createJob(name, stepNames))
  const shardJobs = Array.from({ length: shardCount }, (_item, index) => {
    return createJob(
      `E2E tests (${index + 1}/${shardCount})`,
      ['Run all E2E tests'],
    )
  })

  return [
    createJob('Gate', ['Resolve build source']),
    ...requiredJobs,
    ...shardJobs,
    createJob('Summary', ['Comment build results on PR']),
  ]
}

function createAffectedEraJobs() {
  return [
    createJob('Gate', ['Resolve build source']),
    createJob('Lint & typecheck', [
      'Run ESLint',
      'Run TypeScript type checks',
    ]),
    createJob('Unit tests', ['Run affected unit tests']),
    createJob('Integration tests', ['Run affected integration tests']),
    createJob('Build', ['Check affected E2E tests', 'Build application']),
    ...[1, 2, 3].map((shard) => {
      return createJob(`E2E tests (${shard}/3)`, ['Run affected E2E tests'])
    }),
  ]
}

function createReuseOnlyJobs() {
  return [
    createJob('Gate', ['Resolve build source']),
    createJob('Reuse previous build', ['Upload build artifact']),
    { name: 'Lint & typecheck', conclusion: 'skipped', steps: [] },
    { name: 'Unit tests', conclusion: 'skipped', steps: [] },
    { name: 'Integration tests', conclusion: 'skipped', steps: [] },
    { name: 'Build', conclusion: 'skipped', steps: [] },
    ...[1, 2, 3].map((shard) => {
      return {
        name: `E2E tests (${shard}/3)`,
        conclusion: 'skipped',
        steps: [],
      }
    }),
  ]
}

function replaceJob(
  jobs: Array<{ name: string }>,
  name: string,
  replacement: Record<string, unknown> | null,
) {
  const remaining = jobs.filter(job => job.name !== name)

  return replacement ? [...remaining, replacement] : remaining
}

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveTestSource({
    context,
    listPullRequests: async () => [createPullRequest()],
    fetchPullRequestHead: async () => {},
    listRuns: async () => [createRun()],
    listChangedFiles: () => [],
    listJobs: async () => createFullSuiteJobs(),
    ...overrides,
  })
}

describe('selectMergedPullRequest', () => {
  it('selects the merged pull request that produced the commit', () => {
    const unrelated = createPullRequest({
      number: 1,
      merge_commit_sha: 'b'.repeat(40),
    })

    expect(selectMergedPullRequest([unrelated, createPullRequest()], mainSha))
      .toMatchObject({ number: 442 })
  })

  it('ignores unmerged pull requests and other base branches', () => {
    expect(selectMergedPullRequest(
      [createPullRequest({ merged_at: null })],
      mainSha,
    )).toBeUndefined()
    expect(selectMergedPullRequest(
      [createPullRequest({ base: { ref: 'release' } })],
      mainSha,
    )).toBeUndefined()
    expect(selectMergedPullRequest([], mainSha)).toBeUndefined()
  })

  it('requires the full commit sha to match', () => {
    expect(selectMergedPullRequest(
      [createPullRequest()],
      mainSha.slice(0, 8),
    )).toBeUndefined()
  })
})

describe('findFullSuiteGaps', () => {
  it('accepts a run that executed every required step', () => {
    expect(findFullSuiteGaps(createFullSuiteJobs())).toEqual([])
    expect(isFullSuiteRun(createFullSuiteJobs(1))).toBe(true)
    expect(isFullSuiteRun(createFullSuiteJobs(4))).toBe(true)
  })

  it('rejects an affected-era run whose steps have other names', () => {
    const gaps = findFullSuiteGaps(createAffectedEraJobs())

    expect(gaps).toContain(
      'step "Run all unit tests" of "Unit tests" did not succeed',
    )
    expect(gaps).toContain(
      'step "Check that migrations are committed" of "Lint & typecheck" '
      + 'did not succeed',
    )
    expect(gaps).toContain(
      'step "Run all E2E tests" of "E2E tests (1/3)" did not succeed',
    )
  })

  it('rejects a reuse-only run whose test jobs were skipped', () => {
    expect(isFullSuiteRun(createReuseOnlyJobs())).toBe(false)
  })

  it('rejects a reuse-only run whose skipped matrix job is unexpanded', () => {
    const jobs = [
      ...createReuseOnlyJobs().filter((job) => {
        return !e2eShardPrefix.test(job.name)
      }),
      {
        name: 'E2E tests (${{ matrix.shard }}/${{ strategy.job-total }})',
        conclusion: 'skipped',
        steps: [],
      },
    ]

    expect(findFullSuiteGaps(jobs)).toContain('no E2E shard job is present')
  })

  it('rejects a run whose test jobs are missing entirely', () => {
    expect(isFullSuiteRun([createJob('Gate', ['Resolve build source'])]))
      .toBe(false)
    expect(isFullSuiteRun([])).toBe(false)
  })

  it('rejects a required step that was skipped or failed', () => {
    const skippedStep = createJob('Unit tests', [
      'Run all unit tests',
      'Run cookie-consent module tests',
    ])

    skippedStep.steps[2] = createStep(
      'Run cookie-consent module tests',
      'skipped',
    )

    expect(isFullSuiteRun(
      replaceJob(createFullSuiteJobs(), 'Unit tests', skippedStep),
    )).toBe(false)

    const failedStep = createJob('Build', ['Build application'], 'failure')

    expect(isFullSuiteRun(
      replaceJob(createFullSuiteJobs(), 'Build', failedStep),
    )).toBe(false)
  })

  it('rejects a failed E2E shard', () => {
    const jobs = replaceJob(
      createFullSuiteJobs(),
      'E2E tests (2/3)',
      createJob('E2E tests (2/3)', ['Run all E2E tests'], 'failure'),
    )

    expect(findFullSuiteGaps(jobs)).toContain(
      'job "E2E tests (2/3)" concluded failure',
    )
  })

  it('rejects an E2E shard that did not run the test step', () => {
    const jobs = replaceJob(
      createFullSuiteJobs(),
      'E2E tests (3/3)',
      createJob('E2E tests (3/3)', ['Prepare E2E']),
    )

    expect(isFullSuiteRun(jobs)).toBe(false)
  })

  it('rejects a missing E2E shard', () => {
    const jobs = replaceJob(createFullSuiteJobs(), 'E2E tests (2/3)', null)

    expect(findFullSuiteGaps(jobs)).toEqual(['E2E shard 2/3 is missing'])
  })

  it('rejects a run with no E2E shards at all', () => {
    const jobs = createFullSuiteJobs().filter((job) => {
      return !e2eShardPrefix.test(job.name)
    })

    expect(findFullSuiteGaps(jobs)).toEqual(['no E2E shard job is present'])
  })

  it('rejects shard jobs that disagree on the shard count', () => {
    const jobs = replaceJob(
      createFullSuiteJobs(),
      'E2E tests (3/3)',
      createJob('E2E tests (3/4)', ['Run all E2E tests']),
    )

    expect(findFullSuiteGaps(jobs)).toContain(
      'E2E shard jobs disagree on the shard count',
    )
  })

  it('rejects a shard count below one', () => {
    const jobs = [
      ...createFullSuiteJobs(0),
      createJob('E2E tests (0/0)', ['Run all E2E tests']),
    ]

    expect(findFullSuiteGaps(jobs)).toContain('E2E shard count is below 1')
  })
})

describe('required jobs and steps', () => {
  it('pins the required job and step names to literal values', () => {
    expect(REQUIRED_JOB_STEPS).toEqual(fullSuiteJobSteps)
    expect(E2E_REQUIRED_STEPS).toEqual(['Run all E2E tests'])
  })

  it('pins the E2E shard job name pattern', () => {
    expect(E2E_JOB_NAME_PATTERN.source).toBe('^E2E tests \\((\\d+)\\/(\\d+)\\)$')
    expect(E2E_JOB_NAME_PATTERN.test('E2E tests (1/3)')).toBe(true)
    expect(E2E_JOB_NAME_PATTERN.test('E2E tests (12/12)')).toBe(true)
    expect(E2E_JOB_NAME_PATTERN.test('E2E tests (1/3) extra')).toBe(false)
    expect(E2E_JOB_NAME_PATTERN.test('Unit tests')).toBe(false)
    expect(E2E_JOB_NAME_PATTERN.test(
      'E2E tests (${{ matrix.shard }}/${{ strategy.job-total }})',
    )).toBe(false)
  })
})

describe('preview-build.yml contract', () => {
  const workflowLines = readFileSync(
    '.github/workflows/preview-build.yml',
    'utf-8',
  ).split('\n')

  function readJob(jobId: string) {
    const start = workflowLines.indexOf(`  ${jobId}:`)

    expect(start, `job "${jobId}" exists`).toBeGreaterThan(-1)

    const nextJob = workflowLines.findIndex((line, index) => {
      return index > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)
    })

    return workflowLines.slice(start, nextJob === -1 ? undefined : nextJob)
  }

  function readStep(jobLines: string[], stepName: string) {
    const start = jobLines.indexOf(`      - name: ${stepName}`)

    expect(start, `step "${stepName}" exists`).toBeGreaterThan(-1)

    const nextStep = jobLines.findIndex((line, index) => {
      return index > start && line.startsWith('      - ')
    })

    return jobLines.slice(start, nextStep === -1 ? undefined : nextStep)
      .map(line => line.trim())
  }

  function expectRunStep(
    jobId: string,
    stepName: string,
    command: string,
  ) {
    const stepLines = readStep(readJob(jobId), stepName)

    expect(stepLines).toContain(`run: ${command}`)
    expectUnconditionalStep(stepLines)
  }

  function expectUnconditionalStep(stepLines: string[]) {
    const conditionalKeys = stepLines.filter((line) => {
      return line.startsWith('if:') || line.startsWith('continue-on-error:')
    })

    expect(conditionalKeys).toEqual([])
  }

  function expectJobName(jobId: string, name: string) {
    expect(readJob(jobId)).toContain(`    name: ${name}`)
  }

  function expectJobCannotBeMasked(jobId: string) {
    const maskingKeys = readJob(jobId).filter((line) => {
      return line.startsWith('    continue-on-error:')
    })

    expect(maskingKeys).toEqual([])
  }

  it('maps every required job name to its job id', () => {
    expectJobName('static', 'Lint & typecheck')
    expectJobName('unit', 'Unit tests')
    expectJobName('integration', 'Integration tests')
    expectJobName('build', 'Build')
    expectJobName(
      'e2e',
      'E2E tests (${{ matrix.shard }}/${{ strategy.job-total }})',
    )
  })

  it('runs the exact lint and typecheck commands in static', () => {
    expectRunStep('static', 'Run ESLint', 'pnpm run lint')
    expectRunStep(
      'static',
      'Run TypeScript type checks',
      'pnpm run typecheck',
    )
  })

  it('checks that migrations are committed in static', () => {
    const stepLines = readStep(
      readJob('static'),
      'Check that migrations are committed',
    )

    expect(stepLines).toContain(
      'if ! pnpm run db:generate || ! pnpm run db:consents:generate; then',
    )
    expect(stepLines).toContain(
      'if [ -n "$(git status --porcelain -- .drizzle)" ]; then',
    )
    expect(stepLines.filter(line => line === 'exit 1')).toHaveLength(2)
    expectUnconditionalStep(stepLines)
  })

  it('runs the full unit suites in unit', () => {
    expectRunStep('unit', 'Run all unit tests', 'pnpm run test:unit')
    expectRunStep(
      'unit',
      'Run cookie-consent module tests',
      'pnpm run test:cookie-consent',
    )
  })

  it('runs the full integration suite in integration', () => {
    expectRunStep(
      'integration',
      'Run all integration tests',
      'pnpm run test:integration',
    )
  })

  it('builds the application in build', () => {
    const stepLines = readStep(readJob('build'), 'Build application')

    expect(stepLines.join('\n')).toContain('pnpm run build')
    expectUnconditionalStep(stepLines)
  })

  it('runs every E2E shard of the full suite', () => {
    expectRunStep(
      'e2e',
      'Run all E2E tests',
      'pnpm exec playwright test '
      + '--shard=${{ matrix.shard }}/${{ strategy.job-total }}',
    )
    expect(readJob('e2e').map(line => line.trim()))
      .toContain('shard: [1, 2, 3]')
  })

  it('never masks a failing test job', () => {
    for (const jobId of ['static', 'unit', 'integration', 'build', 'e2e']) {
      expectJobCannotBeMasked(jobId)
    }
  })
})

describe('isSkipSafePath', () => {
  it('pins the skip-blocking patterns to literal values', () => {
    expect(SKIP_BLOCKING_PATTERNS).toEqual([
      'scripts/**',
      '.github/actions/**',
      '.github/workflows/preview-build.yml',
      '.github/workflows/production.yml',
    ])
  })

  it('allows ignorable paths that cannot change what the tests cover', () => {
    expect(isSkipSafePath('docs/ci-speed-audit.md')).toBe(true)
    expect(isSkipSafePath('README.md')).toBe(true)
    expect(isSkipSafePath('.github/workflows/claude.yml')).toBe(true)
    expect(isSkipSafePath('.github/CODEOWNERS')).toBe(true)
    expect(isSkipSafePath('.husky/pre-push')).toBe(true)
    expect(isSkipSafePath('lib/anything.ts')).toBe(true)
  })

  it('blocks ignorable paths that the CI pipeline itself depends on', () => {
    expect(isSkipSafePath('scripts/ci/resolve-production-test-source.mjs'))
      .toBe(false)
    expect(isSkipSafePath('scripts/test-affected.mjs')).toBe(false)
    expect(isSkipSafePath('.github/actions/setup/action.yml')).toBe(false)
    expect(isSkipSafePath('.github/workflows/preview-build.yml')).toBe(false)
    expect(isSkipSafePath('.github/workflows/production.yml')).toBe(false)
  })

  it('blocks paths that are not ignorable at all', () => {
    expect(isSkipSafePath('app/app.vue')).toBe(false)
    expect(isSkipSafePath('.npmrc')).toBe(false)
    expect(isSkipSafePath('.nuxtrc')).toBe(false)
    expect(isSkipSafePath('content/index.md')).toBe(false)
  })

  it('lists only the blocking paths', () => {
    expect(findSkipBlockingPaths([
      'docs/a.md',
      'scripts/x.mjs',
      'app/app.vue',
    ])).toEqual(['scripts/x.mjs', 'app/app.vue'])
    expect(findSkipBlockingPaths([])).toEqual([])
  })
})

describe('resolveTestSource', () => {
  it('runs the tests for a manual dispatch', async () => {
    const listPullRequests = vi.fn()
    const decision = await resolve({
      context: { ...context, eventName: 'workflow_dispatch' },
      listPullRequests,
    })

    expect(decision.skipTests).toBe(false)
    expect(listPullRequests).not.toHaveBeenCalled()
  })

  it('runs the tests for a push to another ref', async () => {
    const listPullRequests = vi.fn()
    const decision = await resolve({
      context: { ...context, ref: 'refs/heads/feature' },
      listPullRequests,
    })

    expect(decision.skipTests).toBe(false)
    expect(listPullRequests).not.toHaveBeenCalled()
  })

  it('runs the tests when the event or ref is unknown', async () => {
    expect((await resolve({
      context: { ...context, eventName: '' },
    })).skipTests).toBe(false)
    expect((await resolve({
      context: { ...context, ref: '' },
    })).skipTests).toBe(false)
  })

  it('runs the tests for a direct push without a pull request', async () => {
    const listRuns = vi.fn()
    const decision = await resolve({
      listPullRequests: async () => [],
      listRuns,
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('direct push')
    expect(listRuns).not.toHaveBeenCalled()
  })

  it('skips the tests when an identical tree passed the full suite', async () => {
    const fetchPullRequestHead = vi.fn(async () => {})
    const decision = await resolve({ fetchPullRequestHead })

    expect(decision.skipTests).toBe(true)
    expect(decision.sourceRunId).toBe('100')
    expect(decision.sourceSha).toBe(prHeadSha)
    expect(decision.pullRequestNumber).toBe(442)
    expect(fetchPullRequestHead).toHaveBeenCalledWith(442)
  })

  it('skips the tests when only docs changed since', async () => {
    const listJobs = vi.fn(async () => createFullSuiteJobs())
    const decision = await resolve({
      listChangedFiles: () => ['docs/a.md', 'AGENTS.md'],
      listJobs,
    })

    expect(decision.skipTests).toBe(true)
    expect(decision.changedFiles).toEqual(['docs/a.md', 'AGENTS.md'])
    expect(decision.reason).not.toContain('identical')
    expect(listJobs).toHaveBeenCalledTimes(1)
  })

  it('skips the tests when an unrelated workflow changed since', async () => {
    const decision = await resolve({
      listChangedFiles: () => ['.github/workflows/claude.yml'],
    })

    expect(decision.skipTests).toBe(true)
  })

  it('runs the tests when a script changed since the tested commit', async () => {
    const listJobs = vi.fn(async () => createFullSuiteJobs())
    const decision = await resolve({
      listChangedFiles: () => ['docs/a.md', 'scripts/ci/gate.mjs'],
      listJobs,
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.blockingFiles).toEqual(['scripts/ci/gate.mjs'])
    expect(decision.reason).toContain('scripts/ci/gate.mjs')
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('runs the tests when a composite action or CI workflow changed since', async () => {
    for (const path of [
      '.github/actions/setup/action.yml',
      '.github/workflows/preview-build.yml',
      '.github/workflows/production.yml',
    ]) {
      const decision = await resolve({ listChangedFiles: () => [path] })

      expect(decision.skipTests).toBe(false)
      expect(decision.reason).toContain(path)
    }
  })

  it('reports at most five blocking paths in the reason', async () => {
    const decision = await resolve({
      listChangedFiles: () => {
        return Array.from({ length: 8 }, (_item, index) => {
          return `scripts/file-${index}.mjs`
        })
      },
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.blockingFiles).toHaveLength(8)
    expect(decision.reason).toContain('scripts/file-4.mjs and 3 more')
    expect(decision.reason).not.toContain('scripts/file-5.mjs')
  })

  it('runs the tests when a non-ignorable file changed since', async () => {
    const listJobs = vi.fn(async () => createFullSuiteJobs())
    const decision = await resolve({
      listChangedFiles: () => ['docs/a.md', 'app/app.vue'],
      listJobs,
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('full-suite')
    expect(decision.reason).toContain('app/app.vue')
    expect(decision.blockingFiles).toEqual(['app/app.vue'])
    expect(decision.rejections).toHaveLength(1)
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('runs the tests when the run executed affected tests only', async () => {
    const decision = await resolve({
      listJobs: async () => createAffectedEraJobs(),
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.sourceRunId).toBeUndefined()
    expect(decision.reason).toContain('No full-suite Preview Build run')
    expect(decision.rejections?.[0]).toContain('not a full-suite run')
  })

  it('runs the tests when a required step is missing', async () => {
    const jobs = replaceJob(
      createFullSuiteJobs(),
      'Lint & typecheck',
      createJob('Lint & typecheck', [
        'Run ESLint',
        'Run TypeScript type checks',
      ]),
    )
    const decision = await resolve({ listJobs: async () => jobs })

    expect(decision.skipTests).toBe(false)
  })

  it('runs the tests when an E2E shard is missing', async () => {
    const jobs = replaceJob(createFullSuiteJobs(), 'E2E tests (3/3)', null)
    const decision = await resolve({ listJobs: async () => jobs })

    expect(decision.skipTests).toBe(false)
    expect(decision.rejections?.[0]).toContain('E2E shard 3/3 is missing')
  })

  it('runs the tests when an E2E shard failed', async () => {
    const jobs = replaceJob(
      createFullSuiteJobs(),
      'E2E tests (1/3)',
      createJob('E2E tests (1/3)', ['Run all E2E tests'], 'failure'),
    )
    const decision = await resolve({ listJobs: async () => jobs })

    expect(decision.skipTests).toBe(false)
  })

  it('uses the older full-suite run when the newer one only reused a build', async () => {
    const decision = await resolve({
      listRuns: async () => [
        createRun({
          id: 200,
          head_sha: 'c'.repeat(40),
          created_at: '2026-10-13T12:00:00Z',
        }),
        createRun({
          id: 100,
          head_sha: prHeadSha,
          created_at: '2026-10-13T10:00:00Z',
        }),
      ],
      listJobs: async (runId: number) => {
        return runId === 200 ? createReuseOnlyJobs() : createFullSuiteJobs()
      },
    })

    expect(decision.skipTests).toBe(true)
    expect(decision.sourceRunId).toBe('100')
    expect(decision.sourceSha).toBe(prHeadSha)
    expect(decision.rejections).toHaveLength(1)
  })

  it('tries the next candidate when git cannot diff against one', async () => {
    const forcePushedSha = 'd'.repeat(40)
    const decision = await resolve({
      listRuns: async () => [
        createRun({
          id: 200,
          head_sha: forcePushedSha,
          created_at: '2026-10-13T12:00:00Z',
        }),
        createRun({
          id: 100,
          head_sha: prHeadSha,
          created_at: '2026-10-13T10:00:00Z',
        }),
      ],
      listChangedFiles: (candidateSha: string) => {
        if (candidateSha === forcePushedSha) {
          throw new Error('bad object')
        }

        return []
      },
    })

    expect(decision.skipTests).toBe(true)
    expect(decision.sourceRunId).toBe('100')
    expect(decision.rejections?.[0]).toContain('could not diff')
  })

  it('runs the tests when git cannot diff against any candidate', async () => {
    const decision = await resolve({
      listChangedFiles: () => {
        throw new Error('bad object')
      },
    })

    expect(decision.skipTests).toBe(false)
  })

  it('matches runs by head branch because merged runs list no pull requests', async () => {
    const decision = await resolve({
      listRuns: async () => [
        createRun({ id: 7, head_branch: 'other-branch' }),
      ],
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('No successful Preview Build run')
  })

  it('matches runs that list the pull request number', async () => {
    const decision = await resolve({
      listRuns: async () => [
        createRun({
          head_branch: 'renamed-branch',
          pull_requests: [{ number: 442 }],
        }),
      ],
    })

    expect(decision.skipTests).toBe(true)
  })

  it('ignores runs that did not succeed', async () => {
    const decision = await resolve({
      listRuns: async () => [
        createRun({ id: 1, conclusion: 'cancelled' }),
        createRun({ id: 2, conclusion: 'failure' }),
      ],
    })

    expect(decision.skipTests).toBe(false)
  })

  it('checks at most ten candidates', async () => {
    const runs = Array.from({ length: 15 }, (_item, index) => {
      return createRun({
        id: index + 1,
        created_at: `2026-10-13T10:${String(index).padStart(2, '0')}:00Z`,
      })
    })
    const listJobs = vi.fn(async () => createAffectedEraJobs())
    const decision = await resolve({ listRuns: async () => runs, listJobs })

    expect(decision.skipTests).toBe(false)
    expect(listJobs).toHaveBeenCalledTimes(10)
  })

  it('runs the tests when the pull request lookup fails', async () => {
    const decision = await resolve({
      listPullRequests: async () => {
        throw new Error('HTTP 502')
      },
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('HTTP 502')
  })

  it('runs the tests when fetching the pull request head fails', async () => {
    const decision = await resolve({
      fetchPullRequestHead: async () => {
        throw new Error('fatal: could not read from remote')
      },
    })

    expect(decision.skipTests).toBe(false)
  })

  it('runs the tests when listing runs fails', async () => {
    const decision = await resolve({
      listRuns: async () => {
        throw new Error('HTTP 403')
      },
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('HTTP 403')
  })

  it('runs the tests when listing jobs fails', async () => {
    const decision = await resolve({
      listJobs: async () => {
        throw new Error('rate limit exceeded')
      },
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('rate limit exceeded')
  })
})
