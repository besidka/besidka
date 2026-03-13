import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProjectInstructions from '../../../../app/components/Chat/ProjectInstructions.vue'

describe('Chat/ProjectInstructions', () => {
  it('renders the project name and instructions', async () => {
    const wrapper = await mountSuspended(ProjectInstructions, {
      props: {
        projectName: 'Project Alpha',
        instructions: 'Always answer with implementation details first.',
        memory: 'User prefers concise technical summaries.',
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Project instructions')
    expect(wrapper.text()).toContain('Project Alpha')
    expect(wrapper.text()).toContain(
      'Always answer with implementation details first.',
    )
    expect(wrapper.text()).toContain('Project memory')
    expect(wrapper.text()).toContain(
      'User prefers concise technical summaries.',
    )
  })

  it('collapses long content until expanded', async () => {
    const wrapper = await mountSuspended(ProjectInstructions, {
      props: {
        projectName: 'Project Alpha',
        instructions: Array.from({ length: 8 }, (_, index) => {
          return `Instruction line ${index + 1}`
        }).join('\n'),
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })

    const button = wrapper.get('button')

    expect(button.text()).toBe('Show more')
    expect(wrapper.get('p').classes()).toContain('line-clamp-6')

    await button.trigger('click')

    expect(button.text()).toBe('Show less')
    expect(wrapper.get('p').classes()).not.toContain('line-clamp-6')
  })
})
