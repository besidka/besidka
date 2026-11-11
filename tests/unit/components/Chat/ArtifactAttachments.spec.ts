import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import ArtifactAttachments from '../../../../app/components/Chat/ArtifactAttachments.vue'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
}))

mockNuxtImport('useArtifactPanel', () => {
  return () => ({ open: mocks.open })
})

enableAutoUnmount(afterEach)

function attachment(
  artifactId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'data-artifact-attachment',
    data: {
      artifactId,
      version: 2,
      kind: 'mermaid',
      title: 'Release flow',
      ...overrides,
    },
  }
}

function mountAttachments(
  role: 'user' | 'assistant',
  parts: unknown[],
) {
  return mountSuspended(ArtifactAttachments, {
    props: {
      message: { role, parts } as Pick<UIMessage, 'role' | 'parts'>,
    },
  })
}

const GROUP = '[data-testid="message-artifact-attachments"]'
const CHIP = '[data-testid="message-artifact-attachment"]'

describe('Chat/ArtifactAttachments', () => {
  beforeEach(() => {
    mocks.open.mockClear()
  })

  it('renders one chip per attached artifact with kind and version',
    async () => {
      const wrapper = await mountAttachments('user', [
        { type: 'text', text: 'Use these' },
        attachment('a1'),
        attachment('a2', { kind: 'html', title: 'Quiz', version: 5 }),
      ])
      const chips = wrapper.findAll(CHIP)

      expect(chips).toHaveLength(2)
      expect(chips[0]!.text()).toContain('Release flow')
      expect(chips[0]!.text()).toContain('Mermaid · v2')
      expect(chips[1]!.text()).toContain('Quiz')
      expect(chips[1]!.text()).toContain('HTML · v5')
      expect(wrapper.get(GROUP).attributes('aria-label'))
        .toBe('Attached artifacts')
    })

  it('renders nothing for a message without attachments', async () => {
    const wrapper = await mountAttachments('user', [
      { type: 'text', text: 'Hello' },
    ])

    expect(wrapper.find(GROUP).exists()).toBe(false)
  })

  it('renders nothing for an assistant message', async () => {
    const wrapper = await mountAttachments('assistant', [attachment('a1')])

    expect(wrapper.find(GROUP).exists()).toBe(false)
  })

  it('ignores malformed attachment parts', async () => {
    const wrapper = await mountAttachments('user', [
      { type: 'data-artifact-attachment', data: { artifactId: 'a1' } },
    ])

    expect(wrapper.find(GROUP).exists()).toBe(false)
  })

  it('opens the artifact in the side panel on click', async () => {
    const wrapper = await mountAttachments('user', [attachment('a1')])

    await wrapper.get(CHIP).trigger('click')

    expect(mocks.open).toHaveBeenCalledWith({
      artifactId: 'a1',
      version: null,
      kind: 'mermaid',
      title: 'Release flow',
      source: 'owner',
    })
  })
})
