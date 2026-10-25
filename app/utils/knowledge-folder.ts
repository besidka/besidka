import { knowledgeIgnoredDirectories } from '#shared/utils/project-knowledge-policy'
import type { KnowledgePlanEntry } from '~/utils/knowledge-upload-plan'
import { normalizeKnowledgeRelativePath } from '~/utils/knowledge-paths'
import {
  isIgnoredByGitignore,
  parseSimpleGitignore,
} from '~/utils/knowledge-upload-plan'

export interface KnowledgeFolderEntries {
  rootName: string | null
  entries: KnowledgePlanEntry[]
}

export interface KnowledgeDirectoryEntries extends KnowledgeFolderEntries {
  rootName: string
  gitignoreText: string
}

export interface KnowledgeFolderSyncItem {
  id: string
  relativePath: string
  contentHash: string
}

export interface KnowledgeFolderIncomingItem {
  relativePath: string
  contentHash: string
}

export interface KnowledgeFolderDiff<
  Incoming extends KnowledgeFolderIncomingItem,
> {
  add: Incoming[]
  replace: Array<{
    itemId: string
    incoming: Incoming
    hasKnownHash: boolean
  }>
  remove: string[]
  unchanged: number
}

interface PermissionAwareDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (
    descriptor: { mode: 'read' },
  ) => Promise<PermissionState>
  requestPermission?: (
    descriptor: { mode: 'read' },
  ) => Promise<PermissionState>
}

const DATABASE_NAME = 'besidka-knowledge'
const DATABASE_VERSION = 1
const HANDLE_STORE_NAME = 'directory-handles'
const MAX_WALKED_FILES = 5000
const GITIGNORE_FILE_NAME = '.gitignore'

function toEntryPath(path: string): string {
  return normalizeKnowledgeRelativePath(path) ?? path
}

export function entriesFromFileList(
  files: FileList | File[],
): KnowledgeFolderEntries {
  const fileArray = Array.from(files)
  let rootName: string | null = null

  const entries = fileArray.map((file) => {
    const segments = (file.webkitRelativePath ?? '')
      .split('/')
      .filter(segment => segment.length > 0)

    if (segments.length === 0) {
      return { file, relativePath: null }
    }

    if (segments.length === 1) {
      return { file, relativePath: toEntryPath(segments[0] ?? '') }
    }

    rootName ??= segments[0] ?? null

    return { file, relativePath: toEntryPath(segments.slice(1).join('/')) }
  })

  return { rootName, entries }
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Folder read aborted', 'AbortError')
  }
}

async function readRootGitignoreText(
  handle: FileSystemDirectoryHandle,
): Promise<string> {
  try {
    const fileHandle = await handle.getFileHandle(GITIGNORE_FILE_NAME)
    const file = await fileHandle.getFile()

    return await file.text()
  } catch {
    return ''
  }
}

export async function readDirectoryHandleEntries(
  handle: FileSystemDirectoryHandle,
  { signal }: { signal?: AbortSignal } = {},
): Promise<KnowledgeDirectoryEntries> {
  const gitignoreText = await readRootGitignoreText(handle)
  const gitignoreRules = parseSimpleGitignore(gitignoreText)
  const entries: KnowledgePlanEntry[] = []

  async function walk(
    directory: FileSystemDirectoryHandle,
    directoryPath: string,
  ): Promise<void> {
    for await (const child of directory.values()) {
      throwIfAborted(signal)

      if (entries.length >= MAX_WALKED_FILES) {
        return
      }

      const childPath = directoryPath
        ? `${directoryPath}/${child.name}`
        : child.name

      if (child.kind === 'directory') {
        const isIgnoredDirectory = (
          knowledgeIgnoredDirectories as readonly string[]
        ).includes(child.name)
        || isIgnoredByGitignore(gitignoreRules, childPath, true)

        if (!isIgnoredDirectory) {
          await walk(child as FileSystemDirectoryHandle, childPath)
        }

        continue
      }

      const file = await (child as FileSystemFileHandle).getFile()

      entries.push({ file, relativePath: toEntryPath(childPath) })
    }
  }

  await walk(handle, '')

  return { rootName: handle.name, entries, gitignoreText }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(HANDLE_STORE_NAME)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function runHandleStoreRequest<Result>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<{ ok: true, value: Result } | { ok: false }> {
  const database = await openDatabase()

  if (!database) {
    return { ok: false }
  }

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(HANDLE_STORE_NAME, mode)
      const request = createRequest(transaction.objectStore(HANDLE_STORE_NAME))

      request.onsuccess = () => {
        resolve({ ok: true, value: request.result })
        database.close()
      }
      request.onerror = () => {
        resolve({ ok: false })
        database.close()
      }
    } catch {
      resolve({ ok: false })
      database.close()
    }
  })
}

export async function saveKnowledgeDirectoryHandle(
  projectId: string,
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const outcome = await runHandleStoreRequest('readwrite', (store) => {
    return store.put(handle, projectId)
  })

  return outcome.ok
}

async function ensureReadPermission(
  handle: PermissionAwareDirectoryHandle,
): Promise<boolean> {
  try {
    const currentPermission = await handle.queryPermission?.({ mode: 'read' })

    if (currentPermission === 'granted') {
      return true
    }

    const requestedPermission = await handle.requestPermission?.({
      mode: 'read',
    })

    return requestedPermission === 'granted'
  } catch {
    return false
  }
}

export async function loadKnowledgeDirectoryHandle(
  projectId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const outcome = await runHandleStoreRequest('readonly', (store) => {
    return store.get(projectId) as IDBRequest<
      PermissionAwareDirectoryHandle | undefined
    >
  })

  if (!outcome.ok || !outcome.value) {
    return null
  }

  const hasPermission = await ensureReadPermission(outcome.value)

  return hasPermission ? outcome.value : null
}

export async function removeKnowledgeDirectoryHandle(
  projectId: string,
): Promise<boolean> {
  const outcome = await runHandleStoreRequest('readwrite', (store) => {
    return store.delete(projectId)
  })

  return outcome.ok
}

function isKnownHash(contentHash: string): boolean {
  return contentHash.length > 0
}

export function diffFolderSync<Incoming extends KnowledgeFolderIncomingItem>(
  { existing, incoming }: {
    existing: KnowledgeFolderSyncItem[]
    incoming: Incoming[]
  },
): KnowledgeFolderDiff<Incoming> {
  const existingByPath = new Map<string, KnowledgeFolderSyncItem>()

  for (const item of existing) {
    if (!existingByPath.has(item.relativePath)) {
      existingByPath.set(item.relativePath, item)
    }
  }

  const incomingPaths = new Set<string>()
  const diff: KnowledgeFolderDiff<Incoming> = {
    add: [],
    replace: [],
    remove: [],
    unchanged: 0,
  }

  for (const item of incoming) {
    incomingPaths.add(item.relativePath)

    const match = existingByPath.get(item.relativePath)

    if (!match) {
      diff.add.push(item)
    } else if (isKnownHash(match.contentHash)) {
      if (match.contentHash === item.contentHash) {
        diff.unchanged += 1
      } else {
        diff.replace.push({
          itemId: match.id,
          incoming: item,
          hasKnownHash: true,
        })
      }
    } else {
      diff.replace.push({
        itemId: match.id,
        incoming: item,
        hasKnownHash: false,
      })
    }
  }

  for (const item of existing) {
    if (!incomingPaths.has(item.relativePath)) {
      diff.remove.push(item.id)
    }
  }

  return diff
}
