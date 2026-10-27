import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Section from '../../../../../app/components/ChatInput/ToolsMenu/Section.vue'

describe('ChatInput/ToolsMenu/Section', () => {
  it('renders a fixed-height header row with the title', async () => {
    const wrapper = await mountSuspended(Section, {
      props: { id: 'add', title: 'Add' },
    })
    const row = wrapper.get('h3').element.parentElement as HTMLElement

    expect(wrapper.get('h3').text()).toBe('Add')
    expect(row.classList.contains('h-7')).toBe(true)
    expect(row.classList.contains('items-center')).toBe(true)
  })

  it('renders an Iconify icon left of the title', async () => {
    const wrapper = await mountSuspended(Section, {
      props: { id: 'add', title: 'Add', icon: 'lucide:plus' },
    })
    const heading = wrapper.get('h3')
    const icon = heading.get('[data-testid="tools-section-icon"]')

    expect(icon.attributes('aria-hidden')).toBe('true')
    expect(heading.element.firstElementChild).toBe(icon.element)
  })

  it('renders an icon component left of the title', async () => {
    const wrapper = await mountSuspended(Section, {
      props: {
        id: 'reasoning',
        title: 'Reasoning',
        iconComponent: 'SvgoThinkHigh',
      },
    })

    expect(wrapper.get('h3 [data-testid="tools-section-icon"]').exists())
      .toBe(true)
  })

  it('renders no icon when none is given', async () => {
    const wrapper = await mountSuspended(Section, {
      props: { id: 'add', title: 'Add' },
    })

    expect(wrapper.find('[data-testid="tools-section-icon"]').exists())
      .toBe(false)
  })

  it('renders the title-end slot inside the header row', async () => {
    const wrapper = await mountSuspended(Section, {
      props: { id: 'search', title: 'Web search' },
      slots: { 'title-end': '<span data-testid="end">end</span>' },
    })
    const row = wrapper.get('h3').element.parentElement as HTMLElement

    expect(row.contains(wrapper.get('[data-testid="end"]').element))
      .toBe(true)
    expect(row.classList.contains('justify-between')).toBe(true)
  })

  it('renders no header for an untitled section', async () => {
    const wrapper = await mountSuspended(Section, {
      props: { id: 'image', label: 'Create image' },
    })

    expect(wrapper.find('h3').exists()).toBe(false)
    expect(wrapper.attributes('aria-label')).toBe('Create image')
  })
})
