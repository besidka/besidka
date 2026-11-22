import { effectScope, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatDriveFiles } from '../../../app/composables/chat-drive-files'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  pick: vi.fn(),
  ensureSendConsent: vi.fn(),
  confirm: vi.fn(),
  navigateTo: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  remember: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useWarningMessage', () => mocks.warning)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: mocks.ensureSendConsent,
}))
mockNuxtImport('useGooglePicker', () => () => ({
  pick: mocks.pick,
  isCheckingConnection: checkingConnection,
}))
mockNuxtImport('useChatRoute', () => () => ({
  routeSlug: routeSlug,
}))
mockNuxtImport('useChatGoogleData', () => () => ({
  rememberChatGoogleData: mocks.remember,
  isChatHoldingGoogleData: () => false,
}))

const routeSlug = shallowRef<string | null>('chat-1')
const checkingConnection = shallowRef<boolean>(false)

const PICKED = {
  id: 'drive-file-1-aaaaaaaaaaaa',
  name: 'Plan',
  mimeType: 'application/vnd.google-apps.document',
  resourceKey: 'key-1',
}

function importedFile(storageKey = 'copy-1.md') {
  return {
    id: 'file-1',
    storageKey,
    name: 'Plan.md',
    size: 12,
    type: 'text/markdown',
    externalSource: 'google',
    externalId: PICKED.id,
  }
}

function createSubject(attached: unknown[] = [], scope?: EffectScope) {
  const attachedFiles = shallowRef(attached) as never
  const attach = vi.fn((files: unknown[]) => files.length)
  const subject = scope
    ? scope.run(() => useChatDriveFiles(attachedFiles, attach))!
    : useChatDriveFiles(attachedFiles, attach)

  return { subject, attach, attachedFiles }
}

function deferred<TValue>() {
  let resolve: (value: TValue) => void = () => {}
  const promise = new Promise<TValue>((resolver) => {
    resolve = resolver
  })

  return { promise, resolve }
}

describe('useChatDriveFiles', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset())
    routeSlug.value = 'chat-1'
    mocks.ensureSendConsent.mockResolvedValue(true)
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return { policy: { maxFilesPerMessage: 10 } }
      }

      return {
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
        }],
      }
    })
    mocks.pick.mockResolvedValue({
      status: 'picked',
      items: [PICKED],
      rejected: [],
    })
  })

  it('exposes the picker\'s slow status check for the tools menu row',
    () => {
      const { subject } = createSubject()

      expect(subject.isCheckingGoogleConnection.value).toBe(false)

      checkingConnection.value = true

      expect(subject.isCheckingGoogleConnection.value).toBe(true)

      checkingConnection.value = false
    })

  it('copies the picked file and attaches it like an upload', async () => {
    const { subject, attach } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/drive/files', {
      method: 'POST',
      body: { items: [{ id: PICKED.id, resourceKey: 'key-1' }] },
    })
    expect(attach).toHaveBeenCalledWith([
      expect.objectContaining({
        storageKey: 'copy-1.md',
        externalSource: 'google',
      }),
    ])
    expect(subject.driveImports.value).toEqual([])
    expect(mocks.remember).toHaveBeenCalledWith('chat-1', true)
  })

  it('asks the picker for no more files than the message has room for',
    async () => {
      mocks.fetch.mockImplementation(async (url: string) => {
        return url === '/api/v1/files/policy'
          ? { policy: { maxFilesPerMessage: 4 } }
          : { results: [] }
      })

      const { subject } = createSubject([
        { storageKey: 'a' },
        { storageKey: 'b' },
      ])

      await subject.attachFromDrive()

      expect(mocks.pick).toHaveBeenCalledWith({ maxItems: 2 })
    })

  it('refuses to open the picker when the message is full', async () => {
    mocks.fetch.mockResolvedValue({ policy: { maxFilesPerMessage: 1 } })

    const { subject } = createSubject([{ storageKey: 'a' }])

    await subject.attachFromDrive()

    expect(mocks.pick).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(
      'You can attach a maximum of 1 files in total.',
    )
  })

  it('stops when the user does not consent to sending files', async () => {
    mocks.ensureSendConsent.mockResolvedValue(false)

    const { subject } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.pick).not.toHaveBeenCalled()
  })

  it('does nothing when the picker is canceled', async () => {
    mocks.pick.mockResolvedValue({ status: 'canceled' })

    const { subject, attach } = createSubject()

    await subject.attachFromDrive()

    expect(attach).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      '/api/v1/google/drive/files',
      expect.anything(),
    )
  })

  it.each(['not-connected', 'reauthorize'])(
    'leads to the Google tab with one plain sentence when %s',
    async (code) => {
      mocks.pick.mockResolvedValue({
        status: 'error',
        code,
        message: 'Reconnect',
      })
      mocks.confirm.mockResolvedValue({ label: 'Open API Keys', index: 0 })

      const { subject } = createSubject()

      await subject.attachFromDrive()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Connect Google Drive on the API Keys page to attach files '
          + 'from it.',
        actions: ['Open API Keys'],
        labelDecline: 'Not now',
      })
      expect(mocks.navigateTo).toHaveBeenCalledWith('/profile/keys?tab=google')
    },
  )

  it('stays on the page when the user declines to open API Keys', async () => {
    mocks.pick.mockResolvedValue({
      status: 'error',
      code: 'not-connected',
      message: 'Not connected',
    })
    mocks.confirm.mockResolvedValue(null)

    const { subject } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('shows any other picker failure as an error with its reason',
    async () => {
      mocks.pick.mockResolvedValue({
        status: 'error',
        code: 'script-blocked',
        message: 'Google\'s file picker could not be loaded',
        why: 'Check your connection',
      })

      const { subject } = createSubject()

      await subject.attachFromDrive()

      expect(mocks.error).toHaveBeenCalledWith(
        'Google\'s file picker could not be loaded',
        'Check your connection',
      )
      expect(mocks.navigateTo).not.toHaveBeenCalled()
    })

  it('warns about a file Drive refused to share', async () => {
    mocks.pick.mockResolvedValue({
      status: 'picked',
      items: [PICKED],
      rejected: [{ name: 'Locked', error: 'The file is not shared' }],
    })

    const { subject } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.warning).toHaveBeenCalledWith(
      'Locked could not be attached',
      'The file is not shared',
    )
  })

  it('keeps a failed file with its reason and attaches the others',
    async () => {
      mocks.pick.mockResolvedValue({
        status: 'picked',
        items: [PICKED, { ...PICKED, id: 'drive-file-2-aaaaaaaaaaaa', name: 'Big' }],
        rejected: [],
      })
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === '/api/v1/files/policy') {
          return { policy: { maxFilesPerMessage: 10 } }
        }

        return {
          results: [
            { id: PICKED.id, status: 'imported', file: importedFile() },
            {
              id: 'drive-file-2-aaaaaaaaaaaa',
              status: 'failed',
              code: 'too_large',
              reason: 'This file is too large to attach.',
            },
          ],
        }
      })

      const { subject, attach } = createSubject()

      await subject.attachFromDrive()

      expect(attach).toHaveBeenCalledWith([
        expect.objectContaining({ storageKey: 'copy-1.md' }),
      ])
      expect(subject.driveImports.value).toEqual([{
        id: 'drive-file-2-aaaaaaaaaaaa',
        name: 'Big',
        status: 'failed',
        error: 'This file is too large to attach.',
      }])
      expect(mocks.warning).toHaveBeenCalledWith(
        'Big could not be attached',
        'This file is too large to attach.',
      )
    })

  it('says only the first sheet is included for a sheet copy', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return { policy: { maxFilesPerMessage: 10 } }
      }

      return {
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
          note: 'Only the first sheet is included.',
        }],
      }
    })

    const { subject } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.info).toHaveBeenCalledWith('Only the first sheet is included.')
  })

  it('marks every file failed when the import request fails', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return { policy: { maxFilesPerMessage: 10 } }
      }

      throw Object.assign(new Error('Storage is full'), {
        status: 413,
        data: { message: 'Storage is full', why: '20 MB of 20 MB used' },
      })
    })

    const { subject, attach } = createSubject()

    await subject.attachFromDrive()

    expect(attach).not.toHaveBeenCalled()
    expect(subject.driveImports.value).toMatchObject([
      { id: PICKED.id, status: 'failed' },
    ])
    expect(mocks.error).toHaveBeenCalled()
  })

  it('does not attach a copy that is already attached', async () => {
    const { subject, attach } = createSubject([{ storageKey: 'copy-1.md' }])

    await subject.attachFromDrive()

    expect(attach).toHaveBeenCalledWith([])
  })

  it('does not mark the chat when nothing was attached', async () => {
    const { subject } = createSubject([{ storageKey: 'copy-1.md' }])

    await subject.attachFromDrive()

    expect(mocks.remember).not.toHaveBeenCalled()
  })

  describe('while a pick or a copy is in flight', () => {
    it('is busy from the pick until the copies are attached', async () => {
      const picking = deferred<unknown>()
      const importing = deferred<unknown>()

      mocks.pick.mockReturnValue(picking.promise)
      mocks.fetch.mockImplementation(async (url: string) => {
        return url === '/api/v1/files/policy'
          ? { policy: { maxFilesPerMessage: 10 } }
          : await importing.promise
      })

      const { subject } = createSubject()
      const running = subject.attachFromDrive()

      await vi.waitFor(() => expect(mocks.pick).toHaveBeenCalled())

      expect(subject.isDriveBusy.value).toBe(true)

      picking.resolve({ status: 'picked', items: [PICKED], rejected: [] })
      await vi.waitFor(() => {
        expect(subject.driveImports.value).toHaveLength(1)
      })

      expect(subject.isDriveBusy.value).toBe(true)

      importing.resolve({
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
        }],
      })
      await running

      expect(subject.isDriveBusy.value).toBe(false)
    })

    it('ignores a second request while busy', async () => {
      const picking = deferred<unknown>()

      mocks.pick.mockReturnValue(picking.promise)

      const { subject } = createSubject()
      const first = subject.attachFromDrive()

      await vi.waitFor(() => expect(mocks.pick).toHaveBeenCalled())
      await subject.attachFromDrive()

      expect(mocks.pick).toHaveBeenCalledTimes(1)

      picking.resolve({ status: 'canceled' })
      await first
    })

    it('drops a result that arrives after the message was sent', async () => {
      const importing = deferred<unknown>()

      mocks.fetch.mockImplementation(async (url: string) => {
        return url === '/api/v1/files/policy'
          ? { policy: { maxFilesPerMessage: 10 } }
          : await importing.promise
      })

      const { subject, attach } = createSubject()
      const running = subject.attachFromDrive()

      await vi.waitFor(() => {
        expect(subject.driveImports.value).toHaveLength(1)
      })
      await useNuxtApp().callHook('chat:submit' as never)

      expect(subject.isDriveBusy.value).toBe(false)

      importing.resolve({
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
        }],
      })
      await running

      expect(attach).not.toHaveBeenCalled()
      expect(mocks.remember).not.toHaveBeenCalled()
      expect(subject.driveImports.value).toEqual([])
    })

    it('does not open the picker for a result nobody will use', async () => {
      const picking = deferred<unknown>()

      mocks.pick.mockReturnValue(picking.promise)

      const { subject, attach } = createSubject()
      const running = subject.attachFromDrive()

      await vi.waitFor(() => expect(mocks.pick).toHaveBeenCalled())
      await useNuxtApp().callHook('chat:submit' as never)
      picking.resolve({ status: 'picked', items: [PICKED], rejected: [] })
      await running

      expect(mocks.fetch).not.toHaveBeenCalledWith(
        '/api/v1/google/drive/files',
        expect.anything(),
      )
      expect(attach).not.toHaveBeenCalled()
    })

    it('drops the result when its owning scope is disposed', async () => {
      const importing = deferred<unknown>()
      const scope = effectScope()

      mocks.fetch.mockImplementation(async (url: string) => {
        return url === '/api/v1/files/policy'
          ? { policy: { maxFilesPerMessage: 10 } }
          : await importing.promise
      })

      const { subject, attach } = createSubject([], scope)
      const running = subject.attachFromDrive()

      await vi.waitFor(() => {
        expect(subject.driveImports.value).toHaveLength(1)
      })
      scope.stop()
      importing.resolve({
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
        }],
      })
      await running

      expect(attach).not.toHaveBeenCalled()
    })
  })

  it('does not mark a new chat that has no slug yet', async () => {
    routeSlug.value = null

    const { subject } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.remember).not.toHaveBeenCalled()
  })

  it('lets the user dismiss a failed file', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return { policy: { maxFilesPerMessage: 10 } }
      }

      return {
        results: [{
          id: PICKED.id,
          status: 'failed',
          code: 'folder',
          reason: 'Folders cannot be attached.',
        }],
      }
    })

    const { subject } = createSubject()

    await subject.attachFromDrive()

    expect(subject.driveImports.value).toHaveLength(1)

    subject.dismissDriveImport(PICKED.id)

    expect(subject.driveImports.value).toEqual([])
  })
})
