import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActionRowWithInfo from '../../../../../app/components/ChatInput/ToolsMenu/ActionRowWithInfo.vue'

function mountRow(props: Record<string, unknown> = {}) {
  return mountSuspended(ActionRowWithInfo, {
    props: {
      label: 'Google Drive',
      hint: 'Saves a copy in your Besidka files',
      icon: 'lucide:hard-drive',
      infoLabel: 'About Google Drive',
      testId: 'row',
      ...props,
    },
    slots: { default: 'Explains the row.' },
  })
}

describe('ChatInput/ToolsMenu/ActionRowWithInfo', () => {
  it('renders one row with the title, the hint and a closed note', async () => {
    const wrapper = await mountRow()
    const note = wrapper.get('[data-testid="row-note"]')

    expect(wrapper.get('[data-testid="row-open"]').text()).toBe('Google Drive')
    expect(wrapper.text()).toContain('Saves a copy in your Besidka files')
    expect(note.text()).toBe('Explains the row.')
    expect((note.element as HTMLElement).style.display).toBe('none')
  })

  describe('scrolling the note into view', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      scrollIntoView.mockReset()
      Element.prototype.scrollIntoView = scrollIntoView
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation(
        (query: string) => {
          return {
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }
        },
      ))
    })

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView
      vi.unstubAllGlobals()
    })

    it('scrolls the opened note to the nearest edge, smoothly', async () => {
      const wrapper = await mountRow()
      const note = wrapper.get('[data-testid="row-note"]').element

      await wrapper.get('[data-testid="row-info"]').trigger('click')
      await nextTick()

      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.instances[0]).toBe(note)
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'smooth',
      })
    })

    it('does not scroll when the note closes', async () => {
      const wrapper = await mountRow()
      const info = wrapper.get('[data-testid="row-info"]')

      await info.trigger('click')
      await nextTick()
      scrollIntoView.mockClear()
      await info.trigger('click')
      await nextTick()

      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('scrolls instantly with reduced motion', async () => {
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation(
        (query: string) => {
          return {
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }
        },
      ))

      const wrapper = await mountRow()

      await wrapper.get('[data-testid="row-info"]').trigger('click')
      await nextTick()

      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'auto',
      })
    })
  })

  it('emits click from the row button only', async () => {
    const wrapper = await mountRow()

    await wrapper.get('[data-testid="row-info"]').trigger('click')

    expect(wrapper.emitted('click')).toBeUndefined()

    await wrapper.get('[data-testid="row-open"]').trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('opens and closes the note from a labeled, controlling info button',
    async () => {
      const wrapper = await mountRow()
      const info = wrapper.get('[data-testid="row-info"]')
      const note = wrapper.get('[data-testid="row-note"]')

      expect(info.attributes('aria-label')).toBe('About Google Drive')
      expect(info.attributes('aria-controls')).toBe(note.attributes('id'))
      expect(info.attributes('aria-expanded')).toBe('false')

      await info.trigger('click')

      expect(info.attributes('aria-expanded')).toBe('true')
      expect((note.element as HTMLElement).style.display).not.toBe('none')
      expect(wrapper.get('[data-testid="row-open"]')
        .attributes('aria-describedby')).toContain(note.attributes('id'))

      await info.trigger('click')

      expect(info.attributes('aria-expanded')).toBe('false')
      expect((note.element as HTMLElement).style.display).toBe('none')
    })

  it('keeps the info button outside the row button', async () => {
    const wrapper = await mountRow()

    expect(wrapper.get('[data-testid="row-open"]').find('button').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="row-open"]').element.contains(
      wrapper.get('[data-testid="row-info"]').element,
    )).toBe(false)
  })

  it('shows the badge and the pending spinner only when asked', async () => {
    const plain = await mountRow()

    expect(plain.find('.badge').exists()).toBe(false)
    expect(plain.find('[data-testid="row-pending"]').exists()).toBe(false)

    const busy = await mountRow({ badge: 2, isPending: true })

    expect(busy.get('.badge').text()).toBe('2')
    expect(busy.find('[data-testid="row-pending"]').exists()).toBe(true)
  })

  it('is as high as the other action rows', async () => {
    const wrapper = await mountRow()

    expect(wrapper.get('.min-h-9').classes()).toContain('max-md:min-h-11')
  })
})
