import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProjectInstructions from '../../../../app/components/Chat/ProjectInstructions.vue'

vi.mock('#app', async (importOriginal) => {
  return await importOriginal<Record<string, unknown>>()
})

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

  describe('multi-paragraph memory', () => {
    const multiParagraphMemory = [
      '**Purpose & Context**',
      '',
      'This memo covers the migration plan.',
      '',
      '**Key Learnings**',
      '',
      'Prefer additive schema changes.',
    ].join('\n')

    async function mountWithExpandedMemory(
      stubs: Record<string, unknown>,
    ) {
      const wrapper = await mountSuspended(ProjectInstructions, {
        props: {
          projectId: 'project-1',
          projectName: 'Project Alpha',
          memory: multiParagraphMemory,
        },
        global: {
          stubs: {
            UiBubble: {
              template: '<div><slot /></div>',
            },
            NuxtLink: {
              props: ['to'],
              template: '<a :href="to"><slot /></a>',
            },
            ...stubs,
          },
        },
      })

      await wrapper.get('summary').trigger('click')

      return wrapper
    }

    it('renders every markdown paragraph as its own block element', async () => {
      const wrapper = await mountWithExpandedMemory({})

      await flushPromises()
      await vi.waitFor(() => {
        expect(
          wrapper.findAll('.chat-markdown p').length,
        ).toBeGreaterThanOrEqual(4)
      })

      expect(
        wrapper.findAll('.chat-markdown p').map(paragraph => paragraph.text()),
      ).toEqual([
        'Purpose & Context',
        'This memo covers the migration plan.',
        'Key Learnings',
        'Prefer additive schema changes.',
      ])
    })

    it('does not strip paragraph wrappers from the memory markdown', async () => {
      const wrapper = await mountWithExpandedMemory({
        MDCCached: {
          name: 'MDCCached',
          props: ['value', 'unwrap'],
          template: '<div>{{ value }}</div>',
        },
      })

      const markdown = wrapper.findComponent({ name: 'MDCCached' })

      expect(markdown.exists()).toBe(true)
      expect(markdown.props('unwrap')).toBeUndefined()
      expect(markdown.props('value')).toBe(multiParagraphMemory)
    })
  })
})
