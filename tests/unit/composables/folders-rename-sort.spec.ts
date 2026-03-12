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

function flushPromises() {
  return Promise.resolve()
}

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

describe('useFolders rename sorting', () => {
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

  it('re-sorts renamed folders when sorting by name', async () => {
    const alphaFolder = createFolder({ id: 'folder-1', name: 'Alpha' })
    const betaFolder = createFolder({ id: 'folder-2', name: 'Beta' })
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      method?: string
    }) => {
      if (url === '/api/v1/folders' && !options?.method) {
        return Promise.resolve(createFoldersResponse({
          folders: [alphaFolder, betaFolder],
        }))
      }

      return Promise.resolve({ success: true })
    }))

    const folders = createFoldersComposable()
    folders.prime(createFoldersResponse({
      folders: [alphaFolder, betaFolder],
    }))

    folders.sortBy.value = 'name'
    await flushPromises()
    await flushPromises()
    await folders.renameFolder('folder-2', 'Aardvark')

    expect(folders.folders.value.map(folder => folder.name)).toEqual([
      'Aardvark',
      'Alpha',
    ])
  })
})
