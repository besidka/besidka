import { computed, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import HistoryArtifactBadge from '../../../../app/components/History/ArtifactBadge.vue'

const artifactsActive = ref<boolean>(true)

mockNuxtImport('useFeature', () => {
  return () => computed(() => {
    return {
      enabled: artifactsActive.value,
      active: artifactsActive.value,
      variant: null,
    }
  })
})

function mountBadge(props: { count?: number, compact?: boolean }) {
  return mountSuspended(HistoryArtifactBadge, {
    props,
    global: {
      stubs: {
        Icon: true,
      },
    },
  })
}

describe('History/ArtifactBadge', () => {
  beforeEach(() => {
    artifactsActive.value = true
  })

  it('renders nothing when there are no artifacts', async () => {
    const wrapper = await mountBadge({ count: 0 })

    expect(wrapper.find('[data-testid="chat-artifact-badge"]').exists())
      .toBe(false)
  })

  it('renders nothing when the count is missing', async () => {
    const wrapper = await mountBadge({})

    expect(wrapper.find('[data-testid="chat-artifact-badge"]').exists())
      .toBe(false)
  })

  it('uses the singular label for one artifact', async () => {
    const wrapper = await mountBadge({ count: 1 })
    const badge = wrapper.get('[data-testid="chat-artifact-badge"]')

    expect(badge.attributes('title')).toBe('1 artifact')
    expect(badge.text()).toContain('1 artifact')
    expect(badge.classes()).toContain('badge-soft')
  })

  it('uses the plural label for several artifacts', async () => {
    const wrapper = await mountBadge({ count: 3 })
    const badge = wrapper.get('[data-testid="chat-artifact-badge"]')

    expect(badge.attributes('title')).toBe('3 artifacts')
    expect(badge.text()).toContain('3 artifacts')
  })

  it('shows only the number in compact mode', async () => {
    const wrapper = await mountBadge({ count: 3, compact: true })
    const badge = wrapper.get('[data-testid="chat-artifact-badge"]')

    const visibleTexts = badge.findAll('span[aria-hidden="true"]')
      .map(node => node.text())
      .filter(Boolean)

    expect(visibleTexts).toEqual(['3'])
    expect(badge.get('.sr-only').text()).toBe('3 artifacts')
  })

  it('is hidden without artifacts access', async () => {
    artifactsActive.value = false

    const wrapper = await mountBadge({ count: 2 })

    expect(wrapper.find('[data-testid="chat-artifact-badge"]').exists())
      .toBe(false)
  })
})
