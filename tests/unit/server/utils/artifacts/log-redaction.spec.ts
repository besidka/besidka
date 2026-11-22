import { describe, expect, it } from 'vitest'
import {
  redactArtifactStorageKeyPath,
  redactArtifactStorageKeys,
} from '~~/server/utils/artifacts/log-redaction'

const KEY = 'jane.doe@example.com'

describe('redactArtifactStorageKeyPath', () => {
  it('replaces the key of a plain storage path', () => {
    expect(redactArtifactStorageKeyPath(
      `/api/v1/artifacts/ArtifactId1/storage/${KEY}`,
    )).toBe('/api/v1/artifacts/ArtifactId1/storage/[key]')
    expect(redactArtifactStorageKeyPath(
      '/api/v1/artifacts/ArtifactId1/storage/quiz:step-2.answer',
    )).toBe('/api/v1/artifacts/ArtifactId1/storage/[key]')
  })

  it('redacts the key inside a message and a full URL', () => {
    expect(redactArtifactStorageKeyPath(
      `PUT /api/v1/artifacts/ArtifactId1/storage/${KEY}`,
    )).toBe('PUT /api/v1/artifacts/ArtifactId1/storage/[key]')
    expect(redactArtifactStorageKeyPath(
      `Failed https://besidka.com/api/v1/artifacts/A1/storage/${KEY} (413)`,
    )).toBe('Failed https://besidka.com/api/v1/artifacts/A1/storage/[key] (413)')
  })

  it('redacts a percent-encoded path and a percent-encoded key', () => {
    expect(redactArtifactStorageKeyPath(
      `x?url=%2Fapi%2Fv1%2Fartifacts%2FA1%2Fstorage%2F${KEY}&y=1`,
    )).toBe('x?url=%2Fapi%2Fv1%2Fartifacts%2FA1%2Fstorage%2F[key]&y=1')
    expect(redactArtifactStorageKeyPath(
      `x=%252fapi%252fv1%252fartifacts%252fA1%252fstorage%252f${KEY}`,
    )).toBe('x=%252fapi%252fv1%252fartifacts%252fA1%252fstorage%252f[key]')
    expect(redactArtifactStorageKeyPath(
      '/api/v1/artifacts/A1/storage/user%3Ajane%40example.com',
    )).toBe('/api/v1/artifacts/A1/storage/[key]')
  })

  it('drops a query string that follows the key', () => {
    expect(redactArtifactStorageKeyPath(
      `/api/v1/artifacts/A1/storage/${KEY}?token=abc&x=1`,
    )).toBe('/api/v1/artifacts/A1/storage/[key]')
  })

  it('keeps text that follows the redacted segment', () => {
    expect(redactArtifactStorageKeyPath(
      `PUT /api/v1/artifacts/A1/storage/${KEY} failed`,
    )).toBe('PUT /api/v1/artifacts/A1/storage/[key] failed')
  })

  it('leaves other paths and non-strings untouched', () => {
    expect(redactArtifactStorageKeyPath('/api/v1/artifacts/A1/storage'))
      .toBe('/api/v1/artifacts/A1/storage')
    expect(redactArtifactStorageKeyPath('/api/v1/artifacts/A1/storage/'))
      .toBe('/api/v1/artifacts/A1/storage/')
    expect(redactArtifactStorageKeyPath('/api/v1/artifacts/A1/shares/abc'))
      .toBe('/api/v1/artifacts/A1/shares/abc')
    expect(redactArtifactStorageKeyPath('/api/v1/files/storage/abc'))
      .toBe('/api/v1/files/storage/abc')
    expect(redactArtifactStorageKeyPath('/chats/storage/abc'))
      .toBe('/chats/storage/abc')
    expect(redactArtifactStorageKeyPath(42)).toBe(42)
    expect(redactArtifactStorageKeyPath(undefined)).toBeUndefined()
  })
})

describe('redactArtifactStorageKeys', () => {
  it('redacts nested strings of a wide event', () => {
    const event: Record<string, unknown> = {
      path: `/api/v1/artifacts/A1/storage/${KEY}`,
      message: `PUT /api/v1/artifacts/A1/storage/${KEY}`,
      error: {
        stack: `at put (/api/v1/artifacts/A1/storage/${KEY}:1:1)`,
      },
      attributes: {
        urls: [`https://besidka.com/api/v1/artifacts/A1/storage/${KEY}?x=1`],
      },
    }

    redactArtifactStorageKeys(event)

    expect(JSON.stringify(event)).not.toContain(KEY)
    expect(event.path).toBe('/api/v1/artifacts/A1/storage/[key]')
    expect(event.message).toBe('PUT /api/v1/artifacts/A1/storage/[key]')
  })
})
