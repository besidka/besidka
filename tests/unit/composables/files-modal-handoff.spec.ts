import { beforeEach, describe, expect, it } from 'vitest'
import { useFilesModalHandoff } from '../../../app/composables/files-modal-handoff'

describe('useFilesModalHandoff', () => {
  beforeEach(() => {
    useFilesModalHandoff().clearPendingOpen()
  })

  it('starts with no pending open request', () => {
    const { pendingOpen } = useFilesModalHandoff()

    expect(pendingOpen.value).toBeNull()
  })

  it('requests opening the select tab with a source filter', () => {
    const { pendingOpen, requestOpen } = useFilesModalHandoff()

    requestOpen('select', '/chats/new', 'all')

    expect(pendingOpen.value).toEqual({
      tab: 'select',
      source: 'all',
      targetPath: '/chats/new',
    })
  })

  it('requests opening the upload tab without a source filter', () => {
    const { pendingOpen, requestOpen } = useFilesModalHandoff()

    requestOpen('upload', '/chats/new')

    expect(pendingOpen.value).toEqual({
      tab: 'upload',
      source: undefined,
      targetPath: '/chats/new',
    })
    expect(pendingOpen.value).not.toStrictEqual({
      tab: 'upload',
      targetPath: '/chats/new',
    })
  })

  it('clears the pending request', () => {
    const { pendingOpen, requestOpen, clearPendingOpen }
      = useFilesModalHandoff()

    requestOpen('select', '/chats/abc123', 'assistant')
    clearPendingOpen()

    expect(pendingOpen.value).toBeNull()
  })

  it('overwrites a previous pending request with the latest one', () => {
    const { pendingOpen, requestOpen } = useFilesModalHandoff()

    requestOpen('select', '/chats/abc123', 'assistant')
    requestOpen('upload', '/chats/new')

    expect(pendingOpen.value).toEqual({
      tab: 'upload',
      source: undefined,
      targetPath: '/chats/new',
    })
  })

  it('shares pendingOpen across separate call sites', () => {
    const chatInputInstance = useFilesModalHandoff()
    const searchModalInstance = useFilesModalHandoff()

    searchModalInstance.requestOpen('select', '/chats/new', 'all')

    expect(chatInputInstance.pendingOpen.value).toEqual({
      tab: 'select',
      source: 'all',
      targetPath: '/chats/new',
    })

    chatInputInstance.clearPendingOpen()

    expect(searchModalInstance.pendingOpen.value).toBeNull()
  })
})
