import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../shared/types/memory.d'
import * as messagesComposable from '../../../../app/composables/messages'
import MemoryPage from '../../../../app/pages/profile/memory.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
  useFetch: vi.fn(),
  useLazyFetch: vi.fn(),
  fetch: vi.fn(),
  patchRequests: [] as Array<Record<string, unknown>>,
  patchError: null as null | Record<string, unknown>,
  patchResponse: {} as Record<string, unknown>,
}))

mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useFetch', () => mocks.useFetch)
mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)

enableAutoUnmount(afterEach)

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: true,
  memoryExtractionEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

let serverSettings: MemorySettingsFields = { ...defaultSettings }

const PanelStub = defineComponent({
  setup(_props, { expose }) {
    expose({ prepareOpen: vi.fn() })

    return () => h('div')
  },
})

async function mountPage(settings: Partial<MemorySettingsFields> = {}) {
  serverSettings = { ...defaultSettings, ...settings }

  const wrapper = await mountSuspended(MemoryPage, {
    global: { stubs: { ChatInputModelsTriggerPanel: PanelStub } },
  })

  await settle()

  return wrapper
}

async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await flushPromises()
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

function checkbox(
  wrapper: Awaited<ReturnType<typeof mountPage>>,
  testId: string,
) {
  return wrapper.get<HTMLInputElement>(`[data-testid="${testId}"]`)
}

describe('profile memory page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Confirm', index: 0 })
    mocks.patchRequests.length = 0
    mocks.patchError = null
    mocks.patchResponse = {}

    mocks.useFetch.mockReset()
    mocks.useFetch.mockImplementation(async () => {
      return {
        data: shallowRef({ ...serverSettings }),
        refresh: vi.fn(),
      }
    })
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockImplementation((url: string) => {
      if (url === '/api/v1/memory/entries') {
        return {
          data: shallowRef({
            scope: 'account',
            projectId: null,
            total: 0,
            limits: {
              maxAccountEntries: 30,
              maxProjectEntries: 15,
              maxBodyBytes: 2048,
              maxAlwaysInjectedBodyBytes: 1024,
              maxDescriptionChars: 100,
              maxTitleChars: 80,
            },
            groups: [],
          }),
          pending: shallowRef(false),
          error: shallowRef(null),
          refresh: vi.fn(),
        }
      }

      return {
        data: shallowRef({ pinned: [], projects: [], nextCursor: null }),
      }
    })
    mocks.fetch.mockReset()
    mocks.fetch.mockImplementation(async (
      _url: string,
      options: { method: string, body: Record<string, unknown> },
    ) => {
      mocks.patchRequests.push(options.body)

      if (mocks.patchError) {
        throw Object.assign(new Error('Request failed'), {
          data: mocks.patchError,
        })
      }

      return mocks.patchResponse
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders defaults for every section', async () => {
    const wrapper = await mountPage()

    expect(checkbox(wrapper, 'memory-enabled-toggle').element.checked)
      .toBe(true)
    expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
      .toBe(false)
    expect(checkbox(wrapper, 'memory-generation-toggle').element.disabled)
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-generation-hint"]').exists())
      .toBe(false)
    expect(checkbox(wrapper, 'memory-chat-search-toggle').element.checked)
      .toBe(true)

    const sameAsChatRadios = wrapper.findAll<HTMLInputElement>(
      '[data-testid="memory-model-same-as-chat"]',
    )

    expect(sameAsChatRadios).toHaveLength(2)
    expect(sameAsChatRadios.every(radio => radio.element.checked)).toBe(true)
    expect(wrapper.find('[data-testid="memory-model-trigger"]').exists())
      .toBe(false)

    const neverStoredItems = wrapper.findAll(
      '[data-testid="memory-never-store-list"] li',
    )

    expect(neverStoredItems.map(item => item.text()))
      .toEqual(neverStoreKinds.map(kind => kind.label))
    expect(wrapper.get('[data-testid="memory-about-me-counter"]').text())
      .toBe('0 / 4000')
    expect(wrapper.find('[data-testid="memory-entries-section"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="memory-disabled-note"]').exists())
      .toBe(false)
  })

  it('passes the settings to the entries list', async () => {
    const wrapper = await mountPage({
      memoryEnabled: false,
      memoryExtractionEnabled: true,
    })

    expect(wrapper.get('[data-testid="memory-disabled-note"]').text())
      .toBe('Memory is off. Entries are kept but not used in chats.')
    expect(wrapper.find('[data-testid="memory-update-now"]').exists())
      .toBe(false)
  })

  it('offers update now when memory and generation are on', async () => {
    const wrapper = await mountPage({
      memoryEnabled: true,
      memoryExtractionEnabled: true,
    })

    expect(wrapper.find('[data-testid="memory-update-now"]').exists())
      .toBe(true)
  })

  it('shows the entries empty state with the generation hint', async () => {
    const wrapper = await mountPage({ memoryExtractionEnabled: false })

    expect(wrapper.get('[data-testid="memory-entries-empty"]').text())
      .toContain('Nothing remembered yet')
    expect(wrapper.find(
      '[data-testid="memory-entries-empty-generation-hint"]',
    ).exists()).toBe(true)
  })

  it('renders saved settings', async () => {
    const wrapper = await mountPage({
      memoryEnabled: false,
      memoryExtractionEnabled: true,
      chatSearchEnabled: false,
      aboutMe: 'Backend developer',
      profileMemoryModel: 'vendor/model',
      profileMemoryGateway: 'openrouter',
    })

    expect(checkbox(wrapper, 'memory-enabled-toggle').element.checked)
      .toBe(false)
    expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
      .toBe(true)
    expect(checkbox(wrapper, 'memory-chat-search-toggle').element.checked)
      .toBe(false)
    expect(wrapper.get<HTMLTextAreaElement>(
      '[data-testid="memory-about-me-input"]',
    ).element.value).toBe('Backend developer')
    expect(wrapper.get('[data-testid="memory-model-trigger"]').text())
      .toContain('vendor/model')
  })

  it('sends memoryEnabled when the use memory toggle changes', async () => {
    const wrapper = await mountPage()

    await checkbox(wrapper, 'memory-enabled-toggle').setValue(false)
    await settle()

    expect(mocks.patchRequests).toEqual([{ memoryEnabled: false }])
    expect(checkbox(wrapper, 'memory-enabled-toggle').element.checked)
      .toBe(false)
  })

  it('sends memoryExtractionEnabled when the generation toggle changes',
    async () => {
      const wrapper = await mountPage()

      await checkbox(wrapper, 'memory-generation-toggle').setValue(true)
      await settle()

      expect(mocks.patchRequests).toEqual([{ memoryExtractionEnabled: true }])
      expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
        .toBe(true)
    })

  it('disables the generation toggle with a hint when memory is off',
    async () => {
      const wrapper = await mountPage({
        memoryEnabled: false,
        memoryExtractionEnabled: true,
      })
      const toggle = checkbox(wrapper, 'memory-generation-toggle')

      expect(toggle.element.disabled).toBe(true)
      expect(toggle.element.checked).toBe(true)
      expect(toggle.attributes('aria-describedby'))
        .toContain('memory-generation-hint')
      expect(wrapper.get('[data-testid="memory-generation-hint"]').text())
        .toBe('Turn on Use memory to generate memory from chats.')

      await toggle.trigger('click')
      await settle()

      expect(mocks.patchRequests).toEqual([])
      expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
        .toBe(true)
    })

  it('enables the generation toggle after memory is turned on', async () => {
    const wrapper = await mountPage({ memoryEnabled: false })

    expect(checkbox(wrapper, 'memory-generation-toggle').element.disabled)
      .toBe(true)

    await checkbox(wrapper, 'memory-enabled-toggle').setValue(true)
    await settle()

    expect(mocks.patchRequests).toEqual([{ memoryEnabled: true }])
    expect(checkbox(wrapper, 'memory-generation-toggle').element.disabled)
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-generation-hint"]').exists())
      .toBe(false)
  })

  it('sends chatSearchEnabled when the chat search toggle changes',
    async () => {
      const wrapper = await mountPage()

      await checkbox(wrapper, 'memory-chat-search-toggle').setValue(false)
      await settle()

      expect(mocks.patchRequests).toEqual([{ chatSearchEnabled: false }])
      expect(checkbox(wrapper, 'memory-chat-search-toggle').element.checked)
        .toBe(false)
    })

  it.each([
    ['memory-enabled-toggle', true, false],
    ['memory-generation-toggle', false, true],
    ['memory-chat-search-toggle', true, false],
  ])('reverts %s and shows a toast when saving fails',
    async (testId, initialValue, nextValue) => {
      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
      const wrapper = await mountPage()

      mocks.patchError = {
        statusCode: 500,
        message: 'Could not save',
        data: { why: 'Database unavailable' },
      }

      await checkbox(wrapper, testId).setValue(nextValue)
      await settle()

      expect(checkbox(wrapper, testId).element.checked).toBe(initialValue)
      expect(useErrorMessage).toHaveBeenCalledWith(
        'Could not save',
        'Database unavailable',
      )
    })

  it('shows what memory never keeps', async () => {
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('What memory never keeps')
    expect(wrapper.get('[data-testid="memory-never-kept-note"]').text())
      .toContain('are never saved to memory.')
    expect(
      wrapper.findAll('[data-testid="memory-never-store-list"] li').length,
    ).toBeGreaterThan(0)
  })

  it('saves trimmed about me text', async () => {
    const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
    const wrapper = await mountPage()
    const input = wrapper.get('[data-testid="memory-about-me-input"]')

    await input.setValue('  I prefer short answers.  ')

    expect(wrapper.get('[data-testid="memory-about-me-counter"]').text())
      .toBe('27 / 4000')

    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await settle()

    expect(mocks.patchRequests).toEqual([{ aboutMe: 'I prefer short answers.' }])
    expect(useInfoMessage).toHaveBeenCalledWith('Saved', 'About me updated.')
    expect(wrapper.find('[data-testid="memory-about-me-error"]').exists())
      .toBe(false)
  })

  it('disables saving when about me is unchanged', async () => {
    const wrapper = await mountPage({ aboutMe: 'Same text' })
    const save = wrapper.get('[data-testid="memory-about-me-save"]')

    expect(save.classes()).toContain('btn-disabled')

    await wrapper.get('[data-testid="memory-about-me-input"]')
      .setValue('Other text')

    expect(wrapper.get('[data-testid="memory-about-me-save"]').classes())
      .not.toContain('btn-disabled')
  })

  it('disables saving when about me is over the limit', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="memory-about-me-input"]')
      .setValue('a'.repeat(MEMORY_LIMITS.maxAboutMeChars + 1))

    expect(wrapper.get('[data-testid="memory-about-me-save"]').classes())
      .toContain('btn-disabled')
    expect(wrapper.get('[data-testid="memory-about-me-counter"]').classes())
      .toContain('text-error')
  })

  it('shows a rejected about me inline without a toast', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountPage()

    mocks.patchError = {
      statusCode: 400,
      message: 'About me contains sensitive data',
      data: {
        why: 'It looks like a payment card number.',
        fix: 'Remove the number and try again.',
      },
    }

    await wrapper.get('[data-testid="memory-about-me-input"]')
      .setValue('My card is 4111 1111 1111 1111')
    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await settle()

    const alert = wrapper.get('[data-testid="memory-about-me-error"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain('About me contains sensitive data')
    expect(alert.text()).toContain('It looks like a payment card number.')
    expect(alert.text()).toContain('Remove the number and try again.')
    expect(useErrorMessage).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="memory-about-me-input"]')
      .setValue('Edited')

    expect(wrapper.find('[data-testid="memory-about-me-error"]').exists())
      .toBe(false)
  })

  it('renders a 422 about me rejection as message, why and fix', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountPage()

    mocks.patchError = {
      statusCode: 422,
      message: 'This looks like sensitive information',
      data: {
        why: 'Health details are not stored in memory.',
        fix: 'Remove that detail and save again.',
      },
    }

    await wrapper.get('[data-testid="memory-about-me-input"]')
      .setValue('I manage a chronic condition')
    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await settle()

    const alert = wrapper.get('[data-testid="memory-about-me-error"]')

    expect(alert.get('p.font-bold').text())
      .toBe('This looks like sensitive information')
    expect(alert.text()).toContain('Health details are not stored in memory.')
    expect(alert.text()).toContain('Remove that detail and save again.')
    expect(alert.text()).not.toContain('422')
    expect(useErrorMessage).not.toHaveBeenCalled()
  })
})
