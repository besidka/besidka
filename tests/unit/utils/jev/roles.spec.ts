import Database from 'better-sqlite3'
import { SQLiteDialect } from 'drizzle-orm/sqlite-core/dialect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_ROLE_IDS } from '#shared/utils/jev-policy'
import {
  isJevRoleEnabled,
  jevRoleSettingsUpdateValue,
  resolveJevRoleApiKey,
  resolveJevRoleModel,
} from '~~/server/utils/jev/roles'

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
}))

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: (value: string) => mocks.decrypt(value),
}))

function createDb(input: {
  key?: { apiKey: string } | Error
  typesafeRoles?: Record<string, boolean> | null
}) {
  const keyFindFirst = vi.fn(async () => {
    if (input.key instanceof Error) {
      throw input.key
    }

    return input.key
  })
  const settingsFindFirst = vi.fn(async () => {
    return input.typesafeRoles === undefined
      ? undefined
      : { typesafeRoles: input.typesafeRoles }
  })

  return {
    db: {
      query: {
        keys: { findFirst: keyFindFirst },
        userSettings: { findFirst: settingsFindFirst },
      },
    } as any,
    keyFindFirst,
    settingsFindFirst,
  }
}

function createLogger() {
  const fields: Array<Record<string, any>> = []

  return {
    fields,
    logger: {
      set: (value: Record<string, unknown>) => {
        fields.push(value)
      },
    },
  }
}

beforeEach(() => {
  mocks.decrypt.mockReset().mockImplementation(async (value: string) => {
    return value.replace(/^encrypted:/, '')
  })
})

describe('isJevRoleEnabled', () => {
  it('is false for every role without a TypeSafe AI key', () => {
    for (const role of JEV_ROLE_IDS) {
      expect(isJevRoleEnabled({
        typesafeRoles: { [role]: true },
        hasTypesafeKey: false,
      }, role)).toBe(false)
    }
  })

  it('treats null settings and a missing role as on', () => {
    for (const role of JEV_ROLE_IDS) {
      expect(isJevRoleEnabled({
        typesafeRoles: null,
        hasTypesafeKey: true,
      }, role)).toBe(true)
      expect(isJevRoleEnabled({
        typesafeRoles: {},
        hasTypesafeKey: true,
      }, role)).toBe(true)
    }
  })

  it('is off only for a role explicitly switched off', () => {
    const settings = {
      typesafeRoles: { rerank: false, autoWebSearch: true },
      hasTypesafeKey: true,
    }

    expect(isJevRoleEnabled(settings, 'rerank')).toBe(false)
    expect(isJevRoleEnabled(settings, 'autoWebSearch')).toBe(true)
    expect(isJevRoleEnabled(settings, 'sharePiiCheck')).toBe(true)
  })
})

describe('resolveJevRoleApiKey', () => {
  it('skips the settings read when there is no key', async () => {
    const { db, settingsFindFirst } = createDb({})

    expect(await resolveJevRoleApiKey({
      db,
      userId: 3,
      role: 'rerank',
    })).toBeNull()
    expect(settingsFindFirst).not.toHaveBeenCalled()
  })

  it('returns the decrypted key for an enabled role', async () => {
    const { db, settingsFindFirst } = createDb({
      key: { apiKey: 'encrypted:ts-key' },
      typesafeRoles: { rerank: false },
    })

    expect(await resolveJevRoleApiKey({
      db,
      userId: 3,
      role: 'autoWebSearch',
    })).toBe('ts-key')
    expect(settingsFindFirst).toHaveBeenCalledWith({
      where: { userId: 3 },
      columns: { typesafeRoles: true },
    })
  })

  it('returns null for a role the user switched off', async () => {
    const { db } = createDb({
      key: { apiKey: 'encrypted:ts-key' },
      typesafeRoles: { rerank: false },
    })

    expect(await resolveJevRoleApiKey({
      db,
      userId: 3,
      role: 'rerank',
    })).toBeNull()
  })

  it('treats a user without a settings row as all roles on', async () => {
    const { db } = createDb({ key: { apiKey: 'encrypted:ts-key' } })

    expect(await resolveJevRoleModel({
      db,
      userId: 3,
      role: 'pastChatRetrieval',
    })).toMatchObject({ modelId: 'jev-1.14.0' })
  })

  it('logs key-error under the role and returns null when the key read '
    + 'fails', async () => {
    const { db } = createDb({ key: new Error('D1 down') })
    const { fields, logger } = createLogger()

    expect(await resolveJevRoleApiKey({
      db,
      userId: 3,
      role: 'injectionScreening',
      logger,
    })).toBeNull()
    expect(fields).toEqual([{
      attributes: {
        injectionScreeningJev: { model: 'jev-1.14.0', status: 'key-error' },
      },
    }])
  })
})

describe('jevRoleSettingsUpdateValue', () => {
  it('merges a role patch into the stored object inside SQLite', () => {
    const value = jevRoleSettingsUpdateValue({ rerank: false })

    expect(value).not.toBeNull()

    const query = new SQLiteDialect().sqlToQuery(value!)

    expect(query.sql).toBe(
      'json_patch(coalesce("user_settings"."typesafe_roles", \'{}\'), ?)',
    )
    expect(query.params).toEqual(['{"rerank":false}'])
  })

  it('keeps the other stored roles when SQLite applies the patch', () => {
    const sqlite = new Database(':memory:')
    const query = new SQLiteDialect().sqlToQuery(
      jevRoleSettingsUpdateValue({ rerank: true, sharePiiCheck: false })!,
    )

    sqlite.exec('create table user_settings (typesafe_roles text)')
    sqlite.prepare('insert into user_settings values (?)')
      .run('{"rerank":false,"autoWebSearch":false}')
    sqlite.prepare(`update user_settings set typesafe_roles = ${query.sql}`)
      .run(...query.params)

    const row = sqlite.prepare('select typesafe_roles from user_settings')
      .get() as { typesafe_roles: string }

    sqlite.close()

    expect(JSON.parse(row.typesafe_roles)).toEqual({
      rerank: true,
      autoWebSearch: false,
      sharePiiCheck: false,
    })
  })

  it('resets to null', () => {
    expect(jevRoleSettingsUpdateValue(null)).toBeNull()
  })
})
