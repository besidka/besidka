import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { parseError } from 'evlog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../../shared/types/memory.d'
import * as messagesComposable from '../../../../../app/composables/messages'
import AboutMe from '../../../../../app/components/Profile/Memory/AboutMe.vue'

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

async function mountAboutMe(settings: Partial<MemorySettingsFields> = {}) {
  return await mountSuspended(AboutMe, {
    props: {
      settings: { ...defaultSettings, ...settings },
      save,
    },
  })
}

function input(wrapper: Awaited<ReturnType<typeof mountAboutMe>>) {
  return wrapper.get<HTMLTextAreaElement>(
    '[data-testid="memory-about-me-input"]',
  )
}

function rejection() {
  return {
    ok: false,
    parsed: parseError(Object.assign(new Error('Request failed'), {
      data: {
        statusCode: 400,
        message: 'About me contains sensitive data',
        data: {
          why: 'It looks like a payment card number.',
          fix: 'Remove the number and try again.',
        },
      },
    })),
  }
}

describe('Profile/Memory/AboutMe', () => {
  beforeEach(() => {
    save.mockReset()
    save.mockResolvedValue({ ok: true, result: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('seeds the draft and counter from settings', async () => {
    const wrapper = await mountAboutMe({ aboutMe: 'Backend developer' })

    expect(input(wrapper).element.value).toBe('Backend developer')
    expect(wrapper.get('[data-testid="memory-about-me-counter"]').text())
      .toBe(`17 / ${MEMORY_LIMITS.maxAboutMeChars}`)
  })

  it('updates the counter as the user types', async () => {
    const wrapper = await mountAboutMe()

    await input(wrapper).setValue('hello')

    expect(wrapper.get('[data-testid="memory-about-me-counter"]').text())
      .toBe(`5 / ${MEMORY_LIMITS.maxAboutMeChars}`)
  })

  it('saves the trimmed text and confirms with a toast', async () => {
    const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
    const wrapper = await mountAboutMe()

    await input(wrapper).setValue('  I prefer short answers.  ')
    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({ aboutMe: 'I prefer short answers.' })
    expect(useInfoMessage).toHaveBeenCalledWith('Saved', 'About me updated.')
    expect(input(wrapper).element.value).toBe('I prefer short answers.')
  })

  it('disables Save while unchanged and enables it after an edit',
    async () => {
      const wrapper = await mountAboutMe({ aboutMe: 'Same text' })
      const saveButton = () => {
        return wrapper.get('[data-testid="memory-about-me-save"]')
      }

      expect(saveButton().classes()).toContain('btn-disabled')

      await input(wrapper).setValue('Other text')

      expect(saveButton().classes()).not.toContain('btn-disabled')
    })

  it('disables Save and flags the counter when over the limit', async () => {
    const wrapper = await mountAboutMe()

    await input(wrapper).setValue('a'.repeat(MEMORY_LIMITS.maxAboutMeChars + 1))

    expect(wrapper.get('[data-testid="memory-about-me-save"]').classes())
      .toContain('btn-disabled')
    expect(wrapper.get('[data-testid="memory-about-me-counter"]').classes())
      .toContain('text-error')
    expect(input(wrapper).attributes('aria-invalid')).toBe('true')
  })

  it('shows a rejected save inline without a toast', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountAboutMe()

    save.mockResolvedValue(rejection())

    await input(wrapper).setValue('My card is 4111 1111 1111 1111')
    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await flushPromises()

    const alert = wrapper.get('[data-testid="memory-about-me-error"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain('About me contains sensitive data')
    expect(alert.text()).toContain('It looks like a payment card number.')
    expect(alert.text()).toContain('Remove the number and try again.')
    expect(input(wrapper).attributes('aria-describedby'))
      .toBe('memory-about-me-error')
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('clears the inline error when the user edits again', async () => {
    const wrapper = await mountAboutMe()

    save.mockResolvedValue(rejection())

    await input(wrapper).setValue('My card is 4111 1111 1111 1111')
    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await flushPromises()
    await input(wrapper).setValue('Edited')

    expect(wrapper.find('[data-testid="memory-about-me-error"]').exists())
      .toBe(false)
  })

  it('keeps the draft after a failed save', async () => {
    const wrapper = await mountAboutMe({ aboutMe: 'Saved text' })

    save.mockResolvedValue(rejection())

    await input(wrapper).setValue('Rejected text')
    await wrapper.get('[data-testid="memory-about-me-save"]')
      .trigger('click')
    await flushPromises()
    await wrapper.setProps({
      settings: { ...defaultSettings, aboutMe: 'Saved text' },
    })

    expect(input(wrapper).element.value).toBe('Rejected text')
  })

  it('shows Clear only when there is a draft and empties it', async () => {
    const wrapper = await mountAboutMe()

    expect(wrapper.find('[data-testid="memory-about-me-clear"]').exists())
      .toBe(false)

    await input(wrapper).setValue('Something')
    await wrapper.get('[data-testid="memory-about-me-clear"]')
      .trigger('click')

    expect(input(wrapper).element.value).toBe('')
    expect(wrapper.get('[data-testid="memory-about-me-counter"]').text())
      .toBe(`0 / ${MEMORY_LIMITS.maxAboutMeChars}`)
    expect(wrapper.find('[data-testid="memory-about-me-clear"]').exists())
      .toBe(false)
  })

  it('saves an empty string after Clear on previously saved text',
    async () => {
      const wrapper = await mountAboutMe({ aboutMe: 'Saved text' })

      await wrapper.get('[data-testid="memory-about-me-clear"]')
        .trigger('click')
      await wrapper.get('[data-testid="memory-about-me-save"]')
        .trigger('click')
      await flushPromises()

      expect(save).toHaveBeenCalledWith({ aboutMe: '' })
    })
})
