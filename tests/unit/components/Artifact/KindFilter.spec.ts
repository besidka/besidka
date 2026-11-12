import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArtifactKindCounts } from '#shared/utils/artifacts'
import KindFilter from '../../../../app/components/Artifact/KindFilter.vue'
import type { ArtifactKindFilter } from '../../../../app/composables/artifacts-library'

enableAutoUnmount(afterEach)

function createCounts(
  overrides: Partial<ArtifactKindCounts> = {},
): ArtifactKindCounts {
  return {
    html: 0,
    react: 0,
    svg: 0,
    mermaid: 0,
    markdown: 0,
    ...overrides,
  }
}

function mountFilter(props: {
  counts: ArtifactKindCounts | null
  kind?: ArtifactKindFilter
}) {
  return mountSuspended(KindFilter, {
    props: {
      kind: 'all',
      testIdPrefix: 'artifact-library',
      ...props,
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Artifact/KindFilter', () => {
  it('renders nothing before the counts are known', async () => {
    const wrapper = await mountFilter({ counts: null })

    expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
      .toBe(false)
  })

  it('renders nothing for an empty library', async () => {
    const wrapper = await mountFilter({ counts: createCounts() })

    expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
      .toBe(false)
  })

  it('renders nothing when the user has a single kind', async () => {
    const wrapper = await mountFilter({
      counts: createCounts({ mermaid: 3 }),
      kind: 'mermaid',
    })

    expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
      .toBe(false)
    expect(wrapper.emitted('fallback')).toBeUndefined()
  })

  it('shows All and only the kinds the user has, each with a count',
    async () => {
      const wrapper = await mountFilter({
        counts: createCounts({ html: 3, mermaid: 1 }),
      })

      const buttons = wrapper.findAll('button')

      expect(buttons.map(button => button.attributes('data-testid')))
        .toEqual([
          'artifact-library-kind-all',
          'artifact-library-kind-html',
          'artifact-library-kind-mermaid',
        ])
      expect(wrapper.get(testId('artifact-library-kind-all-count')).text())
        .toBe('4')
      expect(wrapper.get(testId('artifact-library-kind-html-count')).text())
        .toBe('3')
      expect(wrapper.get(testId('artifact-library-kind-mermaid-count')).text())
        .toBe('1')
      expect(wrapper.find(testId('artifact-library-kind-react')).exists())
        .toBe(false)
    })

  it('uses daisyUI badge modifiers only inside the chips', async () => {
    const wrapper = await mountFilter({
      counts: createCounts({ html: 3, mermaid: 1 }),
    })

    const badge = wrapper.get(testId('artifact-library-kind-html-count'))

    expect(badge.classes()).toEqual(
      expect.arrayContaining(['badge', 'badge-xs', 'badge-soft']),
    )
    expect(badge.classes()).not.toContain('badge-sm')
    expect(badge.classes().some(name => /^(text|bg|border)-/.test(name)))
      .toBe(false)
  })

  it('marks the active kind as pressed', async () => {
    const wrapper = await mountFilter({
      counts: createCounts({ html: 3, mermaid: 1 }),
      kind: 'mermaid',
    })

    expect(wrapper.get(testId('artifact-library-kind-mermaid'))
      .attributes('aria-pressed')).toBe('true')
    expect(wrapper.get(testId('artifact-library-kind-all'))
      .attributes('aria-pressed')).toBe('false')
  })

  it('emits select with the clicked kind', async () => {
    const wrapper = await mountFilter({
      counts: createCounts({ html: 3, mermaid: 1 }),
    })

    await wrapper.get(testId('artifact-library-kind-mermaid'))
      .trigger('click')
    await wrapper.get(testId('artifact-library-kind-all')).trigger('click')

    expect(wrapper.emitted('select')).toEqual([['mermaid'], ['all']])
  })

  it('uses the given test id prefix', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: {
        counts: createCounts({ html: 1, svg: 1 }),
        kind: 'all',
        testIdPrefix: 'artifact-picker',
      },
    })

    expect(wrapper.find(testId('artifact-picker-kind-filter')).exists())
      .toBe(true)
    expect(wrapper.find(testId('artifact-picker-kind-svg')).exists())
      .toBe(true)
  })

  it('asks to fall back to All when the active kind has no artifacts',
    async () => {
      const wrapper = await mountFilter({
        counts: createCounts({ html: 3, svg: 1 }),
        kind: 'mermaid',
      })

      expect(wrapper.emitted('fallback')).toHaveLength(1)
    })

  it('asks to fall back when the last artifact of the kind disappears',
    async () => {
      const wrapper = await mountFilter({
        counts: createCounts({ html: 3, mermaid: 1 }),
        kind: 'mermaid',
      })

      expect(wrapper.emitted('fallback')).toBeUndefined()

      await wrapper.setProps({ counts: createCounts({ html: 3 }) })

      expect(wrapper.emitted('fallback')).toHaveLength(1)
      expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
        .toBe(false)
    })

  it('does not fall back while the counts are unknown', async () => {
    const wrapper = await mountFilter({ counts: null, kind: 'mermaid' })

    expect(wrapper.emitted('fallback')).toBeUndefined()
  })
})
