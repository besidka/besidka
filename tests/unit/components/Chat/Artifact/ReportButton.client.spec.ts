import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportButton from '../../../../../app/components/Chat/Artifact/ReportButton.client.vue'
import * as messagesComposable from '../../../../../app/composables/messages'

const { fetchMock } = vi.hoisted(() => {
  return { fetchMock: vi.fn() }
})

mockNuxtImport('$fetch', () => {
  return fetchMock
})

enableAutoUnmount(afterEach)

const props = {
  shareSlug: 'share-1',
  artifactId: 'art-1',
  title: 'Quiz',
}

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

async function fillForm(
  wrapper: VueWrapper,
  values: Record<string, string>,
) {
  for (const [testId, value] of Object.entries(values)) {
    await wrapper.find(byTestId(testId)).setValue(value)
  }
}

describe('Chat/Artifact/ReportButton.client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the report dialog from the ghost button', async () => {
    const wrapper = await mountSuspended(ReportButton, { props })
    const button = wrapper.find(byTestId('artifact-report-button'))

    expect(button.classes()).toEqual(
      expect.arrayContaining(['btn', 'btn-ghost', 'btn-sm']),
    )

    await button.trigger('click')

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled()
    expect(wrapper.find(byTestId('artifact-report-modal')).text())
      .toContain('Quiz')
  })

  it('posts the report to the shared chat route', async () => {
    const successSpy = vi.spyOn(messagesComposable, 'useSuccessMessage')

    fetchMock.mockResolvedValue({ ok: true })

    const wrapper = await mountSuspended(ReportButton, { props })

    await fillForm(wrapper, {
      'artifact-report-reason': 'phishing',
      'artifact-report-details': 'Asks for a password',
      'artifact-report-name': 'Ann',
      'artifact-report-email': 'ann@example.test',
    })
    await wrapper.find('form').trigger('submit')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/shared/share-1/artifacts/art-1/report',
      {
        method: 'POST',
        body: {
          reason: 'phishing',
          details: 'Asks for a password',
          reporterName: 'Ann',
          reporterEmail: 'ann@example.test',
        },
      },
    )
    await vi.waitFor(() => {
      expect(successSpy).toHaveBeenCalledWith(
        'Report sent',
        expect.any(String),
      )
    })
  })

  it('makes contact details optional only for csam reports', async () => {
    const wrapper = await mountSuspended(ReportButton, { props })
    const email = wrapper.find(byTestId('artifact-report-email'))

    expect(email.attributes('required')).toBeDefined()
    expect(wrapper.find('form').text()).not.toContain('(optional)')

    await fillForm(wrapper, { 'artifact-report-reason': 'csam' })

    expect(wrapper.find('form').text()).toContain('Your email (optional)')
    expect(wrapper.find(byTestId('artifact-report-email')).attributes('required'))
      .toBeUndefined()
  })

  it('shows the server error', async () => {
    const errorSpy = vi.spyOn(messagesComposable, 'useErrorMessage')

    fetchMock.mockRejectedValue(new Error('Too many reports'))

    const wrapper = await mountSuspended(ReportButton, { props })

    await fillForm(wrapper, { 'artifact-report-details': 'x' })
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('Too many reports', undefined)
    })
  })
})
