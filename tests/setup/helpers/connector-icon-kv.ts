export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
])
export const ICO_BYTES = new Uint8Array([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10,
])
export const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
)

interface StoredValue {
  value: string | ArrayBuffer
  metadata: unknown
  ttl: number | undefined
}

/**
 * A KV stand-in that keeps what the connector icon cache writes: binary
 * values with metadata and the TTL of each put.
 */
export function createFakeIconKv() {
  const entries = new Map<string, StoredValue>()

  return {
    entries,
    get: async (key: string) => {
      const stored = entries.get(key)

      return typeof stored?.value === 'string' ? stored.value : null
    },
    getWithMetadata: async (key: string, type?: string) => {
      const stored = entries.get(key)

      if (!stored) {
        return { value: null, metadata: null }
      }

      if (type === 'arrayBuffer') {
        const value = typeof stored.value === 'string'
          ? new TextEncoder().encode(stored.value).buffer
          : stored.value

        return { value, metadata: stored.metadata }
      }

      return { value: stored.value, metadata: stored.metadata }
    },
    put: async (
      key: string,
      value: string | ArrayBuffer,
      options?: { expirationTtl?: number, metadata?: unknown },
    ) => {
      entries.set(key, {
        value,
        metadata: options?.metadata ?? null,
        ttl: options?.expirationTtl,
      })
    },
    delete: async (key: string) => {
      entries.delete(key)
    },
  }
}

export type FakeIconKv = ReturnType<typeof createFakeIconKv>
