import type { KnowledgeFolderNames } from '~/types/knowledge-ui.d'

interface StoredFolderMemory {
  names: KnowledgeFolderNames
  syncedFolderId: string | null
}

const STORAGE_KEY_PREFIX = 'knowledge-folders:'
const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const MAX_FOLDER_NAME_CHARS = 255

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNames(value: unknown): KnowledgeFolderNames {
  if (!isPlainRecord(value)) {
    return {}
  }

  const names: KnowledgeFolderNames = {}

  for (const [folderId, name] of Object.entries(value)) {
    if (
      FOLDER_ID_PATTERN.test(folderId)
      && typeof name === 'string'
      && name.length > 0
      && name.length <= MAX_FOLDER_NAME_CHARS
    ) {
      names[folderId] = name
    }
  }

  return names
}

function parseSyncedFolderId(value: unknown): string | null {
  if (typeof value === 'string' && FOLDER_ID_PATTERN.test(value)) {
    return value
  }

  return null
}

function readStoredMemory(projectId: string): StoredFolderMemory {
  const emptyMemory: StoredFolderMemory = { names: {}, syncedFolderId: null }

  try {
    const raw = window.localStorage.getItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
    )

    if (!raw) {
      return emptyMemory
    }

    const parsed: unknown = JSON.parse(raw)

    if (!isPlainRecord(parsed)) {
      return emptyMemory
    }

    return {
      names: parseNames(parsed.names),
      syncedFolderId: parseSyncedFolderId(parsed.syncedFolderId),
    }
  } catch {
    return emptyMemory
  }
}

function writeStoredMemory(projectId: string, memory: StoredFolderMemory) {
  try {
    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
      JSON.stringify(memory),
    )
  } catch {
    return
  }
}

/**
 * The server stores only a folder id and the paths inside the folder, never
 * the picked folder's own name. This remembers the name, and which folder is
 * linked to a saved directory handle, per project in this browser. Reading
 * waits for mount so the first render matches the server render.
 */
export function useKnowledgeFolderMemory(projectId: MaybeRefOrGetter<string>) {
  const names = shallowRef<KnowledgeFolderNames>({})
  const syncedFolderId = shallowRef<string | null>(null)

  function load() {
    const memory = readStoredMemory(toValue(projectId))

    names.value = memory.names
    syncedFolderId.value = memory.syncedFolderId
  }

  function remember(
    folderId: string,
    name: string,
    options: { isSynced: boolean } = { isSynced: false },
  ) {
    names.value = { ...names.value, [folderId]: name }

    if (options.isSynced) {
      syncedFolderId.value = folderId
    }

    writeStoredMemory(toValue(projectId), {
      names: names.value,
      syncedFolderId: syncedFolderId.value,
    })
  }

  async function forgetSync() {
    syncedFolderId.value = null
    writeStoredMemory(toValue(projectId), {
      names: names.value,
      syncedFolderId: null,
    })

    await removeKnowledgeDirectoryHandle(toValue(projectId))
  }

  onMounted(load)

  watch(() => toValue(projectId), () => {
    if (import.meta.client) {
      load()
    }
  })

  return { names, syncedFolderId, remember, forgetSync }
}
