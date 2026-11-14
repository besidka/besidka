import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Review from '../../../../../app/components/Profile/Skills/Review.vue'
import { createImportPreview } from '../../../../setup/helpers/skills-ui'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/Review', () => {
  it('shows the licence class, the raw license field and the licence excerpt as plain text', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), fileName: 'review-pr.zip' },
    })

    expect(wrapper.get(testId('skill-review-licence-class')).text())
      .toBe('Open licence (MIT)')
    expect(wrapper.get(testId('skill-review-license-field')).text())
      .toBe('MIT')
    expect(wrapper.get(testId('skill-review-licence-text')).text())
      .toContain('MIT License')
    expect(wrapper.get(testId('skill-review-source')).text())
      .toBe('Uploaded file review-pr.zip')
  })

  it('scrolls to the line of a finding that is clicked', async () => {
    const scrollIntoView = vi.fn()

    Element.prototype.scrollIntoView = scrollIntoView

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    await wrapper.findAll(testId('skill-review-finding'))[0]!.trigger('click')
    await flushPromises()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('shows compatibility and the requested tools as not granted', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    expect(wrapper.get(testId('skill-review-compatibility')).text())
      .toBe('Any chat model')
    expect(wrapper.get(testId('skill-review-allowed-tools')).text())
      .toContain('requested by the author, not granted')
  })

  it('warns that installing is like installing software and never calls a skill safe', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })
    const text = wrapper.get(testId('skill-review-warning')).text()

    expect(text).toContain(
      'Installing a skill is like installing software. Only continue if you trust its author.',
    )
    expect(text).toContain(
      'Besidka highlights links and commands so you can review them. It cannot tell whether a skill is safe.',
    )
    expect(text).toContain('1 link')
    expect(text).toContain('1 command')
    expect(wrapper.text().replace('cannot tell whether a skill is safe', ''))
      .not.toMatch(/\bis safe\b|\bsafe to\b|\bverified\b/i)
  })

  it('says nothing was highlighted when there are no findings', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({ findings: [], findingCounts: {} }),
      },
    })

    expect(wrapper.get(testId('skill-review-finding-counts')).text())
      .toContain('Nothing was highlighted.')
    expect(wrapper.find(testId('skill-review-findings')).exists()).toBe(false)
  })

  it('highlights findings in SKILL.md by line', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    expect(wrapper.findAll(testId('skill-file-line-flagged'))).toHaveLength(1)
    expect(wrapper.get(testId('skill-file-marker')).text()).toBe('Command')
  })

  it('does not preview a file whose text the browser does not have', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')

    expect(wrapper.find(testId('skill-review-not-previewed')).exists())
      .toBe(true)
    expect(wrapper.find(testId('skill-file-viewer')).exists()).toBe(false)
  })

  it('previews another file when the caller can read it', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview(),
        readFile: (path: string) => path === 'scripts/run.sh' ? 'echo hi' : null,
      },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')

    expect(wrapper.get('code').text()).toBe('echo hi')
  })

  it('opens the file of a finding from the highlights list', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview(),
        readFile: () => 'echo hi',
      },
    })
    const items = wrapper.findAll(testId('skill-review-finding'))

    await items[1]!.trigger('click')

    expect(wrapper.get(testId('skill-file-viewer')).text())
      .toContain('scripts/run.sh')
  })

  it('shows archive warnings', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({ warnings: ['Skipped __MACOSX'] }),
      },
    })

    expect(wrapper.get(testId('skill-review-warnings')).text())
      .toContain('Skipped __MACOSX')
  })

  it('labels a licence-less skill as no licence stated', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          licence: {
            class: 'none',
            text: 'No licence stated.',
            matched: [],
            file: null,
            spdx: null,
            licenceText: null,
            licenseField: null,
          },
          requiresLicenceAcknowledgement: true,
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-licence-class')).text())
      .toBe('No licence stated')
    expect(wrapper.find(testId('skill-review-licence-text')).exists())
      .toBe(false)
  })
})
