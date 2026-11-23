import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  GOOGLE_SERVICES,
  GOOGLE_TOOL_PERMISSION_MODES,
} from '#shared/utils/google-tool-catalog'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { GOOGLE_TOOL_KINDS } from '#shared/utils/google-tool-approvals'
import { enforceGoogleRateLimit } from '~~/server/utils/google/route'
import {
  loadGoogleToolPermissionModes,
  partitionGoogleToolsForMode,
  resolveGoogleTargetTools,
  setGoogleToolPermissions,
} from '~~/server/utils/google/tool-permissions'
import type {
  GoogleToolPermissionTarget,
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
  z.strictObject({
    service: z.enum(GOOGLE_SERVICES),
    kind: z.enum(GOOGLE_TOOL_KINDS),
    mode: modeSchema,
  }),
])

function describeTarget(
  target: GoogleToolPermissionTarget,
): { scope: string, name: string } {
  if ('tool' in target) {
    return { scope: 'tool', name: target.tool }
  }

  if ('kind' in target) {
    return { scope: 'kind', name: `${target.service}:${target.kind}` }
  }

  return { scope: 'service', name: target.service }
}

/**
 * Sets the signed-in user's mode for one Google tool (`{ tool, mode }`) or
 * for every tool of a service they may reach (`{ service, mode }`), or for
 * the read or write tools of a service (`{ service, kind, mode }`), and
 * answers with the full list and `unchanged`, the names a group request left
 * as they were. "allow" (Always allow) applies only to a tool that can be
 * always allowed (`isGoogleToolAlwaysAllowable`): for one other tool it is a
 * 400, and a group request applies it to the members that take it and
 * leaves the rest unchanged (a 400 when none takes it). A name outside the
 * catalog is a 400; a tool the user may not reach is a 404. "ask" is the
 * default and deletes the row.
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
      fix: 'Send a Google tool or service and a mode',
    })
  }

  const target: GoogleToolPermissionTarget = 'tool' in body.data
    ? { tool: body.data.tool }
    : 'kind' in body.data
      ? { service: body.data.service, kind: body.data.kind }
      : { service: body.data.service }
  const described = describeTarget(target)
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

  const { applied, unchanged } = partitionGoogleToolsForMode(
    targetTools,
    body.data.mode,
  )

  if (!applied.length) {
    throw createError({
      message: 'Invalid permission',
      status: 400,
      why: 'Always allow is not available for this Google tool',
      fix: 'Pick Needs approval or Blocked',
    })
  }

  await enforceGoogleRateLimit(
    event,
    userId,
    'permission',
    `${described.scope}:${described.name}`,
  )

  const changed = await setGoogleToolPermissions(
    userId,
    applied,
    body.data.mode,
  )

  useRequestLogger(event).set({
    attributes: {
      google: {
        toolPermission: {
          action: 'set',
          scope: described.scope,
          target: described.name,
          mode: body.data.mode,
          changed,
          unchanged: unchanged.length,
        },
      },
    },
  })

  return {
    tools: toGoogleToolPermissionEntries(
      reachable,
      await loadGoogleToolPermissionModes(userId),
    ),
    unchanged: unchanged.map(tool => tool.name),
  }
})
