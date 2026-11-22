import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { z } from 'zod'
import {
  SKILL_MAX_PATH_LENGTH,
  SKILL_VIEWER_FILE_MAX_BYTES,
} from '#shared/utils/skills-policy'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import {
  lookupSkillStage,
  readStagedFile,
} from '~~/server/utils/skills/import/stage'
import { requireSkillsSession } from '~~/server/utils/skills/versions/route'

const textDecoder = new TextDecoder()

const querySchema = z.object({
  path: z.string().min(1).max(SKILL_MAX_PATH_LENGTH * 2),
})

function createStageExpiredError() {
  return createError({
    message: 'This import has expired',
    status: 410,
    code: 'stage-expired',
    why: 'Staged files are kept for one hour, and this import is older or '
      + 'was already installed',
    fix: 'Import the skill again',
  })
}

/**
 * One file of an import that is waiting for review, as plain text, so the
 * review screen can show the content the highlights point at before anything
 * is installed. The stage must belong to the signed-in user and the path must
 * be a file the stage's manifest lists, so no other R2 key can be named; the
 * object is read by its content hash. Files over 1 MiB are refused with a
 * reason instead of being sent. The client shows the text as plain text only.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSkillsSession(event)
  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: 'The query needs a file path',
      fix: 'Pass the path of a file of the import as ?path=',
    })
  }

  const { stageId } = getDecodedRouterParams(event)
  const lookup = await lookupSkillStage({
    kv: useKV(),
    userId,
    stageId: stageId ?? '',
  })

  if (lookup.state === 'expired') {
    throw createStageExpiredError()
  }

  if (lookup.state === 'foreign') {
    throw createError({
      message: 'Import not found',
      status: 404,
      code: 'stage-not-found',
      why: 'No import with this id belongs to your account',
      fix: 'Import the skill again',
    })
  }

  const file = lookup.manifest.files.find((candidate) => {
    return candidate.path === query.data.path
  })

  if (!file) {
    throw createError({
      message: 'File not found',
      status: 404,
      code: 'file-not-found',
      why: 'The import has no file at this path',
      fix: 'Pick a file from the list',
    })
  }

  if (file.bytes > SKILL_VIEWER_FILE_MAX_BYTES) {
    throw createError({
      message: 'This file is too large to show',
      status: 413,
      code: 'file-too-large',
      why: 'The review shows files up to 1 MiB',
      fix: 'Read it after installing, in the Files tab',
    })
  }

  const bytes = await readStagedFile({
    bucket: useFileStorage(),
    manifest: lookup.manifest,
    sha256: file.sha256,
  })

  if (!bytes) {
    throw createStageExpiredError()
  }

  return {
    path: file.path,
    bytes: file.bytes,
    kind: file.kind,
    text: textDecoder.decode(bytes),
  }
})
