import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { useFolders } from '../../../app/composables/folders'
import {
  createFolder,
  createFoldersResponse,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

const scopes: EffectScope[] = []

function createFoldersComposable() {
  const scope = effectScope()
  const folders = scope.run(() => useFolders())

  scopes.push(scope)

  if (!folders) {
    throw new Error('Failed to create folders composable')
  }

  return folders
}

describe('useFolders rename behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn())
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => {
      scope.stop()
    })
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('removes a renamed folder that no longer matches the active search', async () => {
    const matchingFolder = createFolder({
      id: 'folder-1',
      name: 'Projects',
    })
    vi.stubGlobal('$fetch', vi.fn(() => {
      return Promise.resolve({ success: true })
    }))

    const folders = createFoldersComposable()
    folders.search.value = 'proj'
    folders.prime(createFoldersResponse({ folders: [matchingFolder] }))

    await folders.renameFolder('folder-1', 'Inbox')

    expect(folders.folders.value).toEqual([])
  })
})
