import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import CommandPicker from '../../../../app/components/ChatInput/CommandPicker.vue'
import type { ComposerCommand } from '../../../../app/utils/composer-command'

enableAutoUnmount(afterEach)

const MEETING_NOTES: ComposerCommand = {
  skillId: 'skl1',
  command: 'meeting-notes',
  name: 'Meeting notes',
  description: 'Turn a transcript into notes',
  version: 2,
  mode: 'ask',
}

const WRITE: ComposerCommand = {
  skillId: 'skl2',
  command: 'write',
  name: 'Writing style',
  description: 'Write in my voice',
  version: 1,
  mode: 'auto',
}

interface MountOptions {
  isOpen?: boolean
  matches?: ComposerCommand[]
  activeIndex?: number
  hasNoCommands?: boolean
}

function mountPicker(options: MountOptions = {}) {
  return mountSuspended(CommandPicker, {
    props: {
      isOpen: true,
      matches: [MEETING_NOTES, WRITE],
      activeIndex: 0,
      hasNoCommands: false,
      ...options,
    },
    global: {
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

describe('ChatInput/CommandPicker', () => {
  it('renders a row with the command, name, description and mode', async () => {
    const wrapper = await mountPicker()
    const first = wrapper.get('[data-testid="command-picker-item-meeting-notes"]')
    const second = wrapper.get('[data-testid="command-picker-item-write"]')

    expect(first.text()).toContain('/meeting-notes')
    expect(first.text()).toContain('Meeting notes')
    expect(first.text()).toContain('Turn a transcript into notes')
    expect(first.text()).toContain('Only when I ask')
    expect(second.text()).toContain('/write')
    expect(second.text()).toContain('Writing style')
    expect(second.text()).toContain('Write in my voice')
    expect(second.text()).toContain('Auto')
    expect(second.text()).not.toContain('Only when I ask')
  })

  it('renders the rows as options of a listbox', async () => {
    const wrapper = await mountPicker()
    const options = wrapper.findAll('[role="option"]')

    expect(wrapper.get('[role="listbox"]').exists()).toBe(true)
    expect(options).toHaveLength(2)
  })

  it('marks only the active row as selected', async () => {
    const wrapper = await mountPicker({ activeIndex: 1 })
    const options = wrapper.findAll('[role="option"]')

    expect(options[0]!.attributes('aria-selected')).toBe('false')
    expect(options[1]!.attributes('aria-selected')).toBe('true')

    await wrapper.setProps({ activeIndex: 0 })

    expect(options[0]!.attributes('aria-selected')).toBe('true')
    expect(options[1]!.attributes('aria-selected')).toBe('false')
  })

  it('exposes the list id and the active option id', async () => {
    const wrapper = await mountPicker({ activeIndex: 1 })
    const exposed = wrapper.vm as unknown as {
      listId: string
      activeOptionId: string | undefined
    }
    const activeOption = wrapper.findAll('[role="option"]')[1]!

    expect(wrapper.get('[role="listbox"]').attributes('id')).toBe(
      exposed.listId,
    )
    expect(exposed.activeOptionId).toBe(activeOption.attributes('id'))
  })

  it('emits pick with the command when a row is clicked', async () => {
    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="command-picker-item-write"]')
      .trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[WRITE]])
  })

  it('prevents mousedown on a row so focus stays in the textarea', async () => {
    const wrapper = await mountPicker()
    const row = wrapper.get('[data-testid="command-picker-item-write"]')
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    })

    row.element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps the rows out of the tab order', async () => {
    const wrapper = await mountPicker()
    const row = wrapper.get('[data-testid="command-picker-item-write"]')

    expect(row.attributes('tabindex')).toBe('-1')
  })

  it('renders nothing when it is closed', async () => {
    const wrapper = await mountPicker({ isOpen: false })

    expect(wrapper.find('[data-testid="command-picker"]').exists()).toBe(false)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('meeting-notes')
  })

  it('renders the empty state with a link to the Skills page', async () => {
    const wrapper = await mountPicker({ matches: [], hasNoCommands: true })
    const empty = wrapper.get('[data-testid="command-picker-empty"]')
    const manage = wrapper.get('[data-testid="command-picker-manage"]')

    expect(empty.text()).toContain('No commands.')
    expect(manage.attributes('href')).toBe('/chats/skills')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })

  it('does not render the empty state while there are commands', async () => {
    const wrapper = await mountPicker()

    expect(wrapper.find('[data-testid="command-picker-empty"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="command-picker-manage"]').exists())
      .toBe(false)
  })

  it('has no active option id without rows', async () => {
    const wrapper = await mountPicker({ matches: [], hasNoCommands: true })
    const exposed = wrapper.vm as unknown as {
      activeOptionId: string | undefined
    }

    expect(exposed.activeOptionId).toBeUndefined()
  })
})
