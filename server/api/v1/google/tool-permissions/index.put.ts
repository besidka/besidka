import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  GOOGLE_SERVICES,
  GOOGLE_TOOL_PERMISSION_MODES,
} from '#shared/utils/google-tool-catalog'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import {
  loadGoogleToolPermissionModes,
  resolveGoogleTargetTools,
  setGoogleToolPermissions,
} from '~~/server/utils/google/tool-permissions'
import {
  requireGoogleToolPermissionsAccess,
  toGoogleToolPermissionEntries,
} from '~~/server/utils/google/tool-permissions-route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const BODY_MAX_BYTES = 1024

const TOOL_NAME_MAX_LENGTH = 64

const modeSchema = z.enum(GOOGLE_TOOL_PERMISSION_MODES)

const bodySchema = z.union([
  z.strictObject({
    tool: z.string().max(TOOL_NAME_MAX_LENGTH),
    mode: modeSchema,
  }),
  z.strictObject({
    service: z.enum(GOOGLE_SERVICES),
    mode: modeSchema,
  }),
])

/**
 * Sets the signed-in user's mode for one Google tool (`{ tool, mode }`) or
 * for every tool of a service they may reach (`{ service, mode }`) and
 * answers with the full list. The mode is "blocked" or "ask" only: "allow"
 * is a 400, as is a name outside the catalog; a tool the user may not reach
 * is a 404. "ask" is the default and deletes the row.
 */
export default defineEventHandler(async (event) => {
  const { userId, reachable } = await requireGoogleToolPermissionsAccess(
    event,
    { write: true },
  )

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: 'The request body does not match the expected fields',
      fix: 'Send a Google tool or service and Blocked or Needs approval',
    })
  }

  const target = 'tool' in body.data
    ? { tool: body.data.tool }
    : { service: body.data.service }
  const reachableNames = new Set(reachable.map(tool => tool.name))
  const targetTools = resolveGoogleTargetTools(target).filter((tool) => {
    return reachableNames.has(tool.name)
  })

  if (!targetTools.length) {
    throw createError({
      message: 'Not found',
      status: 404,
      why: 'This Google tool is not available for this account',
    })
  }

  const changed = await setGoogleToolPermissions(
    userId,
    targetTools,
    body.data.mode,
  )

  useRequestLogger(event).set({
    attributes: {
      google: {
        toolPermission: {
          action: 'set',
          scope: 'tool' in target ? 'tool' : 'service',
          target: 'tool' in target ? target.tool : target.service,
          mode: body.data.mode,
          changed,
        },
      },
    },
  })

  return {
    tools: toGoogleToolPermissionEntries(
      reachable,
      await loadGoogleToolPermissionModes(userId),
    ),
  }
})
