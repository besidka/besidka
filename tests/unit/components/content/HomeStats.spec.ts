import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import HomeStats from '../../../../app/components/content/HomeStats.vue'

describe('HomeStats.vue', () => {
  it('shows uploaded files and generated images as separate metrics',
    async () => {
      const wrapper = await mountSuspended(HomeStats, {
        global: {
          stubs: {
            LandingStatGrid: {
              name: 'LandingStatGrid',
              props: ['metrics'],
              template: '<div />',
            },
          },
        },
      })

      const grid = wrapper.getComponent({ name: 'LandingStatGrid' })
      const metrics = grid.props('metrics')

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
      expect(metrics).toHaveLength(6)
    })
})
