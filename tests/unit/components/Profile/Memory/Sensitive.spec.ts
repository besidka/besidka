import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { parseError } from 'evlog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../../shared/types/memory.d'
import * as messagesComposable from '../../../../../app/composables/messages'
import Sensitive from '../../../../../app/components/Profile/Memory/Sensitive.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  memoryConfig: undefined as undefined | Record<string, unknown>,
}))

mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useRuntimeConfig', (original) => {
  return () => {
    const config = original()

    return {
      ...config,
      public: { ...config.public, memory: mocks.memoryConfig },
    }
  }
})

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

const save = vi.fn()

async function mountSensitive(settings: Partial<MemorySettingsFields> = {}) {
  return await mountSuspended(Sensitive, {
    props: {
      settings: { ...defaultSettings, ...settings },
      save,
    },
  })
}

function toggle(wrapper: Awaited<ReturnType<typeof mountSensitive>>) {
  return wrapper.get<HTMLInputElement>('[data-testid="memory-sensitive-toggle"]')
}

describe('Profile/Memory/Sensitive', () => {
  beforeEach(() => {
    mocks.memoryConfig = { sensitiveOptInEnabled: true }
    save.mockReset()
    save.mockResolvedValue({ ok: true, result: {} })
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Confirm', index: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the toggle by its title and describes it separately',
    async () => {
      const wrapper = await mountSensitive()

      expect(toggle(wrapper).attributes('aria-labelledby'))
        .toBe('memory-sensitive-title')
      expect(toggle(wrapper).attributes('aria-describedby'))
        .toBe('memory-sensitive-description')
      expect(wrapper.get('#memory-sensitive-title').text())
        .toBe('Allow sensitive topics in memory')
    })

  it('opts in after confirmation with the GDPR disclosure', async () => {
    const wrapper = await mountSensitive()

    await toggle(wrapper).setValue(true)
    await flushPromises()

    const options = mocks.confirm.mock.calls[0]![0] as {
      subtitle: string
      actions: string[]
      labelDecline: string
    }

    expect(options.actions).toEqual(['Allow sensitive topics'])
    expect(options.labelDecline).toBe('Cancel')
    expect(options.subtitle).toContain('GDPR Art. 9')
    expect(options.subtitle).toContain('health')
    expect(options.subtitle).toContain('religion or belief')
    expect(save).toHaveBeenCalledWith({ memoryIncludeSensitive: true })
  })

  it('does not save when the opt-in is cancelled', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountSensitive()

    await toggle(wrapper).setValue(true)
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(toggle(wrapper).element.checked).toBe(false)
  })

  it('warns about deletion and reports the deleted count on opt-out',
    async () => {
      const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
      const wrapper = await mountSensitive({ memoryIncludeSensitive: true })

      save.mockResolvedValue({
        ok: true,
        result: { sensitiveEntriesDeleted: 3 },
      })

      await toggle(wrapper).setValue(false)
      await flushPromises()

      const options = mocks.confirm.mock.calls[0]![0] as {
        subtitle: string
        actions: string[]
      }

      expect(options.actions).toEqual(['Turn off and delete'])
      expect(options.subtitle).toContain('deleted')
      expect(save).toHaveBeenCalledWith({ memoryIncludeSensitive: false })
      expect(useInfoMessage).toHaveBeenCalledWith(
        'Sensitive topics off',
        '3 sensitive entries deleted.',
      )
    })

  it.each([
    [0, 'No sensitive entries to delete.'],
    [1, '1 sensitive entry deleted.'],
  ])('reports %i deleted entries on opt-out', async (count, message) => {
    const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
    const wrapper = await mountSensitive({ memoryIncludeSensitive: true })

    save.mockResolvedValue({
      ok: true,
      result: { sensitiveEntriesDeleted: count },
    })

    await toggle(wrapper).setValue(false)
    await flushPromises()

    expect(useInfoMessage).toHaveBeenCalledWith('Sensitive topics off', message)
  })

  it('keeps the setting when the opt-out is cancelled', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountSensitive({ memoryIncludeSensitive: true })

    await toggle(wrapper).setValue(false)
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(toggle(wrapper).element.checked).toBe(true)
  })

  it('shows a toast and no deletion info when saving fails', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
    const wrapper = await mountSensitive({ memoryIncludeSensitive: true })

    save.mockResolvedValue({
      ok: false,
      parsed: parseError(Object.assign(new Error('Request failed'), {
        data: {
          statusCode: 500,
          message: 'Could not save',
          data: { why: 'Database unavailable' },
        },
      })),
    })

    await toggle(wrapper).setValue(false)
    await flushPromises()

    expect(useErrorMessage).toHaveBeenCalledWith(
      'Could not save',
      'Database unavailable',
    )
    expect(useInfoMessage).not.toHaveBeenCalled()
    expect(toggle(wrapper).element.checked).toBe(true)
  })

  it('renders the never-store list from neverStoreKinds', async () => {
    const wrapper = await mountSensitive()
    const items = wrapper.findAll('[data-testid="memory-never-store-list"] li')

    expect(items.map(item => item.text()))
      .toEqual(neverStoreKinds.map(kind => kind.label))
  })

  describe.each([
    ['the flag is false', { sensitiveOptInEnabled: false }],
    ['the flag is missing', {}],
    ['the memory config is missing', undefined],
  ])('when %s', (_label, memoryConfig) => {
    beforeEach(() => {
      mocks.memoryConfig = memoryConfig
    })

    it('hides the toggle and shows the privacy note', async () => {
      const wrapper = await mountSensitive()

      expect(wrapper.find('[data-testid="memory-sensitive-toggle"]').exists())
        .toBe(false)
      expect(wrapper.find('#memory-sensitive-title').exists()).toBe(false)
      expect(wrapper.get('[data-testid="memory-sensitive-hidden-note"]').text())
        .toContain(
          'Sensitive topics (health, religion, politics and similar) '
          + 'are never saved to memory.',
        )
      const link = wrapper.get('[data-testid="memory-sensitive-privacy-link"]')

      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/privacy-policy')
      expect(mocks.confirm).not.toHaveBeenCalled()
    })

    it('keeps the never-store list', async () => {
      const wrapper = await mountSensitive({ memoryIncludeSensitive: true })
      const items = wrapper.findAll(
        '[data-testid="memory-never-store-list"] li',
      )

      expect(items.map(item => item.text()))
        .toEqual(neverStoreKinds.map(kind => kind.label))
    })
  })

  it('hides the privacy note when the flag is on', async () => {
    const wrapper = await mountSensitive()

    expect(wrapper.find('[data-testid="memory-sensitive-hidden-note"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-sensitive-toggle"]').exists())
      .toBe(true)
  })
})
