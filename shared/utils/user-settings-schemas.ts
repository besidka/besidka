import { z } from 'zod'
import { getLegalNoticeById } from '#shared/utils/legal-notices'
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

export const LEGAL_NOTICE_ID_MAX_CHARS = 100
export const LEGAL_NOTICE_IDS_MAX_COUNT = 20

export const dismissLegalNoticeIdsSchema = z
  .array(z.string().max(LEGAL_NOTICE_ID_MAX_CHARS))
  .min(1)
  .max(LEGAL_NOTICE_IDS_MAX_COUNT)
  .refine((noticeIds) => {
    return noticeIds.every((noticeId) => {
      return getLegalNoticeById(noticeId) !== null
    })
  }, { message: 'Unknown legal notice id' })
