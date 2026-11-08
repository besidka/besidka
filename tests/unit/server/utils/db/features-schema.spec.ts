import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import {
  createFeatureFlagSalt,
  featureAuditLog,
  featureFlagRules,
  featureGrants,
  featureOptIns,
  userRoles,
} from '~~/server/db/schemas/features'

const featureTables = [
  userRoles,
  featureFlagRules,
  featureGrants,
  featureOptIns,
  featureAuditLog,
]

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => {
    return {
      name: index.config.name,
      unique: index.config.unique,
    }
  })
}

describe('feature access schema', () => {
  it('defines the five tables', () => {
    expect(featureTables.map((table) => {
      return getTableConfig(table).name
    })).toEqual([
      'user_roles',
      'feature_flag_rules',
      'feature_grants',
      'feature_opt_ins',
      'feature_audit_log',
    ])
  })

  it('declares the unique and lookup indexes', () => {
    expect(indexNames(userRoles)).toEqual([
      { name: 'uq_user_roles_user_role', unique: true },
    ])
    expect(indexNames(featureGrants)).toEqual([
      { name: 'uq_feature_grants_user_flag', unique: true },
      { name: 'idx_feature_grants_flag', unique: false },
    ])
    expect(indexNames(featureOptIns)).toEqual([
      { name: 'uq_feature_opt_ins_user_flag', unique: true },
    ])
    expect(indexNames(featureAuditLog)).toEqual([
      { name: 'idx_feature_audit_created', unique: false },
      { name: 'idx_feature_audit_flag', unique: false },
      { name: 'idx_feature_audit_target', unique: false },
      { name: 'idx_feature_audit_actor', unique: false },
    ])
  })

  it('gives rule defaults in app code, never as SQL defaults', () => {
    const columns = getTableConfig(featureFlagRules).columns
    const columnByName = new Map(columns.map((column) => {
      return [column.name, column]
    }))

    for (const name of ['enabled', 'rollout_bps', 'salt']) {
      const column = columnByName.get(name)

      expect(column?.defaultFn).toBeTypeOf('function')
      expect(column?.default).toBeUndefined()
    }

    expect(columnByName.get('enabled')?.defaultFn?.()).toBe(true)
    expect(columnByName.get('rollout_bps')?.defaultFn?.()).toBe(0)

    for (const table of featureTables) {
      for (const column of getTableConfig(table).columns) {
        expect(column.default, column.name).toBeUndefined()
      }
    }
  })

  it('creates a random 16-byte hex salt', () => {
    const salt = createFeatureFlagSalt()

    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(createFeatureFlagSalt()).not.toBe(salt)
  })

  it('has no foreign key to users or any other table', () => {
    for (const table of featureTables) {
      expect(getTableConfig(table).foreignKeys).toEqual([])
    }

    const source = readFileSync(
      new URL(
        '../../../../../server/db/schemas/features.ts',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).not.toContain('.references(')
    expect(source).not.toMatch(/from '\.\/auth'/)
  })
})
