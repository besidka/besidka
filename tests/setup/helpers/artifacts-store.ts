import type { BlobStore } from '~~/server/utils/platform/types'
import { vi } from 'vitest'

export interface MemoryBlobStore extends BlobStore {
  objects: Map<string, string>
  deleteCalls: string[][]
  putCalls: string[]
}

/**
 * In-memory `BlobStore` for artifact specs: objects are kept as text, and
 * every `delete` call is recorded so a spec can assert one batch per call.
 */
export function createMemoryBlobStore(): MemoryBlobStore {
  const objects = new Map<string, string>()
  const deleteCalls: string[][] = []
  const putCalls: string[] = []

  return {
    objects,
    deleteCalls,
    putCalls,
    put: vi.fn(async (key: string, body: unknown) => {
      putCalls.push(key)
      objects.set(
        key,
        typeof body === 'string'
          ? body
          : new TextDecoder().decode(body as Uint8Array),
      )
    }),
    get: vi.fn(async (key: string) => {
      const text = objects.get(key)

      if (text === undefined) {
        return null
      }

      return {
        key,
        size: new TextEncoder().encode(text).byteLength,
        contentType: 'text/plain; charset=utf-8',
        customMetadata: {},
        body: new Response(text).body as ReadableStream,
      }
    }),
    delete: vi.fn(async (keys: string[]) => {
      deleteCalls.push([...keys])

      for (const key of keys) {
        objects.delete(key)
      }
    }),
    signedUrl: vi.fn(async () => {
      throw new Error('not supported')
    }),
  }
}
