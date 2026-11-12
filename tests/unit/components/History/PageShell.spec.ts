import { computed, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import HistoryPageShell from '../../../../app/components/History/PageShell.vue'

const artifactsActive = ref<boolean>(false)
const documentsActive = ref<boolean>(false)

mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = key === 'documents'
      ? documentsActive.value
      : artifactsActive.value

    return { enabled: active, active, variant: null }
  })
})

type ShellTab = 'chats' | 'projects' | 'shared' | 'artifacts' | 'documents'

function mountShell(activeTab: ShellTab) {
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
    documentsActive.value = false
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

    expect(wrapper.findAll('nav a span.\\@max-md\\:sr-only')).toHaveLength(0)
  })

  it('adds the Artifacts tab before Shared with the feature on',
    async () => {
      artifactsActive.value = true

      const wrapper = await mountShell('artifacts')
      const links = wrapper.get('nav[aria-label="History sections"]')
        .findAll('a')
      const artifactsTab = wrapper.get('[data-testid="tab-artifacts"]')

      expect(links).toHaveLength(4)
      expect(wrapper.find('[data-testid="tab-documents"]').exists())
        .toBe(false)
      expect(links[2]?.attributes('href')).toBe('/chats/artifacts')
      expect(links[3]?.attributes('href')).toBe('/chats/shared')
      expect(artifactsTab.attributes('aria-current')).toBe('page')
      expect(artifactsTab.attributes('aria-label')).toBe('Artifacts')
      expect(artifactsTab.text()).toContain('Artifacts')
    })

  it('shows only the active label below sm with four tabs', async () => {
    artifactsActive.value = true

    const wrapper = await mountShell('shared')
    const labels = wrapper.findAll('nav a span:not(.iconify)')
    const collapsed = labels.filter((label) => {
      return label.classes().includes('@max-md:sr-only')
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

  it('adds only the Documents tab when only the documents feature is on',
    async () => {
      documentsActive.value = true

      const wrapper = await mountShell('documents')
      const links = wrapper.get('nav[aria-label="History sections"]')
        .findAll('a')
      const documentsTab = wrapper.get('[data-testid="tab-documents"]')

      expect(links).toHaveLength(4)
      expect(wrapper.find('[data-testid="tab-artifacts"]').exists())
        .toBe(false)
      expect(links[2]?.attributes('href')).toBe('/chats/documents')
      expect(links[3]?.attributes('href')).toBe('/chats/shared')
      expect(documentsTab.attributes('aria-current')).toBe('page')
      expect(documentsTab.attributes('aria-label')).toBe('Documents')
    })

  it('orders tabs Chats, Projects, Artifacts, Documents, Shared and collapses inactive labels',
    async () => {
      artifactsActive.value = true
      documentsActive.value = true

      const wrapper = await mountShell('documents')
      const links = wrapper.get('nav[aria-label="History sections"]')
        .findAll('a')
      const labels = wrapper.findAll('nav a span:not(.iconify)')
      const collapsed = labels.filter((label) => {
        return label.classes().includes('@max-md:sr-only')
      })

      expect(links.map(link => link.attributes('href'))).toEqual([
        '/chats/history',
        '/chats/projects',
        '/chats/artifacts',
        '/chats/documents',
        '/chats/shared',
      ])
      expect(collapsed.map(label => label.text())).toEqual([
        'Chats',
        'Projects',
        'Artifacts',
        'Shared',
      ])
    })
})
