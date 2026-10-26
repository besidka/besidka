import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { useKnowledgeFolderMemory } from '../../../app/composables/project-knowledge-folders'

const mocks = vi.hoisted(() => ({
  removeKnowledgeDirectoryHandle: vi.fn(),
}))

mockNuxtImport('removeKnowledgeDirectoryHandle', () => {
  return mocks.removeKnowledgeDirectoryHandle
})

enableAutoUnmount(afterEach)

const STORAGE_KEY = 'knowledge-folders:project-1'

async function mountMemory(projectId = shallowRef<string>('project-1')) {
  let memory: ReturnType<typeof useKnowledgeFolderMemory> | null = null

  await mountSuspended(defineComponent({
    setup() {
      memory = useKnowledgeFolderMemory(projectId)

      return () => h('div')
    },
  }))

  return { memory: memory!, projectId }
}

describe('useKnowledgeFolderMemory', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.removeKnowledgeDirectoryHandle.mockReset()
    mocks.removeKnowledgeDirectoryHandle.mockResolvedValue(true)
  })

  it('starts empty', async () => {
    const { memory } = await mountMemory()

    expect(memory.names.value).toEqual({})
    expect(memory.syncedFolderId.value).toBeNull()
  })

  it('remembers a folder name per project in localStorage', async () => {
    const { memory } = await mountMemory()

    memory.remember('folder-1', 'my-app')

    expect(memory.names.value).toEqual({ 'folder-1': 'my-app' })
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
      names: { 'folder-1': 'my-app' },
      syncedFolderId: null,
    })
  })

  it('records which folder is linked to the saved directory handle',
    async () => {
      const { memory } = await mountMemory()

      memory.remember('folder-2', 'docs', { isSynced: true })

      expect(memory.syncedFolderId.value).toBe('folder-2')

      await memory.forgetSync()

      expect(memory.syncedFolderId.value).toBeNull()
      expect(memory.names.value).toEqual({ 'folder-2': 'docs' })
    })

  it('removes the saved directory handle of the project when forgetting',
    async () => {
      const { memory } = await mountMemory()

      memory.remember('folder-2', 'docs', { isSynced: true })
      await memory.forgetSync()

      expect(mocks.removeKnowledgeDirectoryHandle)
        .toHaveBeenCalledExactlyOnceWith('project-1')
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!))
        .toEqual({ names: { 'folder-2': 'docs' }, syncedFolderId: null })
    })

  it('reads what an earlier visit stored once mounted', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: { 'folder-1': 'old' },
      syncedFolderId: 'folder-1',
    }))

    const { memory } = await mountMemory()

    expect(memory.names.value).toEqual({ 'folder-1': 'old' })
    expect(memory.syncedFolderId.value).toBe('folder-1')
  })

  it('ignores corrupt storage', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')

    const { memory } = await mountMemory()

    expect(memory.names.value).toEqual({})
    expect(memory.syncedFolderId.value).toBeNull()
  })

  it.each([
    ['null', 'null'],
    ['an array', '[1,2]'],
    ['a string', '"names"'],
    ['a number', '42'],
  ])('ignores a payload that is %s', async (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw)

    const { memory } = await mountMemory()

    expect(memory.names.value).toEqual({})
    expect(memory.syncedFolderId.value).toBeNull()
  })

  it.each([
    ['an array', '["a","b"]'],
    ['a string', '"x"'],
    ['null', 'null'],
    ['a number', '7'],
  ])('ignores names that are %s', async (_label, names) => {
    window.localStorage.setItem(
      STORAGE_KEY,
      `{"names":${names},"syncedFolderId":"folder-1"}`,
    )

    const { memory } = await mountMemory()

    expect(memory.names.value).toEqual({})
    expect(memory.syncedFolderId.value).toBe('folder-1')
  })

  it('drops invalid name entries instead of rendering them', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: {
        'folder-1': 'kept',
        'folder-2': { nested: true },
        'folder-3': 42,
        'folder-4': ['a'],
        'folder-5': null,
        'folder-6': '',
        'folder-7': 'n'.repeat(256),
        'not a folder id': 'spaces',
        '../escape': 'slashes',
        [`${'i'.repeat(65)}`]: 'too long id',
        'folder-8': 'n'.repeat(255),
      },
      syncedFolderId: null,
    }))

    const { memory } = await mountMemory()

    expect(memory.names.value).toEqual({
      'folder-1': 'kept',
      'folder-8': 'n'.repeat(255),
    })
  })

  it('drops a synced folder id that is not a folder id', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: { 'folder-1': 'docs' },
      syncedFolderId: { id: 'folder-1' },
    }))

    const { memory } = await mountMemory()

    expect(memory.syncedFolderId.value).toBeNull()

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: {},
      syncedFolderId: 'not a folder id',
    }))

    const { memory: other } = await mountMemory()

    expect(other.syncedFolderId.value).toBeNull()
  })

  it('keeps projects apart and reloads when the project changes', async () => {
    window.localStorage.setItem('knowledge-folders:project-2', JSON.stringify({
      names: { other: 'other-folder' },
      syncedFolderId: null,
    }))

    const { memory, projectId } = await mountMemory()

    expect(memory.names.value).toEqual({})

    projectId.value = 'project-2'
    await nextTick()

    expect(memory.names.value).toEqual({ other: 'other-folder' })
  })

  it('survives storage that throws', async () => {
    const { memory } = await mountMemory()
    const original = Storage.prototype.setItem

    Storage.prototype.setItem = () => {
      throw new Error('quota')
    }

    try {
      expect(() => memory.remember('folder-1', 'name')).not.toThrow()
      expect(memory.names.value).toEqual({ 'folder-1': 'name' })
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
