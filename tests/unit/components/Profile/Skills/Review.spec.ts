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

  it('fetches a file the browser does not have, shows it once and never refetches it', async () => {
    const loadFile = vi.fn(async (path: string) => `echo from ${path}`)
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })
    const items = wrapper.findAll(testId('skill-file-tree-item'))

    await items[1]!.trigger('click')
    await flushPromises()

    expect(loadFile).toHaveBeenCalledWith('scripts/run.sh')
    expect(wrapper.get(testId('skill-file-viewer-lines')).text())
      .toContain('echo from scripts/run.sh')

    await items[0]!.trigger('click')
    await flushPromises()
    await items[1]!.trigger('click')
    await flushPromises()

    expect(loadFile).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('not shown before you install')
  })

  it('shows the plain text with line numbers, the highlight and hidden characters', async () => {
    const loadFile = vi.fn(async () => 'one\ntwo https://x.test\u200bz\nthree')
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')
    await flushPromises()

    const lines = wrapper.findAll('[data-line]')

    expect(lines).toHaveLength(3)
    expect(lines[0]!.text()).toContain('1')
    expect(lines[0]!.attributes('data-testid')).toBe('skill-file-line-flagged')
    expect(lines[1]!.text()).toContain('⟨U+200B⟩')
    expect(wrapper.find('script').exists()).toBe(false)
  })

  it('shows a loading state while the file is on its way', async () => {
    let resolveFile: (text: string) => void = () => undefined
    const loadFile = vi.fn(() => new Promise<string>((resolve) => {
      resolveFile = resolve
    }))
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')

    expect(wrapper.find(testId('skill-review-file-loading')).exists())
      .toBe(true)

    resolveFile('echo hi')
    await flushPromises()

    expect(wrapper.find(testId('skill-review-file-loading')).exists())
      .toBe(false)
    expect(wrapper.get('code').text()).toBe('echo hi')
  })

  it('says why a file cannot be shown, in plain text', async () => {
    const loadFile = vi.fn(async () => {
      throw { data: {
        message: 'This file is too large to show',
        why: 'The review shows files up to 1 MiB',
      } }
    })
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('skill-review-file-error')).text()).toBe(
      'This file is too large to show. The review shows files up to 1 MiB',
    )
    expect(wrapper.find(testId('skill-file-viewer')).exists()).toBe(false)
  })

  it('ignores a slow answer for a file that is no longer selected', async () => {
    const answers: Record<string, (text: string) => void> = {}
    const loadFile = vi.fn((path: string) => new Promise<string>((resolve) => {
      answers[path] = resolve
    }))
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          files: [
            ...base.files,
            { path: 'references/a.md', bytes: 3, kind: 'reference' },
          ],
        }),
        loadFile,
      },
    })
    const items = wrapper.findAll(testId('skill-file-tree-item'))
    const itemFor = (name: string) => {
      return items.find(item => item.text().includes(name))!
    }

    await itemFor('run.sh').trigger('click')
    await itemFor('a.md').trigger('click')
    answers['references/a.md']!('second file')
    await flushPromises()
    answers['scripts/run.sh']!('first file')
    await flushPromises()

    expect(wrapper.get('code').text()).toBe('second file')
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

  it('opens the file of a finding from the highlights list, scrolls to its line and marks it', async () => {
    const scrollIntoView = vi.fn()

    Element.prototype.scrollIntoView = scrollIntoView

    const loadFile = vi.fn(async () => 'echo a\necho b\nhttps://x.test')
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [{
            type: 'url',
            path: 'scripts/run.sh',
            line: 3,
            snippet: 'https://x.test',
            detail: null,
          }, ...base.findings.slice(0, 1)],
        }),
        loadFile,
      },
    })

    await wrapper.findAll(testId('skill-review-finding'))[0]!.trigger('click')
    await flushPromises()

    expect(loadFile).toHaveBeenCalledWith('scripts/run.sh')
    expect(wrapper.get(testId('skill-file-viewer')).text())
      .toContain('scripts/run.sh')

    const focused = wrapper.get(testId('skill-file-line-focused'))

    expect(focused.attributes('data-line')).toBe('3')
    expect(focused.attributes('aria-current')).toBe('location')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('moves the mark when another highlight of the same file is clicked', async () => {
    Element.prototype.scrollIntoView = vi.fn()

    const loadFile = vi.fn(async () => 'a\nb\nc\nd')
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [
            { type: 'url', path: 'scripts/run.sh', line: 2, snippet: 'b', detail: null },
            { type: 'url', path: 'scripts/run.sh', line: 4, snippet: 'd', detail: null },
          ],
          files: base.files,
        }),
        loadFile,
      },
    })
    const items = wrapper.findAll(testId('skill-review-finding'))

    await items[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('skill-file-line-focused')).attributes('data-line'))
      .toBe('2')

    await items[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('skill-file-line-focused')).attributes('data-line'))
      .toBe('4')
    expect(loadFile).toHaveBeenCalledTimes(1)
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
