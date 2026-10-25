import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { useKnowledgeFolderMemory } from '../../../app/composables/project-knowledge-folders'

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

      memory.forgetSync()

      expect(memory.syncedFolderId.value).toBeNull()
      expect(memory.names.value).toEqual({ 'folder-2': 'docs' })
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
