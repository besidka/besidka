import { computed, effectScope, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
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
const featureActive = shallowRef<boolean>(true)
const connectionData = shallowRef<unknown>(null)

mockNuxtImport('useNuxtData', () => () => ({ data: connectionData }))

function connectionStatus(
  overrides: { status?: string, capabilities?: string[] } = {},
) {
  return {
    connection: {
      clientMode: 'besidka',
      status: overrides.status ?? 'active',
      email: 'person@example.test',
      capabilities: overrides.capabilities ?? ['identity', 'drive-picked'],
      connectedAt: '2026-11-22T10:00:00.000Z',
    },
    canConnect: true,
    dedicatedClient: true,
    byo: null,
  }
}

const connectorsActive = shallowRef<boolean>(true)

mockNuxtImport('useFeature', () => (key: string) => computed(() => {
  const isActive = key === 'connectors'
    ? connectorsActive.value
    : featureActive.value

  return { enabled: isActive, active: isActive, variant: null }
}))

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

function createSubject(
  attached: unknown[] = [],
  scope?: EffectScope,
  options: { isAvailable?: () => boolean } = {},
) {
  const attachedFiles = shallowRef(attached) as never
  const attach = vi.fn((files: unknown[]) => files.length)
  const subject = scope
    ? scope.run(() => useChatDriveFiles(attachedFiles, attach, options))!
    : useChatDriveFiles(attachedFiles, attach, options)

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
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset())
    routeSlug.value = 'chat-1'
    featureActive.value = true
    connectorsActive.value = true
    connectionData.value = connectionStatus()
    clearNuxtState('google-drive-unreadable-links')
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
    'leads to the Google Drive panel with one plain sentence when %s',
    async (code) => {
      mocks.pick.mockResolvedValue({
        status: 'error',
        code,
        message: 'Reconnect',
      })
      mocks.confirm.mockResolvedValue({ label: 'Open Connectors', index: 0 })

      const { subject } = createSubject()

      await subject.attachFromDrive()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Connect Google Drive on the Connectors page to attach files '
          + 'from it.',
        actions: ['Open Connectors'],
        labelDecline: 'Not now',
      })
      expect(mocks.navigateTo)
        .toHaveBeenCalledWith('/chats/connectors?panel=google-drive')
    },
  )

  it('leads to the Google tab of API Keys without the connectors flag',
    async () => {
      connectorsActive.value = false
      mocks.pick.mockResolvedValue({
        status: 'error',
        code: 'not-connected',
        message: 'Not connected',
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
    })

  it('stays on the page when the user declines to open the connect page',
    async () => {
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
        code: 'too_large',
      }])
    })

  it('keeps Google\'s status, reason and stage for the failed chip',
    async () => {
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === '/api/v1/files/policy') {
          return { policy: { maxFilesPerMessage: 10 } }
        }

        return {
          results: [{
            id: PICKED.id,
            status: 'failed',
            code: 'not_found',
            reason: 'Pick it again.',
            google: { stage: 'export', status: 404, reason: 'notFound' },
          }],
        }
      })

      const { subject } = createSubject()

      await subject.attachFromDrive()

      expect(subject.driveImports.value).toEqual([{
        id: PICKED.id,
        name: 'Plan',
        status: 'failed',
        error: 'Pick it again.',
        code: 'not_found',
        detail: 'Google: notFound, export',
      }])
    })

  describe('picking a file again', () => {
    it('opens the Picker on that one file and imports the pick', async () => {
      const { subject, attach } = createSubject()

      await subject.pickAgain(PICKED.id)

      expect(mocks.pick).toHaveBeenCalledWith({
        maxItems: 5,
        fileIds: [PICKED.id],
      })
      expect(attach).toHaveBeenCalledWith([
        expect.objectContaining({ storageKey: 'copy-1.md' }),
      ])
    })

    it('replaces the failed chip of that file while it copies', async () => {
      const importing = deferred<unknown>()

      mocks.fetch.mockImplementation(async (url: string) => {
        return url === '/api/v1/files/policy'
          ? { policy: { maxFilesPerMessage: 10 } }
          : await importing.promise
      })

      const { subject } = createSubject()
      const running = subject.pickAgain(PICKED.id)

      await vi.waitFor(() => {
        expect(subject.driveImports.value).toMatchObject([
          { id: PICKED.id, status: 'importing' },
        ])
      })

      importing.resolve({ results: [] })
      await running
    })
  })

  it('says why only the first tab was imported, with the technical code, '
    + 'and keeps the detail on the chip', async () => {
    const sheets = {
      code: 'sheets_no_access',
      status: 403,
      reason: 'PERMISSION_DENIED',
    }

    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return { policy: { maxFilesPerMessage: 10 } }
      }

      return {
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
          note: 'Only the first tab of this spreadsheet was imported.',
          sheets,
        }],
      }
    })

    const { subject, attach } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.info).toHaveBeenCalledWith(
      'Only the first tab of this spreadsheet was imported. Google did not '
      + 'let Besidka read this spreadsheet through the Google Sheets API. '
      + '(sheets_no_access (HTTP 403, PERMISSION_DENIED))',
    )
    expect(attach).toHaveBeenCalledWith([
      expect.objectContaining({ sheetsFallback: sheets }),
    ])
  })

  it('shows the plain note and no fallback detail when a map lost tabs',
    async () => {
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === '/api/v1/files/policy') {
          return { policy: { maxFilesPerMessage: 10 } }
        }

        return {
          results: [{
            id: PICKED.id,
            status: 'imported',
            file: importedFile(),
            note: 'Only 4 of 5 tabs of this spreadsheet were imported.',
          }],
        }
      })

      const { subject, attach } = createSubject()

      await subject.attachFromDrive()

      expect(mocks.info).toHaveBeenCalledWith(
        'Only 4 of 5 tabs of this spreadsheet were imported.',
      )
      expect((attach.mock.calls[0]![0] as Array<Record<string, unknown>>)[0])
        .not.toHaveProperty('sheetsFallback')
    })

  it('shows no notice and no detail for a one-tab fallback, which the '
    + 'server sends without a note', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return { policy: { maxFilesPerMessage: 10 } }
      }

      return {
        results: [{
          id: PICKED.id,
          status: 'imported',
          file: importedFile(),
          sheets: {
            code: 'sheets_too_large',
            status: 0,
            reason: 'timeout',
          },
        }],
      }
    })

    const { subject, attach } = createSubject()

    await subject.attachFromDrive()

    expect(mocks.info).not.toHaveBeenCalled()
    expect((attach.mock.calls[0]![0] as Array<Record<string, unknown>>)[0])
      .not.toHaveProperty('sheetsFallback')
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

  describe('a Google link in the message', () => {
    const LINK_ID = '1LinkLinkLinkLinkLinkLinkLink01'
    const SECOND_ID = '1LinkLinkLinkLinkLinkLinkLink02'
    const LINK_URL = `https://docs.google.com/document/d/${LINK_ID}/edit`
    const SECOND_URL = `https://drive.google.com/open?id=${SECOND_ID}`
    const LINK_ROUTE = '/api/v1/google/drive/files/link'

    function linkCalls() {
      return mocks.fetch.mock.calls.filter(call => call[0] === LINK_ROUTE)
    }

    function answerLink(
      respond: (body: { link: string }) => unknown,
    ) {
      mocks.fetch.mockImplementation(async (
        url: string,
        options?: { body?: { link: string } },
      ) => {
        if (url === LINK_ROUTE) {
          return await respond(options!.body!)
        }

        return { policy: { maxFilesPerMessage: 10 } }
      })
    }

    function copyOf(id: string) {
      return {
        ...importedFile(`copy-${id}.md`),
        externalId: id,
      }
    }

    function failedLink(code: string, reason = 'Nope.') {
      return { results: [{ id: LINK_ID, status: 'failed', code, reason }] }
    }

    it('attaches the file at once when Besidka can already read it',
      async () => {
        answerLink(() => ({
          results: [{ id: LINK_ID, status: 'imported', file: copyOf(LINK_ID) }],
        }))

        const { subject, attach } = createSubject()

        await subject.detectLinks(`see ${LINK_URL} please`)

        expect(mocks.fetch).toHaveBeenCalledWith(LINK_ROUTE, {
          method: 'POST',
          body: { link: LINK_URL },
          timeout: 15_000,
        })
        expect(attach).toHaveBeenCalledWith([
          expect.objectContaining({ storageKey: `copy-${LINK_ID}.md` }),
        ])
        expect(subject.linkSuggestions.value).toEqual([])
        expect(mocks.pick).not.toHaveBeenCalled()
        expect(mocks.remember).toHaveBeenCalledWith('chat-1', true)
        expect(mocks.ensureSendConsent).not.toHaveBeenCalled()
      })

    it('offers the Picker for the file when Besidka has no access, without '
      + 'a toast, a dialog or a chip', async () => {
      answerLink(() => failedLink('not_found'))

      const { subject, attach } = createSubject()

      await subject.detectLinks(`${LINK_URL} `)

      expect(subject.linkSuggestions.value).toEqual([
        { id: LINK_ID, kind: 'document' },
      ])
      expect(subject.driveImports.value).toEqual([])
      expect(attach).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
      expect(mocks.warning).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
      expect(mocks.confirm).not.toHaveBeenCalled()
    })

    it('keeps the resource key of the link for the suggestion', async () => {
      answerLink(() => failedLink('no_access'))

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL}?resourcekey=0-key `)

      expect(subject.linkSuggestions.value).toEqual([
        { id: LINK_ID, kind: 'document', resourceKey: '0-key' },
      ])
    })

    it.each(['reauthorize', 'rate_limited', 'failed'])(
      'stays silent when the answer is %s',
      async (code) => {
        answerLink(() => failedLink(code))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(subject.linkSuggestions.value).toEqual([])
        expect(subject.driveImports.value).toEqual([])
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.warning).not.toHaveBeenCalled()
      },
    )

    it('shows a failed chip for a file Besidka can see but cannot attach',
      async () => {
        answerLink(() => failedLink('too_large', 'This file is too large.'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(subject.driveImports.value).toMatchObject([
          { id: LINK_ID, status: 'failed', code: 'too_large' },
        ])
        expect(mocks.error).not.toHaveBeenCalled()
      })

    it.each([401, 404, 409, 429, 400])(
      'stays silent on HTTP %s',
      async (status) => {
        answerLink(() => {
          throw Object.assign(new Error('refused'), { status })
        })

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(subject.linkSuggestions.value).toEqual([])
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.warning).not.toHaveBeenCalled()
        expect(mocks.confirm).not.toHaveBeenCalled()
      },
    )

    it('stops asking once Besidka says Google is not connected, until the '
      + 'next message', async () => {
      answerLink(() => {
        throw Object.assign(new Error('Not connected'), { status: 404 })
      })

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL} `)
      await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

      expect(linkCalls()).toHaveLength(1)

      await useNuxtApp().callHook('chat:submit' as never)
      await subject.detectLinks(`${LINK_URL} `)

      expect(linkCalls()).toHaveLength(2)
    })

    it('does nothing for a user without the google.drive feature',
      async () => {
        featureActive.value = false
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(subject.linkSuggestions.value).toEqual([])
      })

    it('asks about each link once, however often the text changes',
      async () => {
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        await subject.detectLinks(`${LINK_URL} and more words`)
        await subject.detectLinks(`and more words`)
        await subject.detectLinks(`${LINK_URL} `)

        expect(linkCalls()).toHaveLength(1)
      })

    it('ignores a file that is already attached', async () => {
      answerLink(() => failedLink('not_found'))

      const { subject } = createSubject([{
        storageKey: 'copy.md',
        externalSource: 'google',
        externalId: LINK_ID,
      }])

      await subject.detectLinks(`${LINK_URL} `)

      expect(linkCalls()).toHaveLength(0)
    })

    it('asks for one link at a time, in order', async () => {
      let inFlight = 0
      let maxInFlight = 0
      const order: string[] = []

      answerLink(async (body) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        order.push(body.link)
        await new Promise(resolve => setTimeout(resolve, 1))
        inFlight--

        return failedLink('not_found')
      })

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

      expect(maxInFlight).toBe(1)
      expect(order).toEqual([LINK_URL, SECOND_URL])
    })

    it('handles at most five links in a message', async () => {
      answerLink(() => failedLink('not_found'))

      const { subject } = createSubject()
      const links = Array.from({ length: 8 }, (_unused, index) => {
        return `https://docs.google.com/document/d/${index}LinkLinkLinkLinkLinkLink0000/edit`
      })

      await subject.detectLinks(`${links.join(' ')} `)
      await subject.detectLinks(`${links.join(' ')} more `)

      expect(linkCalls()).toHaveLength(5)
    })

    describe('the placeholder while a link is checked', () => {
      it('lists each link from the moment it is queued until its answer, '
        + 'then drops it when the file is attached', async () => {
        const first = deferred<unknown>()
        const second = deferred<unknown>()
        const answers = [first, second]

        answerLink(() => answers.shift()!.promise)

        const { subject, attach } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

        expect(subject.checkingLinkIds.value).toEqual([LINK_ID, SECOND_ID])

        first.resolve({
          results: [{ id: LINK_ID, status: 'imported', file: copyOf(LINK_ID) }],
        })
        await vi.waitFor(() => expect(linkCalls()).toHaveLength(2))

        expect(subject.checkingLinkIds.value).toEqual([SECOND_ID])
        expect(attach).toHaveBeenCalledTimes(1)

        second.resolve(failedLink('not_found'))
        await running

        expect(subject.checkingLinkIds.value).toEqual([])
      })

      it('is at most five, like the links of one message', async () => {
        const answering = deferred<unknown>()
        const ids = Array.from({ length: 7 }, (_item, index) => {
          return `1LinkLinkLinkLinkLinkLinkLink${String(index + 10)}`
        })

        answerLink(() => answering.promise)

        const { subject } = createSubject()
        const running = subject.detectLinks(
          ids.map(id => `https://drive.google.com/open?id=${id}`).join(' '),
        )

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

        expect(subject.checkingLinkIds.value).toHaveLength(5)

        answering.resolve(failedLink('not_found'))
        await running
      })

      it('is gone once the link turns into the Google Drive tile',
        async () => {
          answerLink(() => failedLink('not_found'))

          const { subject } = createSubject()

          await subject.detectLinks(`${LINK_URL} `)

          expect(subject.checkingLinkIds.value).toEqual([])
          expect(subject.linkSuggestions.value).toHaveLength(1)
        })

      it('is gone after an error, a blocked answer and a rate limit, '
        + 'with no toast of its own', async () => {
        for (const failure of [
          () => {
            throw Object.assign(new Error('Server error'), { status: 500 })
          },
          () => {
            throw Object.assign(new Error('Slow down'), { status: 429 })
          },
          () => failedLink('reauthorize'),
        ]) {
          answerLink(failure)

          const { subject } = createSubject()

          await subject.detectLinks(`${LINK_URL} `)

          expect(subject.checkingLinkIds.value).toEqual([])
          expect(subject.linkSuggestions.value).toEqual([])
        }

        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.info).not.toHaveBeenCalled()
      })

      it('is gone when the message is sent meanwhile', async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

        expect(subject.checkingLinkIds.value).toEqual([LINK_ID])

        await useNuxtApp().callHook('chat:submit' as never)

        expect(subject.checkingLinkIds.value).toEqual([])

        answering.resolve(failedLink('not_found'))
        await running

        expect(subject.checkingLinkIds.value).toEqual([])
      })

      it('is gone when the composer is removed with a check pending',
        async () => {
          const answering = deferred<unknown>()
          const scope = effectScope()

          answerLink(() => answering.promise)

          const { subject } = createSubject([], scope)
          const running = subject.detectLinks(`${LINK_URL} `)

          await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

          expect(subject.checkingLinkIds.value).toEqual([LINK_ID])

          scope.stop()

          expect(subject.checkingLinkIds.value).toEqual([])

          answering.resolve(failedLink('not_found'))
          await running
        })

      it('is gone at once when the link text is deleted, and the late copy '
        + 'is deleted, not attached', async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject, attach } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

        expect(subject.checkingLinkIds.value).toEqual([LINK_ID])

        subject.cancelChecksForRemovedLinks('see nothing here')

        expect(subject.checkingLinkIds.value).toEqual([])

        await running

        answering.resolve({
          results: [{
            id: LINK_ID,
            status: 'imported',
            file: { ...copyOf(LINK_ID), id: 'file-public-id' },
          }],
        })
        await vi.waitFor(() => {
          expect(mocks.fetch).toHaveBeenCalledWith(
            '/api/v1/files/file-public-id',
            { method: 'DELETE' },
          )
        })

        expect(attach).not.toHaveBeenCalled()
        expect(subject.checkingLinkIds.value).toEqual([])
        expect(mocks.info).not.toHaveBeenCalled()
      })

      it('stops only the links that are gone, and drops a queued one '
        + 'without asking about it', async () => {
        const first = deferred<unknown>()

        answerLink(() => first.promise)

        const { subject, attach } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

        subject.cancelChecksForRemovedLinks(`${LINK_URL} `)

        expect(subject.checkingLinkIds.value).toEqual([LINK_ID])

        first.resolve({
          results: [{ id: LINK_ID, status: 'imported', file: copyOf(LINK_ID) }],
        })
        await running

        expect(linkCalls()).toHaveLength(1)
        expect(attach).toHaveBeenCalledTimes(1)
      })

      it('leaves a reused copy alone when its link was deleted', async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject, attach } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))
        subject.cancelChecksForRemovedLinks('')
        await running
        answering.resolve({
          results: [{ id: LINK_ID, status: 'reused', file: copyOf(LINK_ID) }],
        })
        await Promise.resolve()

        expect(attach).not.toHaveBeenCalled()
        expect(
          mocks.fetch.mock.calls.filter((call) => {
            return (call[1] as { method?: string } | undefined)?.method
              === 'DELETE'
          }),
        ).toEqual([])
      })

      it('never shows for an unrelated URL or for a link in code', async () => {
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject()

        await subject.detectLinks('see https://example.com/doc')
        await subject.detectLinks(`\`${LINK_URL}\``)

        expect(subject.checkingLinkIds.value).toEqual([])
        expect(linkCalls()).toHaveLength(0)
      })
    })

    it('opens the Picker for every suggested file at once, and dismisses '
      + 'them all for the message', async () => {
      answerLink((body) => {
        const id = body.link === LINK_URL ? LINK_ID : SECOND_ID

        return {
          results: [{ id, status: 'failed', code: 'not_found', reason: 'No' }],
        }
      })
      mocks.pick.mockResolvedValue({ status: 'canceled' })

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

      expect(subject.linkSuggestions.value).toHaveLength(2)

      await subject.acceptAllLinkSuggestions()

      expect(mocks.pick).toHaveBeenCalledWith({
        maxItems: 5,
        fileIds: [LINK_ID, SECOND_ID],
      })

      subject.dismissAllLinkSuggestions()

      expect(subject.linkSuggestions.value).toEqual([])

      await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

      expect(subject.linkSuggestions.value).toEqual([])
    })

    it('is busy while it asks, so a send waits for the copy', async () => {
      const answering = deferred<unknown>()

      answerLink(() => answering.promise)

      const { subject } = createSubject()
      const running = subject.detectLinks(`${LINK_URL} `)

      await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

      expect(subject.isDriveBusy.value).toBe(true)

      answering.resolve(failedLink('not_found'))
      await running

      expect(subject.isDriveBusy.value).toBe(false)
    })

    it('drops an answer that arrives after the message was sent',
      async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject, attach } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))
        await useNuxtApp().callHook('chat:submit' as never)
        answering.resolve({
          results: [{ id: LINK_ID, status: 'imported', file: copyOf(LINK_ID) }],
        })
        await running

        expect(attach).not.toHaveBeenCalled()
        expect(subject.linkSuggestions.value).toEqual([])
      })

    it('opens the Picker on that file when the suggestion is accepted, '
      + 'and removes it after the pick', async () => {
      answerLink(() => failedLink('not_found'))
      mocks.pick.mockResolvedValue({
        status: 'picked',
        items: [{ ...PICKED, id: LINK_ID }],
        rejected: [],
      })

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL} `)
      mocks.fetch.mockImplementation(async (url: string) => {
        return url === '/api/v1/files/policy'
          ? { policy: { maxFilesPerMessage: 10 } }
          : {
            results: [{
              id: LINK_ID,
              status: 'imported',
              file: copyOf(LINK_ID),
            }],
          }
      })
      await subject.acceptLinkSuggestion(LINK_ID)

      expect(mocks.pick).toHaveBeenCalledWith({
        maxItems: 5,
        fileIds: [LINK_ID],
      })
      expect(subject.linkSuggestions.value).toEqual([])
    })

    it('keeps the suggestion when the Picker is canceled', async () => {
      answerLink(() => failedLink('not_found'))
      mocks.pick.mockResolvedValue({ status: 'canceled' })

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL} `)
      await subject.acceptLinkSuggestion(LINK_ID)

      expect(subject.linkSuggestions.value).toHaveLength(1)
    })

    it('keeps a dismissed suggestion dismissed for the message', async () => {
      answerLink(() => failedLink('not_found'))

      const { subject } = createSubject()

      await subject.detectLinks(`${LINK_URL} `)
      subject.dismissLinkSuggestion(LINK_ID)
      await subject.detectLinks(`${LINK_URL} again `)

      expect(subject.linkSuggestions.value).toEqual([])
      expect(linkCalls()).toHaveLength(1)
    })

    it('forgets suggestions and handled links when the message is sent',
      async () => {
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        await useNuxtApp().callHook('chat:submit' as never)

        expect(subject.linkSuggestions.value).toEqual([])

        await subject.detectLinks(`${LINK_URL} `)

        expect(linkCalls()).toHaveLength(1)
        expect(subject.linkSuggestions.value).toHaveLength(1)
      })

    describe('only while Google Drive is connected', () => {
      function statusCalls() {
        return mocks.fetch.mock.calls.filter((call) => {
          return call[0] === '/api/v1/google/connections'
        })
      }

      function answerStatus(
        status: unknown,
        onLink: () => unknown = () => failedLink('not_found'),
      ) {
        mocks.fetch.mockImplementation(async (url: string) => {
          if (url === '/api/v1/google/connections') {
            if (status instanceof Error) {
              throw status
            }

            return status
          }

          if (url === LINK_ROUTE) {
            return await onLink()
          }

          return { policy: { maxFilesPerMessage: 10 } }
        })
      }

      it('never sends a link when nothing is connected, and asks for the '
        + 'status once', async () => {
        connectionData.value = null
        answerStatus({ ...connectionStatus(), connection: null })

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

        expect(linkCalls()).toHaveLength(0)
        expect(statusCalls()).toHaveLength(1)
        expect(subject.linkSuggestions.value).toEqual([])
        expect(subject.checkingLinkIds.value).toEqual([])
      })

      it.each([
        ['a connection that needs re-authorization', 'needs_reauth', undefined],
        ['a connection without the picked files capability', 'active', ['identity']],
      ])('never sends a link with %s', async (_name, status, capabilities) => {
        connectionData.value = connectionStatus({ status, capabilities })
        answerStatus(connectionStatus({ status, capabilities }))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(linkCalls()).toHaveLength(0)
      })

      it('reads the status the API Keys page already holds, with no '
        + 'request of its own', async () => {
        answerStatus(connectionStatus())

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(statusCalls()).toHaveLength(0)
        expect(linkCalls()).toHaveLength(1)
      })

      it('asks once, then sends the link of an active connection', async () => {
        connectionData.value = null
        answerStatus(connectionStatus())
        mocks.fetch.mockImplementationOnce(async () => {
          connectionData.value = null

          return connectionStatus()
        })

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

        expect(statusCalls()).toHaveLength(1)
        expect(linkCalls()).toHaveLength(2)
        expect(connectionData.value).toMatchObject({
          connection: { status: 'active' },
        })
      })

      it('stops after a disconnect refreshed the cached status', async () => {
        answerStatus(connectionStatus())

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        connectionData.value = { ...connectionStatus(), connection: null }

        await subject.detectLinks(`${SECOND_URL} `)

        expect(linkCalls()).toHaveLength(1)
      })

      it('sends nothing when the status cannot be read, and asks again for '
        + 'the next message', async () => {
        connectionData.value = null
        answerStatus(new Error('offline'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        await subject.detectLinks(`${LINK_URL} ${SECOND_URL} `)

        expect(linkCalls()).toHaveLength(0)
        expect(statusCalls()).toHaveLength(1)

        await useNuxtApp().callHook('chat:submit' as never)
        await subject.detectLinks(`${LINK_URL} `)

        expect(statusCalls()).toHaveLength(2)
      })

      it('does not ask for the status when the text has no link', async () => {
        connectionData.value = null
        answerStatus(connectionStatus())

        const { subject } = createSubject()

        await subject.detectLinks('hello, no links here')

        expect(statusCalls()).toHaveLength(0)
      })
    })

    describe('the gates of the menu row and the text', () => {
      it('does nothing in a model that takes no files', async () => {
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject([], undefined, {
          isAvailable: () => false,
        })

        await subject.detectLinks(`${LINK_URL} `)

        expect(mocks.fetch).not.toHaveBeenCalled()
      })

      it('skips a link shown as code', async () => {
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject()

        await subject.detectLinks(
          `\`${LINK_URL}\`\n\`\`\`\n${SECOND_URL}\n\`\`\`\n`,
        )

        expect(linkCalls()).toHaveLength(0)
      })
    })

    describe('what Besidka remembers for the page session', () => {
      it('shows the suggestion of a link it already answered "no access" '
        + 'for without asking again, even in the next message', async () => {
        answerLink(() => failedLink('no_access'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        await useNuxtApp().callHook('chat:submit' as never)

        expect(subject.linkSuggestions.value).toEqual([])

        await subject.detectLinks(`${LINK_URL} `)
        await subject.detectLinks(`${LINK_URL} again`)

        expect(linkCalls()).toHaveLength(1)
        expect(subject.linkSuggestions.value).toEqual([
          { id: LINK_ID, kind: 'document' },
        ])
      })

      it('forgets the link once the user picked the file', async () => {
        answerLink(() => failedLink('not_found'))
        mocks.pick.mockResolvedValue({
          status: 'picked',
          items: [{ ...PICKED, id: LINK_ID }],
          rejected: [],
        })

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)
        mocks.fetch.mockImplementation(async (url: string) => {
          return url === '/api/v1/files/policy'
            ? { policy: { maxFilesPerMessage: 10 } }
            : {
              results: [{
                id: LINK_ID,
                status: 'imported',
                file: copyOf(LINK_ID),
              }],
            }
        })
        await subject.acceptLinkSuggestion(LINK_ID)
        await useNuxtApp().callHook('chat:submit' as never)
        answerLink(() => failedLink('not_found'))
        mocks.fetch.mockClear()
        await subject.detectLinks(`${LINK_URL} `)

        expect(linkCalls()).toHaveLength(1)
      })
    })

    describe('time limits', () => {
      it('gives each request at most fifteen seconds', async () => {
        answerLink(() => failedLink('not_found'))

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        const options = linkCalls()[0]![1] as { timeout: number }

        expect(options.timeout).toBeGreaterThan(0)
        expect(options.timeout).toBeLessThanOrEqual(15_000)
      })

      it('is not busy after a request timed out', async () => {
        answerLink(() => {
          throw Object.assign(new Error('timeout'), { name: 'TimeoutError' })
        })

        const { subject } = createSubject()

        await subject.detectLinks(`${LINK_URL} `)

        expect(subject.isDriveBusy.value).toBe(false)
        expect(subject.linkSuggestions.value).toEqual([])
        expect(mocks.error).not.toHaveBeenCalled()
      })

      it('lets go of the composer when the message is sent while a request '
        + 'is still out', async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(subject.isDriveBusy.value).toBe(true))
        await useNuxtApp().callHook('chat:submit' as never)

        expect(subject.isDriveBusy.value).toBe(false)

        answering.resolve(failedLink('not_found'))
        await running
      })

      it('stops starting requests once the run has used its fifteen '
        + 'seconds', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })

        try {
          answerLink(() => {
            vi.setSystemTime(Date.now() + 6000)

            return failedLink('failed')
          })

          const { subject } = createSubject()
          const links = Array.from({ length: 5 }, (_unused, index) => {
            return `https://docs.google.com/document/d/${index}LinkLinkLinkLinkLinkLinkLink00/edit`
          })

          await subject.detectLinks(`${links.join(' ')} `)

          expect(linkCalls().length).toBeLessThan(5)
          expect(linkCalls().length).toBeGreaterThanOrEqual(2)
        } finally {
          vi.useRealTimers()
        }
      })

      it('waits for a request that is already running when asked again, '
        + 'so a send attaches the file first', async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject, attach } = createSubject()
        const first = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))

        const settled = vi.fn()
        const second = subject.detectLinks(`${LINK_URL} and words`).then(settled)

        await Promise.resolve()

        expect(settled).not.toHaveBeenCalled()

        answering.resolve({
          results: [{ id: LINK_ID, status: 'imported', file: copyOf(LINK_ID) }],
        })
        await Promise.all([first, second])

        expect(settled).toHaveBeenCalled()
        expect(attach).toHaveBeenCalledTimes(1)
      })
    })

    describe('a copy that arrives after the message was sent', () => {
      function deleteCalls() {
        return mocks.fetch.mock.calls.filter((call) => {
          return String(call[0]).startsWith('/api/v1/files/')
            && (call[1] as { method?: string } | undefined)?.method === 'DELETE'
        })
      }

      it('is deleted again through the file delete route, not attached',
        async () => {
          const answering = deferred<unknown>()

          answerLink(() => answering.promise)

          const { subject, attach } = createSubject()
          const running = subject.detectLinks(`${LINK_URL} `)

          await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))
          await useNuxtApp().callHook('chat:submit' as never)
          answering.resolve({
            results: [{
              id: LINK_ID,
              status: 'imported',
              file: { ...copyOf(LINK_ID), id: 'file-public-id' },
            }],
          })
          await running

          expect(attach).not.toHaveBeenCalled()
          expect(deleteCalls()).toEqual([
            ['/api/v1/files/file-public-id', { method: 'DELETE' }],
          ])
        })

      it('leaves a reused copy alone: it was there before the link', async () => {
        const answering = deferred<unknown>()

        answerLink(() => answering.promise)

        const { subject } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))
        await useNuxtApp().callHook('chat:submit' as never)
        answering.resolve({
          results: [{ id: LINK_ID, status: 'reused', file: copyOf(LINK_ID) }],
        })
        await running

        expect(deleteCalls()).toEqual([])
      })

      it('does not fail the composer when the delete fails', async () => {
        const answering = deferred<unknown>()

        mocks.fetch.mockImplementation(async (url: string) => {
          if (url === LINK_ROUTE) {
            return await answering.promise
          }

          if (url.startsWith('/api/v1/files/')) {
            throw Object.assign(new Error('Not found'), { status: 404 })
          }

          return { policy: { maxFilesPerMessage: 10 } }
        })

        const { subject } = createSubject()
        const running = subject.detectLinks(`${LINK_URL} `)

        await vi.waitFor(() => expect(linkCalls()).toHaveLength(1))
        await useNuxtApp().callHook('chat:submit' as never)
        answering.resolve({
          results: [{ id: LINK_ID, status: 'imported', file: copyOf(LINK_ID) }],
        })
        await running

        expect(mocks.error).not.toHaveBeenCalled()
      })
    })
  })
})
