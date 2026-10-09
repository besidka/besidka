import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin from '../../../app/plugins/push-navigation.client'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
}))

mockNuxtImport('navigateTo', () => mocks.navigateTo)

const DATABASE_NAME = 'besidka-push'

interface FakeIndexedDbOptions {
  entry?: { url: string, savedAt: number } | null
  existingDatabases?: string[] | null
  isNewDatabase?: boolean
}

function createFakeIndexedDb(options: FakeIndexedDbOptions = {}) {
  const abort = vi.fn()
  const deleteEntry = vi.fn()
  const databases = vi.fn(async () => {
    return (options.existingDatabases ?? []).map((name) => {
      return { name, version: 1 }
    })
  })

  const open = vi.fn((_name: string, _version: number) => {
    const request: {
      result?: unknown
      transaction?: { abort: () => void }
      onupgradeneeded?: () => void
      onsuccess?: () => void
      onerror?: () => void
    } = {}

    queueMicrotask(() => {
      if (options.isNewDatabase) {
        request.transaction = { abort }
        request.onupgradeneeded?.()
        request.onerror?.()

        return
      }

      request.result = {
        close: vi.fn(),
        transaction: () => {
          const transaction: {
            oncomplete?: () => void
            onabort?: () => void
            objectStore?: () => unknown
          } = {}

          transaction.objectStore = () => {
            return {
              get: () => {
                const getRequest: {
                  result?: unknown
                  onsuccess?: () => void
                } = { result: options.entry ?? undefined }

                queueMicrotask(() => {
                  getRequest.onsuccess?.()
                  queueMicrotask(() => transaction.oncomplete?.())
                })

                return getRequest
              },
              delete: deleteEntry,
            }
          }

          return transaction
        },
      }
      request.onsuccess?.()
    })

    return request
  })

  const indexedDb: Record<string, unknown> = { open }

  if (options.existingDatabases !== null) {
    indexedDb.databases = databases
  }

  return { indexedDb, open, databases, abort, deleteEntry }
}

function setNotificationPermission(
  permission: NotificationPermission | undefined,
) {
  if (permission === undefined) {
    Reflect.deleteProperty(window, 'Notification')

    return
  }

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission },
  })
}

function installFakeIndexedDb(fake: ReturnType<typeof createFakeIndexedDb>) {
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: fake.indexedDb,
  })
}

async function flushPromises() {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve()
  }
}

async function mountApp() {
  const hooks: Record<string, () => Promise<void>> = {}

  plugin({
    runWithContext: (callback: () => unknown) => callback(),
    hook: (name: string, callback: () => Promise<void>) => {
      hooks[name] = callback
    },
  } as never)

  await hooks['app:mounted']?.()
  await flushPromises()
}

describe('push-navigation plugin', () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(
    window,
    'indexedDB',
  )
  const originalNotification = Object.getOwnPropertyDescriptor(
    window,
    'Notification',
  )

  beforeEach(() => {
    mocks.navigateTo.mockReset()
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {})
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()

    if (originalIndexedDb) {
      Object.defineProperty(window, 'indexedDB', originalIndexedDb)
    }

    if (originalNotification) {
      Object.defineProperty(window, 'Notification', originalNotification)
    } else {
      Reflect.deleteProperty(window, 'Notification')
    }
  })

  it('never touches IndexedDB while notification permission is default', async () => {
    const fake = createFakeIndexedDb({ existingDatabases: [DATABASE_NAME] })

    installFakeIndexedDb(fake)
    setNotificationPermission('default')

    await mountApp()

    expect(fake.databases).not.toHaveBeenCalled()
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('never touches IndexedDB while notification permission is denied', async () => {
    const fake = createFakeIndexedDb({ existingDatabases: [DATABASE_NAME] })

    installFakeIndexedDb(fake)
    setNotificationPermission('denied')

    await mountApp()

    expect(fake.open).not.toHaveBeenCalled()
  })

  it('never touches IndexedDB when the Notification API is missing', async () => {
    const fake = createFakeIndexedDb({ existingDatabases: [DATABASE_NAME] })

    installFakeIndexedDb(fake)
    setNotificationPermission(undefined)

    await mountApp()

    expect(fake.databases).not.toHaveBeenCalled()
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('does not open the database when permission is granted but none exists', async () => {
    const fake = createFakeIndexedDb({ existingDatabases: ['other-db'] })

    installFakeIndexedDb(fake)
    setNotificationPermission('granted')

    await mountApp()

    expect(fake.databases).toHaveBeenCalledOnce()
    expect(fake.open).not.toHaveBeenCalled()
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('reads the pending navigation and navigates when the database exists', async () => {
    const fake = createFakeIndexedDb({
      existingDatabases: [DATABASE_NAME],
      entry: { url: '/chats/abc', savedAt: Date.now() },
    })

    installFakeIndexedDb(fake)
    setNotificationPermission('granted')

    await mountApp()

    expect(fake.open).toHaveBeenCalledWith(DATABASE_NAME, 1)
    expect(fake.deleteEntry).toHaveBeenCalledWith('latest')
    expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/abc')
  })

  it('ignores an expired pending navigation', async () => {
    const fake = createFakeIndexedDb({
      existingDatabases: [DATABASE_NAME],
      entry: { url: '/chats/abc', savedAt: Date.now() - 6 * 60 * 1000 },
    })

    installFakeIndexedDb(fake)
    setNotificationPermission('granted')

    await mountApp()

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('aborts instead of creating the database when databases() is unsupported', async () => {
    const fake = createFakeIndexedDb({
      existingDatabases: null,
      isNewDatabase: true,
    })

    installFakeIndexedDb(fake)
    setNotificationPermission('granted')

    await mountApp()

    expect(fake.open).toHaveBeenCalledOnce()
    expect(fake.abort).toHaveBeenCalledOnce()
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('reads an existing database when databases() is unsupported', async () => {
    const fake = createFakeIndexedDb({
      existingDatabases: null,
      entry: { url: '/chats/abc', savedAt: Date.now() },
    })

    installFakeIndexedDb(fake)
    setNotificationPermission('granted')

    await mountApp()

    expect(fake.abort).not.toHaveBeenCalled()
    expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/abc')
  })
})
