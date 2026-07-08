import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FeatureGrid from '../../../../app/components/landing/FeatureGrid.vue'

const features = [
  { icon: 'lucide:layers', title: 'Multiple AI models', body: 'Body one' },
  { icon: 'lucide:globe', title: 'Web search', body: 'Body two' },
  { icon: 'lucide:telescope', title: 'Deep research', body: 'Body three' },
]

describe('FeatureGrid.vue', () => {
  it('renders 2 columns below sm and 3 columns at sm+ by default', async () => {
    const wrapper = await mountSuspended(FeatureGrid, {
      props: { features },
    })

    const grid = wrapper.find('div.grid')

    expect(grid.classes()).toContain('grid-cols-2')
    expect(grid.classes()).toContain('sm:grid-cols-3')
    expect(grid.classes()).not.toContain('grid-cols-1')
    expect(grid.classes()).not.toContain('lg:grid-cols-3')
  })

  it('renders 2 columns below sm and 3 columns at sm+ for columns=3',
    async () => {
      const wrapper = await mountSuspended(FeatureGrid, {
        props: { features, columns: 3 },
      })

      const grid = wrapper.find('div.grid')

      expect(grid.classes()).toContain('grid-cols-2')
      expect(grid.classes()).toContain('sm:grid-cols-3')
    })

  it('keeps 1 column below sm and 2 at sm+ for columns=2', async () => {
    const wrapper = await mountSuspended(FeatureGrid, {
      props: { features, columns: 2 },
    })

    const grid = wrapper.find('div.grid')

    expect(grid.classes()).toContain('grid-cols-1')
    expect(grid.classes()).toContain('sm:grid-cols-2')
    expect(grid.classes()).not.toContain('grid-cols-2')
  })

  it('keeps the 1/2/4 column reflow for columns=4', async () => {
    const wrapper = await mountSuspended(FeatureGrid, {
      props: { features, columns: 4 },
    })

    const grid = wrapper.find('div.grid')

    expect(grid.classes()).toContain('grid-cols-1')
    expect(grid.classes()).toContain('sm:grid-cols-2')
    expect(grid.classes()).toContain('lg:grid-cols-4')
  })

  it('renders one card per feature with title and body', async () => {
    const wrapper = await mountSuspended(FeatureGrid, {
      props: { features },
    })

    const titles = wrapper.findAll('h3').map((heading) => {
      return heading.text()
    })

    expect(titles).toEqual([
      'Multiple AI models',
      'Web search',
      'Deep research',
    ])
  })
})
