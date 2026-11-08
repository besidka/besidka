import type { R2Bucket } from '@cloudflare/workers-types'
import type {
  BlobBody,
  BlobMetadata,
  BlobStore,
  StoredBlob,
} from '~~/server/utils/platform/types'
import { createError } from 'evlog'

export const BLOB_STORE_SIGNED_URL_NOT_SUPPORTED = 'not_supported'

type BlobBucket = Pick<R2Bucket, 'put' | 'get' | 'delete'>

/**
 * R2 adapter for `BlobStore`. The bucket is passed in (for example from
 * `useFileStorage()` before any fan-out), so the adapter never reads the
 * request context. `signedUrl` answers 501 until a consumer needs it: the
 * file-share token helper signs with the request event, which a background
 * job does not have.
 */
export function createR2BlobStore(bucket: BlobBucket): BlobStore {
  return {
    async put(key: string, body: BlobBody, metadata: BlobMetadata = {}) {
      await bucket.put(key, body as Parameters<BlobBucket['put']>[1], {
        httpMetadata: metadata.contentType
          ? { contentType: metadata.contentType }
          : undefined,
        customMetadata: metadata.customMetadata,
      })
    },
    async get(key: string): Promise<StoredBlob | null> {
      const object = await bucket.get(key)

      if (!object) {
        return null
      }

      return {
        key: object.key,
        size: object.size,
        contentType: object.httpMetadata?.contentType ?? null,
        customMetadata: object.customMetadata ?? {},
        body: object.body as unknown as ReadableStream,
      }
    },
    async delete(keys: string[]) {
      if (!keys.length) {
        return
      }

      await bucket.delete(keys)
    },
    async signedUrl() {
      throw createError({
        message: 'Signed URLs are not supported',
        status: 501,
        why: BLOB_STORE_SIGNED_URL_NOT_SUPPORTED,
      })
    },
  }
}
