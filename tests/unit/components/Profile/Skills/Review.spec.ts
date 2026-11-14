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
  it('shows the license once, as one row with a badge for the class', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), fileName: 'review-pr.zip' },
    })

    expect(wrapper.get(testId('skill-review-license')).text())
      .toBe('MIT · open license')
    expect(wrapper.get(testId('skill-review-license-class')).classes())
      .toEqual(expect.arrayContaining(['badge', 'badge-soft']))
    expect(wrapper.find(testId('skill-review-license-field')).exists())
      .toBe(false)
    expect(wrapper.find(testId('skill-review-license-root')).exists())
      .toBe(false)
    expect(wrapper.findAll('dt').filter((term) => {
      return /licen[cs]e/i.test(term.text())
    }).map((term) => {
      return term.text()
    })).toEqual(['License'])
    expect(wrapper.get(testId('skill-review-license-text')).text())
      .toContain('License text')
    expect(wrapper.get(testId('skill-review-license-text')).text())
      .toContain('MIT License')
    expect(wrapper.get(testId('skill-review-source')).text())
      .toBe('Uploaded file review-pr.zip')
  })

  it('shows the raw license field only when it differs from the detected license', async () => {
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          skill: { ...base.skill, license: 'Apache 2 with extras' },
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license-field')).text())
      .toBe('Apache 2 with extras')

    const sameWithOtherCase = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          skill: { ...base.skill, license: 'mit' },
        }),
      },
    })

    expect(sameWithOtherCase.find(testId('skill-review-license-field')).exists())
      .toBe(false)
  })

  it('says "From the repository root" once when the root license was used', async () => {
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          license: { ...base.license, fromRepositoryRoot: true },
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license-root')).text())
      .toBe('From the repository root')
  })

  it('shows a license class without an SPDX id as one badge', async () => {
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          skill: { ...base.skill, license: null },
          license: {
            ...base.license,
            class: 'none',
            spdx: null,
            file: null,
            licenseText: null,
            licenseField: null,
          },
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license')).text())
      .toBe('No license stated')
    expect(wrapper.find(testId('skill-review-license-text')).exists())
      .toBe(false)
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

  it('labels a license-less skill as no license stated', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          license: {
            class: 'none',
            text: 'No license stated.',
            matched: [],
            file: null,
            spdx: null,
            licenseText: null,
            licenseField: null,
          },
          requiresLicenseAcknowledgement: true,
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license-class')).text())
      .toBe('No license stated')
    expect(wrapper.find(testId('skill-review-license-text')).exists())
      .toBe(false)
  })
})
