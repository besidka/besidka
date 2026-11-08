import { ref } from 'vue'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContextItem } from '../../../../shared/types/chat-context.d'
import ChatContextPanel from '../../../../app/components/Chat/ContextPanel.vue'
import { useSidePanel } from '../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const routeSlug = ref<string>(CHAT_SLUG)
const data = ref<Record<string, any> | null>(null)
const error = ref<unknown>(null)
const refresh = vi.fn()
const layout = ref<'docked' | 'overlay' | 'sheet'>('docked')
const isShareModalOpen = ref<boolean>(false)
const isBranching = ref<boolean>(false)
const sharedBranchTarget = ref<{ slug: string, allowBranch: boolean } | null>(
  null,
)
const memoryExclusionSavingSlug = ref<string | null>(null)
const openShareModal = vi.fn()
const branchOwnedChat = vi.fn()
const branchSharedChat = vi.fn()
const setChatMemoryExcluded = vi.fn()
const memoryOverride = ref<boolean | null>(null)

mockNuxtImport('useChatRoute', () => {
  return () => ({ routeSlug })
})

mockNuxtImport('useChatContext', () => {
  return () => ({ data, error, refresh })
})

mockNuxtImport('useSidePanelLayout', () => {
  return () => layout
})

mockNuxtImport('useChatShare', () => {
  return () => ({
    openShareModal,
    branchOwnedChat,
    branchSharedChat,
    sharedBranchTarget,
    isBranching,
    isModalOpen: isShareModalOpen,
  })
})

mockNuxtImport('useChatMemoryExclusion', () => {
  return () => ({
    savingSlug: memoryExclusionSavingSlug,
    isChatMemoryExcluded: (_slug: string, fallback = false) => {
      return memoryOverride.value ?? fallback
    },
    setChatMemoryExcluded,
  })
})

mockComponent('ChatImagePreview', () => {
  return {
    props: ['src', 'downloadUrl', 'alt', 'filename', 'open'],
    emits: ['update:open'],
    template: `
      <div
        data-testid="chat-context-image-preview"
        :data-src="src"
        :data-download-url="downloadUrl"
        :data-filename="filename"
        :data-open="String(open)"
      />
    `,
  }
})

const stubs = {
  UiSidePanelSkeleton: {
    template: '<div data-testid="chat-context-skeleton" />',
  },
}

function item(overrides: Partial<ChatContextItem> = {}): ChatContextItem {
  return {
    id: 'file:/files/key-1',
    sectionId: 'uploaded-files',
    kind: 'file',
    title: 'report.pdf',
    messageId: 'message-1',
    meta: { url: '/files/key-1', mediaType: 'application/pdf' },
    ...overrides,
  }
}

function ownedData(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'owned',
    chat: {
      slug: CHAT_SLUG,
      title: 'Roadmap',
      project: null,
      memoryExcluded: false,
      share: { active: false },
      cost: null,
      models: [],
    },
    outputs: [],
    inputs: [],
    used: [],
    counts: { outputs: 0, inputs: 0, used: 0 },
    kindCounts: {},
    truncated: false,
    ...overrides,
  }
}

function sharedData(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'shared',
    chat: {
      slug: 'share-slug',
      title: 'Shared chat',
      cost: null,
      models: [],
      allowBranch: true,
    },
    outputs: [],
    inputs: [],
    used: [],
    counts: { outputs: 0, inputs: 0, used: 0 },
    kindCounts: {},
    truncated: false,
    ...overrides,
  }
}

function mountPanel() {
  return mountSuspended(ChatContextPanel, { global: { stubs } })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Chat/ContextPanel', () => {
  beforeEach(() => {
    routeSlug.value = CHAT_SLUG
    data.value = null
    error.value = null
    layout.value = 'docked'
    isShareModalOpen.value = false
    isBranching.value = false
    sharedBranchTarget.value = null
    memoryExclusionSavingSlug.value = null
    memoryOverride.value = null
    refresh.mockReset()
    openShareModal.mockReset()
    branchOwnedChat.mockReset()
    branchSharedChat.mockReset()
    setChatMemoryExcluded.mockReset()
    setChatMemoryExcluded.mockResolvedValue(true)
    clearNuxtState('chat-context-collapsed-sections')
    useSidePanel().close()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    useSidePanel().close()
    document.body.innerHTML = ''
  })

  describe('states', () => {
    it('shows the skeleton while the context loads', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-skeleton')).exists())
        .toBe(true)
      expect(wrapper.find(testId('chat-context-header')).exists())
        .toBe(false)
      expect(wrapper.find(testId('chat-context-error')).exists())
        .toBe(false)
    })

    it('shows an error with a retry that refreshes', async () => {
      error.value = { message: 'Chat not found.', status: 404 }

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-skeleton')).exists())
        .toBe(false)
      expect(wrapper.get(testId('chat-context-error')).text())
        .toContain('Couldn\'t load this chat\'s context')

      await wrapper.get(testId('chat-context-retry')).trigger('click')

      expect(refresh).toHaveBeenCalledOnce()
    })

    it('keeps showing loaded data when a refresh fails', async () => {
      data.value = ownedData()
      error.value = { message: 'offline' }

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-error')).exists()).toBe(false)
      expect(wrapper.find(testId('chat-context-header')).exists()).toBe(true)
    })

    it('says so when the chat has nothing yet', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-empty')).text())
        .toContain('Nothing here yet')
      expect(wrapper.find(testId('chat-context-section-outputs')).exists())
        .toBe(false)
    })

    it('shows only the sections that have items', async () => {
      data.value = ownedData({
        outputs: [
          item({
            id: 'research:m1',
            sectionId: 'research-reports',
            kind: 'research',
            title: 'Research report',
            meta: {},
          }),
        ],
        used: [
          item({
            id: 'memory:call-1',
            sectionId: 'memory',
            kind: 'memory',
            title: 'Likes cats',
            meta: { action: 'Saved' },
          }),
        ],
      })

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-empty')).exists()).toBe(false)
      expect(wrapper.find(testId('chat-context-section-outputs')).exists())
        .toBe(true)
      expect(wrapper.find(testId('chat-context-section-inputs')).exists())
        .toBe(false)
      expect(wrapper.find(testId('chat-context-section-used')).exists())
        .toBe(true)
    })

    it('labels each section with its item count', async () => {
      data.value = ownedData({
        inputs: [
          item(),
          item({ id: 'file:/files/key-2', title: 'notes.txt' }),
        ],
        counts: { outputs: 0, inputs: 2, used: 0 },
      })

      const wrapper = await mountPanel()
      const section = wrapper.get(testId('chat-context-section-inputs'))

      expect(section.get('h4').text()).toContain('Inputs')
      expect(section.get('h4').text()).toContain('2')
      expect(section.findAll('li')).toHaveLength(2)
      expect(section.find(testId('chat-context-section-inputs-capped')).exists())
        .toBe(false)
    })

    it('shows the full total and a capped note when items were cut', async () => {
      data.value = ownedData({
        inputs: [item()],
        counts: { outputs: 0, inputs: 230, used: 0 },
      })

      const wrapper = await mountPanel()
      const section = wrapper.get(testId('chat-context-section-inputs'))

      expect(section.get('h4').text()).toContain('230')
      expect(section.get(testId('chat-context-section-inputs-capped')).text())
        .toBe('Showing the latest 1.')
    })

    it('notes when only the latest messages were read', async () => {
      data.value = ownedData({ truncated: true })

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-truncated')).text())
        .toContain('latest 1,000 messages')
    })

    it('does not show the truncation note for a complete read', async () => {
      data.value = ownedData({ truncated: false })

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-truncated')).exists())
        .toBe(false)
    })
  })

  describe('owned chat header', () => {
    it('shows the title, with a fallback for an untitled chat', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-title')).text())
        .toBe('Roadmap')

      data.value = ownedData({
        chat: { ...ownedData().chat, title: '' },
      })
      await nextTick()

      expect(wrapper.get(testId('chat-context-title')).text())
        .toBe('Untitled chat')
    })

    it('links the project, shows the cost and the shared badge', async () => {
      data.value = ownedData({
        chat: {
          ...ownedData().chat,
          project: { id: 'project-1', name: 'Vaimo' },
          cost: { amount: 0.0312, isEstimated: true },
          share: { active: true, url: '/shared/x' },
        },
      })

      const wrapper = await mountPanel()
      const project = wrapper.get(testId('chat-context-project'))

      expect(project.text()).toContain('Vaimo')
      expect(project.attributes('to')).toBe('/chats/projects/project-1')
      expect(wrapper.get(testId('chat-context-cost')).text())
        .toBe('~$0.0312')
      expect(wrapper.get(testId('chat-context-cost')).attributes('title'))
        .toBe('Chat total, partly estimated')
      expect(wrapper.find(testId('chat-context-shared')).exists()).toBe(true)
    })

    it('shows an exact cost without a tilde', async () => {
      data.value = ownedData({
        chat: {
          ...ownedData().chat,
          cost: { amount: 0.5, isEstimated: false },
        },
      })

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-cost')).text()).toBe('$0.50')
      expect(wrapper.get(testId('chat-context-cost')).attributes('title'))
        .toBe('Chat total')
    })

    it('shows no badges for a plain chat', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-project')).exists())
        .toBe(false)
      expect(wrapper.find(testId('chat-context-cost')).exists()).toBe(false)
      expect(wrapper.find(testId('chat-context-shared')).exists()).toBe(false)
      expect(wrapper.find(testId('chat-context-memory-excluded')).exists())
        .toBe(false)
    })

    it('shows the memory-excluded badge', async () => {
      data.value = ownedData({
        chat: { ...ownedData().chat, memoryExcluded: true },
      })

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-memory-excluded')).text())
        .toContain('Not used for memory')
    })

    it('offers Branch, Share and the memory toggle', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-branch')).text())
        .toContain('Branch')
      expect(wrapper.get(testId('chat-context-share')).text())
        .toContain('Share')
      expect(wrapper.get(testId('chat-context-memory-exclusion')).text())
        .toContain('Exclude from memory')
    })

    it('opens the share modal for the route chat', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()

      await wrapper.get(testId('chat-context-share')).trigger('click')

      expect(openShareModal).toHaveBeenCalledWith(CHAT_SLUG)
    })

    it('branches the owned chat', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()

      await wrapper.get(testId('chat-context-branch')).trigger('click')

      expect(branchOwnedChat).toHaveBeenCalledWith(CHAT_SLUG)
      expect(branchSharedChat).not.toHaveBeenCalled()
    })

    it('disables Branch while a branch is being created', async () => {
      isBranching.value = true
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-branch'))
        .attributes('disabled')).toBeDefined()
    })

    it('offers to exclude an included chat from memory', async () => {
      data.value = ownedData()

      const wrapper = await mountPanel()
      const toggle = wrapper.get(testId('chat-context-memory-exclusion'))

      expect(toggle.attributes('title')).toContain(
        'Don\'t use this chat for memory',
      )

      await toggle.trigger('click')

      expect(setChatMemoryExcluded).toHaveBeenCalledWith(CHAT_SLUG, true)
    })

    it('offers to use an excluded chat for memory again', async () => {
      data.value = ownedData({
        chat: { ...ownedData().chat, memoryExcluded: true },
      })

      const wrapper = await mountPanel()
      const toggle = wrapper.get(testId('chat-context-memory-exclusion'))

      expect(toggle.text()).toContain('Use memory')
      expect(toggle.attributes('title')).toBe(
        'Learns from this chat and finds it in chat search.',
      )

      await toggle.trigger('click')

      expect(setChatMemoryExcluded).toHaveBeenCalledWith(CHAT_SLUG, false)
    })

    it('follows a local memory exclusion over the loaded value', async () => {
      memoryOverride.value = true
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-memory-excluded')).exists())
        .toBe(true)
      expect(wrapper.get(testId('chat-context-memory-exclusion')).text())
        .toContain('Use memory')
    })

    it('disables the memory toggle while it saves', async () => {
      memoryExclusionSavingSlug.value = CHAT_SLUG
      data.value = ownedData()

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-memory-exclusion'))
        .attributes('disabled')).toBeDefined()
    })

    it('refreshes when the share modal closes', async () => {
      data.value = ownedData()

      await mountPanel()

      isShareModalOpen.value = true
      await nextTick()

      expect(refresh).not.toHaveBeenCalled()

      isShareModalOpen.value = false
      await nextTick()

      expect(refresh).toHaveBeenCalledOnce()
    })
  })

  describe('shared chat header', () => {
    it('shows Branch only when the share allows it', async () => {
      routeSlug.value = 'share-slug'
      sharedBranchTarget.value = { slug: 'share-slug', allowBranch: true }
      data.value = sharedData()

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-branch')).exists()).toBe(true)

      await wrapper.get(testId('chat-context-branch')).trigger('click')

      expect(branchSharedChat).toHaveBeenCalledWith('share-slug')
      expect(branchOwnedChat).not.toHaveBeenCalled()
    })

    it('never shows Share or the memory controls', async () => {
      routeSlug.value = 'share-slug'
      sharedBranchTarget.value = { slug: 'share-slug', allowBranch: true }
      data.value = sharedData()

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-share')).exists()).toBe(false)
      expect(wrapper.find(testId('chat-context-memory-exclusion')).exists())
        .toBe(false)
      expect(wrapper.find(testId('chat-context-project')).exists())
        .toBe(false)
      expect(wrapper.find(testId('chat-context-shared')).exists()).toBe(false)
    })

    it('hides Branch when the share does not allow it', async () => {
      routeSlug.value = 'share-slug'
      sharedBranchTarget.value = { slug: 'share-slug', allowBranch: true }
      data.value = sharedData({
        chat: { ...sharedData().chat, allowBranch: false },
      })

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-branch')).exists())
        .toBe(false)
    })

    it('hides Branch when the page reports it cannot branch', async () => {
      routeSlug.value = 'share-slug'
      sharedBranchTarget.value = { slug: 'share-slug', allowBranch: false }
      data.value = sharedData()

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-branch')).exists())
        .toBe(false)
    })

    it('hides Branch while the branch target is another chat or missing',
      async () => {
        routeSlug.value = 'share-slug'
        data.value = sharedData()

        const wrapper = await mountPanel()

        expect(wrapper.find(testId('chat-context-branch')).exists())
          .toBe(false)

        sharedBranchTarget.value = { slug: 'other', allowBranch: true }
        await nextTick()

        expect(wrapper.find(testId('chat-context-branch')).exists())
          .toBe(false)
      })

    it('shows the cost when the share exposes metadata', async () => {
      routeSlug.value = 'share-slug'
      data.value = sharedData({
        chat: {
          ...sharedData().chat,
          cost: { amount: 0.02, isEstimated: false },
        },
      })

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-cost')).text()).toBe('$0.02')
    })
  })

  describe('collapsible sections', () => {
    function manyItems(count: number) {
      return Array.from({ length: count }, (_value, index) => {
        return item({
          id: `file:/files/key-${index}`,
          title: `file-${index}.txt`,
        })
      })
    }

    function toggleOf(
      wrapper: Awaited<ReturnType<typeof mountPanel>>,
      id: string,
    ) {
      return wrapper.get(testId(`chat-context-section-${id}-toggle`))
    }

    it('renders each section header as a button with count and chevron',
      async () => {
        data.value = ownedData({
          inputs: manyItems(2),
          counts: { outputs: 0, inputs: 2, used: 0 },
        })

        const wrapper = await mountPanel()
        const toggle = toggleOf(wrapper, 'inputs')

        expect(toggle.element.tagName).toBe('BUTTON')
        expect(toggle.attributes('type')).toBe('button')
        expect(toggle.attributes('aria-expanded')).toBe('true')
        expect(toggle.attributes('aria-controls'))
          .toBe(wrapper.get(testId('chat-context-section-inputs-list'))
            .element.parentElement?.id)
        expect(toggle.text()).toContain('Inputs')
        expect(toggle.text()).toContain('2')
        expect(toggle.find('.iconify').classes())
          .toContain('i-lucide:chevron-right')
      })

    it('collapses and expands a section from its header', async () => {
      data.value = ownedData({
        inputs: manyItems(2),
        counts: { outputs: 0, inputs: 2, used: 0 },
      })

      const wrapper = await mountPanel()

      await toggleOf(wrapper, 'inputs').trigger('click')

      expect(toggleOf(wrapper, 'inputs').attributes('aria-expanded'))
        .toBe('false')
      expect(wrapper.find(testId('chat-context-section-inputs-list')).exists())
        .toBe(false)
      expect(toggleOf(wrapper, 'inputs').attributes('aria-controls'))
        .toBeUndefined()
      expect(wrapper.get(testId('chat-context-section-inputs')).text())
        .toContain('Inputs')

      await toggleOf(wrapper, 'inputs').trigger('click')

      expect(toggleOf(wrapper, 'inputs').attributes('aria-expanded'))
        .toBe('true')
      expect(wrapper.findAll(
        `${testId('chat-context-section-inputs-list')} li`,
      )).toHaveLength(2)
    })

    it('collapses only the section that was toggled', async () => {
      data.value = ownedData({
        outputs: manyItems(1),
        inputs: manyItems(1),
        counts: { outputs: 1, inputs: 1, used: 0 },
      })

      const wrapper = await mountPanel()

      await toggleOf(wrapper, 'outputs').trigger('click')

      expect(toggleOf(wrapper, 'outputs').attributes('aria-expanded'))
        .toBe('false')
      expect(toggleOf(wrapper, 'inputs').attributes('aria-expanded'))
        .toBe('true')
    })

    it('keeps the choice for the rest of the session when reopened',
      async () => {
        data.value = ownedData({
          inputs: manyItems(2),
          counts: { outputs: 0, inputs: 2, used: 0 },
        })

        const first = await mountPanel()

        await toggleOf(first, 'inputs').trigger('click')
        first.unmount()

        const second = await mountPanel()

        expect(toggleOf(second, 'inputs').attributes('aria-expanded'))
          .toBe('false')
      })

    it('collapses Used by default when it has more than 10 items',
      async () => {
        data.value = ownedData({
          inputs: manyItems(2),
          used: manyItems(11),
          counts: { outputs: 0, inputs: 2, used: 11 },
        })

        const wrapper = await mountPanel()

        expect(toggleOf(wrapper, 'used').attributes('aria-expanded'))
          .toBe('false')
        expect(toggleOf(wrapper, 'used').text()).toContain('11')
        expect(wrapper.find(testId('chat-context-section-used-list')).exists())
          .toBe(false)
        expect(toggleOf(wrapper, 'inputs').attributes('aria-expanded'))
          .toBe('true')

        await toggleOf(wrapper, 'used').trigger('click')

        expect(wrapper.findAll(
          `${testId('chat-context-section-used-list')} li`,
        )).toHaveLength(11)
      })

    it('keeps Used open at 10 items or fewer', async () => {
      data.value = ownedData({
        used: manyItems(10),
        counts: { outputs: 0, inputs: 0, used: 10 },
      })

      const wrapper = await mountPanel()

      expect(toggleOf(wrapper, 'used').attributes('aria-expanded'))
        .toBe('true')
    })

    it('bases the Used default on the full total, not the capped list',
      async () => {
        data.value = ownedData({
          used: manyItems(3),
          counts: { outputs: 0, inputs: 0, used: 250 },
        })

        const wrapper = await mountPanel()

        expect(toggleOf(wrapper, 'used').attributes('aria-expanded'))
          .toBe('false')
      })

    it('scrolls each list inside a 500px box and keeps rows compact',
      async () => {
        data.value = ownedData({
          inputs: manyItems(40),
          counts: { outputs: 0, inputs: 40, used: 0 },
        })

        const wrapper = await mountPanel()
        const list = wrapper.get(testId('chat-context-section-inputs-list'))

        expect(list.classes()).toEqual(expect.arrayContaining([
          'max-h-[500px]',
          'overflow-y-auto',
        ]))
        expect(list.findAll('li')).toHaveLength(40)
        expect(list.get('li .size-7').exists()).toBe(true)
      })
  })

  describe('items', () => {
    it('shows a generated image with a thumbnail and its detail', async () => {
      data.value = ownedData({
        outputs: [
          item({
            id: 'image:file-1',
            sectionId: 'generated-images',
            kind: 'image',
            title: 'cat.png',
            meta: { url: '/files/key-2', mediaType: 'image/png' },
          }),
        ],
      })

      const wrapper = await mountPanel()
      const row = wrapper.get(testId('chat-context-item-image'))

      expect(row.find('img').attributes('src')).toBe('/files/key-2')
      expect(row.text()).toContain('cat.png')
      expect(row.text()).toContain('Generated image')
    })

    it('never renders an unsafe image url as a thumbnail', async () => {
      data.value = ownedData({
        outputs: [
          item({
            id: 'image:evil',
            kind: 'image',
            title: 'evil.png',
            meta: { url: 'javascript:alert(1)' },
          }),
          item({
            id: 'image:external',
            kind: 'image',
            title: 'external.png',
            meta: { url: '//evil.test/a.png' },
          }),
        ],
      })

      const wrapper = await mountPanel()

      expect(wrapper.find('img').exists()).toBe(false)
    })

    it('opens a generated image in the preview', async () => {
      data.value = ownedData({
        outputs: [
          item({
            id: 'image:file-1',
            kind: 'image',
            title: 'cat.png',
            meta: {
              url: '/files/key-2',
              downloadUrl: '/files/key-2?download=1',
            },
          }),
        ],
      })

      const wrapper = await mountPanel()

      expect(wrapper.find(testId('chat-context-image-preview')).exists())
        .toBe(false)

      await wrapper.get(testId('chat-context-item-image')).trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find(testId('chat-context-image-preview')).exists())
          .toBe(true)
      })

      const preview = wrapper.get(testId('chat-context-image-preview'))

      expect(preview.attributes('data-src')).toBe('/files/key-2')
      expect(preview.attributes('data-download-url'))
        .toBe('/files/key-2?download=1')
      expect(preview.attributes('data-filename')).toBe('cat.png')
      expect(preview.attributes('data-open')).toBe('true')
    })

    it('falls back to the image url for the download link', async () => {
      data.value = ownedData({
        outputs: [
          item({
            id: 'image:file-1',
            kind: 'image',
            title: 'cat.png',
            meta: { url: '/files/key-2', downloadUrl: 'https://evil.test/x' },
          }),
        ],
      })

      const wrapper = await mountPanel()

      await wrapper.get(testId('chat-context-item-image')).trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find(testId('chat-context-image-preview')).exists())
          .toBe(true)
      })

      expect(wrapper.get(testId('chat-context-image-preview'))
        .attributes('data-download-url')).toBe('/files/key-2')
    })

    it('does not open the preview for an unsafe image url', async () => {
      const target = document.createElement('div')

      target.setAttribute('data-message-id', 'message-1')
      target.scrollIntoView = vi.fn()
      document.body.append(target)
      data.value = ownedData({
        outputs: [
          item({
            id: 'image:evil',
            kind: 'image',
            title: 'evil.png',
            meta: { url: 'https://evil.test/a.png' },
          }),
        ],
      })

      const wrapper = await mountPanel()

      await wrapper.get(testId('chat-context-item-image')).trigger('click')

      expect(wrapper.find(testId('chat-context-image-preview')).exists())
        .toBe(false)
      expect(target.scrollIntoView).toHaveBeenCalled()
    })

    it('scrolls the chat to the message of a plain item', async () => {
      const target = document.createElement('div')
      const other = document.createElement('div')

      target.setAttribute('data-message-id', 'message-1')
      other.setAttribute('data-message-id', 'message-2')
      target.scrollIntoView = vi.fn()
      other.scrollIntoView = vi.fn()
      document.body.append(target, other)
      data.value = ownedData({ inputs: [item({ messageId: 'message-1' })] })

      const wrapper = await mountPanel()

      await wrapper.get(testId('chat-context-item-file')).trigger('click')

      expect(target.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      })
      expect(other.scrollIntoView).not.toHaveBeenCalled()
    })

    it('keeps the panel open on desktop after scrolling', async () => {
      const target = document.createElement('div')

      target.setAttribute('data-message-id', 'message-1')
      target.scrollIntoView = vi.fn()
      document.body.append(target)
      useSidePanel().open({ viewKey: 'chat-context', title: 'Chat' })
      data.value = ownedData({ inputs: [item()] })

      const wrapper = await mountPanel()

      await wrapper.get(testId('chat-context-item-file')).trigger('click')

      expect(useSidePanel().isOpen.value).toBe(true)
    })

    it('does nothing when the message is not in the page', async () => {
      useSidePanel().open({ viewKey: 'chat-context', title: 'Chat' })
      data.value = ownedData({ inputs: [item({ messageId: 'gone' })] })

      const wrapper = await mountPanel()

      await expect(
        wrapper.get(testId('chat-context-item-file')).trigger('click'),
      ).resolves.toBeUndefined()
    })

    it('closes the panel first on the sheet layout, then scrolls',
      async () => {
        const sidePanel = useSidePanel()
        const target = document.createElement('div')
        let panelOpenWhenScrolled: boolean | null = null

        layout.value = 'sheet'
        target.setAttribute('data-message-id', 'message-1')
        target.scrollIntoView = vi.fn(() => {
          panelOpenWhenScrolled = sidePanel.isOpen.value
        })
        document.body.append(target)
        sidePanel.open({ viewKey: 'chat-context', title: 'Chat' })
        data.value = ownedData({ inputs: [item()] })

        const wrapper = await mountPanel()

        await wrapper.get(testId('chat-context-item-file')).trigger('click')
        await vi.waitFor(() => {
          expect(target.scrollIntoView).toHaveBeenCalled()
        })

        expect(panelOpenWhenScrolled).toBe(false)
        expect(sidePanel.isOpen.value).toBe(false)
      })

    it('opens a web source as an external link with safe rel', async () => {
      data.value = ownedData({
        used: [
          item({
            id: 'source:https://example.com/a',
            sectionId: 'web-sources',
            kind: 'web-source',
            title: 'Article A',
            href: 'https://example.com/a',
            meta: { domain: 'example.com' },
          }),
        ],
      })

      const wrapper = await mountPanel()
      const link = wrapper.get(testId('chat-context-item-web-source'))

      expect(link.element.tagName).toBe('A')
      expect(link.attributes('href')).toBe('https://example.com/a')
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
      expect(link.text()).toContain('Article A')
      expect(link.text()).toContain('example.com')
    })

    it('renders items without a link as buttons', async () => {
      data.value = ownedData({ inputs: [item()] })

      const wrapper = await mountPanel()

      expect(wrapper.get(testId('chat-context-item-file')).element.tagName)
        .toBe('BUTTON')
    })

    it('words the detail line per kind', async () => {
      data.value = ownedData({
        outputs: [
          item({
            id: 'research:m1',
            kind: 'research',
            title: 'Research report',
            meta: {},
          }),
        ],
        inputs: [
          item({
            id: 'knowledge:item-1',
            kind: 'knowledge',
            title: 'Pricing sheet',
            meta: undefined,
          }),
        ],
        used: [
          item({
            id: 'web-search:web_search_brave',
            kind: 'web-search',
            title: 'Brave Search',
            meta: { count: 3 },
          }),
          item({
            id: 'web-search:web_search_exa',
            kind: 'web-search',
            title: 'Exa search',
            meta: { count: 1 },
          }),
          item({
            id: 'memory:call-1',
            kind: 'memory',
            title: 'Likes cats',
            meta: { action: 'Saved' },
          }),
          item({
            id: 'chat-search:call-2',
            kind: 'chat-search',
            title: 'wedding plans',
            meta: { action: 'Searched chats' },
          }),
        ],
      })

      const wrapper = await mountPanel()
      const text = (id: string) => {
        return wrapper.get(testId(id)).text()
      }

      expect(text('chat-context-section-outputs')).toContain('Deep research')
      expect(text('chat-context-section-inputs'))
        .toContain('Project knowledge')

      const used = text('chat-context-section-used')

      expect(used).toContain('Used in 3 answers')
      expect(used).toContain('Used in 1 answer')
      expect(used).toContain('Saved')
      expect(used).toContain('Searched chats')
    })
  })
})
