import { readdirSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { purgeUserFeatureAccess } from '~~/server/utils/account/purge-feature-access'

const migrationsDirectory = new URL(
  '../../../../.drizzle/migrations/',
  import.meta.url,
)

function readFeatureAccessMigration(): string {
  const directory = readdirSync(migrationsDirectory).find((name) => {
    return name.endsWith('_feature_access_tables')
  })

  if (!directory) {
    throw new Error('feature access migration not found')
  }

  return readFileSync(
    new URL(`${directory}/migration.sql`, migrationsDirectory),
    'utf8',
  )
}

const createdAt = 1_762_560_000

describe('purgeUserFeatureAccess', () => {
  let sqlite: InstanceType<typeof Database>
  let database: ReturnType<typeof drizzle>

  beforeEach(() => {
    sqlite = new Database(':memory:')

    for (const statement of readFeatureAccessMigration().split(
      '--> statement-breakpoint',
    )) {
      sqlite.exec(statement)
    }

    database = drizzle({ client: sqlite })
  })

  afterEach(() => {
    sqlite.close()
  })

  function seed() {
    sqlite.exec(`
      insert into user_roles (user_id, role, granted_by, created_at)
        values (7, 'tester', 1, ${createdAt}), (8, 'tester', 1, ${createdAt});
      insert into feature_grants
        (user_id, flag, effect, reason, granted_by, created_at)
        values
          (7, 'artifacts', 'allow', 'asked by mail', 1, ${createdAt}),
          (7, 'documents', 'deny', null, 1, ${createdAt}),
          (8, 'artifacts', 'allow', null, 1, ${createdAt});
      insert into feature_opt_ins (user_id, flag, opted_in_at)
        values (7, 'artifacts', ${createdAt}), (8, 'artifacts', ${createdAt});
      insert into feature_audit_log
        (actor_user_id, actor_kind, action, flag, target_user_id,
          before, after, created_at)
        values
          (1, 'ui', 'grant.set', 'artifacts', 7, null,
            '{"effect":"allow","userId":7,"reason":"asked by mail",'
              || '"grantedBy":1}',
            ${createdAt}),
          (7, 'ui', 'role.grant', null, 8, null,
            '{"role":"tester","userId":8,"grantedBy":7}', ${createdAt}),
          (1, 'ui', 'grant.set', 'artifacts', 8, null,
            '{"effect":"allow","userId":8,"reason":"beta"}', ${createdAt}),
          (null, 'env', 'rule.update', 'artifacts', null,
            '{"rolloutBps":0}', '{"rolloutBps":500}', ${createdAt});
    `)
  }

  it('deletes only the user rows and reports the counts', async () => {
    seed()

    const result = await purgeUserFeatureAccess(7, database as never)

    expect(result).toEqual({
      featureGrantsDeleted: 2,
      featureOptInsDeleted: 1,
      userRolesDeleted: 1,
      featureAuditRowsAnonymised: 2,
    })
    expect(sqlite.prepare(
      'select user_id as userId from feature_grants',
    ).all()).toEqual([{ userId: 8 }])
    expect(sqlite.prepare(
      'select user_id as userId from feature_opt_ins',
    ).all()).toEqual([{ userId: 8 }])
    expect(sqlite.prepare(
      'select user_id as userId from user_roles',
    ).all()).toEqual([{ userId: 8 }])
  })

  it('nulls ids and strips ids and reason from referencing audit rows', async () => {
    seed()

    await purgeUserFeatureAccess(7, database as never)

    const rows = sqlite.prepare(`
      select actor_user_id as actor, target_user_id as target, before, after
      from feature_audit_log order by id
    `).all()

    expect(rows).toEqual([
      {
        actor: 1,
        target: null,
        before: null,
        after: '{"effect":"allow"}',
      },
      {
        actor: null,
        target: 8,
        before: null,
        after: '{"role":"tester"}',
      },
      {
        actor: 1,
        target: 8,
        before: null,
        after: '{"effect":"allow","userId":8,"reason":"beta"}',
      },
      {
        actor: null,
        target: null,
        before: '{"rolloutBps":0}',
        after: '{"rolloutBps":500}',
      },
    ])
  })

  it('nulls the grantor ids the user left on other rows', async () => {
    seed()
    sqlite.exec(`
      insert into user_roles (user_id, role, granted_by, created_at)
        values (9, 'tester', 7, ${createdAt});
      insert into feature_grants (user_id, flag, effect, granted_by, created_at)
        values (9, 'skills', 'allow', 7, ${createdAt});
      insert into feature_flag_rules
        (flag, enabled, rollout_bps, salt, updated_by, created_at, updated_at)
        values ('skills', 1, 0, 'abc', 7, ${createdAt}, ${createdAt}),
          ('documents', 1, 0, 'def', 1, ${createdAt}, ${createdAt});
    `)

    await purgeUserFeatureAccess(7, database as never)

    expect(sqlite.prepare(
      'select granted_by as grantedBy from user_roles where user_id = 9',
    ).get()).toEqual({ grantedBy: null })
    expect(sqlite.prepare(
      'select granted_by as grantedBy from feature_grants where user_id = 9',
    ).get()).toEqual({ grantedBy: null })
    expect(sqlite.prepare(
      'select flag, updated_by as updatedBy from feature_flag_rules order by flag',
    ).all()).toEqual([
      { flag: 'documents', updatedBy: 1 },
      { flag: 'skills', updatedBy: null },
    ])
  })

  it('drops audit json that is not valid instead of failing', async () => {
    sqlite.exec(`
      insert into feature_audit_log
        (actor_user_id, actor_kind, action, target_user_id, before, after,
          created_at)
        values (1, 'ui', 'grant.set', 7, '', 'not json', ${createdAt});
    `)

    const result = await purgeUserFeatureAccess(7, database as never)

    expect(result.featureAuditRowsAnonymised).toBe(1)
    expect(sqlite.prepare(
      'select target_user_id as target, before, after from feature_audit_log',
    ).get()).toEqual({ target: null, before: null, after: null })
  })

  it('is a no-op for a user without feature access rows', async () => {
    seed()

    const result = await purgeUserFeatureAccess(99, database as never)

    expect(result).toEqual({
      featureGrantsDeleted: 0,
      featureOptInsDeleted: 0,
      userRolesDeleted: 0,
      featureAuditRowsAnonymised: 0,
    })
    expect(sqlite.prepare(
      'select count(*) as count from feature_audit_log where after like ?',
    ).get('%reason%')).toEqual({ count: 2 })
  })
})
