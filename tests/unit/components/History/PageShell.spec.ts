import { computed, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import HistoryPageShell from '../../../../app/components/History/PageShell.vue'

const artifactsActive = ref<boolean>(false)

mockNuxtImport('useFeature', () => {
  return () => computed(() => {
    return {
      enabled: artifactsActive.value,
      active: artifactsActive.value,
      variant: null,
    }
  })
})

function mountShell(activeTab: 'chats' | 'projects' | 'shared' | 'artifacts') {
  return mountSuspended(HistoryPageShell, {
    props: {
      activeTab,
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
}

describe('HistoryPageShell', () => {
  beforeEach(() => {
    artifactsActive.value = false
  })

  it('renders history navigation as page links styled like tabs', async () => {
    const wrapper = await mountShell('projects')

    const navigation = wrapper.get('nav[aria-label="History sections"]')
    const links = navigation.findAll('a')

    expect(navigation.classes()).toContain('tabs')
    expect(navigation.classes()).toContain('tabs-border')
    expect(links).toHaveLength(3)
    expect(links[0]?.attributes('href')).toBe('/chats/history')
    expect(links[0]?.attributes('aria-current')).toBeUndefined()
    expect(links[1]?.attributes('href')).toBe('/chats/projects')
    expect(links[1]?.attributes('aria-current')).toBe('page')
    expect(links[2]?.attributes('href')).toBe('/chats/shared')
    expect(links[2]?.attributes('aria-current')).toBeUndefined()
    expect(wrapper.find('[data-testid="tab-artifacts"]').exists()).toBe(false)
  })

  it('keeps every label visible while there are three tabs', async () => {
    const wrapper = await mountShell('chats')

    expect(wrapper.findAll('nav a span.max-sm\\:sr-only')).toHaveLength(0)
  })

  it('adds the Artifacts tab as the fourth link with the feature on',
    async () => {
      artifactsActive.value = true

      const wrapper = await mountShell('artifacts')
      const links = wrapper.get('nav[aria-label="History sections"]')
        .findAll('a')
      const artifactsTab = wrapper.get('[data-testid="tab-artifacts"]')

      expect(links).toHaveLength(4)
      expect(links[3]?.attributes('href')).toBe('/chats/artifacts')
      expect(artifactsTab.attributes('aria-current')).toBe('page')
      expect(artifactsTab.attributes('aria-label')).toBe('Artifacts')
      expect(artifactsTab.text()).toContain('Artifacts')
    })

  it('shows only the active label below sm with four tabs', async () => {
    artifactsActive.value = true

    const wrapper = await mountShell('shared')
    const labels = wrapper.findAll('nav a span:not(.iconify)')
    const collapsed = labels.filter((label) => {
      return label.classes().includes('max-sm:sr-only')
    })

    expect(labels).toHaveLength(4)
    expect(collapsed.map(label => label.text())).toEqual([
      'Chats',
      'Projects',
      'Artifacts',
    ])
    expect(wrapper.get('[data-testid="tab-shared"]').attributes('aria-label'))
      .toBe('Shared')
  })
})
