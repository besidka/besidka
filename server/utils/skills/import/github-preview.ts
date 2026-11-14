import { createError } from 'evlog'
import { z } from 'zod'
import { SKILL_GITHUB_PICK_MAX } from '#shared/utils/skills-policy'
import {
  GITHUB_PATH_MAX_LENGTH,
  GITHUB_PATH_MAX_SEGMENTS,
  GITHUB_URL_MAX_LENGTH,
  githubRepoUrl,
  isValidGithubSegment,
  parseGithubSkillUrl,
} from '#shared/utils/skills/github-url'
import {
  findReleaseTagForSha,
  sortReleaseTagsDescending,
} from '#shared/utils/skills/release'
import type { SkillImportRelease } from '#shared/types/skills.d'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  createGithubClient,
  fetchGithubRefs,
  resolveGithubSource,
} from '~~/server/utils/skills/import/github'
import type {
  GithubClient,
  GithubRepository,
  GithubResolvedSource,
} from '~~/server/utils/skills/import/github'
import { loadGithubSkill } from '~~/server/utils/skills/import/github-skill'
import { createSkillImportPreview } from '~~/server/utils/skills/import/preview'
import type {
  SkillStageBucket,
  SkillStageKv,
} from '~~/server/utils/skills/import/stage'

export const githubImportBodySchema = z.object({
  url: z.string().min(1).max(GITHUB_URL_MAX_LENGTH),
  path: z.string().max(GITHUB_PATH_MAX_LENGTH + 2).optional(),
  channel: z.enum(['release', 'branch']).optional(),
})

export type GithubImportBody = z.infer<typeof githubImportBodySchema>

export interface GithubPickList {
  pick: {
    owner: string
    repo: string
    ref: string
    sha: string
    total: number
    truncated: boolean
    max: number
    candidates: Array<{ path: string, name: string }>
  }
}

function createInvalidLinkError(why: string) {
  return createError({
    message: 'This link cannot be imported',
    status: 400,
    code: 'invalid-request',
    why,
    fix: 'Paste a link to a repository, a skill folder, or its SKILL.md',
  })
}

function readPickedPath(path: string | undefined): string | null | undefined {
  if (path === undefined) {
    return undefined
  }

  const segments = path.split('/').filter((segment) => {
    return segment !== ''
  })

  if (
    segments.length === 0
    || segments.length > GITHUB_PATH_MAX_SEGMENTS
    || segments.join('/').length > GITHUB_PATH_MAX_LENGTH
    || !segments.every(isValidGithubSegment)
  ) {
    throw createInvalidLinkError('The folder path is not valid')
  }

  return segments.join('/')
}

interface SourceAttempt {
  ref: string
  sha: string
  isRelease: boolean
}

function listSourceAttempts(
  source: GithubResolvedSource,
  channel: 'release' | 'branch',
): SourceAttempt[] {
  const branchAttempt = { ref: source.ref, sha: source.sha, isRelease: false }

  if (!source.release || channel === 'branch') {
    return [branchAttempt]
  }

  return [
    ...source.release.tags.map((release) => {
      return { ref: release.tag, sha: release.sha, isRelease: true }
    }),
    branchAttempt,
  ]
}

/**
 * Loads the skill from the first source that holds it: the latest releases
 * one after the other (a folder added after the newest release is missing
 * from it), then the default branch. Only a missing folder moves on to the
 * next source; every other failure stops the import.
 */
async function loadFirstAvailableSource(
  client: GithubClient,
  repository: GithubRepository,
  path: string | null,
  attempts: SourceAttempt[],
) {
  for (const [index, attempt] of attempts.entries()) {
    try {
      const loaded = await loadGithubSkill(client, {
        ...repository,
        sha: attempt.sha,
        path,
      })

      return { loaded, attempt, skippedReleases: index > 0 }
    } catch (exception) {
      const isLast = index === attempts.length - 1
      const code = (exception as { code?: string }).code

      if (isLast || code !== 'archive-missing-skill-md') {
        throw exception
      }
    }
  }

  throw new Error('No source to load')
}

async function describeRelease(
  client: GithubClient,
  repository: GithubRepository,
  source: GithubResolvedSource,
  attempt: SourceAttempt,
): Promise<SkillImportRelease> {
  let tag: string | null = attempt.isRelease ? attempt.ref : null
  let latestTag = source.release?.latestTag ?? null

  try {
    const advertisement = await fetchGithubRefs(client, repository)

    latestTag = sortReleaseTagsDescending(advertisement.tags)[0]?.tag ?? null
    tag ??= findReleaseTagForSha(advertisement.tags, attempt.sha)
  } catch (_exception) {
    client.logger?.set({
      attributes: { skills: { github: { releaseLookupFailed: true } } },
    })
  }

  return {
    tag,
    isLatestRelease: tag !== null && tag === latestTag,
    latestTag,
    defaultBranch: source.release?.defaultBranch ?? null,
    channel: attempt.isRelease ? 'release' : 'branch',
    switchable: source.release !== null,
  }
}

/**
 * A GitHub link in, a staged preview out (or a pick list when the link holds
 * several skills; the caller sends the same link again with the chosen
 * `path`). The commit is resolved once and the preview carries it as the
 * version, so what the user reviews is exactly what `import/commit` installs.
 */
export async function previewGithubImport(input: {
  db: ReturnType<typeof useDb>
  kv: SkillStageKv
  bucket: SkillStageBucket
  userId: number
  body: GithubImportBody
  logger: LoggerLike
  fetchImpl?: typeof fetch
}) {
  const parsed = parseGithubSkillUrl(input.body.url)

  if (!parsed.ok) {
    throw createInvalidLinkError(parsed.message)
  }

  const pickedPath = readPickedPath(input.body.path)
  const client = createGithubClient({
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    kv: input.kv,
  })
  const source = await resolveGithubSource(client, parsed.value, {
    path: pickedPath,
  })
  const repository = { owner: parsed.value.owner, repo: parsed.value.repo }
  const { loaded, attempt, skippedReleases } = await loadFirstAvailableSource(
    client,
    repository,
    source.path,
    listSourceAttempts(source, input.body.channel ?? 'release'),
  )

  if (loaded.kind === 'pick') {
    input.logger.set({
      attributes: {
        skills: {
          import: {
            source: 'github',
            stage: 'pick',
            candidates: loaded.total,
          },
        },
      },
    })

    return {
      pick: {
        ...repository,
        ref: attempt.ref,
        sha: attempt.sha,
        total: loaded.total,
        truncated: loaded.total > loaded.candidates.length,
        max: SKILL_GITHUB_PICK_MAX,
        candidates: loaded.candidates.map((path) => {
          return { path, name: path.split('/').at(-1)! }
        }),
      },
    } satisfies GithubPickList
  }

  const fallbackWarnings = skippedReleases
    ? [
      'None of the latest releases contain this skill, so the latest commit '
      + 'of the default branch was used',
    ]
    : []

  return await createSkillImportPreview({
    db: input.db,
    kv: input.kv,
    bucket: input.bucket,
    userId: input.userId,
    source: 'github',
    sourceVersion: attempt.sha,
    provenance: {
      url: githubRepoUrl(repository.owner, repository.repo),
      ref: attempt.ref,
      path: loaded.skillPath,
    },
    release: await describeRelease(client, repository, source, attempt),
    fileName: null,
    files: loaded.files,
    folderName: loaded.folderName,
    archiveWarnings: [
      ...source.warnings,
      ...fallbackWarnings,
    ],
    licenseFromRepositoryRoot: loaded.rootLicenseFiles.length > 0,
    logger: input.logger,
  })
}
