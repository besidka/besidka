#!/usr/bin/env node

/**
 * Decides whether a Preview Build run must build or can reuse an earlier one.
 *
 * Finds the newest successful Preview Build run of the same PR whose
 * `preview-build` and `preview-drizzle` artifacts are still downloadable and
 * whose commit is an ancestor of the PR head. When every file changed since
 * that commit is ignorable, the run skips the build and relays that run's
 * artifacts. Anything uncertain (no candidate, expired artifacts, rewritten
 * history, API or git failure) resolves to a normal build.
 * See docs/cloudflare-previews.md → "Skipping builds".
 *
 * Usage:
 *   node scripts/ci/resolve-preview-build-source.mjs
 *   node scripts/ci/resolve-preview-build-source.mjs --dry-run \
 *     --pr=442 --head-ref=<branch> --head-sha=<sha> --current-run-id=0
 *
 * Env (overridden by the matching --flag):
 *   GH_TOKEN             token for `gh api`
 *   GITHUB_REPOSITORY    owner/name; falls back to `gh repo view`
 *   PR_NUMBER            pull request number
 *   PR_HEAD_REF          head branch name
 *   PR_HEAD_SHA          head commit sha
 *   PR_HEAD_REPOSITORY   head repo owner/name; defaults to GITHUB_REPOSITORY
 *   CURRENT_RUN_ID       run id to exclude from candidates
 *   GITHUB_OUTPUT        outputs file (skipped with --dry-run)
 *   GITHUB_STEP_SUMMARY  summary file (skipped with --dry-run)
 */

/* eslint-disable no-console */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const WORKFLOW_FILE = 'preview-build.yml'
export const REQUIRED_ARTIFACT_NAMES = ['preview-build', 'preview-drizzle']
export const RUNS_PAGE_SIZE = 50
export const MAX_CANDIDATES_CHECKED = 10
export const MAX_LISTED_FILES = 20

export const IGNORED_PATH_PATTERNS = [
  '.agents/**',
  '.agent/**',
  '.claude/**',
  '.cursor/**',
  '.windsurf/**',
  '.pi/**',
  '.github/**',
  '.husky/**',
  '.vscode/**',
  'docs/**',
  'lib/**',
  'scripts/**',
  '.gitignore',
  'commitlint.config.ts',
  '*.md',
  'skills-lock.json',
]

export function globToRegExp(pattern) {
  let source = ''

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]

    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index++
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  return new RegExp(`^${source}$`)
}

const IGNORED_PATH_MATCHERS = IGNORED_PATH_PATTERNS.map(globToRegExp)

export function isIgnoredPath(path) {
  return IGNORED_PATH_MATCHERS.some((matcher) => {
    return matcher.test(path)
  })
}

export function areAllPathsIgnored(paths) {
  return paths.every(isIgnoredPath)
}

export function matchesPullRequest(run, context) {
  const pullRequests = Array.isArray(run.pull_requests)
    ? run.pull_requests
    : []

  if (pullRequests.length > 0) {
    return pullRequests.some((pullRequest) => {
      return pullRequest.number === context.pullRequestNumber
    })
  }

  return run.head_repository?.full_name === context.headRepository
    && run.head_branch === context.headRef
}

export function selectCandidateRuns(runs, context) {
  return runs
    .filter((run) => {
      return run.conclusion === 'success'
        && String(run.id) !== String(context.currentRunId)
        && matchesPullRequest(run, context)
    })
    .sort((first, second) => {
      const byCreation = Date.parse(second.created_at)
        - Date.parse(first.created_at)

      if (Number.isNaN(byCreation) || byCreation === 0) {
        return second.id - first.id
      }

      return byCreation
    })
}

export function hasReusableArtifacts(artifacts) {
  return REQUIRED_ARTIFACT_NAMES.every((name) => {
    return artifacts.some((artifact) => {
      return artifact.name === name && artifact.expired === false
    })
  })
}

export function parseNullSeparated(output) {
  return output.split('\0').filter(Boolean)
}

export async function resolveSource({
  runs,
  context,
  listArtifacts,
  isAncestor,
  listChangedFiles,
}) {
  const candidates = selectCandidateRuns(runs, context)
    .slice(0, MAX_CANDIDATES_CHECKED)

  if (candidates.length === 0) {
    return {
      shouldSkip: false,
      reason: 'No earlier successful Preview Build run found for this PR.',
    }
  }

  for (const candidate of candidates) {
    const artifacts = await listArtifacts(candidate.id)

    if (!hasReusableArtifacts(artifacts)) {
      continue
    }

    if (!isAncestor(candidate.head_sha)) {
      continue
    }

    const changedFiles = listChangedFiles(candidate.head_sha)
    const sourceDescription = `run ${candidate.id} (${candidate.head_sha})`

    if (!areAllPathsIgnored(changedFiles)) {
      const blockingFiles = changedFiles.filter((path) => {
        return !isIgnoredPath(path)
      })

      return {
        shouldSkip: false,
        reason: `Non-ignorable changes since ${sourceDescription}.`,
        changedFiles: blockingFiles,
      }
    }

    return {
      shouldSkip: true,
      sourceRunId: String(candidate.id),
      sourceSha: candidate.head_sha,
      reason: changedFiles.length === 0
        ? `No changes since ${sourceDescription}; reusing its build.`
        : `Only ignorable changes since ${sourceDescription}; `
          + 'reusing its build.',
      changedFiles,
    }
  }

  return {
    shouldSkip: false,
    reason: 'No earlier successful run has live artifacts and is an '
      + 'ancestor of the PR head.',
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

function readContext() {
  const repository = readSetting('repo', 'GITHUB_REPOSITORY')
    ?? readRepositoryFromGh()
  const pullRequestNumber = Number(readSetting('pr', 'PR_NUMBER'))
  const headRef = readSetting('head-ref', 'PR_HEAD_REF')
  const headSha = readSetting('head-sha', 'PR_HEAD_SHA')

  if (!Number.isInteger(pullRequestNumber) || !headRef || !headSha) {
    throw new Error(
      'PR number, head ref and head sha are required '
      + '(--pr, --head-ref, --head-sha or PR_NUMBER, PR_HEAD_REF, '
      + 'PR_HEAD_SHA).',
    )
  }

  return {
    repository,
    pullRequestNumber,
    headRef,
    headSha,
    headRepository: readSetting('head-repo', 'PR_HEAD_REPOSITORY')
      ?? repository,
    currentRunId: readSetting('current-run-id', 'CURRENT_RUN_ID') ?? '0',
  }
}

function createGitProbe(headSha) {
  return {
    isAncestor(sourceSha) {
      const result = spawnSync(
        'git',
        ['merge-base', '--is-ancestor', sourceSha, headSha],
        { stdio: 'ignore' },
      )

      return result.status === 0
    },
    listChangedFiles(sourceSha) {
      return parseNullSeparated(
        runGit([
          'diff',
          '--name-only',
          '--no-renames',
          '-z',
          sourceSha,
          headSha,
        ]),
      )
    },
  }
}

function buildSummary(context, decision) {
  const lines = [
    '### Preview build source',
    '',
    `- Decision: ${decision.shouldSkip ? 'reuse previous build' : 'build'}`,
    `- Head: \`${context.headSha}\``,
  ]

  if (decision.shouldSkip) {
    lines.push(
      `- Reused run: [${decision.sourceRunId}]`
      + `(https://github.com/${context.repository}/actions/runs/`
      + `${decision.sourceRunId})`,
      `- Reused commit: \`${decision.sourceSha}\``,
    )
  }

  lines.push(`- Reason: ${decision.reason}`)

  const files = decision.changedFiles ?? []

  if (files.length > 0) {
    const listed = files.slice(0, MAX_LISTED_FILES)
      .map(file => `  - \`${file}\``)
    const hidden = files.length - listed.length

    lines.push(
      decision.shouldSkip
        ? '- Ignorable files changed since the reused commit:'
        : '- Files that require a build:',
      ...listed,
    )

    if (hidden > 0) {
      lines.push(`  - ...and ${hidden} more`)
    }
  }

  return `${lines.join('\n')}\n`
}

function writeOutputs(decision) {
  const lines = [
    `should-skip=${decision.shouldSkip}`,
    `source-run-id=${decision.sourceRunId ?? ''}`,
    `source-sha=${decision.sourceSha ?? ''}`,
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
    context = readContext()
    const query = new URLSearchParams({
      event: 'pull_request',
      status: 'success',
      branch: context.headRef,
      per_page: String(RUNS_PAGE_SIZE),
    })
    const runsResponse = runGitHubApi(
      `repos/${context.repository}/actions/workflows/${WORKFLOW_FILE}`
      + `/runs?${query}`,
    )
    const gitProbe = createGitProbe(context.headSha)

    decision = await resolveSource({
      runs: runsResponse.workflow_runs ?? [],
      context,
      listArtifacts: async (runId) => {
        const response = runGitHubApi(
          `repos/${context.repository}/actions/runs/${runId}`
          + '/artifacts?per_page=100',
        )

        return response.artifacts ?? []
      },
      isAncestor: gitProbe.isAncestor,
      listChangedFiles: gitProbe.listChangedFiles,
    })
  } catch (exception) {
    decision = {
      shouldSkip: false,
      reason: 'Could not resolve a previous build '
        + `(${exception instanceof Error ? exception.message : exception}); `
        + 'building.',
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
