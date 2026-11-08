import { describe, expect, it, vi } from 'vitest'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'
import type {
  FeatureEvaluationConfig,
  FeatureEvaluationContext,
  FeatureRule,
  FeatureUserState,
} from '~~/server/utils/features/provider'
import {
  computeFeatureBucket,
  evaluateFeature,
  FEATURE_RULES_CACHE_KEY,
  getFeatureEvaluationConfig,
  hasObjectedToExperiments,
  isAdminUser,
  isFeatureActive,
  isFeatureToggledOn,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { markAllFeaturesAvailable } from '../../../../setup/helpers/features-available'

await markAllFeaturesAvailable()

const baseConfig: FeatureEvaluationConfig = {
  featuresDisabled: '',
  featuresHostMode: 'byok',
  featuresRolloutEnabled: true,
  adminEmails: 'owner@example.com',
  requireAdminTwoFactor: false,
}

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
    flag: 'artifacts',
    enabled: true,
    rolloutBps: 0,
    allowRoles: null,
    variants: null,
    salt: 'salt-a',
    ...overrides,
  }
}

function createContext(
  overrides: Partial<FeatureEvaluationContext> = {},
): FeatureEvaluationContext {
  return {
    userState: createUserState(),
    rules: {},
    config: baseConfig,
    hasBinding: () => true,
    ...overrides,
  }
}

const adminState = createUserState({
  email: 'owner@example.com',
  emailVerified: true,
})

describe('evaluateFeature precedence', () => {
  it('1. unknown flag is off', async () => {
    const result = await evaluateFeature(
      'unknown.flag',
      createContext({ userState: adminState }),
    )

    expect(result).toMatchObject({ value: false, reason: 'UNKNOWN' })
  })

  it('2. the kill switch wins over admins and allow grants', async () => {
    const userState = createUserState({
      ...adminState,
      grants: { artifacts: { effect: 'allow', variant: null } },
    })

    for (const featuresDisabled of ['*', 'documents, ARTIFACTS']) {
      const result = await evaluateFeature('artifacts', createContext({
        userState,
        config: { ...baseConfig, featuresDisabled },
      }))

      expect(result).toMatchObject({ value: false, reason: 'KILL_SWITCH' })
    }
  })

  it('3. host mode off turns every feature off', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: adminState,
      config: { ...baseConfig, featuresHostMode: 'off' },
    }))

    expect(result).toMatchObject({ value: false, reason: 'HOST_MODE' })
  })

  it('4. a disabled rule wins over grants and roles', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: createUserState({
        ...adminState,
        grants: { artifacts: { effect: 'allow', variant: null } },
      }),
      rules: { artifacts: createRule({ enabled: false }) },
    }))

    expect(result).toMatchObject({ value: false, reason: 'DISABLED' })
  })

  it('5. a signed-out caller gets the registry default', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: null,
      rules: { artifacts: createRule({ rolloutBps: 10_000 }) },
    }))

    expect(result).toMatchObject({ value: false, reason: 'ANONYMOUS' })
  })

  it('6. a deny grant wins over an admin role', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: createUserState({
        ...adminState,
        grants: { artifacts: { effect: 'deny', variant: null } },
      }),
    }))

    expect(result).toMatchObject({ value: false, reason: 'DENY_GRANT' })
  })

  it('7. an allow grant turns the feature on for a normal user', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: createUserState({
        grants: { artifacts: { effect: 'allow', variant: null } },
      }),
    }))

    expect(result).toMatchObject({ value: true, reason: 'ALLOW_GRANT' })
  })

  it('8. a rule allow list can leave admins out', async () => {
    await expect(evaluateFeature('artifacts', createContext({
      userState: adminState,
      rules: { artifacts: createRule({ allowRoles: ['tester'] }) },
    }))).resolves.toMatchObject({ value: false, reason: 'DEFAULT' })
  })

  it('8. a role in the rule or registry allow list turns it on', async () => {
    const tester = createUserState({ roles: ['tester'] })

    await expect(evaluateFeature('artifacts', createContext({
      userState: tester,
    }))).resolves.toMatchObject({ value: false, reason: 'DEFAULT' })
    await expect(evaluateFeature('artifacts', createContext({
      userState: tester,
      rules: { artifacts: createRule({ allowRoles: ['tester'] }) },
    }))).resolves.toMatchObject({ value: true, reason: 'ROLE' })
    await expect(evaluateFeature('artifacts', createContext({
      userState: adminState,
    }))).resolves.toMatchObject({ value: true, reason: 'ROLE' })
  })

  it('9. a full rollout turns it on with the bucket', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      rules: { artifacts: createRule({ rolloutBps: 10_000 }) },
    }))

    expect(result.value).toBe(true)
    expect(result.reason).toBe('ROLLOUT')
    expect(result.bucket).toBeTypeOf('number')
  })

  it('10. otherwise the registry default applies', async () => {
    const result = await evaluateFeature('artifacts', createContext())

    expect(result).toMatchObject({ value: false, reason: 'DEFAULT' })
  })

  it('ignores the rollout while rollouts are disabled (C2)', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      rules: { artifacts: createRule({ rolloutBps: 10_000 }) },
      config: { ...baseConfig, featuresRolloutEnabled: false },
    }))

    expect(result).toMatchObject({ value: false, reason: 'DEFAULT' })
  })

  it('skips the rollout for a user who objected (C3)', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: createUserState({
        optIns: {
          experiments: { optedInAt: null, optedOutAt: new Date() },
        },
      }),
      rules: { artifacts: createRule({ rolloutBps: 10_000 }) },
    }))

    expect(result).toMatchObject({ value: false, reason: 'DEFAULT' })
  })

  it('keeps grants and roles working for an objecting user (C3)', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: createUserState({
        grants: { artifacts: { effect: 'allow', variant: null } },
        optIns: {
          experiments: { optedInAt: null, optedOutAt: new Date() },
        },
      }),
    }))

    expect(result).toMatchObject({ value: true, reason: 'ALLOW_GRANT' })
  })
})

describe('parent and child flags', () => {
  it('turns a child off when its parent is off', async () => {
    const result = await evaluateFeature('artifacts.react', createContext({
      userState: createUserState({
        grants: { 'artifacts.react': { effect: 'allow', variant: null } },
      }),
    }))

    expect(result).toMatchObject({
      value: false,
      reason: 'DEFAULT',
      flagMetadata: { decidedBy: 'artifacts' },
    })
  })

  it('keeps a child on when its parent is on', async () => {
    const result = await evaluateFeature('artifacts.react', createContext({
      userState: adminState,
    }))

    expect(result).toMatchObject({ value: true, reason: 'ROLE' })
  })

  it('reports the kill-switched parent as the reason', async () => {
    const result = await evaluateFeature('artifacts.react', createContext({
      userState: adminState,
      config: { ...baseConfig, featuresDisabled: 'artifacts' },
    }))

    expect(result).toMatchObject({
      value: false,
      reason: 'KILL_SWITCH',
      flagMetadata: { decidedBy: 'artifacts' },
    })
  })
})

describe('admin detection', () => {
  it('accepts a verified env admin email, case-insensitively', () => {
    expect(isAdminUser(createUserState({
      email: 'Owner@Example.com',
    }), { ...baseConfig, adminEmails: ' owner@example.com ,x@y.z' }))
      .toBe(true)
  })

  it('rejects an env admin email that is not verified, even in dev', () => {
    expect(isAdminUser(createUserState({
      email: 'owner@example.com',
      emailVerified: false,
    }), baseConfig)).toBe(false)
  })

  it('rejects an account changed to an admin address without verifying (C13)', () => {
    const changedEmail = createUserState({
      email: 'owner@example.com',
      emailVerified: false,
      roles: ['tester'],
    })

    expect(isAdminUser(changedEmail, baseConfig)).toBe(false)
  })

  it('accepts an admin role row with a verified email', () => {
    expect(isAdminUser(createUserState({ roles: ['admin'] }), baseConfig))
      .toBe(true)
    expect(isAdminUser(createUserState({
      roles: ['admin'],
      emailVerified: false,
    }), baseConfig)).toBe(false)
  })

  it('requires 2FA for every admin when the config asks for it (C13b)', () => {
    const config = { ...baseConfig, requireAdminTwoFactor: true }

    expect(isAdminUser(adminState, config)).toBe(false)
    expect(isAdminUser(createUserState({ roles: ['admin'] }), config))
      .toBe(false)
    expect(isAdminUser({ ...adminState, twoFactorEnabled: true }, config))
      .toBe(true)
  })

  it('does not grant the admin role without 2FA in production', async () => {
    const result = await evaluateFeature('artifacts', createContext({
      userState: adminState,
      config: { ...baseConfig, requireAdminTwoFactor: true },
    }))

    expect(result).toMatchObject({ value: false, reason: 'DEFAULT' })
  })

  it('is false when signed out', () => {
    expect(isAdminUser(null, baseConfig)).toBe(false)
  })
})

describe('rollout buckets', () => {
  it('keeps the pinned bucket for a known input', async () => {
    await expect(computeFeatureBucket('artifacts:salt-a:7'))
      .resolves.toBe(1761)
  })

  it('is stable for the same flag, salt and user', async () => {
    const first = await computeFeatureBucket('artifacts:salt-a:7')
    const second = await computeFeatureBucket('artifacts:salt-a:7')

    expect(first).toBe(second)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(10_000)
  })

  it('reshuffles when the salt changes', async () => {
    const userIds = Array.from({ length: 50 }, (_value, index) => index + 1)
    const withSaltA = await Promise.all(userIds.map((userId) => {
      return computeFeatureBucket(`artifacts:salt-a:${userId}`)
    }))
    const withSaltB = await Promise.all(userIds.map((userId) => {
      return computeFeatureBucket(`artifacts:salt-b:${userId}`)
    }))
    const unchanged = withSaltA.filter((bucket, index) => {
      return bucket === withSaltB[index]
    })

    expect(unchanged.length).toBeLessThan(3)
  })

  it('puts 25% ± 1.5% of 10,000 users in a 2500 bps rollout', async () => {
    const rules = { artifacts: createRule({ rolloutBps: 2500 }) }
    let enabledCount = 0

    for (let userId = 1; userId <= 10_000; userId++) {
      const result = await evaluateFeature('artifacts', createContext({
        userState: createUserState({ userId }),
        rules,
      }))

      if (result.value) {
        enabledCount++
      }
    }

    expect(enabledCount / 10_000).toBeGreaterThanOrEqual(0.235)
    expect(enabledCount / 10_000).toBeLessThanOrEqual(0.265)
  })
})

describe('active state and objections', () => {
  it('needs an active opt-in for a spending feature', () => {
    const on = { value: true }
    const optedIn = new Date('2026-11-01T00:00:00Z')
    const optedOut = new Date('2026-11-02T00:00:00Z')

    expect(isFeatureActive('research.custom', on, createUserState()))
      .toBe(false)
    expect(isFeatureActive('research.custom', on, createUserState({
      optIns: {
        'research.custom': { optedInAt: optedIn, optedOutAt: null },
      },
    }))).toBe(true)
    expect(isFeatureActive('research.custom', on, createUserState({
      optIns: {
        'research.custom': { optedInAt: optedIn, optedOutAt: optedOut },
      },
    }))).toBe(false)
    expect(isFeatureActive('artifacts', on, createUserState())).toBe(true)
    expect(isFeatureActive('research.custom.max', on, createUserState({
      optIns: {
        'research.custom.max': { optedInAt: optedIn, optedOutAt: null },
      },
    }))).toBe(false)
    expect(isFeatureActive('research.custom.max', on, createUserState({
      optIns: {
        'research.custom': { optedInAt: optedIn, optedOutAt: null },
        'research.custom.max': { optedInAt: optedIn, optedOutAt: null },
      },
    }))).toBe(true)
    expect(isFeatureActive('artifacts', { value: false }, createUserState()))
      .toBe(false)
  })

  it('treats a newer experiments opt-in as withdrawing the objection', () => {
    expect(hasObjectedToExperiments(createUserState({
      optIns: {
        experiments: {
          optedInAt: new Date('2026-11-03T00:00:00Z'),
          optedOutAt: new Date('2026-11-02T00:00:00Z'),
        },
      },
    }))).toBe(false)
    expect(hasObjectedToExperiments(null)).toBe(false)
  })

  it('treats a later objection or a tie as objecting', () => {
    const optedIn = new Date('2026-11-02T00:00:00Z')

    expect(hasObjectedToExperiments(createUserState({
      optIns: {
        experiments: {
          optedInAt: optedIn,
          optedOutAt: new Date('2026-11-03T00:00:00Z'),
        },
      },
    }))).toBe(true)
    expect(hasObjectedToExperiments(createUserState({
      optIns: {
        experiments: { optedInAt: optedIn, optedOutAt: optedIn },
      },
    }))).toBe(true)
  })
})

describe('opt-out and availability', () => {
  const on = { value: true }
  const earlier = new Date('2026-11-01T00:00:00Z')
  const later = new Date('2026-11-02T00:00:00Z')

  it('keeps a non-spending feature on until the user switches it off', () => {
    expect(isFeatureActive('artifacts', on, createUserState())).toBe(true)
    expect(isFeatureActive('artifacts', on, createUserState({
      optIns: { artifacts: { optedInAt: null, optedOutAt: later } },
    }))).toBe(false)
    expect(isFeatureActive('artifacts', on, createUserState({
      optIns: { artifacts: { optedInAt: earlier, optedOutAt: later } },
    }))).toBe(false)
  })

  it('switches a non-spending feature back on with a newer opt-in', () => {
    expect(isFeatureActive('artifacts', on, createUserState({
      optIns: { artifacts: { optedInAt: later, optedOutAt: earlier } },
    }))).toBe(true)
  })

  it('turns a child off when its non-spending parent is switched off', () => {
    const state = createUserState({
      optIns: { artifacts: { optedInAt: null, optedOutAt: later } },
    })

    expect(isFeatureActive('artifacts.react', on, state)).toBe(false)
    expect(isFeatureActive('artifacts.react', on, createUserState()))
      .toBe(true)
  })

  it('reads the toggle state by opt-in kind', () => {
    const optOut = { optIn: 'none' } as const
    const optIn = { optIn: 'required' } as const

    expect(isFeatureToggledOn(optOut, undefined)).toBe(true)
    expect(isFeatureToggledOn(optIn, undefined)).toBe(false)
    expect(isFeatureToggledOn(optOut, {
      optedInAt: earlier,
      optedOutAt: later,
    })).toBe(false)
    expect(isFeatureToggledOn(optIn, {
      optedInAt: earlier,
      optedOutAt: later,
    })).toBe(false)
    expect(isFeatureToggledOn(optIn, {
      optedInAt: later,
      optedOutAt: earlier,
    })).toBe(true)
  })

  it('is off for an unavailable feature whatever the role or grant', async () => {
    const definition = FEATURE_REGISTRY['artifacts']

    definition.available = false

    try {
      const forAdmin = await evaluateFeature('artifacts', createContext({
        userState: adminState,
      }))
      const forGrant = await evaluateFeature('artifacts', createContext({
        userState: createUserState({
          grants: { artifacts: { effect: 'allow', variant: null } },
        }),
      }))
      const forChild = await evaluateFeature('artifacts.react', createContext({
        userState: adminState,
      }))

      expect(forAdmin).toMatchObject({ value: false, reason: 'NOT_AVAILABLE' })
      expect(forGrant).toMatchObject({ value: false, reason: 'NOT_AVAILABLE' })
      expect(forChild).toMatchObject({
        value: false,
        reason: 'NOT_AVAILABLE',
        flagMetadata: { decidedBy: 'artifacts' },
      })
    } finally {
      definition.available = true
    }
  })
})

describe('getFeatureEvaluationConfig', () => {
  it('defaults rollouts off and host mode to byok', () => {
    expect(getFeatureEvaluationConfig({})).toMatchObject({
      adminEmails: '',
      featuresDisabled: '',
      featuresHostMode: 'byok',
      featuresRolloutEnabled: false,
    })
  })

  it('ships rollouts off and no admins in nuxt.config defaults', () => {
    expect(getFeatureEvaluationConfig()).toMatchObject({
      adminEmails: '',
      featuresDisabled: '',
      featuresHostMode: 'byok',
      featuresRolloutEnabled: false,
    })
  })

  it('reads env string values', () => {
    expect(getFeatureEvaluationConfig({
      featuresRolloutEnabled: 'true',
      featuresHostMode: 'off',
    })).toMatchObject({
      featuresRolloutEnabled: true,
      featuresHostMode: 'off',
    })
    expect(getFeatureEvaluationConfig({
      featuresHostMode: 'nonsense',
    }).featuresHostMode).toBe('off')
    expect(getFeatureEvaluationConfig({
      featuresHostMode: '',
    }).featuresHostMode).toBe('byok')
  })
})

describe('loading rules and user state', () => {
  it('serves rules from KV without touching D1', async () => {
    const kv = {
      get: vi.fn(async () => JSON.stringify([createRule()])),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const db = { select: vi.fn() }
    const rules = await loadFeatureRules(kv as never, db as never)

    expect(rules.artifacts?.salt).toBe('salt-a')
    expect(kv.get).toHaveBeenCalledWith(FEATURE_RULES_CACHE_KEY)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('reads D1 once on a miss and writes the cache back', async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(),
    }
    const from = vi.fn(async () => [createRule({
      rolloutBps: 99_999,
      allowRoles: ['tester', 'owner'],
      variants: [
        null,
        { key: 'wide', weightBps: '20000' },
      ] as never,
    })])
    const db = { select: vi.fn(() => ({ from })) }
    const rules = await loadFeatureRules(kv as never, db as never)

    expect(db.select).toHaveBeenCalledTimes(1)
    expect(rules.artifacts?.rolloutBps).toBe(10_000)
    expect(rules.artifacts?.allowRoles).toEqual(['tester'])
    expect(rules.artifacts?.variants).toEqual([
      { key: 'wide', weightBps: 10_000 },
    ])
    expect(kv.put).toHaveBeenCalledWith(
      FEATURE_RULES_CACHE_KEY,
      expect.any(String),
      { expirationTtl: 300 },
    )
  })

  it('falls back to D1 when KV fails', async () => {
    const kv = {
      get: vi.fn(async () => {
        throw new Error('kv down')
      }),
      put: vi.fn(async () => {
        throw new Error('kv down')
      }),
      delete: vi.fn(),
    }
    const from = vi.fn(async () => [createRule()])
    const db = { select: vi.fn(() => ({ from })) }
    const logger = { set: vi.fn() }

    await expect(loadFeatureRules(kv as never, db as never, logger))
      .resolves.toHaveProperty('artifacts')
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        featureRulesCache: { operation: 'read', error: 'kv down' },
      },
    })
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        featureRulesCache: { operation: 'write', error: 'kv down' },
      },
    })
  })

  it('loads the user state in one D1 batch', async () => {
    const chain = () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: () => query,
      }

      return query
    }
    const db = {
      select: vi.fn(chain),
      batch: vi.fn(async () => [
        [{
          email: 'user@example.com',
          emailVerified: true,
          twoFactorEnabled: null,
        }],
        [{ role: 'tester' }, { role: 'unknown' }],
        [{ flag: 'artifacts', effect: 'allow', variant: null }],
        [{ flag: 'experiments', optedInAt: null, optedOutAt: new Date() }],
      ]),
    }
    const state = await loadUserFeatureState(db as never, 7)

    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({
      userId: 7,
      emailVerified: true,
      twoFactorEnabled: false,
      roles: ['tester'],
      grants: { artifacts: { effect: 'allow', variant: null } },
    })
    expect(hasObjectedToExperiments(state)).toBe(true)
  })

  it('returns null for a user id with no users row', async () => {
    const query = { from: () => query, where: () => query, limit: () => query }
    const db = {
      select: vi.fn(() => query),
      batch: vi.fn(async () => [[], [], [], []]),
    }

    await expect(loadUserFeatureState(db as never, 7)).resolves.toBeNull()
  })
})

describe('background use', () => {
  it('evaluates without a request context', async () => {
    vi.stubGlobal('useEvent', () => {
      throw new Error('no request context')
    })

    try {
      const result = await evaluateFeature('artifacts', createContext({
        userState: adminState,
      }))

      expect(result.value).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
