import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFileAccessToken,
  hasShareTokenFileAccess,
} from '~~/server/utils/files/file-share-access'

const event = {} as Parameters<typeof createFileAccessToken>[1]

function stubGrant(share: {
  googleOptInAt: Date | null
  googleDataAt: Date | null
}) {
  vi.stubGlobal('useDb', () => ({
    query: {
      chatShareFiles: {
        findFirst: vi.fn(async () => ({
          id: 1,
          share: {
            revoked: false,
            expiresAt: null,
            showFiles: true,
            googleOptInAt: share.googleOptInAt,
            chat: { googleDataAt: share.googleDataAt },
          },
        })),
      },
    },
  }))
}

async function tokenFor(fileId: string) {
  return await createFileAccessToken({
    shareId: 'share-1',
    fileId,
    expiresInSeconds: 300,
  }, event)
}

describe('hasShareTokenFileAccess and chats that hold Google data', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('useRuntimeConfig', () => ({ encryptionKey: 'test-key' }))
  })

  it('serves a granted file of an ordinary chat', async () => {
    stubGrant({ googleOptInAt: null, googleDataAt: null })

    expect(await hasShareTokenFileAccess(
      await tokenFor('file-1'),
      'file-1',
      event,
    )).toBe(true)
  })

  it('refuses a file of a flagged chat whose share has no opt-in', async () => {
    stubGrant({ googleOptInAt: null, googleDataAt: new Date(2_000_000) })

    expect(await hasShareTokenFileAccess(
      await tokenFor('file-1'),
      'file-1',
      event,
    )).toBe(false)
  })

  it('serves it while the share carries the stored opt-in', async () => {
    stubGrant({
      googleOptInAt: new Date(3_000_000),
      googleDataAt: new Date(2_000_000),
    })

    expect(await hasShareTokenFileAccess(
      await tokenFor('file-1'),
      'file-1',
      event,
    )).toBe(true)
  })
})
