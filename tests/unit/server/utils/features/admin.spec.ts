import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import { FEATURE_AUDIT_PERSONAL_KEYS } from '~~/server/utils/account/purge-feature-access'
import {
  logFeatureAdminRead,
  revokeFeatureGrant,
  revokeUserRole,
  setFeatureGrant,
  setFeatureRule,
  setUserRole,
} from '~~/server/utils/features/admin'
import { FEATURE_RULES_CACHE_KEY } from '~~/server/utils/features/evaluate'

vi.mock('#shared/utils/features/registry', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('#shared/utils/features/registry')
  >()
  const variantFeature = {
    key: 'demo.variants',
    title: 'Demo variants',
    description: 'A flag with variants for the spec.',
    stage: 'internal',
    default: false,
    allowRoles: ['admin'],
    spend: 'none',
    optIn: 'none',
    requires: { bindings: [], keyKinds: [] },
    variants: ['control', 'treatment'],
    exposeToClient: true,
  }

  return {
    ...original,
    getFeatureDefinition: (key: string) => {
      return key === variantFeature.key
        ? variantFeature
        : original.getFeatureDefinition(key)
    },
  }
})

interface RecordedOperation {
  kind: 'insert' | 'update' | 'delete'
  table: unknown
  values?: Record<string, any>
  set?: Record<string, any>
  conflict?: Record<string, any>
}

function createFakeDb(selectResults: unknown[][] = []) {
  const queue = [...selectResults]
  const batches: RecordedOperation[][] = []

  const db = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => queue.shift() ?? [],
      }

      return chain
    }),
    insert: vi.fn((table: unknown) => {
      const operation: RecordedOperation = { kind: 'insert', table }
      const builder = {
        operation,
        values: (values: Record<string, any>) => {
          operation.values = values

          return builder
        },
        onConflictDoUpdate: (conflict: Record<string, any>) => {
          operation.conflict = conflict

          return builder
        },
        returning: () => builder,
      }

      return builder
    }),
    update: vi.fn((table: unknown) => {
      const operation: RecordedOperation = { kind: 'update', table }
      const builder = {
        operation,
        set: (values: Record<string, any>) => {
          operation.set = values

          return builder
        },
        where: () => builder,
      }

      return builder
    }),
    delete: vi.fn((table: unknown) => {
      const operation: RecordedOperation = { kind: 'delete', table }
      const builder = { operation, where: () => builder }

      return builder
    }),
    batch: vi.fn(async (operations: { operation: RecordedOperation }[]) => {
      batches.push(operations.map((item) => {
        return item.operation
      }))

      return operations.map(() => {
        return [{ id: 7 }]
      })
    }),
  }

  return { db, batches }
}

const now = new Date('2026-11-08T12:00:00.000Z')

function createContext(
  db: ReturnType<typeof createFakeDb>['db'],
  overrides: Partial<FeatureAdminContext> = {},
) {
  const logger = { set: vi.fn() }
  const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
  const context = {
    db: db as unknown as FeatureAdminContext['db'],
    kv,
    actor: { userId: 1, kind: 'ui' as const },
    rolloutEnabled: true,
    logger,
    now,
    ...overrides,
  }

  return { context, logger, kv }
}

function auditOf(batch: RecordedOperation[]) {
  return batch[1]!.values!
}

function assertAuditInvariants(audit: Record<string, any>) {
  const allowedUserKeys = new Set<string>(FEATURE_AUDIT_PERSONAL_KEYS)

  for (const snapshot of [audit.before, audit.after]) {
    if (!snapshot) {
      continue
    }

    for (const [key, value] of Object.entries(snapshot)) {
      expect(typeof value === 'object' && value !== null && !Array.isArray(value))
        .toBe(false)

      if (key.toLowerCase().includes('user')) {
        expect(allowedUserKeys.has(key)).toBe(true)
        expect([audit.actorUserId, audit.targetUserId]).toContain(value)
      }
    }
  }
}

describe('setFeatureRule', () => {
  it('creates a rule with a fresh salt, audits it and busts the cache', async () => {
    const { db, batches } = createFakeDb([[]])
    const { context, logger, kv } = createContext(db)

    const rule = await setFeatureRule(context, 'artifacts', {
      allowRoles: ['admin', 'tester'],
    })

    expect(rule).toMatchObject({
      flag: 'artifacts',
      enabled: true,
      rolloutBps: 0,
      allowRoles: ['admin', 'tester'],
      variants: null,
    })
    expect(batches).toHaveLength(1)

    const [write, audit] = batches[0]!

    expect(write!.kind).toBe('insert')
    expect(write!.values!.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(write!.values!.updatedBy).toBe(1)
    expect(audit!.values).toMatchObject({
      actorUserId: 1,
      actorKind: 'ui',
      action: 'rule.set',
      flag: 'artifacts',
      targetUserId: null,
      before: null,
      after: {
        enabled: true,
        rolloutBps: 0,
        allowRoles: ['admin', 'tester'],
        variants: null,
      },
    })
    expect(kv.delete).toHaveBeenCalledWith(FEATURE_RULES_CACHE_KEY)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        featureAccess: {
          action: 'rule.set',
          flag: 'artifacts',
          targetUserId: null,
          effect: 'enabled',
          expiresAt: null,
          actorKind: 'ui',
        },
      },
    })
  })

  it('updates only the patched fields and keeps the old values in before', async () => {
    const existing = {
      flag: 'artifacts',
      enabled: true,
      rolloutBps: 2500,
      allowRoles: ['admin'],
      variants: null,
      salt: 'a'.repeat(32),
      updatedBy: 99,
    }
    const { db, batches } = createFakeDb([[existing]])
    const { context } = createContext(db)

    await setFeatureRule(context, 'artifacts', { enabled: false })

    const [write, audit] = batches[0]!

    expect(write!.kind).toBe('update')
    expect(write!.set).toMatchObject({
      enabled: false,
      rolloutBps: 2500,
      allowRoles: ['admin'],
      updatedBy: 1,
    })
    expect(audit!.values!.before).toEqual({
      enabled: true,
      rolloutBps: 2500,
      allowRoles: ['admin'],
      variants: null,
    })
    expect(audit!.values!.after.enabled).toBe(false)
    assertAuditInvariants(audit!.values!)
  })

  it('refuses an empty patch', async () => {
    const { db } = createFakeDb([[]])
    const { context } = createContext(db)

    await expect(setFeatureRule(context, 'artifacts', {}))
      .rejects.toMatchObject({ status: 400, why: 'empty_patch' })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('logs a failed cache bust instead of failing the committed write', async () => {
    const { db, batches } = createFakeDb([[]])
    const { context, logger, kv } = createContext(db)

    kv.delete.mockRejectedValue(new Error('kv down'))

    await expect(setFeatureRule(context, 'artifacts', { enabled: false }))
      .resolves.toMatchObject({ enabled: false })
    expect(batches).toHaveLength(1)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        featureRulesCache: { operation: 'bust', error: 'kv down' },
      },
    })
  })

  it('answers 404 for a flag outside the registry', async () => {
    const { db } = createFakeDb()
    const { context } = createContext(db)

    await expect(setFeatureRule(context, 'nope', { enabled: true }))
      .rejects.toMatchObject({ status: 404, why: 'unknown_flag' })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('refuses to raise the rollout while rollouts are switched off', async () => {
    const { db } = createFakeDb([[]])
    const { context } = createContext(db, { rolloutEnabled: false })

    await expect(setFeatureRule(context, 'artifacts', { rolloutBps: 500 }))
      .rejects.toMatchObject({ status: 409, why: 'rollout_disabled' })
    await expect(setFeatureRule(context, 'artifacts', { rolloutBps: 0 }))
      .resolves.toMatchObject({ rolloutBps: 0 })
  })

  it('refuses variants on a flag without variants', async () => {
    const { db } = createFakeDb([[]])
    const { context } = createContext(db)

    await expect(setFeatureRule(context, 'artifacts', {
      variants: [{ key: 'control', weightBps: 10_000 }],
    })).rejects.toMatchObject({ status: 400, why: 'variants_not_supported' })
  })

  it('validates variant keys and weights', async () => {
    const { db } = createFakeDb([[], [], [], []])
    const { context } = createContext(db)

    await expect(setFeatureRule(context, 'demo.variants', {
      variants: [
        { key: 'control', weightBps: 5000 },
        { key: 'treatment', weightBps: 4000 },
      ],
    })).rejects.toMatchObject({ why: 'variant_weights_invalid' })
    await expect(setFeatureRule(context, 'demo.variants', {
      variants: [{ key: 'other', weightBps: 10_000 }],
    })).rejects.toMatchObject({ why: 'variant_unknown' })
    await expect(setFeatureRule(context, 'demo.variants', {
      variants: [
        { key: 'control', weightBps: 5000 },
        { key: 'control', weightBps: 5000 },
      ],
    })).rejects.toMatchObject({ why: 'variant_duplicate' })
    await expect(setFeatureRule(context, 'demo.variants', {
      variants: [
        { key: 'control', weightBps: 5000 },
        { key: 'treatment', weightBps: 5000 },
      ],
    })).resolves.toMatchObject({
      variants: [
        { key: 'control', weightBps: 5000 },
        { key: 'treatment', weightBps: 5000 },
      ],
    })
  })
})

describe('setFeatureGrant', () => {
  it('upserts a grant and writes a flat audit row', async () => {
    const { db, batches } = createFakeDb([[{ id: 5 }], []])
    const { context, logger } = createContext(db)

    const grant = await setFeatureGrant(context, 'artifacts', {
      userId: 5,
      effect: 'allow',
      expiresInDays: 30,
      reason: ' tests sharing ',
    })

    expect(grant.expiresAt?.toISOString()).toBe('2026-12-08T12:00:00.000Z')

    const [write, audit] = batches[0]!

    expect(write!.values).toMatchObject({
      userId: 5,
      flag: 'artifacts',
      effect: 'allow',
      variant: null,
      reason: 'tests sharing',
      grantedBy: 1,
    })
    expect(write!.conflict!.set).toMatchObject({ effect: 'allow' })
    expect(audit!.values).toMatchObject({
      action: 'grant.set',
      flag: 'artifacts',
      targetUserId: 5,
      before: null,
      after: {
        userId: 5,
        effect: 'allow',
        variant: null,
        expiresAt: 1796731200,
        reason: 'tests sharing',
      },
    })
    assertAuditInvariants(audit!.values!)

    const ledger = logger.set.mock.calls[0]![0].attributes.featureAccess

    expect(ledger).toEqual({
      action: 'grant.set',
      flag: 'artifacts',
      targetUserId: 5,
      effect: 'allow',
      expiresAt: '2026-12-08T12:00:00.000Z',
      actorKind: 'ui',
    })
    expect(JSON.stringify(ledger)).not.toContain('sharing')
  })

  it('keeps the previous grant in before and drops a variant on deny', async () => {
    const existing = {
      id: 3,
      userId: 5,
      flag: 'demo.variants',
      effect: 'allow',
      variant: 'control',
      expiresAt: null,
      reason: null,
      grantedBy: 42,
    }
    const { db, batches } = createFakeDb([[{ id: 5 }], [existing]])
    const { context } = createContext(db)

    await setFeatureGrant(context, 'demo.variants', {
      userId: 5,
      effect: 'deny',
      variant: 'control',
    })

    const audit = auditOf(batches[0]!)

    expect(audit.before).toEqual({
      userId: 5,
      effect: 'allow',
      variant: 'control',
      expiresAt: null,
      reason: null,
    })
    expect(audit.after.variant).toBeNull()
    assertAuditInvariants(audit)
  })

  it('answers 404 for an unknown user and 400 for an unknown variant', async () => {
    const { db } = createFakeDb([[]])
    const { context } = createContext(db)

    await expect(setFeatureGrant(context, 'artifacts', {
      userId: 404,
      effect: 'allow',
    })).rejects.toMatchObject({ status: 404, why: 'user_not_found' })
    await expect(setFeatureGrant(context, 'demo.variants', {
      userId: 5,
      effect: 'allow',
      variant: 'missing',
    })).rejects.toMatchObject({ status: 400, why: 'variant_unknown' })
    expect(db.batch).not.toHaveBeenCalled()
  })
})

describe('revokeFeatureGrant', () => {
  it('deletes the grant with one audit row', async () => {
    const grant = {
      id: 3,
      userId: 5,
      flag: 'artifacts',
      effect: 'deny',
      variant: null,
      expiresAt: null,
      reason: 'abuse',
    }
    const { db, batches } = createFakeDb([[grant]])
    const { context, logger } = createContext(db)

    await revokeFeatureGrant(context, 3)

    expect(batches[0]!.map((operation) => {
      return operation.kind
    })).toEqual(['delete', 'insert'])

    const audit = auditOf(batches[0]!)

    expect(audit).toMatchObject({
      action: 'grant.revoke',
      targetUserId: 5,
      after: null,
    })
    assertAuditInvariants(audit)
    expect(logger.set.mock.calls[0]![0].attributes.featureAccess)
      .toMatchObject({ action: 'grant.revoke', targetUserId: 5 })
  })

  it('answers 404 for a missing grant', async () => {
    const { db } = createFakeDb([[]])
    const { context } = createContext(db)

    await expect(revokeFeatureGrant(context, 9))
      .rejects.toMatchObject({ status: 404, why: 'grant_not_found' })
  })
})

describe('roles', () => {
  it('grants the tester role once with an audit row', async () => {
    const { db, batches } = createFakeDb([[{ id: 5 }], []])
    const { context } = createContext(db)

    await expect(setUserRole(context, { userId: 5, role: 'tester' }))
      .resolves.toEqual({ id: 7, changed: true })

    const audit = auditOf(batches[0]!)

    expect(audit).toMatchObject({
      action: 'role.set',
      targetUserId: 5,
      after: { userId: 5, role: 'tester' },
    })
    assertAuditInvariants(audit)
  })

  it('writes nothing when the user already has the role', async () => {
    const { db } = createFakeDb([[{ id: 5 }], [{ id: 2 }]])
    const { context, logger } = createContext(db)

    await expect(setUserRole(context, { userId: 5, role: 'tester' }))
      .resolves.toEqual({ id: 2, changed: false })
    expect(db.batch).not.toHaveBeenCalled()
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('never grants or revokes the admin role', async () => {
    const { db } = createFakeDb([[{ id: 2, userId: 1, role: 'admin' }]])
    const { context } = createContext(db)

    await expect(setUserRole(context, {
      userId: 1,
      role: 'admin' as 'tester',
    })).rejects.toMatchObject({ status: 403, why: 'role_not_assignable' })
    await expect(revokeUserRole(context, 2))
      .rejects.toMatchObject({ status: 403, why: 'role_not_assignable' })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('revokes a tester role with an audit row', async () => {
    const { db, batches } = createFakeDb([[{ id: 2, userId: 5, role: 'tester' }]])
    const { context } = createContext(db)

    await revokeUserRole(context, 2)

    const audit = auditOf(batches[0]!)

    expect(audit).toMatchObject({
      action: 'role.revoke',
      targetUserId: 5,
      before: { userId: 5, role: 'tester' },
      after: null,
    })
  })
})

describe('logFeatureAdminRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs the resource and result count only', () => {
    const logger = { set: vi.fn() }

    logFeatureAdminRead(logger, 'user_search', 3)

    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        featureAccess: {
          action: 'admin.read',
          resource: 'user_search',
          resultCount: 3,
        },
      },
    })
  })
})
