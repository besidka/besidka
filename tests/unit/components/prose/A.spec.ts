import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { DOMWrapper } from '@vue/test-utils'
import A from '../../../../app/components/prose/A.vue'

const mocks = vi.hoisted(() => {
  return { openResearchLink: vi.fn() }
})

mockNuxtImport('useResearchLink', () => {
  return () => {
    return { openResearchLink: mocks.openResearchLink }
  }
})

async function clickAnchorWithoutNavigating(
  link: DOMWrapper<Element>,
  options: Record<string, unknown> = {},
) {
  link.element.addEventListener('click', (event) => {
    event.preventDefault()
  })

  await link.trigger('click', options)
}

describe('prose/A.vue', () => {
  beforeEach(() => {
    mocks.openResearchLink.mockClear()
  })

  it('intercepts a plain left-click on an external link', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: 'https://example.com/x' },
    })

    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    wrapper.get('a').element.dispatchEvent(event)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(mocks.openResearchLink).toHaveBeenCalledWith(
      'https://example.com/x',
    )
  })

  it('does not intercept an external link click with the meta key held',
    async () => {
      const wrapper = await mountSuspended(A, {
        props: { href: 'https://example.com/x' },
      })

      await clickAnchorWithoutNavigating(wrapper.get('a'), {
        metaKey: true,
      })

      expect(mocks.openResearchLink).not.toHaveBeenCalled()
    })

  it('does not intercept an external link click with the ctrl key held',
    async () => {
      const wrapper = await mountSuspended(A, {
        props: { href: 'https://example.com/x' },
      })

      await clickAnchorWithoutNavigating(wrapper.get('a'), {
        ctrlKey: true,
      })

      expect(mocks.openResearchLink).not.toHaveBeenCalled()
    })

  it('does not intercept an external link click with the shift key held',
    async () => {
      const wrapper = await mountSuspended(A, {
        props: { href: 'https://example.com/x' },
      })

      await clickAnchorWithoutNavigating(wrapper.get('a'), {
        shiftKey: true,
      })

      expect(mocks.openResearchLink).not.toHaveBeenCalled()
    })

  it('does not intercept an external link click with the alt key held',
    async () => {
      const wrapper = await mountSuspended(A, {
        props: { href: 'https://example.com/x' },
      })

      await clickAnchorWithoutNavigating(wrapper.get('a'), {
        altKey: true,
      })

      expect(mocks.openResearchLink).not.toHaveBeenCalled()
    })

  it('does not intercept a middle-click on an external link', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: 'https://example.com/x' },
    })

    await clickAnchorWithoutNavigating(wrapper.get('a'), { button: 1 })

    expect(mocks.openResearchLink).not.toHaveBeenCalled()
  })

  it('does not intercept a same-origin absolute URL', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: 'http://localhost:3000/foo' },
    })

    await clickAnchorWithoutNavigating(wrapper.get('a'))

    expect(mocks.openResearchLink).not.toHaveBeenCalled()
  })

  it('does not intercept a relative URL', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: '/chats/abc' },
    })

    await clickAnchorWithoutNavigating(wrapper.get('a'))

    expect(mocks.openResearchLink).not.toHaveBeenCalled()
  })

  it('does not intercept a hash link', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: '#section' },
    })

    await clickAnchorWithoutNavigating(wrapper.get('a'))

    expect(mocks.openResearchLink).not.toHaveBeenCalled()
  })

  it('does not intercept a mailto link', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: 'mailto:a@b.com' },
    })

    await clickAnchorWithoutNavigating(wrapper.get('a'))

    expect(mocks.openResearchLink).not.toHaveBeenCalled()
  })

  it('renders a real anchor whose href matches the prop', async () => {
    const wrapper = await mountSuspended(A, {
      props: { href: 'https://example.com/x' },
    })

    const link = wrapper.get('a')

    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('https://example.com/x')
  })
})
