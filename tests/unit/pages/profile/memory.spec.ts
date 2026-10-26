import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AboutMeNotMigratedReason,
  MemorySettingsFields,
} from '../../../../shared/types/memory.d'
import * as messagesComposable from '../../../../app/composables/messages'
import MemoryPage from '../../../../app/pages/profile/memory.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
  useFetch: vi.fn(),
  useLazyFetch: vi.fn(),
  refreshNuxtData: vi.fn(),
  settingsRefresh: vi.fn(),
  fetch: vi.fn(),
  patchRequests: [] as Array<Record<string, unknown>>,
  patchError: null as null | Record<string, unknown>,
  patchResponse: {} as Record<string, unknown>,
}))

mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useFetch', () => mocks.useFetch)
mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
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
let serverReason: AboutMeNotMigratedReason | null = null

const PanelStub = defineComponent({
  setup(_props, { expose }) {
    expose({ prepareOpen: vi.fn() })

    return () => h('div')
  },
})

const ExtraChecksStub = defineComponent({
  setup() {
    return () => h('div', { 'data-testid': 'memory-extra-checks-stub' })
  },
})

const CacheInfoStub = defineComponent({
  setup() {
    return () => h('div', { 'data-testid': 'memory-cache-info-stub' })
  },
})

async function mountPage(
  settings: Partial<MemorySettingsFields> = {},
  reason: AboutMeNotMigratedReason | null = null,
) {
  serverSettings = { ...defaultSettings, ...settings }
  serverReason = reason

  const wrapper = await mountSuspended(MemoryPage, {
    global: {
      stubs: {
        ChatInputModelsTriggerPanel: PanelStub,
        ProfileMemoryCacheInfo: CacheInfoStub,
        ProfileMemoryExtraChecks: ExtraChecksStub,
      },
    },
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

    mocks.refreshNuxtData.mockReset()
    mocks.settingsRefresh.mockReset()
    mocks.useFetch.mockReset()
    mocks.useFetch.mockImplementation(async () => {
      const data = shallowRef<Record<string, unknown>>({
        ...serverSettings,
        aboutMeNotMigratedReason: serverReason,
      })

      mocks.settingsRefresh.mockImplementation(async () => {
        data.value = {
          ...data.value,
          aboutMe: null,
          aboutMeNotMigratedReason: null,
        }
      })

      return { data, refresh: mocks.settingsRefresh }
    })
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockImplementation((url: string) => {
      if (url === '/api/v1/memory/entries') {
        return {
          data: shallowRef({
            scope: 'all',
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
        pending: shallowRef(false),
      }
    })
    mocks.fetch.mockReset()
    mocks.fetch.mockImplementation(async (
      _url: string,
      options?: { method?: string, body?: Record<string, unknown> },
    ) => {
      if (options?.method !== 'PATCH') {
        throw new Error('Only settings PATCH requests are mocked')
      }

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

  it('links the public memory explainer from the page header', async () => {
    const wrapper = await mountPage()
    const link = wrapper.get('[data-testid="memory-how-it-works-link"]')

    expect(link.attributes('href') ?? link.attributes('to'))
      .toBe('/memory')
    expect(link.text()).toBe('How memory works')
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
    expect(wrapper.find('[data-testid="memory-about-me-input"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-entries-section"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="memory-disabled-note"]').exists())
      .toBe(false)
  })

  it('renders the prompt-cache info between models and entries', async () => {
    const wrapper = await mountPage()
    const sections = wrapper.findAll(
      '[data-testid="memory-model-same-as-chat"], '
      + '[data-testid="memory-cache-info-stub"], '
      + '[data-testid="memory-entries-section"]',
    )
    const testIds = sections.map(section => section.attributes('data-testid'))

    expect(testIds).toEqual([
      'memory-model-same-as-chat',
      'memory-model-same-as-chat',
      'memory-cache-info-stub',
      'memory-entries-section',
    ])
  })

  it('renders the extra memory checks card between models and the '
    + 'prompt-cache info', async () => {
    const wrapper = await mountPage()
    const sections = wrapper.findAll(
      '[data-testid="memory-model-same-as-chat"], '
      + '[data-testid="memory-extra-checks-stub"], '
      + '[data-testid="memory-cache-info-stub"]',
    )
    const testIds = sections.map(section => section.attributes('data-testid'))

    expect(testIds).toEqual([
      'memory-model-same-as-chat',
      'memory-model-same-as-chat',
      'memory-extra-checks-stub',
      'memory-cache-info-stub',
    ])
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
      profileMemoryModel: 'vendor/model',
      profileMemoryGateway: 'openrouter',
    })

    expect(checkbox(wrapper, 'memory-enabled-toggle').element.checked)
      .toBe(false)
    expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
      .toBe(true)
    expect(checkbox(wrapper, 'memory-chat-search-toggle').element.checked)
      .toBe(false)
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

  it('re-reads settings and entries after memory is turned on, converting '
    + 'the leftover about me', async () => {
    const wrapper = await mountPage(
      { memoryEnabled: false, aboutMe: 'Backend developer' },
      'memory-off',
    )

    expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(true)

    await checkbox(wrapper, 'memory-enabled-toggle').setValue(true)
    await settle()

    expect(mocks.patchRequests).toEqual([{ memoryEnabled: true }])
    expect(mocks.settingsRefresh).toHaveBeenCalledOnce()
    expect(mocks.refreshNuxtData).toHaveBeenCalledOnce()
    expect(mocks.refreshNuxtData).toHaveBeenCalledWith('memory-entries:all')
    expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(false)
  })

  it('does not re-read anything when memory is turned off', async () => {
    const wrapper = await mountPage()

    await checkbox(wrapper, 'memory-enabled-toggle').setValue(false)
    await settle()

    expect(mocks.settingsRefresh).not.toHaveBeenCalled()
    expect(mocks.refreshNuxtData).not.toHaveBeenCalled()
  })

  it('does not re-read anything when another toggle changes', async () => {
    const wrapper = await mountPage({ memoryEnabled: false })

    await checkbox(wrapper, 'memory-chat-search-toggle').setValue(false)
    await settle()

    expect(mocks.settingsRefresh).not.toHaveBeenCalled()
    expect(mocks.refreshNuxtData).not.toHaveBeenCalled()
  })

  it('does not re-read anything when turning memory on fails', async () => {
    const wrapper = await mountPage({ memoryEnabled: false })

    mocks.patchError = {
      statusCode: 500,
      message: 'Could not save',
      data: { why: 'Database unavailable' },
    }

    await checkbox(wrapper, 'memory-enabled-toggle').setValue(true)
    await settle()

    expect(checkbox(wrapper, 'memory-enabled-toggle').element.checked)
      .toBe(false)
    expect(mocks.settingsRefresh).not.toHaveBeenCalled()
    expect(mocks.refreshNuxtData).not.toHaveBeenCalled()
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

  it('has no About me card or textarea', async () => {
    const wrapper = await mountPage({ aboutMe: 'Backend developer' })

    expect(wrapper.find('[data-testid="memory-about-me-input"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-about-me-save"]').exists())
      .toBe(false)
    expect(wrapper.text()).not.toContain('Sent with every chat so the assistant')
  })

  it('shows leftover about me with the server reason', async () => {
    const wrapper = await mountPage({ aboutMe: 'x'.repeat(1500) }, 'too-long')

    expect(wrapper.get('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="memory-legacy-about-me-reason"]').text())
      .toContain('It is too long to become a Profile entry')
    expect(wrapper.get('[data-testid="memory-legacy-about-me-text"]').text())
      .toHaveLength(1500)
  })

  it('discards leftover about me and hides the block', async () => {
    const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
    const wrapper = await mountPage({ aboutMe: 'Leftover' }, 'profile-exists')

    await wrapper.get('[data-testid="memory-legacy-about-me-discard"]')
      .trigger('click')
    await settle()

    expect(mocks.patchRequests).toEqual([{ aboutMe: null }])
    expect(useInfoMessage).toHaveBeenCalledWith(
      'Discarded',
      'Earlier about me discarded.',
    )
    expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(false)
  })

  it('keeps the leftover block and toasts when discarding fails', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountPage({ aboutMe: 'Leftover' }, 'rejected')

    mocks.patchError = {
      statusCode: 500,
      message: 'Could not save',
      data: { why: 'Database unavailable' },
    }

    await wrapper.get('[data-testid="memory-legacy-about-me-discard"]')
      .trigger('click')
    await settle()

    expect(useErrorMessage).toHaveBeenCalledWith(
      'Could not save',
      'Database unavailable',
    )
    expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(true)
  })

  it('leaves leftover about me alone when other settings change', async () => {
    const wrapper = await mountPage({ aboutMe: 'Leftover' }, 'memory-off')

    await checkbox(wrapper, 'memory-chat-search-toggle').setValue(false)
    await settle()

    expect(mocks.patchRequests).toEqual([{ chatSearchEnabled: false }])
    expect(wrapper.get('[data-testid="memory-legacy-about-me"]').exists())
      .toBe(true)
  })
})
