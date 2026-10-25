import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { parseError } from 'evlog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../../shared/types/memory.d'
import * as messagesComposable from '../../../../../app/composables/messages'
import Controls from '../../../../../app/components/Profile/Memory/Controls.vue'

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

async function mountControls(settings: Partial<MemorySettingsFields> = {}) {
  return await mountSuspended(Controls, {
    props: {
      settings: { ...defaultSettings, ...settings },
      save,
    },
  })
}

function toggle(
  wrapper: Awaited<ReturnType<typeof mountControls>>,
  testId: string,
) {
  return wrapper.get<HTMLInputElement>(`[data-testid="${testId}"]`)
}

describe('Profile/Memory/Controls', () => {
  beforeEach(() => {
    save.mockReset()
    save.mockResolvedValue({ ok: true, result: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the three toggles from settings', async () => {
    const wrapper = await mountControls({
      memoryExtractionEnabled: true,
      chatSearchEnabled: false,
    })

    expect(toggle(wrapper, 'memory-enabled-toggle').element.checked)
      .toBe(true)
    expect(toggle(wrapper, 'memory-generation-toggle').element.checked)
      .toBe(true)
    expect(toggle(wrapper, 'memory-chat-search-toggle').element.checked)
      .toBe(false)
  })

  it.each([
    ['memory-enabled-toggle', false, { memoryEnabled: false }],
    ['memory-generation-toggle', true, { memoryExtractionEnabled: true }],
    ['memory-chat-search-toggle', false, { chatSearchEnabled: false }],
  ])('saves %s through the save prop', async (testId, nextValue, payload) => {
    const wrapper = await mountControls()

    await toggle(wrapper, testId).setValue(nextValue)
    await flushPromises()

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(payload)
  })

  it('names each toggle by its title and describes it separately',
    async () => {
      const wrapper = await mountControls()

      for (const [testId, titleId, descriptionId] of [
        ['memory-enabled-toggle', 'memory-enabled-title',
          'memory-enabled-description'],
        ['memory-generation-toggle', 'memory-generation-title',
          'memory-generation-description'],
        ['memory-chat-search-toggle', 'memory-chat-search-title',
          'memory-chat-search-description'],
      ]) {
        const input = toggle(wrapper, testId)

        expect(input.attributes('aria-labelledby')).toBe(titleId)
        expect(input.attributes('aria-describedby')).toContain(descriptionId)
        expect(wrapper.get(`#${titleId}`).text()).not.toBe('')
        expect(wrapper.get(`#${titleId}`).element.contains(
          wrapper.get(`#${descriptionId}`).element,
        )).toBe(false)
      }
    })

  it('explains that generation covers profile and project memory', async () => {
    const wrapper = await mountControls()
    const note = wrapper.get('[data-testid="memory-generation-project-note"]')

    expect(note.text()).toBe(
      'Covers your profile and project memory. Off by default. When on, '
      + 'chats you have from now on are summarised in the background on '
      + 'your key. Use "Build memory from past chats" to include older '
      + 'chats.',
    )
    expect(toggle(wrapper, 'memory-generation-toggle')
      .attributes('aria-describedby'))
      .toContain(note.attributes('id'))
  })

  it('omits the project note while memory is off', async () => {
    const wrapper = await mountControls({ memoryEnabled: false })

    expect(wrapper.find('[data-testid="memory-generation-project-note"]')
      .exists()).toBe(false)
    expect(toggle(wrapper, 'memory-generation-toggle')
      .attributes('aria-describedby'))
      .not.toContain('memory-generation-project-note')
  })

  it('disables the generation toggle with a hint when memory is off',
    async () => {
      const wrapper = await mountControls({
        memoryEnabled: false,
        memoryExtractionEnabled: true,
      })
      const generation = toggle(wrapper, 'memory-generation-toggle')

      expect(generation.element.disabled).toBe(true)
      expect(generation.attributes('aria-describedby'))
        .toContain('memory-generation-hint')
      expect(wrapper.get('[data-testid="memory-generation-hint"]').text())
        .toBe('Turn on Use memory to generate memory from chats.')
    })

  it('does not save when the generation toggle is disabled', async () => {
    const wrapper = await mountControls({ memoryEnabled: false })

    await toggle(wrapper, 'memory-generation-toggle').trigger('click')
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
  })

  it('hides the generation hint when memory is on', async () => {
    const wrapper = await mountControls()

    expect(wrapper.find('[data-testid="memory-generation-hint"]').exists())
      .toBe(false)
    expect(toggle(wrapper, 'memory-generation-toggle')
      .attributes('aria-describedby'))
      .not.toContain('memory-generation-hint')
  })

  it.each([
    ['memory-enabled-toggle', true, false],
    ['memory-generation-toggle', false, true],
    ['memory-chat-search-toggle', true, false],
  ])('reverts %s and shows a toast when saving fails',
    async (testId, initialValue, nextValue) => {
      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
      const wrapper = await mountControls()

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

      await toggle(wrapper, testId).setValue(nextValue)
      await flushPromises()

      expect(toggle(wrapper, testId).element.checked).toBe(initialValue)
      expect(useErrorMessage).toHaveBeenCalledWith(
        'Could not save',
        'Database unavailable',
      )
    })
})
