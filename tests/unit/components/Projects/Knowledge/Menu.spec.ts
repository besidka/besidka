import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import Menu from '../../../../../app/components/Projects/Knowledge/Menu.vue'

enableAutoUnmount(afterEach)

async function mountMenu() {
  return await mountSuspended(Menu, {
    props: {
      label: 'More',
      menuLabel: 'More knowledge actions',
      triggerTestId: 'menu-trigger',
    },
    slots: {
      default: '<li><button type="button" data-testid="menu-item">Do it</button></li>',
    },
    attachTo: document.body,
  })
}

function details(wrapper: Awaited<ReturnType<typeof mountMenu>>) {
  return wrapper.get<HTMLDetailsElement>('details').element
}

describe('Projects/Knowledge/Menu', () => {
  it('is a plain disclosure with aria-expanded on the trigger', async () => {
    const wrapper = await mountMenu()
    const trigger = wrapper.get('[data-testid="menu-trigger"]')

    expect(trigger.element.tagName).toBe('SUMMARY')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-haspopup')).toBeUndefined()
    expect(trigger.attributes('aria-controls'))
      .toBe(wrapper.get('ul').attributes('id'))
    expect(wrapper.get('ul').attributes('id')).toBeTruthy()
    expect(wrapper.get('ul').attributes('aria-label'))
      .toBe('More knowledge actions')

    details(wrapper).open = true
    await wrapper.get('details').trigger('toggle')

    expect(trigger.attributes('aria-expanded')).toBe('true')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const wrapper = await mountMenu()

    details(wrapper).open = true
    await wrapper.get('details').trigger('toggle')
    await wrapper.get('[data-testid="menu-item"]').trigger('keydown', {
      key: 'Escape',
    })

    expect(details(wrapper).open).toBe(false)
    expect(wrapper.get('[data-testid="menu-trigger"]')
      .attributes('aria-expanded')).toBe('false')
    expect(document.activeElement)
      .toBe(wrapper.get('[data-testid="menu-trigger"]').element)
  })

  it('closes after an item is chosen', async () => {
    const wrapper = await mountMenu()

    details(wrapper).open = true
    await wrapper.get('details').trigger('toggle')
    await wrapper.get('[data-testid="menu-item"]').trigger('click')

    expect(details(wrapper).open).toBe(false)
  })

  it('uses a rounded-box surface for the list', async () => {
    const wrapper = await mountMenu()

    expect(wrapper.get('ul').classes()).toContain('rounded-box')
  })
})
