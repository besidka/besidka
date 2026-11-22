import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  BESIDKA_TOOL_NAME_PATTERN,
  BESIDKA_TOOL_TIERS,
} from '#shared/utils/besidka-tool-permissions'
import { TOOL_PERMISSION_MODES } from '#shared/utils/tool-approval-policy'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import {
  listBesidkaToolPermissions,
  setBesidkaToolPermissions,
} from '~~/server/utils/besidka-tools/permissions'
import { requireBesidkaToolsAccess } from '~~/server/utils/besidka-tools/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const BODY_MAX_BYTES = 1024

const modeSchema = z.enum(TOOL_PERMISSION_MODES)

const bodySchema = z.union([
  z.strictObject({
    tool: z.string().regex(BESIDKA_TOOL_NAME_PATTERN),
    mode: modeSchema,
  }),
  z.strictObject({
    tier: z.enum(BESIDKA_TOOL_TIERS),
    mode: modeSchema,
  }),
])

/**
 * Sets the signed-in user's permission mode for one Besidka tool
 * (`{ tool, mode }`) or for every tool of a group (`{ tier, mode }`) and
 * answers with the full list, so the client shows what is stored. The
 * ask-every-time tier refuses "allow". Validated against the registry only.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireBesidkaToolsAccess(event, { write: true })

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: 'The request body does not match the expected fields',
      fix: 'Send a tool or a group and a mode',
    })
  }

  const target = 'tool' in body.data
    ? { tool: body.data.tool }
    : { tier: body.data.tier }
  const changed = await setBesidkaToolPermissions(
    userId,
    target,
    body.data.mode,
  )

  useRequestLogger(event).set({
    attributes: {
      besidkaTools: {
        action: 'permissions-set',
        scope: 'tool' in target ? 'tool' : 'tier',
        target: 'tool' in target ? target.tool : target.tier,
        mode: body.data.mode,
        changed,
      },
    },
  })

  return { tools: await listBesidkaToolPermissions(userId) }
})
