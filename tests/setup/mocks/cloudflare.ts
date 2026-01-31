import { vi } from 'vitest'
import Database from 'better-sqlite3'

/* eslint-disable no-console */

/**
 * Mock Cloudflare D1 database using better-sqlite3
 */
export function createMockD1() {
  const db = new Database(':memory:')

  return {
    prepare(query: string) {
      const stmt = db.prepare(query)
      return {
        bind(...values: any[]) {
          return {
            async first(column?: string) {
              try {
                const result = stmt.get(...values)
                return column ? (result as any)?.[column] : result
              } catch (error) {
                console.error('D1 query error:', error)
                return null
              }
            },
            async all() {
              try {
                const results = stmt.all(...values)
                return { results, success: true }
              } catch (error) {
                console.error('D1 query error:', error)
                return { results: [], success: false }
              }
            },
            async run() {
              try {
                const info = stmt.run(...values)
                return {
                  success: true,
                  meta: {
                    changes: info.changes,
                    last_row_id: info.lastInsertRowid,
                  },
                }
              } catch (error) {
                console.error('D1 query error:', error)
                return { success: false }
              }
            },
          }
        },
        async first(column?: string) {
          try {
            const result = stmt.get()
            return column ? (result as any)?.[column] : result
          } catch (error) {
            console.error('D1 query error:', error)
            return null
          }
        },
        async all() {
          try {
            const results = stmt.all()
            return { results, success: true }
          } catch (error) {
            console.error('D1 query error:', error)
            return { results: [], success: false }
          }
        },
        async run() {
          try {
            const info = stmt.run()
            return {
              success: true,
              meta: {
                changes: info.changes,
                last_row_id: info.lastInsertRowid,
              },
            }
          } catch (error) {
            console.error('D1 query error:', error)
            return { success: false }
          }
        },
      }
    },
    async batch(statements: any[]) {
      const results = []
      for (const stmt of statements) {
        results.push(await stmt.run())
      }
      return results
    },
    async exec(query: string) {
      db.exec(query)
      return { count: 1, duration: 0 }
    },
  }
}

/**
 * Mock Cloudflare KV store using Map
 */
export function createMockKV() {
  const store = new Map<string, string>()

  return {
    async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }) {
      const value = store.get(key)
      if (!value) return null

      if (options?.type === 'json') {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      }

      return value
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
    ) {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      store.set(key, stringValue)
    },
    async delete(key: string) {
      store.delete(key)
    },
    async list(
      options?: { prefix?: string, limit?: number, cursor?: string },
    ) {
      const keys = Array.from(store.keys())
      const filtered = options?.prefix
        ? keys.filter(k => k.startsWith(options.prefix!))
        : keys
      const limited = options?.limit
        ? filtered.slice(0, options.limit)
        : filtered

      return {
        keys: limited.map(name => ({ name })),
        list_complete: true,
        cursor: '',
      }
    },
  }
}

/**
 * Mock Cloudflare bindings
 */
export function createMockCloudflareBindings() {
  return {
    DB: createMockD1(),
    KV: createMockKV(),
    ASSETS: {
      fetch: vi.fn(),
    },
  }
}

/**
 * Helper to create H3 event with Cloudflare context
 */
export function createMockH3Event(overrides: any = {}) {
  const bindings = createMockCloudflareBindings()

  return {
    context: {
      cloudflare: {
        env: bindings,
        ...overrides.cloudflare,
      },
    },
    node: {
      req: {},
      res: {},
    },
    ...overrides,
  }
}
