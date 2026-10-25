#!/usr/bin/env node

/**
 * Decides whether a push to main can skip the test jobs of Deploy to
 * Production.
 *
 * Finds the pull request that produced the pushed commit, then looks for a
 * successful full-suite Preview Build run of that PR whose commit differs from
 * the pushed commit only in ignorable paths. When one exists, the same tree
 * already passed lint, typecheck, unit, integration and E2E, so main only
 * builds and deploys. Anything uncertain (not a push to main, direct push, no
 * qualifying run, rewritten history, API or git failure) resolves to running
 * the tests. See docs/ci-speed-audit.md → F4.
 *
 * Usage:
 *   node scripts/ci/resolve-production-test-source.mjs
 *   node scripts/ci/resolve-production-test-source.mjs --dry-run \
 *     --sha=<merge commit>
 *
 * Env (overridden by the matching --flag):
 *   GH_TOKEN             token for `gh api`
 *   GITHUB_REPOSITORY    owner/name; falls back to `gh repo view`
 *   GITHUB_SHA           the commit pushed to main
 *   GITHUB_EVENT_NAME    must be `push` to skip the tests
 *   GITHUB_REF           must be `refs/heads/main` to skip the tests
 *   GITHUB_OUTPUT        outputs file (skipped with --dry-run)
 *   GITHUB_STEP_SUMMARY  summary file (skipped with --dry-run)
 *
 * With --dry-run the event name and ref default to `push` and
 * `refs/heads/main`, and the outputs and summary are not written.
 */

/* eslint-disable no-console */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MAX_CANDIDATES_CHECKED,
  MAX_LISTED_FILES,
  RUNS_PAGE_SIZE,
  WORKFLOW_FILE,
  areAllPathsIgnored,
  isIgnoredPath,
  parseNullSeparated,
  selectCandidateRuns,
} from './resolve-preview-build-source.mjs'

export const PRODUCTION_BRANCH = 'main'
export const PRODUCTION_REF = `refs/heads/${PRODUCTION_BRANCH}`

export const REQUIRED_JOB_STEPS = {
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

export const E2E_JOB_NAME_PATTERN = /^E2E tests \((\d+)\/(\d+)\)$/
export const E2E_REQUIRED_STEPS = ['Run all E2E tests']

function isSuccessful(entry) {
  return entry?.conclusion === 'success'
}

function findStepGaps(job, requiredStepNames) {
  return requiredStepNames
    .filter((stepName) => {
      const step = (job.steps ?? []).find((candidate) => {
        return candidate.name === stepName
      })

      return !isSuccessful(step)
    })
    .map((stepName) => {
      return `step "${stepName}" of "${job.name}" did not succeed`
    })
}

function findJobGaps(jobs, jobName, requiredStepNames) {
  const matchingJobs = jobs.filter((job) => {
    return job.name === jobName
  })

  if (matchingJobs.length === 0) {
    return [`job "${jobName}" is missing`]
  }

  return matchingJobs.flatMap((job) => {
    if (!isSuccessful(job)) {
      return [`job "${jobName}" concluded ${job.conclusion ?? 'unknown'}`]
    }

    return findStepGaps(job, requiredStepNames)
  })
}

function findShardGaps(jobs) {
  const shardJobs = jobs.filter((job) => {
    return E2E_JOB_NAME_PATTERN.test(job.name)
  })

  if (shardJobs.length === 0) {
    return ['no E2E shard job is present']
  }

  const gaps = []
  const totals = new Set()
  const shards = new Set()

  for (const job of shardJobs) {
    const [, shard, total] = job.name.match(E2E_JOB_NAME_PATTERN)

    shards.add(Number(shard))
    totals.add(Number(total))

    if (!isSuccessful(job)) {
      gaps.push(`job "${job.name}" concluded ${job.conclusion ?? 'unknown'}`)
      continue
    }

    gaps.push(...findStepGaps(job, E2E_REQUIRED_STEPS))
  }

  if (totals.size !== 1) {
    gaps.push('E2E shard jobs disagree on the shard count')

    return gaps
  }

  const [shardCount] = totals

  if (shardCount < 1) {
    gaps.push('E2E shard count is below 1')

    return gaps
  }

  for (let shard = 1; shard <= shardCount; shard++) {
    if (!shards.has(shard)) {
      gaps.push(`E2E shard ${shard}/${shardCount} is missing`)
    }
  }

  return gaps
}

export function findFullSuiteGaps(jobs) {
  const jobGaps = Object.entries(REQUIRED_JOB_STEPS)
    .flatMap(([jobName, requiredStepNames]) => {
      return findJobGaps(jobs, jobName, requiredStepNames)
    })

  return [...jobGaps, ...findShardGaps(jobs)]
}

export function isFullSuiteRun(jobs) {
  return findFullSuiteGaps(jobs).length === 0
}

export function selectMergedPullRequest(pullRequests, sha) {
  return pullRequests.find((pullRequest) => {
    return Boolean(pullRequest.merged_at)
      && pullRequest.merge_commit_sha === sha
      && pullRequest.base?.ref === PRODUCTION_BRANCH
  })
}

function formatError(exception) {
  const message = exception instanceof Error
    ? exception.message
    : String(exception)

  return message.replace(/\s+/g, ' ').trim()
}

function shorten(sha) {
  return String(sha).slice(0, 7)
}

async function decide({
  context,
  listPullRequests,
  fetchPullRequestHead,
  listRuns,
  listChangedFiles,
  listJobs,
}) {
  if (context.eventName !== 'push' || context.ref !== PRODUCTION_REF) {
    return {
      skipTests: false,
      reason: `Not a push to ${PRODUCTION_BRANCH} `
        + `(${context.eventName} on ${context.ref}); running the tests.`,
    }
  }

  const pullRequest = selectMergedPullRequest(
    await listPullRequests(context.sha),
    context.sha,
  )

  if (!pullRequest) {
    return {
      skipTests: false,
      reason: 'No merged pull request produced this commit (direct push); '
        + 'running the tests.',
    }
  }

  await fetchPullRequestHead(pullRequest.number)

  const runs = await listRuns(pullRequest)
  const candidates = selectCandidateRuns(runs, {
    pullRequestNumber: pullRequest.number,
    headRef: pullRequest.head?.ref,
    headRepository: pullRequest.head?.repo?.full_name ?? context.repository,
    currentRunId: '0',
  }).slice(0, MAX_CANDIDATES_CHECKED)

  if (candidates.length === 0) {
    return {
      skipTests: false,
      pullRequestNumber: pullRequest.number,
      reason: `No successful Preview Build run found for PR `
        + `#${pullRequest.number}; running the tests.`,
    }
  }

  const rejections = []

  for (const candidate of candidates) {
    const candidateLabel = `run ${candidate.id} (${shorten(candidate.head_sha)})`
    let changedFiles

    try {
      changedFiles = listChangedFiles(candidate.head_sha)
    } catch (exception) {
      rejections.push(
        `${candidateLabel}: could not diff against it `
        + `(${formatError(exception)})`,
      )
      continue
    }

    if (!areAllPathsIgnored(changedFiles)) {
      const blockingFiles = changedFiles.filter((path) => {
        return !isIgnoredPath(path)
      })

      rejections.push(
        `${candidateLabel}: ${blockingFiles.length} non-ignorable file(s) `
        + 'changed since it',
      )
      continue
    }

    const gaps = findFullSuiteGaps(await listJobs(candidate.id))

    if (gaps.length > 0) {
      rejections.push(`${candidateLabel}: not a full-suite run (${gaps[0]})`)
      continue
    }

    return {
      skipTests: true,
      sourceRunId: String(candidate.id),
      sourceSha: candidate.head_sha,
      pullRequestNumber: pullRequest.number,
      reason: changedFiles.length === 0
        ? `PR #${pullRequest.number} passed the full suite on an identical `
        + `tree in ${candidateLabel}; reusing its result.`
        : `PR #${pullRequest.number} passed the full suite in `
          + `${candidateLabel} and only ignorable files changed since; `
          + 'reusing its result.',
      changedFiles,
      rejections,
    }
  }

  return {
    skipTests: false,
    pullRequestNumber: pullRequest.number,
    reason: `No full-suite Preview Build run on a matching tree found for PR `
      + `#${pullRequest.number} (${rejections.length} candidate(s) `
      + 'rejected); running the tests.',
    rejections,
  }
}

export async function resolveTestSource(dependencies) {
  try {
    return await decide(dependencies)
  } catch (exception) {
    return {
      skipTests: false,
      reason: 'Could not resolve a reusable test run '
        + `(${formatError(exception)}); running the tests.`,
    }
  }
}

function runGitHubApi(path) {
  const output = execFileSync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github+json', path],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  )

  return JSON.parse(output)
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function readArgument(name) {
  const prefix = `--${name}=`
  const match = process.argv.find((argument) => {
    return argument.startsWith(prefix)
  })

  if (match) {
    return match.slice(prefix.length)
  }

  return process.argv.includes(`--${name}`) ? true : undefined
}

function readSetting(argumentName, environmentName) {
  const fromArgument = readArgument(argumentName)

  if (typeof fromArgument === 'string') {
    return fromArgument
  }

  return process.env[environmentName]?.trim() || undefined
}

function readRepositoryFromGh() {
  return execFileSync(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    { encoding: 'utf-8' },
  ).trim()
}

function readContext(isDryRun) {
  const repository = readSetting('repo', 'GITHUB_REPOSITORY')
    ?? readRepositoryFromGh()
  const requestedSha = readSetting('sha', 'GITHUB_SHA')

  if (!requestedSha) {
    throw new Error('The commit sha is required (--sha or GITHUB_SHA).')
  }

  return {
    repository,
    sha: runGit(['rev-parse', '--verify', `${requestedSha}^{commit}`]).trim(),
    eventName: readSetting('event-name', 'GITHUB_EVENT_NAME')
      ?? (isDryRun ? 'push' : ''),
    ref: readSetting('ref', 'GITHUB_REF')
      ?? (isDryRun ? PRODUCTION_REF : ''),
  }
}

function createDependencies(context) {
  return {
    context,
    listPullRequests: async (sha) => {
      return runGitHubApi(
        `repos/${context.repository}/commits/${sha}/pulls?per_page=100`,
      )
    },
    fetchPullRequestHead: async (pullRequestNumber) => {
      runGit([
        'fetch',
        '--no-tags',
        'origin',
        `+refs/pull/${pullRequestNumber}/head:`
        + `refs/remotes/origin/pr/${pullRequestNumber}`,
      ])
    },
    listRuns: async (pullRequest) => {
      const query = new URLSearchParams({
        event: 'pull_request',
        branch: pullRequest.head.ref,
        status: 'success',
        per_page: String(RUNS_PAGE_SIZE),
      })
      const response = runGitHubApi(
        `repos/${context.repository}/actions/workflows/${WORKFLOW_FILE}`
        + `/runs?${query}`,
      )

      return response.workflow_runs ?? []
    },
    listChangedFiles: (candidateSha) => {
      if (!/^[0-9a-f]{40}$/i.test(candidateSha)) {
        throw new Error(`Unexpected commit sha "${candidateSha}".`)
      }

      return parseNullSeparated(
        runGit([
          'diff',
          '--name-only',
          '--no-renames',
          '-z',
          candidateSha,
          context.sha,
        ]),
      )
    },
    listJobs: async (runId) => {
      const response = runGitHubApi(
        `repos/${context.repository}/actions/runs/${runId}`
        + '/jobs?filter=latest&per_page=100',
      )
      const jobs = response.jobs ?? []

      if (response.total_count > jobs.length) {
        throw new Error(`The job list of run ${runId} is truncated.`)
      }

      return jobs
    },
  }
}

function buildSummary(context, decision) {
  const lines = [
    '### Production test source',
    '',
    `- Decision: ${decision.skipTests ? 'reuse the pull request tests' : 'run the tests'}`,
    `- Commit: \`${context.sha}\``,
  ]

  if (decision.pullRequestNumber) {
    lines.push(
      `- Pull request: [#${decision.pullRequestNumber}]`
      + `(https://github.com/${context.repository}/pull/`
      + `${decision.pullRequestNumber})`,
    )
  }

  if (decision.skipTests) {
    lines.push(
      `- Tested run: [${decision.sourceRunId}]`
      + `(https://github.com/${context.repository}/actions/runs/`
      + `${decision.sourceRunId})`,
      `- Tested commit: \`${decision.sourceSha}\``,
    )
  }

  lines.push(`- Reason: ${decision.reason}`)

  const files = decision.changedFiles ?? []

  if (files.length > 0) {
    const listed = files.slice(0, MAX_LISTED_FILES)
      .map(file => `  - \`${file}\``)
    const hidden = files.length - listed.length

    lines.push(
      '- Ignorable files changed since the tested commit:',
      ...listed,
    )

    if (hidden > 0) {
      lines.push(`  - ...and ${hidden} more`)
    }
  }

  const rejections = decision.rejections ?? []

  if (rejections.length > 0) {
    lines.push(
      '- Rejected candidates:',
      ...rejections.map(rejection => `  - ${rejection}`),
    )
  }

  return `${lines.join('\n')}\n`
}

function writeOutputs(decision) {
  const lines = [
    `skip-tests=${decision.skipTests}`,
    `source-run-id=${decision.sourceRunId ?? ''}`,
    `source-sha=${decision.sourceSha ?? ''}`,
    `pr-number=${decision.skipTests ? decision.pullRequestNumber : ''}`,
    `reason=${decision.reason.replace(/\s+/g, ' ')}`,
  ]

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  }
}

async function main() {
  const isDryRun = readArgument('dry-run') === true
  let context
  let decision

  try {
    context = readContext(isDryRun)
    decision = await resolveTestSource(createDependencies(context))
  } catch (exception) {
    decision = {
      skipTests: false,
      reason: 'Could not resolve a reusable test run '
        + `(${formatError(exception)}); running the tests.`,
    }
  }

  console.log(JSON.stringify(decision, null, 2))

  if (isDryRun) {
    return 0
  }

  writeOutputs(decision)

  if (context && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      buildSummary(context, decision),
    )
  }

  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
