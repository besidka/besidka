import { z } from 'zod'
import { reasoningLevels } from '#shared/utils/reasoning'

export const FAVORITE_MODELS_MAX_COUNT = 50
export const FAVORITE_MODEL_ID_MAX_CHARS = 100

export const favoriteModelIdsSchema = z
  .array(z.string().max(FAVORITE_MODEL_ID_MAX_CHARS))
  .max(FAVORITE_MODELS_MAX_COUNT)

export const favoriteGatewayModelsSchema = z.object({
  vercel: favoriteModelIdsSchema.optional(),
  cloudflare: favoriteModelIdsSchema.optional(),
  openrouter: favoriteModelIdsSchema.optional(),
})

export const defaultReasoningLevelSchema = z.enum(reasoningLevels).nullable()
