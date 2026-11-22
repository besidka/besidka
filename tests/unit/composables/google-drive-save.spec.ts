import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { nextTick, shallowRef } from 'vue'
import { useState } from '#imports'
import { useGoogleDriveSave } from '../../../app/composables/google-drive-save'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  ensureSendConsent: vi.fn(),
  featureActive: null as unknown as { value: { active: boolean } },
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: mocks.ensureSendConsent,
}))
mockNuxtImport('useFeature', () => () => mocks.featureActive)

const KEY = 'generated-report.md'
const LINK = 'https://drive.google.com/open?id=1NewDriveNewDriveNewDriveNew99'
const STATUS_ROUTE = '/api/v1/google/connections'

function activeConnection(capabilities = ['identity', 'drive-picked']) {
  return { status: 'active', capabilities }
}

function replyWithConnection(connection: unknown) {
  mocks.fetch.mockImplementation(async (url: string) => {
    return url === STATUS_ROUTE ? { connection } : {}
  })
}

function statusCalls() {
  return mocks.fetch.mock.calls.filter(([url]) => url === STATUS_ROUTE)
}

describe('useGoogleDriveSave', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.error.mockReset()
    mocks.ensureSendConsent.mockReset().mockResolvedValue(true)
    mocks.featureActive = shallowRef({ active: true })
    replyWithConnection(activeConnection())
    useState('google-drive-saved-files').value = {}
    useState('google-drive-save-connection').value = null
    useState('google-drive-save-connection-requested').value = false
  })

  describe('isAvailable', () => {
    it('is true for an active connection that holds the picked-files access',
      async () => {
        const subject = useGoogleDriveSave()

        await vi.waitFor(() => {
          expect(subject.isAvailable.value).toBe(true)
        })
      })

    it('reads the connection once for any number of cards', async () => {
      const first = useGoogleDriveSave()
      const second = useGoogleDriveSave()
      const third = useGoogleDriveSave()

      await vi.waitFor(() => {
        expect(third.isAvailable.value).toBe(true)
      })

      expect(first.isAvailable.value).toBe(true)
      expect(second.isAvailable.value).toBe(true)
      expect(statusCalls()).toHaveLength(1)
    })

    it('reads no connection and stays off while google.drive is inactive',
      async () => {
        mocks.featureActive.value = { active: false }

        const subject = useGoogleDriveSave()

        await nextTick()

        expect(subject.isAvailable.value).toBe(false)
        expect(statusCalls()).toHaveLength(0)
      })

    it('reads the connection when the flag turns active after the card '
      + 'mounted', async () => {
      mocks.featureActive.value = { active: false }

      const subject = useGoogleDriveSave()

      expect(statusCalls()).toHaveLength(0)

      mocks.featureActive.value = { active: true }

      await vi.waitFor(() => {
        expect(subject.isAvailable.value).toBe(true)
      })

      expect(statusCalls()).toHaveLength(1)
    })

    it.each([
      ['no connection', null],
      ['a connection that needs re-authorization', {
        status: 'needs_reauth',
        capabilities: [],
      }],
      ['a connection without the picked-files access', activeConnection([
        'identity',
      ])],
    ])('is false for %s', async (_name, connection) => {
      replyWithConnection(connection)

      const subject = useGoogleDriveSave()

      await vi.waitFor(() => {
        expect(statusCalls()).toHaveLength(1)
      })
      await nextTick()

      expect(subject.isAvailable.value).toBe(false)
    })

    it('tries again later when the connection could not be read', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('offline'))

      useGoogleDriveSave()

      await vi.waitFor(() => {
        expect(statusCalls()).toHaveLength(1)
      })
      await nextTick()

      replyWithConnection(activeConnection())

      const subject = useGoogleDriveSave()

      await vi.waitFor(() => {
        expect(subject.isAvailable.value).toBe(true)
      })
    })
  })

  describe('save', () => {
    it('posts the storage key and remembers the Drive link', async () => {
      mocks.fetch.mockResolvedValueOnce({ connection: null })
      mocks.fetch.mockResolvedValueOnce({
        status: 'saved',
        link: LINK,
        driveFileId: 'drive-1',
      })

      const subject = useGoogleDriveSave()
      const saved = await subject.save(KEY)

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/drive/saved-files',
        { method: 'POST', body: { storageKey: KEY } },
      )
      expect(saved).toEqual({ link: LINK, driveFileId: 'drive-1' })
      expect(subject.getSaved(KEY)).toEqual(saved)
      expect(subject.getSaved('other.md')).toBeNull()
    })

    it('does nothing when the user declines the consent', async () => {
      mocks.ensureSendConsent.mockResolvedValueOnce(false)

      expect(await useGoogleDriveSave().save(KEY)).toBeNull()
      expect(mocks.fetch).not.toHaveBeenCalledWith(
        '/api/v1/google/drive/saved-files',
        expect.anything(),
      )
    })

    it('shows the server reason and remembers nothing when it fails',
      async () => {
        mocks.fetch.mockImplementation(async (url: string) => {
          if (url === STATUS_ROUTE) {
            return { connection: null }
          }

          throw Object.assign(new Error('x'), {
            data: {
              message: 'Your Google Drive storage is full.',
              why: 'The save was refused: drive_full',
            },
          })
        })

        const subject = useGoogleDriveSave()

        expect(await subject.save(KEY)).toBeNull()
        expect(mocks.error).toHaveBeenCalledTimes(1)
        expect(subject.getSaved(KEY)).toBeNull()
      })
  })
})
