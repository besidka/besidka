import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProjectInstructions from '../../../../app/components/Chat/ProjectInstructions.vue'

describe('Chat/ProjectInstructions', () => {
  it('renders compact collapsed rows and expands instructions with a project link', async () => {
    const wrapper = await mountSuspended(ProjectInstructions, {
      props: {
        projectId: 'project-1',
        projectName: 'Project Alpha',
        instructions: 'Always answer with implementation details first.',
        memory: 'User prefers concise technical summaries.',
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          MDCCached: {
            props: ['value'],
            template: '<div><slot />{{ value }}</div>',
          },
          NuxtLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    })

    const sections = wrapper.findAll('details')

    expect(wrapper.text()).toContain('Project instructions')
    expect(wrapper.text()).toContain('Project memory')
    expect(wrapper.text()).not.toContain(
      'Always answer with implementation details first.',
    )
    expect(wrapper.text()).not.toContain(
      'User prefers concise technical summaries.',
    )
    expect(sections).toHaveLength(2)

    await sections[0]!.get('summary').trigger('click')

    expect(wrapper.text()).toContain(
      'Always answer with implementation details first.',
    )
    expect(wrapper.text()).toContain('Project settings')
    expect(wrapper.html()).toContain('/chats/projects/project-1')

    await sections[1]!.get('summary').trigger('click')

    expect(wrapper.text()).toContain(
      'User prefers concise technical summaries.',
    )
  })
})
