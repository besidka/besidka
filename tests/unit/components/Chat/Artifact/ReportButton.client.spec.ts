import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ReportButton from '../../../../../app/components/Chat/Artifact/ReportButton.client.vue'

enableAutoUnmount(afterEach)

mockComponent('ArtifactReportModal', () => {
  return defineComponent({
    props: {
      open: { type: Boolean, required: true },
      title: { type: String, required: true },
      endpoint: { type: String, required: true },
      headers: { type: Object, default: undefined },
      version: { type: Number, default: null },
    },
    setup(props) {
      return () => h('div', {
        'data-testid': 'report-modal-stub',
        'data-open': String(props.open),
        'data-endpoint': props.endpoint,
        'data-title': props.title,
        'data-has-headers': String(!!props.headers),
        'data-version': String(props.version),
      })
    },
  })
})

const props = {
  shareSlug: 'share 1',
  artifactId: 'art-1',
  title: 'Quiz',
}

describe('Chat/Artifact/ReportButton.client', () => {
  it('renders a ghost button that announces a dialog', async () => {
    const wrapper = await mountSuspended(ReportButton, { props })
    const button = wrapper.get('[data-testid="artifact-report-button"]')

    expect(button.classes()).toEqual(
      expect.arrayContaining(['btn', 'btn-ghost', 'btn-sm']),
    )
    expect(button.attributes('aria-haspopup')).toBe('dialog')
    expect(button.text()).toBe('Report')
  })

  it('opens the shared report modal with the shared chat endpoint',
    async () => {
      const wrapper = await mountSuspended(ReportButton, { props })
      const modal = () => {
        return wrapper.get('[data-testid="report-modal-stub"]')
      }

      expect(modal().attributes('data-open')).toBe('false')

      await wrapper.get('[data-testid="artifact-report-button"]')
        .trigger('click')

      expect(modal().attributes('data-open')).toBe('true')
      expect(modal().attributes('data-endpoint')).toBe(
        '/api/v1/shared/share%201/artifacts/art-1/report',
      )
      expect(modal().attributes('data-title')).toBe('Quiz')
      expect(modal().attributes('data-has-headers')).toBe('false')
      expect(modal().attributes('data-version')).toBe('null')
    })

  it('passes the version shown in the panel to the modal', async () => {
    const wrapper = await mountSuspended(ReportButton, {
      props: { ...props, version: 2 },
    })

    expect(wrapper.get('[data-testid="report-modal-stub"]')
      .attributes('data-version')).toBe('2')
  })
})
