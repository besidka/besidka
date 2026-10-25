import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  E2E_JOB_NAME_PATTERN,
  REQUIRED_JOB_STEPS,
  findFullSuiteGaps,
  isFullSuiteRun,
  resolveTestSource,
  selectMergedPullRequest,
} from '../../../scripts/ci/resolve-production-test-source.mjs'

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
  const requiredJobs = Object.entries(REQUIRED_JOB_STEPS)
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
        return !E2E_JOB_NAME_PATTERN.test(job.name)
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
      return !E2E_JOB_NAME_PATTERN.test(job.name)
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

describe('workflow parity', () => {
  const workflow = readFileSync('.github/workflows/preview-build.yml', 'utf-8')
  const names = workflow
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('name: ') || line.startsWith('- name: '))
    .map(line => line.replace(/^- /, '').slice('name: '.length))

  it('names every required job and step in preview-build.yml', () => {
    for (const [jobName, stepNames] of Object.entries(REQUIRED_JOB_STEPS)) {
      expect(names).toContain(jobName)

      for (const stepName of stepNames) {
        expect(names).toContain(stepName)
      }
    }

    expect(names).toContain('Run all E2E tests')
    expect(names).toContain(
      'E2E tests (${{ matrix.shard }}/${{ strategy.job-total }})',
    )
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

  it('skips the tests when only ignorable files changed since', async () => {
    const decision = await resolve({
      listChangedFiles: () => ['docs/a.md', '.github/workflows/x.yml'],
    })

    expect(decision.skipTests).toBe(true)
    expect(decision.changedFiles).toEqual([
      'docs/a.md',
      '.github/workflows/x.yml',
    ])
  })

  it('runs the tests when a non-ignorable file changed since', async () => {
    const listJobs = vi.fn(async () => createFullSuiteJobs())
    const decision = await resolve({
      listChangedFiles: () => ['docs/a.md', 'app/app.vue'],
      listJobs,
    })

    expect(decision.skipTests).toBe(false)
    expect(decision.reason).toContain('full-suite')
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
