import type { FeatureResolution } from '~~/server/utils/features/provider'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const FEATURE_EXPOSURE_EVENT = 'feature_exposure'

interface ExposureSink {
  writeDataPoint: AnalyticsEngineDataset['writeDataPoint']
}

export interface RecordFeatureExposureInput {
  flag: string
  resolution: FeatureResolution
  recorded: Set<string>
  analytics: ExposureSink | null
  logger?: LoggerLike
}

export function isExposureDecision(resolution: FeatureResolution): boolean {
  if (resolution.flagMetadata.decidedBy) {
    return false
  }

  return resolution.reason === 'ROLLOUT'
}

/**
 * Records that a hash-based decision was shown: a rollout and the hash
 * variant split, which the evaluator only runs on rollout results,
 * at most once per flag per request. Analytics Engine gets the event name,
 * flag, variant and reason only: no bucket, no path, no user id (pre-check
 * C1). Axiom gets the same fields on the request's wide event, which already
 * carries the user id. Grant, role, default and anonymous results are never
 * recorded.
 */
export function recordFeatureExposure(
  input: RecordFeatureExposureInput,
): boolean {
  const { flag, resolution, recorded } = input

  if (!isExposureDecision(resolution) || recorded.has(flag)) {
    return false
  }

  recorded.add(flag)

  const variant = resolution.variant ?? ''

  try {
    input.analytics?.writeDataPoint({
      blobs: [FEATURE_EXPOSURE_EVENT, flag, variant, resolution.reason],
    })
  } catch (exception) {
    input.logger?.set({
      attributes: {
        featureExposure: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  input.logger?.set({
    attributes: {
      features: {
        [flag]: {
          value: resolution.value,
          variant: resolution.variant,
          reason: resolution.reason,
        },
      },
    },
  })

  return true
}
