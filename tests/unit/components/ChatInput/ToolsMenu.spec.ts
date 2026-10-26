import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import type {
  ChatInputTile,
  ChatInputToolsState,
} from '../../../../app/types/chat-input-tools'
import ToolsMenu from '../../../../app/components/ChatInput/ToolsMenu.client.vue'

const mocks = vi.hoisted(() => ({
  setReasoningExpanded: vi.fn(),
  setReasoningAutoHide: vi.fn(),
}))

mockNuxtImport('useMediaQuery', () => {
  return () => isPopoverLayout
})

mockNuxtImport('useUserSetting', () => {
  return () => ({
    reasoningExpanded: shallowRef(false),
    reasoningAutoHide: shallowRef(true),
    setReasoningExpanded: mocks.setReasoningExpanded,
    setReasoningAutoHide: mocks.setReasoningAutoHide,
  })
})

const isPopoverLayout = shallowRef<boolean>(true)

enableAutoUnmount(afterEach)

type StateOverrides = {
  [Key in keyof ChatInputToolsState]?: ChatInputToolsState[Key] extends object
    ? Partial<ChatInputToolsState[Key]> | ChatInputToolsState[Key]
    : ChatInputToolsState[Key]
}

function createState(overrides: StateOverrides = {}): ChatInputToolsState {
  const base: ChatInputToolsState = {
    isNewChat: true,
    webSearch: {
      visible: true,
      selected: 'off',
      options: [
        {
          value: 'web_search',
          label: 'Model\'s built-in search',
          enabled: true,
        },
      ],
      isToolCallingSupported: false,
      exaSearchLevel: 'auto',
      isAutoAvailable: false,
      isAutoPreferred: false,
    },
    reasoning: {
      visible: true,
      mode: 'configurable',
      level: 'medium',
      levels: ['low', 'medium', 'high'],
      canDisable: true,
      capability: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      defaultLevel: 'medium',
    },
    image: { supported: true, enabled: false, required: false },
    files: { visible: true, count: 2, isImageInputSupported: true },
    project: { visible: true, context: null },
    memory: { excluded: false },
    research: null,
    isDeepResearchModel: false,
    isResearchJobActive: false,
    isCapabilityResolved: true,
  }

  return {
    ...base,
    ...overrides,
    webSearch: { ...base.webSearch, ...overrides.webSearch },
    reasoning: { ...base.reasoning, ...overrides.reasoning },
    image: { ...base.image, ...overrides.image },
    files: { ...base.files, ...overrides.files },
    project: { ...base.project, ...overrides.project },
    memory: { ...base.memory, ...overrides.memory },
  } as ChatInputToolsState
}

async function mountMenu(
  stateOverrides: StateOverrides = {},
  tiles: ChatInputTile[] = [],
) {
  const wrapper = await mountSuspended(ToolsMenu, {
    props: {
      state: createState(stateOverrides),
      tiles,
    },
    attachTo: document.body,
  })

  return wrapper
}

type MenuWrapper = Awaited<ReturnType<typeof mountMenu>>

async function open(wrapper: MenuWrapper) {
  await wrapper.get('[data-testid="chat-input-tools-trigger"]')
    .trigger('click')
  await flushPromises()
}

function has(wrapper: MenuWrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

function sectionIds(wrapper: MenuWrapper): string[] {
  return wrapper.findAll('[data-section]').map((section) => {
    return section.attributes('data-section') ?? ''
  })
}

const memoryTile: ChatInputTile = {
  id: 'memory',
  section: 'memory',
  icon: { kind: 'icon', name: 'lucide:book-x' },
  caption: 'Memory',
  value: 'Off',
  chipLabel: 'Memory off',
  ariaLabel: 'Memory off',
  removeLabel: 'Use memory again',
  isNeutral: true,
  isAuto: false,
  isDisabled: false,
}

describe('ChatInput/ToolsMenu', () => {
  beforeEach(() => {
    isPopoverLayout.value = true
    useState('chat-input:open-popover').value = null
  })

  it('renders a labelled "+" trigger and nothing else until opened',
    async () => {
      const wrapper = await mountMenu()
      const trigger = wrapper.get('[data-testid="chat-input-tools-trigger"]')

      expect(trigger.attributes('aria-label')).toBe('Add files and tools')
      expect(trigger.attributes('aria-haspopup')).toBe('dialog')
      expect(trigger.attributes('aria-expanded')).toBe('false')
      expect(trigger.classes()).toEqual(
        expect.arrayContaining(['btn-circle', 'btn-ghost-legacy']),
      )
      expect(has(wrapper, 'chat-input-tools-panel')).toBe(false)
    })

  it('lists the sections in order with every capability on', async () => {
    const wrapper = await mountMenu()

    await open(wrapper)

    expect(sectionIds(wrapper)).toEqual([
      'add',
      'search',
      'reasoning',
      'image',
      'project',
      'memory',
    ])
    expect(wrapper.get('[data-testid="tools-action-library"]').text())
      .toContain('2')
  })

  it('drops sections whose capability is missing', async () => {
    const wrapper = await mountMenu({
      webSearch: { visible: false },
      reasoning: { visible: false },
      image: { supported: false },
      project: { visible: false },
      memory: { excluded: null },
      files: { isImageInputSupported: false },
    })

    await open(wrapper)

    expect(sectionIds(wrapper)).toEqual(['add'])
    expect(has(wrapper, 'tools-action-generated')).toBe(false)
  })

  it('shows only the deep research note and lower rows for a research '
    + 'model', async () => {
    const wrapper = await mountMenu({
      isDeepResearchModel: true,
      research: {
        tier: 'thorough',
        assistModel: 'o4-mini',
        costEstimate: '~$1',
        timeEstimate: '5-30 min',
      },
      files: { visible: false },
      webSearch: { visible: false },
      reasoning: { visible: false },
    })

    await open(wrapper)

    expect(has(wrapper, 'tools-deep-research-note')).toBe(true)
    expect(sectionIds(wrapper)).toEqual(['project', 'memory'])
  })

  it('marks Create image required and checked for an image-only model',
    async () => {
      const wrapper = await mountMenu({
        image: { supported: true, enabled: true, required: true },
      })

      await open(wrapper)

      const toggle = wrapper.get('[data-testid="tools-image-toggle"]')

      expect((toggle.element as HTMLInputElement).checked).toBe(true)
      expect((toggle.element as HTMLInputElement).disabled).toBe(true)
      expect(toggle.attributes('aria-label'))
        .toBe('Image creation is required for this model')
    })

  it('labels the project row by chat state', async () => {
    const newChat = await mountMenu({
      project: { visible: true, context: { id: 'p1', name: 'Roadmap' } },
    })

    await open(newChat)

    expect(newChat.get('[data-testid="tools-project"]').text())
      .toContain('Roadmap')

    const existingChat = await mountMenu({ isNewChat: false })

    await open(existingChat)

    expect(existingChat.get('[data-testid="tools-project"]').text())
      .toContain('Move to project')
    expect(existingChat.get('[data-testid="tools-project"]').text())
      .toContain('None')
  })

  it('emits update:use-memory from the Use memory toggle, checked by '
    + 'default', async () => {
    const wrapper = await mountMenu()

    await open(wrapper)

    const toggle = wrapper.get('[data-testid="new-chat-memory-toggle"]')

    expect((toggle.element as HTMLInputElement).checked).toBe(true)

    await toggle.setValue(false)

    expect(wrapper.emitted('update:use-memory')).toEqual([[false]])
  })

  it('keeps the panel open after a radio or toggle change', async () => {
    const wrapper = await mountMenu()

    await open(wrapper)
    await wrapper.get('[data-testid="reasoning-level-high"]').setValue(true)
    await wrapper.get('[data-testid="tools-image-toggle"]').setValue(true)

    expect(wrapper.emitted('select-reasoning-level')).toEqual([['high']])
    expect(wrapper.emitted('toggle-image-generation')).toHaveLength(1)
    expect(
      wrapper.get('[data-testid="chat-input-tools-trigger"]')
        .attributes('aria-expanded'),
    ).toBe('true')
  })

  it('closes after an action that opens a modal', async () => {
    const wrapper = await mountMenu()

    await open(wrapper)
    await wrapper.get('[data-testid="tools-action-attach"]').trigger('click')

    expect(wrapper.emitted('open-files-upload')).toHaveLength(1)
    expect(
      wrapper.get('[data-testid="chat-input-tools-trigger"]')
        .attributes('aria-expanded'),
    ).toBe('false')

    await open(wrapper)
    await wrapper.get('[data-testid="tools-project"]').trigger('click')

    expect(wrapper.emitted('open-project-picker')).toHaveLength(1)
    expect(
      wrapper.get('[data-testid="chat-input-tools-trigger"]')
        .attributes('aria-expanded'),
    ).toBe('false')
  })

  it('focuses the first control on open and returns focus on Escape',
    async () => {
      const wrapper = await mountMenu()
      const trigger = wrapper.get('[data-testid="chat-input-tools-trigger"]')

      await open(wrapper)

      expect(document.activeElement).toBe(
        wrapper.get('[data-testid="tools-action-attach"]').element,
      )

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await nextTick()

      expect(trigger.attributes('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger.element)
    })

  it('opens at a section and focuses its checked radio', async () => {
    const wrapper = await mountMenu()
    const vm = wrapper.vm as unknown as {
      open: (section: string) => Promise<void>
    }

    await vm.open('reasoning')
    await flushPromises()

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="reasoning-level-medium"]').element,
    )
    expect(wrapper.get('[data-section="reasoning"]').classes())
      .toContain('bg-accent/10')
  })

  it('closes when the model picker claims the shared popover slot',
    async () => {
      const wrapper = await mountMenu()

      await open(wrapper)

      useState('chat-input:open-popover').value = 'models'
      await nextTick()

      expect(
        wrapper.get('[data-testid="chat-input-tools-trigger"]')
          .attributes('aria-expanded'),
      ).toBe('false')
    })

  describe('below md', () => {
    beforeEach(() => {
      isPopoverLayout.value = false
    })

    it('opens a bottom sheet with removable chips for active settings',
      async () => {
        const showModal = vi
          .spyOn(HTMLDialogElement.prototype, 'showModal')
          .mockImplementation(function (this: HTMLDialogElement) {
            this.setAttribute('open', '')
          })
        const wrapper = await mountMenu({}, [memoryTile])

        await open(wrapper)

        const sheet = wrapper.get('[data-testid="chat-input-tools-panel"]')

        expect(sheet.element.tagName).toBe('DIALOG')
        expect(sheet.classes()).toEqual(
          expect.arrayContaining(['modal', 'modal-bottom']),
        )
        expect(showModal).toHaveBeenCalledOnce()
        expect(wrapper.get('[data-testid="chat-input-tools-chip-memory"]')
          .text()).toBe('Memory off')

        await wrapper
          .get('[data-testid="chat-input-tools-chip-memory-remove"]')
          .trigger('click')

        expect(wrapper.emitted('remove-tile')).toEqual([['memory']])

        showModal.mockRestore()
      })

    it('says nothing changed when no tile is active', async () => {
      const showModal = vi
        .spyOn(HTMLDialogElement.prototype, 'showModal')
        .mockImplementation(() => {})
      const wrapper = await mountMenu()

      await open(wrapper)

      expect(wrapper.get('[data-testid="chat-input-tools-chips"]').text())
        .toBe('Nothing changed from the defaults')

      showModal.mockRestore()
    })
  })
})
