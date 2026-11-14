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
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  createGithubClient,
  resolveGithubSource,
} from '~~/server/utils/skills/import/github'
import {
  loadGithubSkill,
  loadGithubSkillMarkdown,
} from '~~/server/utils/skills/import/github-skill'
import { createSkillImportPreview } from '~~/server/utils/skills/import/preview'
import type {
  SkillStageBucket,
  SkillStageKv,
} from '~~/server/utils/skills/import/stage'

export const githubImportBodySchema = z.object({
  url: z.string().min(1).max(GITHUB_URL_MAX_LENGTH),
  path: z.string().max(GITHUB_PATH_MAX_LENGTH + 2).optional(),
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
    fix: 'Paste a link like https://github.com/owner/repo/tree/main/skills/name',
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

/**
 * A GitHub link in, a staged preview out (or a pick list when the link holds
 * several skills; the caller sends the same link again with the chosen
 * `path`). The commit is resolved once and the preview carries it as the
 * version, so what the user reviews is exactly what `import/commit` installs.
 */
export async function previewGithubImport(input: {
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
  const loadSource = {
    ...repository,
    sha: source.sha,
    path: source.path,
  }
  const loaded = parsed.value.kind === 'blob' && pickedPath === undefined
    ? await loadGithubSkillMarkdown(client, loadSource)
    : await loadGithubSkill(client, loadSource)

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
        ref: source.ref,
        sha: source.sha,
        total: loaded.total,
        truncated: loaded.total > loaded.candidates.length,
        max: SKILL_GITHUB_PICK_MAX,
        candidates: loaded.candidates.map((path) => {
          return { path, name: path.split('/').at(-1)! }
        }),
      },
    } satisfies GithubPickList
  }

  return await createSkillImportPreview({
    kv: input.kv,
    bucket: input.bucket,
    userId: input.userId,
    source: 'github',
    sourceVersion: source.sha,
    provenance: {
      url: githubRepoUrl(repository.owner, repository.repo),
      ref: source.ref,
      path: loaded.skillPath,
    },
    fileName: null,
    files: loaded.files,
    folderName: loaded.folderName,
    archiveWarnings: [...source.warnings, ...loaded.warnings],
    logger: input.logger,
  })
}
