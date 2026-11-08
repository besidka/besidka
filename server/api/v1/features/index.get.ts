import type {
  ClientFeaturesPayload,
  ClientFeatureState,
} from '#shared/types/features.d'
import type { FeatureKey } from '#shared/utils/features/registry'
import { defineEventHandler } from 'nuxt/server'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
} from '#shared/utils/features/registry'
import { useFeatureContext } from '~~/server/utils/features/context'
import {
  evaluateFeature,
  isFeatureActive,
} from '~~/server/utils/features/evaluate'

const clientFeatureKeys = FEATURE_KEYS.filter((key) => {
  return FEATURE_REGISTRY[key].exposeToClient
})

export default defineEventHandler(async (event) => {
  event.res.headers.set('Cache-Control', 'private, no-store')

  const context = await useFeatureContext(event)
  const features: Partial<Record<FeatureKey, ClientFeatureState>> = {}

  for (const key of clientFeatureKeys) {
    const resolution = await evaluateFeature(key, context)

    features[key] = {
      enabled: resolution.value,
      active: isFeatureActive(key, resolution, context.userState),
      variant: resolution.value ? resolution.variant : null,
    }
  }

  const payload: ClientFeaturesPayload = {
    features,
    isAdmin: context.isAdmin,
  }

  return payload
})
