import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useState } from '#imports'
import { useGoogleDriveSave } from '../../../app/composables/google-drive-save'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  ensureSendConsent: vi.fn(),
  useGoogleConnection: vi.fn(),
  featureActive: true,
  connection: null as unknown,
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: mocks.ensureSendConsent,
}))
mockNuxtImport('useFeature', () => () => ({
  value: { active: mocks.featureActive },
}))
mockNuxtImport('useGoogleConnection', () => () => {
  mocks.useGoogleConnection()

  return { data: { value: { connection: mocks.connection } } }
})

const KEY = 'generated-report.md'
const LINK = 'https://drive.google.com/open?id=1NewDriveNewDriveNewDriveNew99'

function activeConnection(capabilities = ['identity', 'drive-picked']) {
  return { status: 'active', capabilities }
}

describe('useGoogleDriveSave', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.error.mockReset()
    mocks.useGoogleConnection.mockReset()
    mocks.ensureSendConsent.mockReset().mockResolvedValue(true)
    mocks.featureActive = true
    mocks.connection = activeConnection()
    useState('google-drive-saved-files').value = {}
  })

  describe('isAvailable', () => {
    it('is true for an active connection that holds the picked-files access',
      () => {
        expect(useGoogleDriveSave().isAvailable.value).toBe(true)
      })

    it('reads no connection and stays off while google.drive is inactive',
      () => {
        mocks.featureActive = false

        expect(useGoogleDriveSave().isAvailable.value).toBe(false)
        expect(mocks.useGoogleConnection).not.toHaveBeenCalled()
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
    ])('is false for %s', (_name, connection) => {
      mocks.connection = connection

      expect(useGoogleDriveSave().isAvailable.value).toBe(false)
    })
  })

  describe('save', () => {
    it('posts the storage key and remembers the Drive link', async () => {
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
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('shows the server reason and remembers nothing when it fails',
      async () => {
        mocks.fetch.mockRejectedValueOnce(Object.assign(new Error('x'), {
          data: {
            message: 'Your Google Drive storage is full.',
            why: 'The save was refused: drive_full',
          },
        }))

        const subject = useGoogleDriveSave()

        expect(await subject.save(KEY)).toBeNull()
        expect(mocks.error).toHaveBeenCalledTimes(1)
        expect(subject.getSaved(KEY)).toBeNull()
      })
  })
})
