import type { KnowledgeFolderNames } from '~/types/knowledge-ui.d'

interface StoredFolderMemory {
  names: KnowledgeFolderNames
  syncedFolderId: string | null
}

const STORAGE_KEY_PREFIX = 'knowledge-folders:'

function readStoredMemory(projectId: string): StoredFolderMemory {
  const emptyMemory: StoredFolderMemory = { names: {}, syncedFolderId: null }

  try {
    const raw = window.localStorage.getItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
    )

    if (!raw) {
      return emptyMemory
    }

    const parsed = JSON.parse(raw) as Partial<StoredFolderMemory>

    return {
      names: parsed.names && typeof parsed.names === 'object'
        ? parsed.names
        : {},
      syncedFolderId: typeof parsed.syncedFolderId === 'string'
        ? parsed.syncedFolderId
        : null,
    }
  } catch (exception) {
    void exception

    return emptyMemory
  }
}

function writeStoredMemory(projectId: string, memory: StoredFolderMemory) {
  try {
    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
      JSON.stringify(memory),
    )
  } catch (exception) {
    void exception
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

  function forgetSync() {
    syncedFolderId.value = null
    writeStoredMemory(toValue(projectId), {
      names: names.value,
      syncedFolderId: null,
    })
  }

  onMounted(load)

  watch(() => toValue(projectId), () => {
    if (import.meta.client) {
      load()
    }
  })

  return { names, syncedFolderId, remember, forgetSync }
}
