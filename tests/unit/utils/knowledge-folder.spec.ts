import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  diffFolderSync,
  entriesFromFileList,
  loadKnowledgeDirectoryHandle,
  readDirectoryHandleEntries,
  removeKnowledgeDirectoryHandle,
  saveKnowledgeDirectoryHandle,
  supportsDirectoryPicker,
} from '~/utils/knowledge-folder'

interface FakeRequest {
  result: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onupgradeneeded: (() => void) | null
  onblocked: (() => void) | null
}

function createRequest(): FakeRequest {
  return {
    result: undefined,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  }
}

function createFakeIndexedDb() {
  const databases = new Map<string, {
    stores: Map<string, Map<string, unknown>>
    close: () => void
  }>()

  function runRequest(operation: () => unknown): FakeRequest {
    const request = createRequest()

    setTimeout(() => {
      request.result = operation()
      request.onsuccess?.()
    }, 0)

    return request
  }

  return {
    databases,
    open(name: string) {
      const request = createRequest()

      setTimeout(() => {
        const existing = databases.get(name)
        const database = existing ?? {
          stores: new Map<string, Map<string, unknown>>(),
          close: vi.fn(),
        }

        databases.set(name, database)
        request.result = {
          close: database.close,
          createObjectStore: (storeName: string) => {
            database.stores.set(storeName, new Map())
          },
          transaction: (storeName: string) => ({
            objectStore: () => {
              const store = database.stores.get(storeName)

              return {
                put: (value: unknown, key: string) => {
                  return runRequest(() => store?.set(key, value))
                },
                get: (key: string) => runRequest(() => store?.get(key)),
                delete: (key: string) => {
                  return runRequest(() => store?.delete(key))
                },
              }
            },
          }),
        }

        if (!existing) {
          request.onupgradeneeded?.()
        }

        request.onsuccess?.()
      }, 0)

      return request
    },
  }
}

interface FakeDirectoryHandle {
  kind: 'directory'
  name: string
  values: () => AsyncGenerator<unknown>
  getFileHandle: (name: string) => Promise<unknown>
}

function fakeFile(name: string, content: string = 'x') {
  return {
    kind: 'file' as const,
    name,
    getFile: () => Promise.resolve(new File([content], name)),
  }
}

function fakeDirectory(
  name: string,
  children: Array<ReturnType<typeof fakeFile> | FakeDirectoryHandle>,
): FakeDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async* values() {
      for (const child of children) {
        yield child
      }
    },
    getFileHandle: (fileName: string) => {
      const match = children.find((child) => {
        return child.kind === 'file' && child.name === fileName
      })

      return match ? Promise.resolve(match) : Promise.reject(new Error('none'))
    },
  }
}

function fileWithPath(name: string, webkitRelativePath: string): File {
  const file = new File(['content'], name)

  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
  })

  return file
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('entriesFromFileList', () => {
  it('strips the root folder segment and reports its name', () => {
    const { rootName, entries } = entriesFromFileList([
      fileWithPath('a.md', 'my-project/docs/a.md'),
      fileWithPath('b.ts', 'my-project/b.ts'),
    ])

    expect(rootName).toBe('my-project')
    expect(entries.map(entry => entry.relativePath)).toEqual([
      'docs/a.md',
      'b.ts',
    ])
  })

  it('returns null paths for plain file picks', () => {
    const { rootName, entries } = entriesFromFileList([
      new File(['x'], 'plain.txt'),
    ])

    expect(rootName).toBeNull()
    expect(entries[0]?.relativePath).toBeNull()
  })

  it('keeps single-segment paths as they are', () => {
    const { rootName, entries } = entriesFromFileList([
      fileWithPath('a.md', 'a.md'),
    ])

    expect(rootName).toBeNull()
    expect(entries[0]?.relativePath).toBe('a.md')
  })
})

describe('diffFolderSync', () => {
  const existing = [
    { id: 'i1', relativePath: 'a.md', contentHash: 'h-a' },
    { id: 'i2', relativePath: 'b.md', contentHash: 'h-b' },
    { id: 'i3', relativePath: 'gone.md', contentHash: 'h-gone' },
  ]

  it('adds new, replaces changed, removes missing and counts unchanged', () => {
    const incoming = [
      { relativePath: 'a.md', contentHash: 'h-a' },
      { relativePath: 'b.md', contentHash: 'h-b2' },
      { relativePath: 'new.md', contentHash: 'h-new' },
    ]

    expect(diffFolderSync({ existing, incoming })).toEqual({
      add: [{ relativePath: 'new.md', contentHash: 'h-new' }],
      replace: [
        {
          itemId: 'i2',
          incoming: { relativePath: 'b.md', contentHash: 'h-b2' },
        },
      ],
      remove: ['i3'],
      unchanged: 1,
    })
  })

  it('keeps extra fields on incoming items', () => {
    const file = new File(['x'], 'new.md')
    const diff = diffFolderSync({
      existing: [],
      incoming: [{ relativePath: 'new.md', contentHash: 'h', file }],
    })

    expect(diff.add[0]?.file).toBe(file)
  })

  it('handles empty inputs', () => {
    expect(diffFolderSync({ existing: [], incoming: [] })).toEqual({
      add: [],
      replace: [],
      remove: [],
      unchanged: 0,
    })
    expect(diffFolderSync({ existing, incoming: [] }).remove).toEqual([
      'i1',
      'i2',
      'i3',
    ])
  })
})

describe('supportsDirectoryPicker', () => {
  it('detects window.showDirectoryPicker', () => {
    expect(supportsDirectoryPicker()).toBe(false)

    vi.stubGlobal('window', {})
    expect(supportsDirectoryPicker()).toBe(false)

    vi.stubGlobal('window', { showDirectoryPicker: () => undefined })
    expect(supportsDirectoryPicker()).toBe(true)
  })
})

describe('readDirectoryHandleEntries', () => {
  function createTree() {
    return fakeDirectory('repo', [
      fakeFile('.gitignore', 'generated/\n*.log\n'),
      fakeFile('README.md', 'readme'),
      fakeDirectory('node_modules', [fakeFile('dep.js')]),
      fakeDirectory('.git', [fakeFile('HEAD')]),
      fakeDirectory('generated', [fakeFile('out.ts')]),
      fakeDirectory('src', [
        fakeFile('main.ts'),
        fakeFile('debug.log'),
        fakeDirectory('dist', [fakeFile('bundle.js')]),
        fakeDirectory('lib', [fakeFile('util.ts')]),
      ]),
    ])
  }

  it('walks recursively without descending into ignored directories', async () => {
    const result = await readDirectoryHandleEntries(
      createTree() as unknown as FileSystemDirectoryHandle,
    )

    expect(result.rootName).toBe('repo')
    expect(result.gitignoreText).toBe('generated/\n*.log\n')
    expect(result.entries.map(entry => entry.relativePath)).toEqual([
      '.gitignore',
      'README.md',
      'src/main.ts',
      'src/debug.log',
      'src/lib/util.ts',
    ])
    expect(result.entries[1]?.file.name).toBe('README.md')
  })

  it('returns empty gitignore text when the file is missing', async () => {
    const result = await readDirectoryHandleEntries(
      fakeDirectory('empty', [
        fakeFile('a.md'),
      ]) as unknown as FileSystemDirectoryHandle,
    )

    expect(result.gitignoreText).toBe('')
    expect(result.entries).toHaveLength(1)
  })

  it('stops with an AbortError when the signal is aborted', async () => {
    const controller = new AbortController()

    controller.abort()

    await expect(readDirectoryHandleEntries(
      createTree() as unknown as FileSystemDirectoryHandle,
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('directory handle persistence', () => {
  function createHandle(permissions: {
    query?: PermissionState
    request?: PermissionState | 'throw'
  }) {
    return {
      kind: 'directory',
      name: 'repo',
      queryPermission: vi.fn().mockResolvedValue(permissions.query ?? 'prompt'),
      requestPermission: vi.fn().mockImplementation(() => {
        if (permissions.request === 'throw') {
          return Promise.reject(new Error('no user activation'))
        }

        return Promise.resolve(permissions.request ?? 'denied')
      }),
    }
  }

  it('saves and loads a handle without prompting when granted', async () => {
    const fakeDb = createFakeIndexedDb()
    const handle = createHandle({ query: 'granted' })

    vi.stubGlobal('indexedDB', fakeDb)

    expect(await saveKnowledgeDirectoryHandle(
      'project-1',
      handle as unknown as FileSystemDirectoryHandle,
    )).toBe(true)
    expect(await loadKnowledgeDirectoryHandle('project-1')).toBe(handle)
    expect(handle.requestPermission).not.toHaveBeenCalled()
    expect(fakeDb.databases.has('besidka-knowledge')).toBe(true)
  })

  it('requests read permission when it is not granted yet', async () => {
    const handle = createHandle({ query: 'prompt', request: 'granted' })

    vi.stubGlobal('indexedDB', createFakeIndexedDb())
    await saveKnowledgeDirectoryHandle(
      'project-1',
      handle as unknown as FileSystemDirectoryHandle,
    )

    expect(await loadKnowledgeDirectoryHandle('project-1')).toBe(handle)
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('returns null when the permission is denied or the request throws', async () => {
    const denied = createHandle({ query: 'prompt', request: 'denied' })
    const throwing = createHandle({ query: 'prompt', request: 'throw' })

    vi.stubGlobal('indexedDB', createFakeIndexedDb())
    await saveKnowledgeDirectoryHandle(
      'denied',
      denied as unknown as FileSystemDirectoryHandle,
    )
    await saveKnowledgeDirectoryHandle(
      'throwing',
      throwing as unknown as FileSystemDirectoryHandle,
    )

    expect(await loadKnowledgeDirectoryHandle('denied')).toBeNull()
    expect(await loadKnowledgeDirectoryHandle('throwing')).toBeNull()
  })

  it('returns null for a missing handle and removes saved ones', async () => {
    const handle = createHandle({ query: 'granted' })

    vi.stubGlobal('indexedDB', createFakeIndexedDb())

    expect(await loadKnowledgeDirectoryHandle('missing')).toBeNull()

    await saveKnowledgeDirectoryHandle(
      'project-1',
      handle as unknown as FileSystemDirectoryHandle,
    )

    expect(await removeKnowledgeDirectoryHandle('project-1')).toBe(true)
    expect(await loadKnowledgeDirectoryHandle('project-1')).toBeNull()
  })

  it('degrades quietly when IndexedDB is unavailable', async () => {
    const handle = createHandle({ query: 'granted' })

    vi.stubGlobal('indexedDB', undefined)

    expect(await saveKnowledgeDirectoryHandle(
      'p',
      handle as unknown as FileSystemDirectoryHandle,
    )).toBe(false)
    expect(await loadKnowledgeDirectoryHandle('p')).toBeNull()
    expect(await removeKnowledgeDirectoryHandle('p')).toBe(false)
  })

  it('degrades quietly when opening the database throws or errors', async () => {
    const handle = createHandle({ query: 'granted' })

    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('SecurityError')
      },
    })

    expect(await saveKnowledgeDirectoryHandle(
      'p',
      handle as unknown as FileSystemDirectoryHandle,
    )).toBe(false)

    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = createRequest()

        setTimeout(() => request.onerror?.(), 0)

        return request
      },
    })

    expect(await loadKnowledgeDirectoryHandle('p')).toBeNull()
  })
})
