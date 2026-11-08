import type { BlobStore } from '~~/server/utils/platform/types'
import { createR2BlobStore } from '~~/server/utils/platform/cloudflare/blob-store'

export function useArtifactBlobStore(): BlobStore {
  const bucket = useFileStorage() as unknown as Parameters<
    typeof createR2BlobStore
  >[0]

  return createR2BlobStore(bucket)
}
