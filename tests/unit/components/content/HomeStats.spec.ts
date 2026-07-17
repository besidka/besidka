import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import HomeStats from '../../../../app/components/content/HomeStats.vue'

const mountOptions = {
  global: {
    stubs: {
      LandingStatGrid: {
        name: 'LandingStatGrid',
        props: ['metrics'],
        template: '<div />',
      },
    },
  },
}

describe('HomeStats.vue', () => {
  it('passes the default metrics through to LandingStatGrid', async () => {
    const wrapper = await mountSuspended(HomeStats, mountOptions)

    const statGrid = wrapper.getComponent({ name: 'LandingStatGrid' })

    expect(statGrid.props('metrics')).toEqual([
      {
        metric: 'users',
        label: 'People using Besidka',
        icon: 'lucide:users',
      },
      {
        metric: 'chats',
        label: 'Conversations started',
        icon: 'lucide:message-square',
      },
      {
        metric: 'messages',
        label: 'Messages exchanged',
        icon: 'lucide:messages-square',
      },
      {
        metric: 'uploadedFiles',
        label: 'Files uploaded',
        icon: 'lucide:paperclip',
      },
      {
        metric: 'generatedImages',
        label: 'Images generated',
        icon: 'lucide:image',
      },
      {
        metric: 'sharedChats',
        label: 'Conversations shared',
        icon: 'lucide:share-2',
      },
      {
        metric: 'researches',
        label: 'Research reports generated',
        icon: 'lucide:telescope',
      },
    ])
  })

  it('shows uploaded files and generated images as separate metrics',
    async () => {
      const wrapper = await mountSuspended(HomeStats, mountOptions)

      const statGrid = wrapper.getComponent({ name: 'LandingStatGrid' })
      const metrics = statGrid.props('metrics')

      expect(metrics).toContainEqual({
        metric: 'uploadedFiles',
        label: 'Files uploaded',
        icon: 'lucide:paperclip',
      })
      expect(metrics).toContainEqual({
        metric: 'generatedImages',
        label: 'Images generated',
        icon: 'lucide:image',
      })
    })

  it('includes a researches metric card with the telescope icon', async () => {
    const wrapper = await mountSuspended(HomeStats, mountOptions)

    const statGrid = wrapper.getComponent({ name: 'LandingStatGrid' })
    const metrics = statGrid.props('metrics') as {
      metric: string
      label: string
      icon?: string
    }[]
    const researchMetric = metrics.find((metric) => {
      return metric.metric === 'researches'
    })

    expect(researchMetric).toBeDefined()
    expect(researchMetric?.icon).toBe('lucide:telescope')
  })

  it('forwards custom metrics passed as a prop', async () => {
    const customMetrics = [
      { metric: 'users', label: 'Custom label', icon: 'lucide:users' },
    ]
    const wrapper = await mountSuspended(HomeStats, {
      props: { metrics: customMetrics },
      ...mountOptions,
    })

    const statGrid = wrapper.getComponent({ name: 'LandingStatGrid' })

    expect(statGrid.props('metrics')).toEqual(customMetrics)
  })
})
