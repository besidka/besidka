import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { MEMORY_PERMISSION_TOOL_NAMES } from '#shared/utils/memory-tool-permissions'
import { TOOL_PERMISSION_MODES } from '#shared/utils/tool-approval-policy'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import {
  listMemoryToolPermissions,
  setMemoryToolPermission,
} from '~~/server/utils/memory/tools/permissions'
import { requireMemoryToolPermissionsAccess } from '~~/server/utils/memory/tools/permissions-route'

const BODY_MAX_BYTES = 1024

const bodySchema = z.strictObject({
  tool: z.enum(MEMORY_PERMISSION_TOOL_NAMES),
  mode: z.enum(TOOL_PERMISSION_MODES),
})

/**
 * Sets the signed-in user's permission mode for `memory_write` or
 * `memory_forget` (`{ tool, mode }`) and answers with both, so the client
 * shows what is stored. One mode covers account and project memory.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireMemoryToolPermissionsAccess(event, {
    write: true,
  })

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: 'The request body does not match the expected fields',
      fix: 'Send one memory tool and a mode',
    })
  }

  await setMemoryToolPermission(userId, body.data.tool, body.data.mode)

  useRequestLogger(event).set({
    attributes: {
      memoryToolPermissions: {
        action: 'permission-set',
        tool: body.data.tool,
        mode: body.data.mode,
      },
    },
  })

  return { tools: await listMemoryToolPermissions(userId) }
})
