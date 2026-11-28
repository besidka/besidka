import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getGoogleFilePreviewViewKey,
  useGoogleFilePreview,
} from '../../../app/composables/google-file-preview'
import { useSidePanel } from '../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const TARGET = {
  toolCallId: 'call_1',
  id: 'abcdefghij1234567890',
  chatSlug: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  title: 'Plan',
  kind: 'document' as const,
  content: '# Plan',
  openLink: 'https://docs.google.com/document/d/abcdefghij1234567890/edit',
}

describe('useGoogleFilePreview', () => {
  beforeEach(() => {
    useSidePanel().close()
  })

  it('opens the file in the side panel with its own view key', () => {
    const preview = useGoogleFilePreview()
    const sidePanel = useSidePanel()

    expect(preview.isShowing('call_1')).toBe(false)

    preview.open(TARGET)

    expect(sidePanel.viewKey.value).toBe('google-file:call_1')
    expect(sidePanel.viewKey.value)
      .toBe(getGoogleFilePreviewViewKey('call_1'))
    expect(sidePanel.title.value).toBe('Plan')
    expect(sidePanel.mode.value).toBe('detail')
    expect(sidePanel.currentView.value?.props).toEqual({
      toolCallId: 'call_1',
      fileId: 'abcdefghij1234567890',
      chatSlug: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      title: 'Plan',
      kind: 'document',
      content: '# Plan',
      openLink: TARGET.openLink,
    })
    expect(sidePanel.currentView.value?.headerActions).toBeDefined()
    expect(preview.isShowing('call_1')).toBe(true)
  })

  it('pushes a registered file so Back returns to the earlier view', () => {
    const preview = useGoogleFilePreview()
    const sidePanel = useSidePanel()

    sidePanel.open({ viewKey: 'chat-context', title: 'Context' })
    preview.register(TARGET)

    expect(preview.pushRegistered('call_1')).toBe(true)
    expect(sidePanel.viewKey.value).toBe('google-file:call_1')
    expect(sidePanel.canGoBack.value).toBe(true)

    sidePanel.back()

    expect(sidePanel.viewKey.value).toBe('chat-context')
  })

  it('does not push a file that is not registered or was removed', () => {
    const preview = useGoogleFilePreview()
    const sidePanel = useSidePanel()

    expect(preview.pushRegistered('missing')).toBe(false)

    preview.register(TARGET)
    preview.unregister('call_1')

    expect(preview.pushRegistered('call_1')).toBe(false)
    expect(sidePanel.isOpen.value).toBe(false)
  })
})
