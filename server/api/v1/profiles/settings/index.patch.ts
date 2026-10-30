import { createError } from 'evlog'
import type { GatewayId } from '#shared/types/gateways.d'
import { jevRoleSettingsPatchSchema } from '#shared/utils/jev-schemas'
import {
  defaultReasoningLevelSchema,
  favoriteGatewayModelsSchema,
  favoriteModelIdsSchema,
} from '#shared/utils/user-settings-schemas'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import {
  memorySettingsPatchShape,
  refineMemorySettingsPatch,
} from '#shared/utils/memory-schemas'
import { enforceGatewayModelsRateLimit } from '~~/server/utils/gateways/catalog-rate-limit'
import { assertMemoryModelChoice } from '~~/server/utils/memory/validate-model-choice'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import {
  applyUserSettingsUpdate,
  dedupeFavoriteGatewayModels,
} from '~~/server/utils/settings/apply-user-settings'
import type {
  UserSettingsFieldUpdates,
} from '~~/server/utils/settings/apply-user-settings'

const memoryModelScopes = [
  {
    modelKey: 'profileMemoryModel',
    gatewayKey: 'profileMemoryGateway',
  },
  {
    modelKey: 'projectMemoryModel',
    gatewayKey: 'projectMemoryGateway',
  },
] as const

interface MemoryModelChoiceToValidate {
  model: string
  gateway: GatewayId | null
}

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    reasoningExpanded: z.boolean().optional(),
    reasoningAutoHide: z.boolean().optional(),
    defaultReasoningLevel: defaultReasoningLevelSchema.optional(),
    allowExternalLinks: z.boolean().nullable().optional(),
    notificationPromptState: z.boolean().nullable().optional(),
    sidebarPinned: z.boolean().optional(),
    favoriteModels: favoriteModelIdsSchema.optional(),
    favoriteGatewayModels: favoriteGatewayModelsSchema.optional(),
    typesafeRoles: jevRoleSettingsPatchSchema.nullable().optional(),
    ...memorySettingsPatchShape,
  }).superRefine(refineMemorySettingsPatch).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const logger = useRequestLogger(event)

  const fieldUpdates: UserSettingsFieldUpdates = {}

  if (body.data.reasoningExpanded !== undefined) {
    fieldUpdates.reasoningExpanded = body.data.reasoningExpanded
  }

  if (body.data.reasoningAutoHide !== undefined) {
    fieldUpdates.reasoningAutoHide = body.data.reasoningAutoHide
  }

  if ('defaultReasoningLevel' in body.data) {
    fieldUpdates.defaultReasoningLevel
      = body.data.defaultReasoningLevel ?? null
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
    fieldUpdates.favoriteGatewayModels = dedupeFavoriteGatewayModels(
      body.data.favoriteGatewayModels,
    )
  }

  if (body.data.memoryEnabled !== undefined) {
    fieldUpdates.memoryEnabled = body.data.memoryEnabled
  }

  if (body.data.memoryExtractionEnabled !== undefined) {
    fieldUpdates.memoryExtractionEnabled = body.data.memoryExtractionEnabled
  }

  if (body.data.chatSearchEnabled !== undefined) {
    fieldUpdates.chatSearchEnabled = body.data.chatSearchEnabled
  }

  if (body.data.aboutMe === null) {
    fieldUpdates.aboutMe = null
  }

  if (body.data.typesafeRoles !== undefined) {
    fieldUpdates.typesafeRoles = body.data.typesafeRoles
  }

  const memoryModelChoices: MemoryModelChoiceToValidate[] = []

  for (const { modelKey, gatewayKey } of memoryModelScopes) {
    const model = body.data[modelKey]
    const gateway = body.data[gatewayKey]

    if (gateway !== undefined && model === undefined) {
      throw createError({
        message: 'Invalid request body',
        status: 400,
        why: `${gatewayKey} was sent without ${modelKey}.`,
        fix: `Send ${modelKey} together with its gateway.`,
      })
    }

    if (model === undefined) {
      continue
    }

    fieldUpdates[modelKey] = model
    fieldUpdates[gatewayKey] = model === null ? null : (gateway ?? null)

    if (model !== null) {
      memoryModelChoices.push({
        model,
        gateway: gateway ?? null,
      })
    }
  }

  if (Object.keys(fieldUpdates).length === 0) {
    throw createError({
      message: 'No fields to update',
      status: 400,
    })
  }

  for (const { model, gateway } of memoryModelChoices) {
    if (gateway !== null) {
      await enforceGatewayModelsRateLimit(event, session.user.id)
    }

    await assertMemoryModelChoice({ userId, model, gateway, logger })
  }

  await applyUserSettingsUpdate({ db, userId, fieldUpdates })

  return fieldUpdates
})
