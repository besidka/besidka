import type { GatewayId } from '#shared/types/gateways.d'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const favoriteGatewayModelIds = z.array(z.string().max(100)).max(50)

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    reasoningExpanded: z.boolean().optional(),
    reasoningAutoHide: z.boolean().optional(),
    allowExternalLinks: z.boolean().nullable().optional(),
    notificationPromptState: z.boolean().nullable().optional(),
    sidebarPinned: z.boolean().optional(),
    favoriteModels: z.array(z.string().max(100)).max(50).optional(),
    favoriteGatewayModels: z.object({
      vercel: favoriteGatewayModelIds.optional(),
      cloudflare: favoriteGatewayModelIds.optional(),
      openrouter: favoriteGatewayModelIds.optional(),
    }).optional(),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const existingSettings = await db.query.userSettings.findFirst({
    where: {
      userId,
    },
    columns: {
      id: true,
    },
  })

  const fieldUpdates: {
    reasoningExpanded?: boolean
    reasoningAutoHide?: boolean
    allowExternalLinks?: boolean | null
    notificationPromptState?: boolean | null
    sidebarPinned?: boolean
    favoriteModels?: string[]
    favoriteGatewayModels?: Partial<Record<GatewayId, string[]>>
  } = {}

  if (body.data.reasoningExpanded !== undefined) {
    fieldUpdates.reasoningExpanded = body.data.reasoningExpanded
  }

  if (body.data.reasoningAutoHide !== undefined) {
    fieldUpdates.reasoningAutoHide = body.data.reasoningAutoHide
  }

  if ('allowExternalLinks' in body.data) {
    fieldUpdates.allowExternalLinks = body.data.allowExternalLinks ?? null
  }

  if ('notificationPromptState' in body.data) {
    fieldUpdates.notificationPromptState
      = body.data.notificationPromptState ?? null
  }

  if (body.data.sidebarPinned !== undefined) {
    fieldUpdates.sidebarPinned = body.data.sidebarPinned
  }

  if (body.data.favoriteModels !== undefined) {
    fieldUpdates.favoriteModels = [...new Set(body.data.favoriteModels)]
  }

  if (body.data.favoriteGatewayModels !== undefined) {
    const deduped: Partial<Record<GatewayId, string[]>> = {}

    for (const [gatewayId, modelIds] of Object.entries(
      body.data.favoriteGatewayModels,
    )) {
      if (!modelIds) {
        continue
      }

      deduped[gatewayId as GatewayId] = [...new Set(modelIds)]
    }

    fieldUpdates.favoriteGatewayModels = deduped
  }

  if (Object.keys(fieldUpdates).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No fields to update',
    })
  }

  if (existingSettings) {
    await db.update(schema.userSettings).set(fieldUpdates)
      .where(eq(schema.userSettings.userId, userId))
  } else {
    await db.insert(schema.userSettings).values({
      userId,
      ...fieldUpdates,
    })
  }

  return fieldUpdates
})
