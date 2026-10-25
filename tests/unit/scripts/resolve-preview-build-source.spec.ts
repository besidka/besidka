import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  IGNORED_PATH_PATTERNS,
  areAllPathsIgnored,
  hasReusableArtifacts,
  isIgnoredPath,
  matchesPullRequest,
  parseNullSeparated,
  resolveSource,
  selectCandidateRuns,
} from '../../../scripts/ci/resolve-preview-build-source.mjs'

const context = {
  pullRequestNumber: 442,
  headRef: 'feat/branch',
  headRepository: 'owner/repo',
  currentRunId: '300',
}

function createRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    head_sha: 'a'.repeat(40),
    head_branch: 'feat/branch',
    head_repository: { full_name: 'owner/repo' },
    conclusion: 'success',
    created_at: '2026-10-13T10:00:00Z',
    pull_requests: [{ number: 442 }],
    ...overrides,
  }
}

const liveArtifacts = [
  { name: 'preview-build', expired: false },
  { name: 'preview-drizzle', expired: false },
]

describe('isIgnoredPath', () => {
  it('ignores tooling, docs and root markdown', () => {
    expect(isIgnoredPath('docs/cloudflare-previews.md')).toBe(true)
    expect(isIgnoredPath('.github/workflows/preview-build.yml')).toBe(true)
    expect(isIgnoredPath('scripts/ci/resolve-preview-build-source.mjs'))
      .toBe(true)
    expect(isIgnoredPath('lib/anything/deep/file.ts')).toBe(true)
    expect(isIgnoredPath('.agents/skills/nuxt/SKILL.md')).toBe(true)
    expect(isIgnoredPath('.cursor/rules.mdc')).toBe(true)
    expect(isIgnoredPath('.windsurf/rules.md')).toBe(true)
    expect(isIgnoredPath('README.md')).toBe(true)
    expect(isIgnoredPath('CLAUDE.md')).toBe(true)
    expect(isIgnoredPath('.gitignore')).toBe(true)
    expect(isIgnoredPath('skills-lock.json')).toBe(true)
    expect(isIgnoredPath('commitlint.config.ts')).toBe(true)
  })

  it('does not ignore nested markdown such as landing page content', () => {
    expect(isIgnoredPath('content/index.md')).toBe(false)
    expect(isIgnoredPath('content/guides/byok.md')).toBe(false)
    expect(isIgnoredPath('app/components/README.md')).toBe(false)
  })

  it('does not ignore application source or lookalike root files', () => {
    expect(isIgnoredPath('app/app.vue')).toBe(false)
    expect(isIgnoredPath('server/api/v1/chats/index.post.ts')).toBe(false)
    expect(isIgnoredPath('package.json')).toBe(false)
    expect(isIgnoredPath('pnpm-lock.yaml')).toBe(false)
    expect(isIgnoredPath('nested/.gitignore')).toBe(false)
    expect(isIgnoredPath('app/.eslintrc')).toBe(false)
    expect(isIgnoredPath('docs')).toBe(false)
    expect(isIgnoredPath('wrangler.jsonc')).toBe(false)
  })

  it('does not ignore install and Nuxt config dotfiles', () => {
    expect(isIgnoredPath('.npmrc')).toBe(false)
    expect(isIgnoredPath('.nuxtrc')).toBe(false)
  })
})

describe('areAllPathsIgnored', () => {
  it('requires every path to be ignorable', () => {
    expect(areAllPathsIgnored(['docs/a.md', '.github/x.yml'])).toBe(true)
    expect(areAllPathsIgnored(['docs/a.md', 'app/app.vue'])).toBe(false)
  })

  it('treats an empty list as ignorable', () => {
    expect(areAllPathsIgnored([])).toBe(true)
  })
})

describe('paths-ignore parity with the workflow', () => {
  it('keeps IGNORED_PATH_PATTERNS identical to on.pull_request.paths-ignore', () => {
    const workflow = readFileSync(
      '.github/workflows/preview-build.yml',
      'utf-8',
    )
    const block = workflow.split('paths-ignore:')[1]?.split('\nconcurrency:')[0]
    const patterns = (block ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('- '))
      .map(line => line.slice(2).replace(/^'|'$/g, ''))

    expect(patterns).toEqual(IGNORED_PATH_PATTERNS)
  })
})

describe('parseNullSeparated', () => {
  it('splits git -z output and drops the trailing empty entry', () => {
    expect(parseNullSeparated('a.ts\0docs/b.md\0')).toEqual([
      'a.ts',
      'docs/b.md',
    ])
    expect(parseNullSeparated('')).toEqual([])
  })
})

describe('matchesPullRequest', () => {
  it('matches by PR number when the run lists pull requests', () => {
    expect(matchesPullRequest(createRun(), context)).toBe(true)
    expect(matchesPullRequest(
      createRun({ pull_requests: [{ number: 7 }] }),
      context,
    )).toBe(false)
  })

  it('matches fork runs by head repository and branch', () => {
    const forkContext = { ...context, headRepository: 'fork/repo' }
    const forkRun = createRun({
      pull_requests: [],
      head_repository: { full_name: 'fork/repo' },
    })

    expect(matchesPullRequest(forkRun, forkContext)).toBe(true)
    expect(matchesPullRequest(forkRun, context)).toBe(false)
    expect(matchesPullRequest(
      createRun({
        pull_requests: [],
        head_repository: { full_name: 'fork/repo' },
        head_branch: 'other',
      }),
      forkContext,
    )).toBe(false)
  })
})

describe('selectCandidateRuns', () => {
  it('keeps successful runs of this PR newest first', () => {
    const older = createRun({ id: 1, created_at: '2026-10-13T08:00:00Z' })
    const newer = createRun({ id: 2, created_at: '2026-10-13T09:00:00Z' })

    expect(selectCandidateRuns([older, newer], context).map(run => run.id))
      .toEqual([2, 1])
  })

  it('excludes the current run, other PRs and non-successful runs', () => {
    const runs = [
      createRun({ id: 300 }),
      createRun({ id: 11, pull_requests: [{ number: 9 }] }),
      createRun({ id: 12, conclusion: 'cancelled' }),
      createRun({ id: 13, conclusion: 'failure' }),
      createRun({ id: 14 }),
    ]

    expect(selectCandidateRuns(runs, context).map(run => run.id))
      .toEqual([14])
  })
})

describe('hasReusableArtifacts', () => {
  it('requires both artifacts to be live', () => {
    expect(hasReusableArtifacts(liveArtifacts)).toBe(true)
    expect(hasReusableArtifacts([
      { name: 'preview-build', expired: false },
      { name: 'preview-drizzle', expired: true },
    ])).toBe(false)
    expect(hasReusableArtifacts([
      { name: 'preview-build', expired: false },
    ])).toBe(false)
    expect(hasReusableArtifacts([])).toBe(false)
  })
})

describe('resolveSource', () => {
  const sourceSha = 'a'.repeat(40)

  function resolve(overrides: Record<string, unknown> = {}) {
    return resolveSource({
      runs: [createRun({ id: 100, head_sha: sourceSha })],
      context,
      listArtifacts: async () => liveArtifacts,
      isAncestor: () => true,
      listChangedFiles: () => ['docs/a.md'],
      ...overrides,
    })
  }

  it('reuses the last built run when only ignorable files changed', async () => {
    const decision = await resolve()

    expect(decision.shouldSkip).toBe(true)
    expect(decision.sourceRunId).toBe('100')
    expect(decision.sourceSha).toBe(sourceSha)
  })

  it('reuses the last built run when nothing changed', async () => {
    const decision = await resolve({ listChangedFiles: () => [] })

    expect(decision.shouldSkip).toBe(true)
    expect(decision.sourceRunId).toBe('100')
  })

  it('builds when a code change sits between the build and the head', async () => {
    const decision = await resolve({
      listChangedFiles: () => ['docs/a.md', 'app/app.vue'],
    })

    expect(decision.shouldSkip).toBe(false)
    expect(decision.changedFiles).toEqual(['app/app.vue'])
  })

  it('builds when no earlier run exists', async () => {
    const decision = await resolve({ runs: [] })

    expect(decision.shouldSkip).toBe(false)
    expect(decision.sourceRunId).toBeUndefined()
  })

  it('builds when the only candidate has expired artifacts', async () => {
    const decision = await resolve({
      listArtifacts: async () => [
        { name: 'preview-build', expired: true },
        { name: 'preview-drizzle', expired: true },
      ],
    })

    expect(decision.shouldSkip).toBe(false)
  })

  it('builds when history was rewritten', async () => {
    const decision = await resolve({ isAncestor: () => false })

    expect(decision.shouldSkip).toBe(false)
  })

  it('falls back to an older candidate with live artifacts', async () => {
    const expiredSha = 'b'.repeat(40)
    const decision = await resolve({
      runs: [
        createRun({
          id: 200,
          head_sha: expiredSha,
          created_at: '2026-10-13T12:00:00Z',
        }),
        createRun({
          id: 100,
          head_sha: sourceSha,
          created_at: '2026-10-13T10:00:00Z',
        }),
      ],
      listArtifacts: async (runId: number) => {
        return runId === 200 ? [] : liveArtifacts
      },
    })

    expect(decision.shouldSkip).toBe(true)
    expect(decision.sourceRunId).toBe('100')
  })

  it('prefers the newest qualifying run', async () => {
    const decision = await resolve({
      runs: [
        createRun({
          id: 100,
          head_sha: sourceSha,
          created_at: '2026-10-13T10:00:00Z',
        }),
        createRun({
          id: 200,
          head_sha: 'c'.repeat(40),
          created_at: '2026-10-13T12:00:00Z',
        }),
      ],
    })

    expect(decision.sourceRunId).toBe('200')
    expect(decision.sourceSha).toBe('c'.repeat(40))
  })

  it('builds when the only earlier runs were cancelled or failed', async () => {
    const listedRunIds: number[] = []
    const decision = await resolve({
      runs: [
        createRun({ id: 101, head_sha: sourceSha, conclusion: 'cancelled' }),
        createRun({ id: 102, head_sha: sourceSha, conclusion: 'failure' }),
      ],
      listArtifacts: async (runId: number) => {
        listedRunIds.push(runId)

        return liveArtifacts
      },
    })

    expect(decision.shouldSkip).toBe(false)
    expect(decision.sourceRunId).toBeUndefined()
    expect(listedRunIds).toEqual([])
  })

  it('never takes the baseline from a cancelled run newer than a built one', async () => {
    const decision = await resolve({
      runs: [
        createRun({
          id: 200,
          head_sha: 'c'.repeat(40),
          conclusion: 'cancelled',
          created_at: '2026-10-13T12:00:00Z',
        }),
        createRun({
          id: 100,
          head_sha: sourceSha,
          created_at: '2026-10-13T10:00:00Z',
        }),
      ],
      listChangedFiles: (baselineSha: string) => {
        return baselineSha === sourceSha ? ['docs/a.md'] : ['app/app.vue']
      },
    })

    expect(decision.shouldSkip).toBe(true)
    expect(decision.sourceRunId).toBe('100')
    expect(decision.sourceSha).toBe(sourceSha)
  })

  it('builds when earlier successful runs built nothing', async () => {
    const decision = await resolve({
      runs: [
        createRun({ id: 100, head_sha: sourceSha }),
        createRun({
          id: 200,
          head_sha: 'c'.repeat(40),
          created_at: '2026-10-13T12:00:00Z',
        }),
      ],
      listArtifacts: async () => [],
    })

    expect(decision.shouldSkip).toBe(false)
    expect(decision.sourceRunId).toBeUndefined()
  })

  it('never reuses the current run', async () => {
    const decision = await resolve({
      runs: [createRun({ id: 300, head_sha: sourceSha })],
    })

    expect(decision.shouldSkip).toBe(false)
  })
})
