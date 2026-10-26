import { vi } from 'vitest'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { createKnowledgeTestDb } from './knowledge-db'
import type { KnowledgeTestDb } from './knowledge-db'

export interface FakeBucketCall {
  operation: 'put' | 'get' | 'delete' | 'list'
  key: string
}

export interface FakeKnowledgeBucket {
  objects: Map<string, string>
  calls: FakeBucketCall[]
  failPutAt: number | null
  failPutForKey: ((key: string) => boolean) | null
  getMaxInFlight: () => number
  put: (key: string, value: string) => Promise<{ key: string }>
  get: (key: string) => Promise<{
    size: number
    text: () => Promise<string>
  } | null>
  delete: (keys: string | string[]) => Promise<void>
  list: (options: { prefix: string }) => Promise<{
    objects: Array<{ key: string }>
    truncated: boolean
  }>
}

export interface KnowledgeApiResponses {
  status: number | null
}

export interface KnowledgeEventInput {
  projectId?: string
  itemId?: string
  body?: unknown
  rawBody?: string | ReadableStream<Uint8Array>
  headers?: Record<string, string>
  waitUntil?: (promise: Promise<unknown>) => void
}

export const knowledgeRoutes = {
  summary: 'index.get',
  mode: 'mode.patch',
  commit: 'commit.post',
  itemsCreate: 'items/index.post',
  itemPatch: 'items/[itemId]/index.patch',
  itemAllow: 'items/[itemId]/allow.patch',
  itemDelete: 'items/[itemId]/index.delete',
  itemText: 'items/[itemId]/text.get',
  noteCreate: 'notes/index.post',
  notePatch: 'notes/[itemId].patch',
} as const

export type KnowledgeRouteName = keyof typeof knowledgeRoutes

export type KnowledgeHandler = (event: unknown) => Promise<any>

export async function loadKnowledgeHandler(
  route: KnowledgeRouteName,
): Promise<KnowledgeHandler> {
  const module = await import(
    /* @vite-ignore */
    `../../../server/api/v1/projects/[id]/knowledge/${knowledgeRoutes[route]}`
  )

  return module.default
}

function buildRequest(input: KnowledgeEventInput): Request {
  const init: RequestInit & { duplex?: 'half' } = { method: 'POST' }

  if (input.rawBody !== undefined) {
    init.body = input.rawBody
    init.duplex = 'half'
  } else if (input.body !== undefined) {
    init.body = JSON.stringify(input.body)
  }

  return new Request('http://localhost/knowledge', init)
}

export function knowledgeEvent(input: KnowledgeEventInput = {}) {
  return {
    body: input.body,
    req: buildRequest(input),
    headers: input.headers ?? {},
    res: { headers: new Headers() },
    context: {
      params: { id: input.projectId, itemId: input.itemId },
      cloudflare: input.waitUntil
        ? { context: { waitUntil: input.waitUntil } }
        : undefined,
    },
  }
}

export interface FakeKnowledgeKv {
  values: Map<string, string>
  get: (key: string) => Promise<string | null>
  put: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
}

export function createFakeKnowledgeKv(): FakeKnowledgeKv {
  const values = new Map<string, string>()

  return {
    values,
    get: async key => values.get(key) ?? null,
    put: async (key, value) => {
      values.set(key, value)
    },
    delete: async (key) => {
      values.delete(key)
    },
  }
}

export interface KnowledgeApiHarness {
  testDb: KnowledgeTestDb
  kv: FakeKnowledgeKv
  bucket: FakeKnowledgeBucket
  responses: KnowledgeApiResponses
  session: { userId: number | null }
  beforeBatchHooks: Array<() => void>
  install: () => void
  close: () => void
}

/**
 * An in-memory R2 stand-in that records every call, can fail the nth put or
 * any put for a chosen key, and tracks the highest number of overlapping
 * calls so a spec can prove the writes are sequential.
 */
export function createFakeKnowledgeBucket(): FakeKnowledgeBucket {
  let inFlight = 0
  let maxInFlight = 0

  async function track<T>(action: () => T): Promise<T> {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await Promise.resolve()

    try {
      return action()
    } finally {
      inFlight--
    }
  }

  const bucket: FakeKnowledgeBucket = {
    objects: new Map(),
    calls: [],
    failPutAt: null,
    failPutForKey: null,
    getMaxInFlight: () => maxInFlight,
    put: async (key, value) => {
      return await track(() => {
        bucket.calls.push({ operation: 'put', key })

        const putNumber = bucket.calls.filter((call) => {
          return call.operation === 'put'
        }).length

        if (
          bucket.failPutAt === putNumber
          || bucket.failPutForKey?.(key)
        ) {
          throw new Error('R2 put failed')
        }

        bucket.objects.set(key, value)

        return { key }
      })
    },
    get: async (key) => {
      return await track(() => {
        bucket.calls.push({ operation: 'get', key })

        const value = bucket.objects.get(key)

        if (value === undefined) {
          return null
        }

        return {
          size: new TextEncoder().encode(value).length,
          text: async () => value,
        }
      })
    },
    delete: async (keys) => {
      await track(() => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          bucket.calls.push({ operation: 'delete', key })
          bucket.objects.delete(key)
        }
      })
    },
    list: async (options) => {
      return await track(() => {
        bucket.calls.push({ operation: 'list', key: options.prefix })

        return {
          objects: [...bucket.objects.keys()]
            .filter((key) => {
              return key.startsWith(options.prefix)
            })
            .map((key) => {
              return { key }
            }),
          truncated: false,
        }
      })
    },
  }

  return bucket
}

/**
 * Builds the shared environment of the knowledge API specs: a real
 * better-sqlite3 database from `createKnowledgeTestDb`, a fake R2 bucket, a
 * switchable session and a `batch()` that behaves like D1's (all statements
 * in one transaction, rolled back together when one throws). `install()`
 * stubs the Nitro auto-imports the handlers read as globals. Spec files add
 * their own `vi.mock` calls (evlog, the storage cache, the pack module).
 */
export function createKnowledgeApiHarness(): KnowledgeApiHarness {
  const testDb = createKnowledgeTestDb()
  const bucket = createFakeKnowledgeBucket()
  const kv = createFakeKnowledgeKv()
  const session: { userId: number | null } = { userId: 1 }
  const responses: KnowledgeApiResponses = { status: null }
  const beforeBatchHooks: Array<() => void> = []

  let batchQueue: Promise<void> = Promise.resolve()
  const eagerAll = testDb.db.all.bind(testDb.db) as (
    query: unknown,
    mode?: unknown,
  ) => unknown

  Object.assign(testDb.db, {
    all: (query: unknown, mode?: unknown) => {
      return {
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          return Promise.resolve()
            .then(() => eagerAll(query, mode))
            .then(resolve, reject)
        },
      }
    },
    batch: async (statements: PromiseLike<unknown>[]) => {
      const previous = batchQueue
      let release: () => void = () => {}

      batchQueue = new Promise<void>((resolve) => {
        release = resolve
      })

      await previous

      try {
        for (const hook of beforeBatchHooks) {
          hook()
        }

        testDb.sqlite.exec('BEGIN')

        try {
          const results: unknown[] = []

          for (const statement of statements) {
            results.push(await statement)
          }

          testDb.sqlite.exec('COMMIT')

          return results
        } catch (exception) {
          testDb.sqlite.exec('ROLLBACK')

          throw exception
        }
      } finally {
        release()
      }
    },
  })

  function install(): void {
    responses.status = null

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('setResponseStatus', (_event: unknown, code: number) => {
      responses.status = code
    })
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Record<string, string> }, name: string) => {
        return event.headers?.[name.toLowerCase()]
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', async () => {
      return session.userId === null
        ? null
        : { user: { id: String(session.userId) } }
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => bucket)
    vi.stubGlobal('useKV', () => kv)
  }

  return {
    testDb,
    kv,
    bucket,
    responses,
    session,
    beforeBatchHooks,
    install,
    close: () => testDb.close(),
  }
}

/**
 * A stand-in for `commitKnowledgeChange` that follows its contract without
 * the pack build: it deletes the listed rows of this project and user only,
 * bumps `knowledge_version` once and returns the project's versions.
 */
export function createCommitImplementation(testDb: KnowledgeTestDb) {
  return async (input: {
    userId: number
    projectId: number
    removeItemIds?: number[]
  }) => {
    for (const itemId of input.removeItemIds ?? []) {
      testDb.sqlite.prepare(
        'delete from project_knowledge_items'
        + ' where id = ? and project_id = ? and user_id = ?',
      ).run(itemId, input.projectId, input.userId)
    }

    testDb.sqlite.prepare(
      'update projects set knowledge_version'
      + ' = coalesce(knowledge_version, 0) + 1 where id = ?',
    ).run(input.projectId)

    const row = testDb.getProjectRow(input.projectId)!

    return {
      version: row.knowledge_version ?? 0,
      packVersion: row.knowledge_pack_version,
    }
  }
}
