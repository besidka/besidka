import { describe, expect, it, vi } from 'vitest'
import type { FeatureDefinition } from '#shared/utils/features/registry'
import type {
  FeatureEvaluationContext,
  FeatureRule,
  FeatureUserState,
} from '~~/server/utils/features/provider'
import {
  evaluateFeature,
  localFeatureProvider,
} from '~~/server/utils/features/evaluate'
import { isExposureDecision } from '~~/server/utils/features/exposure'

const variantFlag = 'experiment-flag'

const definition: FeatureDefinition = {
  key: variantFlag,
  title: 'Experiment',
  description: 'Test entry with variants.',
  stage: 'internal',
  available: true,
  default: false,
  allowRoles: ['admin'],
  spend: 'none',
  optIn: 'none',
  requires: { bindings: [], keyKinds: [] },
  variants: ['wide', 'narrow'],
  exposeToClient: true,
}

vi.mock('#shared/utils/features/registry', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('#shared/utils/features/registry')
  >()

  return {
    ...original,
    getFeatureDefinition: (key: string) => {
      return key === variantFlag ? definition : undefined
    },
  }
})

function createUserState(
  overrides: Partial<FeatureUserState> = {},
): FeatureUserState {
  return {
    userId: 7,
    email: 'user@example.com',
    emailVerified: true,
    twoFactorEnabled: false,
    roles: [],
    grants: {},
    optIns: {},
    ...overrides,
  }
}

function createRule(overrides: Partial<FeatureRule> = {}): FeatureRule {
  return {
    flag: variantFlag,
    enabled: true,
    rolloutBps: 10_000,
    allowRoles: ['tester'],
    variants: [
      { key: 'wide', weightBps: 5000 },
      { key: 'narrow', weightBps: 5000 },
      { key: 'unknown', weightBps: 5000 },
    ],
    salt: 'salt-a',
    ...overrides,
  }
}

function createContext(
  overrides: Partial<FeatureEvaluationContext> = {},
): FeatureEvaluationContext {
  return {
    userState: createUserState(),
    rules: { [variantFlag]: createRule() },
    config: {
      featuresDisabled: '',
      featuresHostMode: 'byok',
      featuresRolloutEnabled: true,
      adminEmails: '',
      requireAdminTwoFactor: false,
    },
    hasBinding: () => true,
    ...overrides,
  }
}

describe('variant split', () => {
  it('splits rollout users by a separate hash', async () => {
    const seen = new Set<string | null>()

    for (let userId = 1; userId <= 40; userId++) {
      const result = await evaluateFeature(variantFlag, createContext({
        userState: createUserState({ userId }),
      }))

      seen.add(result.variant)
      expect(result.reason).toBe('ROLLOUT')
      expect(result.flagMetadata.variantSource).toBe('hash')
      expect(isExposureDecision(result)).toBe(true)
    }

    expect(seen).toEqual(new Set(['wide', 'narrow']))
  })

  it('gives no variant when the bucket is past the total weight', async () => {
    const result = await evaluateFeature(variantFlag, createContext({
      rules: {
        [variantFlag]: createRule({
          variants: [{ key: 'wide', weightBps: 0 }],
        }),
      },
    }))

    expect(result).toMatchObject({ value: true, variant: null })
  })

  it('gives role and grant results no hash variant (C1)', async () => {
    const role = await evaluateFeature(variantFlag, createContext({
      userState: createUserState({ roles: ['tester'] }),
    }))
    const grant = await evaluateFeature(variantFlag, createContext({
      userState: createUserState({
        grants: { [variantFlag]: { effect: 'allow', variant: null } },
      }),
    }))

    expect(role).toMatchObject({ reason: 'ROLE', variant: null })
    expect(grant).toMatchObject({ reason: 'ALLOW_GRANT', variant: null })
    expect(isExposureDecision(role)).toBe(false)
    expect(isExposureDecision(grant)).toBe(false)
  })

  it('lets a grant force a registry variant', async () => {
    const result = await evaluateFeature(variantFlag, createContext({
      userState: createUserState({
        grants: { [variantFlag]: { effect: 'allow', variant: 'narrow' } },
      }),
    }))

    expect(result).toMatchObject({
      value: true,
      variant: 'narrow',
      reason: 'ALLOW_GRANT',
      flagMetadata: { variantSource: 'grant' },
    })
    expect(isExposureDecision(result)).toBe(false)
  })

  it('ignores a forced variant the registry does not know', async () => {
    const result = await evaluateFeature(variantFlag, createContext({
      userState: createUserState({
        grants: { [variantFlag]: { effect: 'allow', variant: 'unknown' } },
      }),
    }))

    expect(result).toMatchObject({ value: true, variant: null })
  })

  it('assigns nothing while rollouts are disabled (C2)', async () => {
    const context = createContext()
    const result = await evaluateFeature(variantFlag, {
      ...context,
      config: { ...context.config, featuresRolloutEnabled: false },
    })

    expect(result).toMatchObject({
      value: false,
      variant: null,
      reason: 'DEFAULT',
    })
  })

  it('assigns nothing to an objecting user (C3)', async () => {
    const result = await evaluateFeature(variantFlag, createContext({
      userState: createUserState({
        optIns: {
          experiments: { optedInAt: null, optedOutAt: new Date() },
        },
      }),
    }))

    expect(result).toMatchObject({
      value: false,
      variant: null,
      reason: 'DEFAULT',
    })
  })

  it('returns the variant from the string resolver', async () => {
    const result = await localFeatureProvider.resolveString(
      variantFlag,
      createContext({
        userState: createUserState({
          grants: { [variantFlag]: { effect: 'allow', variant: 'wide' } },
        }),
      }),
    )

    expect(result.value).toBe('wide')
  })
})
