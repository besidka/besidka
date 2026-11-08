import type { LabsFeature, LabsPayload } from '#shared/types/features.d'
import type { FeatureKey } from '#shared/utils/features/registry'
import { defineEventHandler } from 'nuxt/server'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  isFeatureKey,
} from '#shared/utils/features/registry'
import { useFeatureContext } from '~~/server/utils/features/context'
import {
  evaluateFeature,
  hasObjectedToExperiments,
  isActiveOptIn,
  isFeatureActive,
} from '~~/server/utils/features/evaluate'

const labsFeatureKeys = FEATURE_KEYS.filter((key) => {
  return FEATURE_REGISTRY[key].exposeToClient
})

function toParentKey(parent: string | undefined): FeatureKey | null {
  return parent && isFeatureKey(parent) ? parent : null
}

export default defineEventHandler(async (event) => {
  event.res.headers.set('Cache-Control', 'private, no-store')

  const context = await useFeatureContext(event)

  if (context.userId === null) {
    return useUnauthorizedError()
  }

  const features: LabsFeature[] = []

  for (const key of labsFeatureKeys) {
    const resolution = await evaluateFeature(key, context)

    if (!resolution.value) {
      continue
    }

    const definition = FEATURE_REGISTRY[key]

    features.push({
      key,
      title: definition.title,
      description: definition.description,
      stage: definition.stage,
      spend: definition.spend,
      optIn: definition.optIn,
      requires: { keyKinds: [...definition.requires.keyKinds] },
      parent: toParentKey(definition.parent),
      optedIn: isActiveOptIn(context.userState?.optIns[key]),
      active: isFeatureActive(key, resolution, context.userState),
    })
  }

  const payload: LabsPayload = {
    features,
    objectedToExperiments: hasObjectedToExperiments(context.userState),
  }

  return payload
})
