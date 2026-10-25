import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '#shared/types/memory.d'
import * as messagesComposable from '../../../../app/composables/messages'
import MemoryPage from '../../../../app/pages/profile/memory.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
  useFetch: vi.fn(),
  fetch: vi.fn(),
  patchRequests: [] as Array<Record<string, unknown>>,
  patchError: null as null | Record<string, unknown>,
  patchResponse: {} as Record<string, unknown>,
}))

mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useFetch', () => mocks.useFetch)
mockNuxtImport('$fetch', () => mocks.fetch)

enableAutoUnmount(afterEach)

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: false,
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

    expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
      .toBe(false)
    expect(checkbox(wrapper, 'memory-chat-search-toggle').element.checked)
      .toBe(true)
    expect(checkbox(wrapper, 'memory-sensitive-toggle').element.checked)
      .toBe(false)

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
  })

  it('renders saved settings', async () => {
    const wrapper = await mountPage({
      memoryEnabled: true,
      chatSearchEnabled: false,
      aboutMe: 'Backend developer',
      profileMemoryModel: 'vendor/model',
      profileMemoryGateway: 'openrouter',
    })

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

  it('sends memoryEnabled when the generation toggle changes', async () => {
    const wrapper = await mountPage()

    await checkbox(wrapper, 'memory-generation-toggle').setValue(true)
    await settle()

    expect(mocks.patchRequests).toEqual([{ memoryEnabled: true }])
    expect(checkbox(wrapper, 'memory-generation-toggle').element.checked)
      .toBe(true)
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

  it('opts in to sensitive topics after confirmation', async () => {
    const wrapper = await mountPage()

    await checkbox(wrapper, 'memory-sensitive-toggle').setValue(true)
    await settle()

    expect(mocks.confirm).toHaveBeenCalledOnce()

    const options = mocks.confirm.mock.calls[0]![0] as {
      subtitle: string
      actions: string[]
    }

    expect(options.actions).toEqual(['Allow sensitive topics'])
    expect(options.subtitle).toContain('GDPR Art. 9')
    expect(options.subtitle).toContain('health')
    expect(options.subtitle).toContain('religion or belief')
    expect(options.subtitle).toContain('political opinion')
    expect(options.subtitle).toContain('racial or ethnic origin')
    expect(options.subtitle).toContain('sex life or orientation')
    expect(options.subtitle).toContain('trade union membership')
    expect(options.subtitle).toContain('genetic data')
    expect(options.subtitle).toContain('biometric data')
    expect(options.subtitle).toContain('legal disputes')
    expect(options.subtitle).toContain('drugs')
    expect(mocks.patchRequests).toEqual([{ memoryIncludeSensitive: true }])
    expect(checkbox(wrapper, 'memory-sensitive-toggle').element.checked)
      .toBe(true)
  })

  it('keeps sensitive topics off when the opt-in is cancelled', async () => {
    mocks.confirm.mockResolvedValue(null as never)

    const wrapper = await mountPage()

    await checkbox(wrapper, 'memory-sensitive-toggle').setValue(true)
    await settle()

    expect(mocks.patchRequests).toEqual([])
    expect(checkbox(wrapper, 'memory-sensitive-toggle').element.checked)
      .toBe(false)
  })

  it('warns about deletion and reports the deleted count on opt-out',
    async () => {
      const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
      const wrapper = await mountPage({ memoryIncludeSensitive: true })

      mocks.patchResponse = { sensitiveEntriesDeleted: 3 }

      await checkbox(wrapper, 'memory-sensitive-toggle').setValue(false)
      await settle()

      const options = mocks.confirm.mock.calls[0]![0] as {
        subtitle: string
        actions: string[]
      }

      expect(options.actions).toEqual(['Turn off and delete'])
      expect(options.subtitle).toContain('deleted')
      expect(mocks.patchRequests).toEqual([{ memoryIncludeSensitive: false }])
      expect(useInfoMessage).toHaveBeenCalledWith(
        'Sensitive topics off',
        '3 sensitive entries deleted.',
      )
      expect(checkbox(wrapper, 'memory-sensitive-toggle').element.checked)
        .toBe(false)
    })

  it('says there is nothing to delete when no entries were removed',
    async () => {
      const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
      const wrapper = await mountPage({ memoryIncludeSensitive: true })

      mocks.patchResponse = { sensitiveEntriesDeleted: 0 }

      await checkbox(wrapper, 'memory-sensitive-toggle').setValue(false)
      await settle()

      expect(useInfoMessage).toHaveBeenCalledWith(
        'Sensitive topics off',
        'No sensitive entries to delete.',
      )
    })

  it('leaves sensitive topics on when the opt-out is cancelled', async () => {
    mocks.confirm.mockResolvedValue(null as never)

    const wrapper = await mountPage({ memoryIncludeSensitive: true })

    await checkbox(wrapper, 'memory-sensitive-toggle').setValue(false)
    await settle()

    expect(mocks.patchRequests).toEqual([])
    expect(checkbox(wrapper, 'memory-sensitive-toggle').element.checked)
      .toBe(true)
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
})
