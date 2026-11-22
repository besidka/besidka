import { defineComponent, h, provide } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGoogleDriveLibrary } from '../../../app/composables/google-drive-library'
import {
  FILE_MANAGER_DIALOG_KEY,
} from '../../../app/utils/file-manager-dialog'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  pick: vi.fn(),
  ensureSendConsent: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  calls: [] as string[],
  suspend: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
  onChanged: vi.fn(),
  onConnectionIssue: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useWarningMessage', () => mocks.warning)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: mocks.ensureSendConsent,
}))
mockNuxtImport('useGooglePicker', () => () => ({ pick: mocks.pick }))

const PICKED = {
  id: 'drive-file-1-aaaaaaaaaaaa',
  name: 'Plan',
  mimeType: 'application/vnd.google-apps.document',
  resourceKey: 'key-1',
}

type Library = ReturnType<typeof useGoogleDriveLibrary>

const holder: { library: Library | null } = { library: null }

const Consumer = defineComponent({
  setup() {
    holder.library = useGoogleDriveLibrary({
      getFileName: fileId => `name-of-${fileId}`,
      onChanged: mocks.onChanged,
      onConnectionIssue: mocks.onConnectionIssue,
    })

    return () => h('div')
  },
})

const Provider = defineComponent({
  setup() {
    provide(FILE_MANAGER_DIALOG_KEY, {
      close: mocks.close,
      suspend: mocks.suspend,
      resume: mocks.resume,
    })

    return () => h(Consumer)
  },
})

async function mountLibrary(): Promise<Library> {
  holder.library = null

  await mountSuspended(Provider)

  return holder.library!
}

function imported(id = PICKED.id) {
  return {
    id,
    status: 'imported',
    file: { id: 'file-1', storageKey: 'copy-1.md', name: 'Plan.md' },
  }
}

function deferred<TValue>() {
  let resolve: (value: TValue) => void = () => {}
  const promise = new Promise<TValue>((resolver) => {
    resolve = resolver
  })

  return { promise, resolve }
}

describe('useGoogleDriveLibrary', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === 'function') {
        mock.mockReset()
      }
    })
    mocks.calls.length = 0
    mocks.ensureSendConsent.mockImplementation(async () => {
      mocks.calls.push('consent')

      return true
    })
    mocks.suspend.mockImplementation(() => mocks.calls.push('suspend'))
    mocks.resume.mockImplementation(() => mocks.calls.push('resume'))
    mocks.pick.mockImplementation(async () => {
      mocks.calls.push('pick')

      return { status: 'picked', items: [PICKED], rejected: [] }
    })
    mocks.fetch.mockImplementation(async (url: string) => {
      mocks.calls.push(url)

      return { results: [imported()] }
    })
  })

  describe('pickMore', () => {
    it('suspends the dialog for the pick and resumes it before copying',
      async () => {
        const library = await mountLibrary()

        await library.pickMore()

        expect(mocks.calls).toEqual([
          'consent',
          'suspend',
          'pick',
          'resume',
          '/api/v1/google/drive/files',
        ])
        expect(mocks.pick).toHaveBeenCalledWith({ maxItems: 5 })
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/google/drive/files',
          {
            method: 'POST',
            body: { items: [{ id: PICKED.id, resourceKey: 'key-1' }] },
          },
        )
      })

    it('refreshes the list once and says how many files were copied',
      async () => {
        const library = await mountLibrary()

        await library.pickMore()

        expect(mocks.onChanged).toHaveBeenCalledOnce()
        expect(mocks.success).toHaveBeenCalledWith(
          'Copied 1 file from Google Drive',
        )
      })

    it('passes the first-sheet note on', async () => {
      mocks.fetch.mockResolvedValue({
        results: [{ ...imported(), note: 'Only the first sheet is included.' }],
      })

      const library = await mountLibrary()

      await library.pickMore()

      expect(mocks.info).toHaveBeenCalledWith(
        'Only the first sheet is included.',
      )
    })

    it('does not open the picker when the consent is refused', async () => {
      mocks.ensureSendConsent.mockResolvedValue(false)

      const library = await mountLibrary()

      await library.pickMore()

      expect(mocks.suspend).not.toHaveBeenCalled()
      expect(mocks.pick).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('resumes the dialog and copies nothing when the pick is canceled',
      async () => {
        mocks.pick.mockResolvedValue({ status: 'canceled' })

        const library = await mountLibrary()

        await library.pickMore()

        expect(mocks.resume).toHaveBeenCalledOnce()
        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(mocks.onChanged).not.toHaveBeenCalled()
      })

    it('resumes the dialog even when the picker throws', async () => {
      mocks.pick.mockRejectedValue(new Error('boom'))

      const library = await mountLibrary()

      await expect(library.pickMore()).rejects.toThrow('boom')

      expect(mocks.resume).toHaveBeenCalledOnce()
      expect(library.isBusy.value).toBe(false)
    })

    it.each(['not-connected', 'reauthorize'])(
      'asks for a connection check when the picker answers %s',
      async (code) => {
        mocks.pick.mockResolvedValue({
          status: 'error',
          code,
          message: 'x',
        })

        const library = await mountLibrary()

        await library.pickMore()

        expect(mocks.onConnectionIssue).toHaveBeenCalledOnce()
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.resume).toHaveBeenCalledOnce()
      },
    )

    it('tells the user what to check when the picker fails', async () => {
      mocks.pick.mockResolvedValue({
        status: 'error',
        code: 'script-blocked',
        message: 'Google\'s file picker could not be loaded',
        why: 'Check your connection.',
      })

      const library = await mountLibrary()

      await library.pickMore()

      expect(mocks.error).toHaveBeenCalledWith(
        'Google\'s file picker could not be loaded',
        'Check your connection.',
      )
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('warns about each file Google did not share', async () => {
      mocks.pick.mockResolvedValue({
        status: 'picked',
        items: [PICKED],
        rejected: [{ name: 'Secret.pdf', error: 'No access' }],
      })

      const library = await mountLibrary()

      await library.pickMore()

      expect(mocks.warning).toHaveBeenCalledWith(
        'Secret.pdf could not be copied',
        'No access',
      )
    })

    it('warns about a file that could not be copied and counts the rest',
      async () => {
        const other = 'drive-file-2-bbbbbbbbbbbb'

        mocks.pick.mockResolvedValue({
          status: 'picked',
          items: [PICKED, { ...PICKED, id: other, name: 'Budget' }],
          rejected: [],
        })
        mocks.fetch.mockResolvedValue({
          results: [
            imported(),
            {
              id: other,
              status: 'failed',
              code: 'too_large',
              reason: 'Too large.',
            },
          ],
        })

        const library = await mountLibrary()

        await library.pickMore()

        expect(mocks.warning).toHaveBeenCalledWith(
          'Budget could not be copied',
          'Too large.',
        )
        expect(mocks.success).toHaveBeenCalledWith(
          'Copied 1 file from Google Drive',
        )
      })

    it('does not say copied when every file failed', async () => {
      mocks.fetch.mockResolvedValue({
        results: [{
          id: PICKED.id,
          status: 'failed',
          code: 'failed',
          reason: 'Try again.',
        }],
      })

      const library = await mountLibrary()

      await library.pickMore()

      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.onChanged).toHaveBeenCalledOnce()
    })

    it.each([404, 409])(
      'asks for a connection check when the copy request answers %s',
      async (status) => {
        mocks.fetch.mockRejectedValue({ status, data: { message: 'x' } })

        const library = await mountLibrary()

        await library.pickMore()

        expect(mocks.onConnectionIssue).toHaveBeenCalledOnce()
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.onChanged).not.toHaveBeenCalled()
      },
    )

    it('shows another copy failure as an error', async () => {
      mocks.fetch.mockRejectedValue({
        status: 500,
        data: { message: 'Storage is full', why: 'No room' },
      })

      const library = await mountLibrary()

      await library.pickMore()

      expect(mocks.error).toHaveBeenCalledWith('Storage is full', 'No room')
      expect(mocks.onConnectionIssue).not.toHaveBeenCalled()
    })

    it('ignores a second pick while one is running', async () => {
      const pending = deferred<{ status: 'canceled' }>()

      mocks.pick.mockReturnValue(pending.promise)

      const library = await mountLibrary()
      const first = library.pickMore()

      await flushPromises()

      expect(library.isPicking.value).toBe(true)

      await library.pickMore()

      expect(mocks.pick).toHaveBeenCalledOnce()

      pending.resolve({ status: 'canceled' })
      await first

      expect(library.isBusy.value).toBe(false)
    })
  })

  describe('refreshCopies', () => {
    function refreshed(...results: unknown[]) {
      mocks.fetch.mockResolvedValue({ results })
    }

    it('asks the server once for up to five copies', async () => {
      refreshed({ id: 'a', status: 'up_to_date' })

      const library = await mountLibrary()

      await library.refreshCopies(['a'])

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/drive/files/refresh',
        { method: 'POST', body: { ids: ['a'] } },
      )
    })

    it('does nothing for no copies', async () => {
      const library = await mountLibrary()

      await library.refreshCopies([])

      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('sends more than five copies in sequential requests of five',
      async () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        const order: string[][] = []

        mocks.fetch.mockImplementation(async (
          _url: string,
          options: { body: { ids: string[] } },
        ) => {
          order.push(options.body.ids)

          return {
            results: options.body.ids.map((id) => {
              return { id, status: 'up_to_date' }
            }),
          }
        })

        const library = await mountLibrary()

        await library.refreshCopies(ids)

        expect(order).toEqual([['a', 'b', 'c', 'd', 'e'], ['f', 'g']])
        expect(mocks.info).toHaveBeenCalledWith('7 files are up to date')
      })

    it('says a single file is up to date by its name', async () => {
      refreshed({ id: 'a', status: 'up_to_date' })

      const library = await mountLibrary()

      await library.refreshCopies(['a'])

      expect(mocks.info).toHaveBeenCalledWith('name-of-a is up to date')
      expect(mocks.onChanged).not.toHaveBeenCalled()
    })

    it('reports a new copy, keeps the earlier one and reloads the list',
      async () => {
        refreshed({
          id: 'a',
          status: 'updated',
          file: { id: 'new' },
          note: 'Only the first sheet is included.',
        })

        const library = await mountLibrary()

        await library.refreshCopies(['a'])

        expect(mocks.success).toHaveBeenCalledWith(
          'Copied the new version of name-of-a',
          'The earlier copy stays in your files for the messages that '
          + 'used it.',
        )
        expect(mocks.info).toHaveBeenCalledWith(
          'Only the first sheet is included.',
        )
        expect(mocks.onChanged).toHaveBeenCalledOnce()
      })

    it('reports a newer copy that already exists without reloading',
      async () => {
        refreshed({ id: 'a', status: 'newer_copy', file: { id: 'new' } })

        const library = await mountLibrary()

        await library.refreshCopies(['a'])

        expect(mocks.info).toHaveBeenCalledWith(
          'A newer copy of name-of-a is already in your files',
        )
        expect(mocks.onChanged).not.toHaveBeenCalled()
      })

    it('warns about each copy that could not be refreshed', async () => {
      refreshed(
        {
          id: 'a',
          status: 'failed',
          code: 'deleted',
          reason: 'This file is in the trash.',
        },
        { id: 'b', status: 'updated', file: { id: 'new' } },
      )

      const library = await mountLibrary()

      await library.refreshCopies(['a', 'b'])

      expect(mocks.warning).toHaveBeenCalledWith(
        'name-of-a could not be refreshed',
        'This file is in the trash.',
      )
      expect(mocks.success).toHaveBeenCalled()
    })

    it.each([404, 409])(
      'asks for a connection check when the server answers %s',
      async (status) => {
        mocks.fetch.mockRejectedValue({ status, data: { message: 'x' } })

        const library = await mountLibrary()

        await library.refreshCopies(['a'])

        expect(mocks.onConnectionIssue).toHaveBeenCalledOnce()
        expect(mocks.error).not.toHaveBeenCalled()
      },
    )

    it('keeps what was reported when a later request fails', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f']

      mocks.fetch
        .mockResolvedValueOnce({
          results: ['a', 'b', 'c', 'd', 'e'].map((id) => {
            return { id, status: 'updated', file: { id: `new-${id}` } }
          }),
        })
        .mockRejectedValueOnce({ status: 429, data: { message: 'Slow down' } })

      const library = await mountLibrary()

      await library.refreshCopies(ids)

      expect(mocks.error).toHaveBeenCalledWith('Slow down', undefined)
      expect(mocks.success).toHaveBeenCalledWith(
        'Copied new versions of 5 files',
        expect.any(String),
      )
      expect(mocks.onChanged).toHaveBeenCalledOnce()
      expect(library.isRefreshing.value).toBe(false)
    })

    it('is ignored while a pick is running', async () => {
      const pending = deferred<{ status: 'canceled' }>()

      mocks.pick.mockReturnValue(pending.promise)

      const library = await mountLibrary()
      const picking = library.pickMore()

      await flushPromises()
      await library.refreshCopies(['a'])

      expect(mocks.fetch).not.toHaveBeenCalled()

      pending.resolve({ status: 'canceled' })
      await picking
    })
  })
})
