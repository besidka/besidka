import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  JobRunner,
  JobStepOptions,
} from '~~/server/utils/platform/types'
import {
  BLOB_STORE_SIGNED_URL_NOT_SUPPORTED,
  R2_DELETE_BATCH_LIMIT,
  createR2BlobStore,
} from '~~/server/utils/platform/cloudflare/blob-store'
import {
  JOB_RUNNER_NOT_CONFIGURED,
  createCloudflareJobRunner,
} from '~~/server/utils/platform/cloudflare/job-runner'

function createBucket() {
  return {
    put: vi.fn().mockResolvedValue(null),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

describe('R2 blob store', () => {
  it('puts a body with content type and custom metadata', async () => {
    const bucket = createBucket()
    const store = createR2BlobStore(bucket as never)

    await store.put('artifacts/1.html', '<p>hi</p>', {
      contentType: 'text/html',
      customMetadata: { userId: '1' },
    })

    expect(bucket.put).toHaveBeenCalledWith('artifacts/1.html', '<p>hi</p>', {
      httpMetadata: { contentType: 'text/html' },
      customMetadata: { userId: '1' },
    })
  })

  it('puts without metadata', async () => {
    const bucket = createBucket()
    const store = createR2BlobStore(bucket as never)

    await store.put('key', 'body')

    expect(bucket.put).toHaveBeenCalledWith('key', 'body', {
      httpMetadata: undefined,
      customMetadata: undefined,
    })
  })

  it('maps a stored object and returns null for a missing key', async () => {
    const bucket = createBucket()
    const body = new ReadableStream()

    bucket.get.mockResolvedValueOnce({
      key: 'key',
      size: 4,
      httpMetadata: { contentType: 'text/plain' },
      customMetadata: { userId: '1' },
      body,
    })
    bucket.get.mockResolvedValueOnce(null)

    const store = createR2BlobStore(bucket as never)

    await expect(store.get('key')).resolves.toEqual({
      key: 'key',
      size: 4,
      contentType: 'text/plain',
      customMetadata: { userId: '1' },
      body,
    })
    await expect(store.get('missing')).resolves.toBeNull()
  })

  it('deletes many keys with one batch call and skips an empty list', async () => {
    const bucket = createBucket()
    const store = createR2BlobStore(bucket as never)

    await store.delete(['a', 'b', 'c'])
    await store.delete([])

    expect(bucket.delete).toHaveBeenCalledTimes(1)
    expect(bucket.delete).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('splits more than 1000 keys into sequential batch calls', async () => {
    const bucket = createBucket()
    const store = createR2BlobStore(bucket as never)
    const keys = Array.from({ length: 2500 }, (_value, index) => {
      return `key-${index}`
    })

    await store.delete(keys)

    expect(bucket.delete).toHaveBeenCalledTimes(3)
    expect(bucket.delete.mock.calls.map(([batch]) => {
      return batch.length
    })).toEqual([R2_DELETE_BATCH_LIMIT, R2_DELETE_BATCH_LIMIT, 500])
  })

  it('answers 501 for signed URLs', async () => {
    const store = createR2BlobStore(createBucket() as never)

    await expect(store.signedUrl('key', 60)).rejects.toMatchObject({
      status: 501,
      why: BLOB_STORE_SIGNED_URL_NOT_SUPPORTED,
    })
  })

  it('never reads the request context', () => {
    const requestContextPattern
      = /useEvent\(|getRequestEvent|useUserSession|event\.context/
    const sources = ['server/capabilities', 'server/utils/platform']
      .flatMap((directory) => {
        return readdirSync(directory, { recursive: true })
          .map((entry) => {
            return `${directory}/${String(entry).split('\\').join('/')}`
          })
          .filter((path) => {
            return path.endsWith('.ts')
          })
      })

    expect(sources.length).toBeGreaterThanOrEqual(6)

    for (const path of sources) {
      expect(readFileSync(path, 'utf-8')).not.toMatch(requestContextPattern)
    }
  })
})

describe('Cloudflare job runner stub', () => {
  it('requires an explicit retries option on step', () => {
    expectTypeOf<Parameters<JobRunner['step']>[1]>()
      .toEqualTypeOf<JobStepOptions>()
    expectTypeOf<JobStepOptions['retries']>().toEqualTypeOf<number>()
    expectTypeOf<Pick<JobStepOptions, 'retries'>>()
      .toEqualTypeOf<{ retries: number }>()
  })

  it('answers 501 for every method', async () => {
    const runner = createCloudflareJobRunner()
    const notConfigured = { status: 501, why: JOB_RUNNER_NOT_CONFIGURED }

    await expect(runner.enqueue('kind', {}))
      .rejects
      .toMatchObject(notConfigured)
    await expect(runner.get('job')).rejects.toMatchObject(notConfigured)
    await expect(runner.cancel('job')).rejects.toMatchObject(notConfigured)
    await expect(runner.step('step', { retries: 0 }, async () => {
      return 1
    })).rejects.toMatchObject(notConfigured)
  })
})
