import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import HomeBubble from '../../../../app/components/content/HomeBubble.vue'

const mountOptions = {
  global: {
    stubs: {
      Logo: true,
      Icon: true,
    },
  },
}

describe('HomeBubble.vue', () => {
  it('renders a heading whose id matches the anchor and whose text is '
    + 'the slot content', async () => {
    const wrapper = await mountSuspended(HomeBubble, {
      props: {
        role: 'user',
        heading: true,
        id: 'features',
      },
      slots: {
        default: '<p>What can I actually do with it?</p>',
      },
      ...mountOptions,
    })

    const heading = wrapper.get('h2')

    expect(heading.attributes('id')).toBe('features')
    expect(heading.attributes('tabindex')).toBe('-1')
    expect(heading.text()).toBe('What can I actually do with it?')
    expect(heading.find('p').exists()).toBe(false)
  })

  it('wraps the heading text in a self-link to its own anchor when an '
    + 'id is set', async () => {
    const wrapper = await mountSuspended(HomeBubble, {
      props: {
        role: 'user',
        heading: true,
        id: 'features',
      },
      slots: {
        default: '<p>What can I actually do with it?</p>',
      },
      ...mountOptions,
    })

    const heading = wrapper.get('h2')
    const link = heading.get('a')

    expect(link.attributes('href')).toBe('#features')
    expect(link.text()).toBe('What can I actually do with it?')
    expect(heading.findAll('a')).toHaveLength(1)
  })

  it('renders no link inside the heading when no id is provided',
    async () => {
      const wrapper = await mountSuspended(HomeBubble, {
        props: {
          role: 'user',
          heading: true,
        },
        slots: {
          default: '<p>Who is this for?</p>',
        },
        ...mountOptions,
      })

      const heading = wrapper.get('h2')

      expect(heading.find('a').exists()).toBe(false)
      expect(heading.text()).toBe('Who is this for?')
    })

  it('renders no heading when the flag is not set', async () => {
    const wrapper = await mountSuspended(HomeBubble, {
      props: {
        role: 'user',
        srLabel: 'User question',
      },
      slots: {
        default: '<p>How many people are using this?</p>',
      },
      ...mountOptions,
    })

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.text()).toContain('How many people are using this?')
  })

  it('renders a heading with no id when none is provided', async () => {
    const wrapper = await mountSuspended(HomeBubble, {
      props: {
        role: 'user',
        heading: true,
      },
      slots: {
        default: '<p>Who is this for?</p>',
      },
      ...mountOptions,
    })

    const heading = wrapper.get('h2')

    expect(heading.attributes('id')).toBeUndefined()
    expect(heading.attributes('tabindex')).toBe('-1')
    expect(heading.text()).toBe('Who is this for?')
  })

  it('does not pass an sr-label through when a heading is present',
    async () => {
      const wrapper = await mountSuspended(HomeBubble, {
        props: {
          role: 'user',
          heading: true,
          id: 'faq',
          srLabel: 'Should be ignored',
        },
        slots: {
          default: '<p>I have more questions.</p>',
        },
        ...mountOptions,
      })

      expect(wrapper.attributes('aria-label')).toBeUndefined()
    })
})
