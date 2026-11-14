import { describe, expect, it } from 'vitest'
import {
  createStorageFullError,
  describeStorageFullForModel,
  isStorageFullError,
} from '~~/server/utils/storage/errors'

describe('storage full error', () => {
  const quota = { usedBytes: 20 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 }

  it('answers 413 with usage, a fix and the Storage page link', () => {
    expect(createStorageFullError(quota)).toMatchObject({
      status: 413,
      message: 'Storage is full',
      code: 'storage_full',
      why: '20.0 MB of 20.0 MB used',
      fix: 'Free space on the Storage page',
      link: '/profile/storage',
    })
  })

  it('is recognised by its code only', () => {
    expect(isStorageFullError(createStorageFullError(quota))).toBe(true)
    expect(isStorageFullError(new Error('Storage is full'))).toBe(false)
    expect(isStorageFullError(null)).toBe(false)
    expect(isStorageFullError('storage_full')).toBe(false)
  })

  it('describes the failure to a model as plain text', () => {
    const text = describeStorageFullForModel(createStorageFullError(quota))

    expect(text).toBe(
      'Storage is full. 20.0 MB of 20.0 MB used. Tell the user to free '
      + 'space on the Storage page of their Besidka settings, then ask again.',
    )
  })
})
