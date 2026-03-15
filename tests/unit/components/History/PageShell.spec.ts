import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import HistoryPageShell from '../../../../app/components/History/PageShell.vue'

describe('HistoryPageShell', () => {
  it('renders history navigation as page links styled like tabs', async () => {
    const wrapper = await mountSuspended(HistoryPageShell, {
      props: {
        activeTab: 'projects',
      },
      slots: {
        default: '<div>Content</div>',
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          Icon: true,
          NuxtLink: {
            props: ['to', 'ariaCurrent'],
            template: `
              <a :href="to" :aria-current="ariaCurrent">
                <slot />
              </a>
            `,
          },
        },
      },
    })

    const navigation = wrapper.get('nav[aria-label="History sections"]')
    const links = navigation.findAll('a')

    expect(navigation.classes()).toContain('tabs')
    expect(navigation.classes()).toContain('tabs-border')
    expect(links).toHaveLength(2)
    expect(links[0]?.attributes('href')).toBe('/chats/history')
    expect(links[0]?.attributes('aria-current')).toBeUndefined()
    expect(links[1]?.attributes('href')).toBe('/chats/projects')
    expect(links[1]?.attributes('aria-current')).toBe('page')
  })
})
