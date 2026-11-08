import { describe, expect, it, vi } from 'vitest'
import type { FeatureResolution } from '~~/server/utils/features/provider'
import {
  isExposureDecision,
  recordFeatureExposure,
} from '~~/server/utils/features/exposure'

function createResolution(
  overrides: Partial<FeatureResolution> = {},
): FeatureResolution {
  return {
    value: true,
    variant: null,
    reason: 'ROLLOUT',
    bucket: 1234,
    flagMetadata: {},
    ...overrides,
  }
}

function createSinks() {
  return {
    analytics: { writeDataPoint: vi.fn() },
    logger: { set: vi.fn() },
  }
}

describe('recordFeatureExposure', () => {
  it('writes only the event name, flag, variant and reason (C1)', () => {
    const { analytics, logger } = createSinks()

    recordFeatureExposure({
      flag: 'artifacts',
      resolution: createResolution({
        variant: 'wide',
        flagMetadata: { variantSource: 'hash' },
      }),
      recorded: new Set(),
      analytics,
      logger,
    })

    expect(analytics.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      blobs: ['feature_exposure', 'artifacts', 'wide', 'ROLLOUT'],
    })
    expect(logger.set).toHaveBeenCalledExactlyOnceWith({
      attributes: {
        features: {
          artifacts: { value: true, variant: 'wide', reason: 'ROLLOUT' },
        },
      },
    })
  })

  it('never sends the bucket, a user id or indexes', () => {
    const { analytics, logger } = createSinks()

    recordFeatureExposure({
      flag: 'artifacts',
      resolution: createResolution({ bucket: 7 }),
      recorded: new Set(),
      analytics,
      logger,
    })

    const dataPoint = analytics.writeDataPoint.mock.calls[0]![0]

    expect(dataPoint).not.toHaveProperty('doubles')
    expect(dataPoint).not.toHaveProperty('indexes')
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('bucket')
  })

  it('fires at most once per flag per request', () => {
    const { analytics, logger } = createSinks()
    const recorded = new Set<string>()

    for (let attempt = 0; attempt < 3; attempt++) {
      recordFeatureExposure({
        flag: 'artifacts',
        resolution: createResolution(),
        recorded,
        analytics,
        logger,
      })
    }

    recordFeatureExposure({
      flag: 'documents',
      resolution: createResolution(),
      recorded,
      analytics,
      logger,
    })

    expect(analytics.writeDataPoint).toHaveBeenCalledTimes(2)
  })

  it('skips grant, role, default and anonymous results', () => {
    const { analytics, logger } = createSinks()

    for (const reason of [
      'ALLOW_GRANT',
      'ROLE',
      'DEFAULT',
      'ANONYMOUS',
      'DENY_GRANT',
    ] as const) {
      recordFeatureExposure({
        flag: `flag-${reason}`,
        resolution: createResolution({ reason }),
        recorded: new Set(),
        analytics,
        logger,
      })
    }

    expect(analytics.writeDataPoint).not.toHaveBeenCalled()
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('records only rollout decisions, never role or forced variants', () => {
    expect(isExposureDecision(createResolution({
      reason: 'ROLE',
      variant: 'wide',
      flagMetadata: { variantSource: 'hash' },
    }))).toBe(false)
    expect(isExposureDecision(createResolution({
      reason: 'ALLOW_GRANT',
      variant: 'wide',
      flagMetadata: { variantSource: 'grant' },
    }))).toBe(false)
    expect(isExposureDecision(createResolution({
      value: false,
      flagMetadata: { decidedBy: 'artifacts' },
    }))).toBe(false)
  })

  it('keeps going when Analytics Engine is missing or throws', () => {
    const logger = { set: vi.fn() }

    expect(recordFeatureExposure({
      flag: 'artifacts',
      resolution: createResolution(),
      recorded: new Set(),
      analytics: null,
      logger,
    })).toBe(true)

    expect(recordFeatureExposure({
      flag: 'artifacts',
      resolution: createResolution(),
      recorded: new Set(),
      analytics: {
        writeDataPoint: vi.fn(() => {
          throw new Error('ae down')
        }),
      },
      logger,
    })).toBe(true)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { featureExposure: { error: 'ae down' } },
    })
  })
})
