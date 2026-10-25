import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { parseError } from 'evlog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryUiSettings } from '../../../../../app/types/memory-settings.d'
import * as messagesComposable from '../../../../../app/composables/messages'
import Sensitive from '../../../../../app/components/Profile/Memory/Sensitive.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}))

mockNuxtImport('useConfirm', () => mocks.confirm)

enableAutoUnmount(afterEach)

const defaultSettings: MemoryUiSettings = {
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

async function mountSensitive(settings: Partial<MemoryUiSettings> = {}) {
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
})
