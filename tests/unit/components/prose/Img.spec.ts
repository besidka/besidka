import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import Img from '../../../../app/components/prose/Img.vue'

const mocks = vi.hoisted(() => {
  return { openResearchLink: vi.fn() }
})

mockNuxtImport('useResearchLink', () => {
  return () => {
    return { openResearchLink: mocks.openResearchLink }
  }
})

const EXFILTRATION_URL = 'https://evil.example/p?d=secret%20chat%20text'
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgo='

const HOSTILE_ATTRIBUTES = {
  'srcset': 'https://evil.example/x 1x',
  'style': 'background:url(https://evil.example/s)',
  'onerror': 'alert(1)',
  'sizes': '100vw',
  'data-exfil': 'https://evil.example/d',
}

async function mountImg(src?: string) {
  return await mountSuspended(Img, { props: { src, alt: 'diagram' } })
}

async function mountImgWithHostileAttributes(src: string) {
  return await mountSuspended(Img, {
    props: { src, alt: 'diagram' },
    attrs: HOSTILE_ATTRIBUTES,
  })
}

describe('prose/Img.vue', () => {
  beforeEach(() => {
    mocks.openResearchLink.mockClear()
  })

  it('renders a relative file URL as an image', async () => {
    const wrapper = await mountImg('/files/a.png')
    const image = wrapper.get('[data-testid="prose-img"]')

    expect(image.element.tagName).toBe('IMG')
    expect(image.attributes('src')).toContain('/files/a.png')
    expect(wrapper.find('[data-testid="prose-img-blocked"]').exists())
      .toBe(false)
  })

  it('renders a path-relative URL as an image', async () => {
    const wrapper = await mountImg('files/a.png')

    expect(wrapper.find('[data-testid="prose-img"]').exists()).toBe(true)
  })

  it('renders a same-origin absolute URL as an image', async () => {
    const wrapper = await mountImg(
      `${window.location.origin}/files/b.png?download=0`,
    )
    const image = wrapper.get('[data-testid="prose-img"]')

    expect(image.attributes('src')).toContain('/files/b.png')
  })

  it('renders an allowed raster data URI as an image', async () => {
    const wrapper = await mountImg(PNG_DATA_URI)
    const image = wrapper.get('[data-testid="prose-img"]')

    expect(image.attributes('src')).toContain('data:image/png;base64,')
  })

  it('blocks an external image and never leaks the URL into the DOM',
    async () => {
      const wrapper = await mountImg(EXFILTRATION_URL)
      const html = wrapper.html()

      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find('[data-testid="prose-img"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="prose-img-blocked"]').exists())
        .toBe(true)
      expect(html).not.toContain('secret')
      expect(html).not.toContain('evil.example/p')
      expect(html).not.toContain('srcset')
      expect(html).not.toContain('src=')
      expect(wrapper.text()).toContain('External image blocked')
      expect(wrapper.text()).toContain('evil.example')
    })

  it('blocks an external http image', async () => {
    const wrapper = await mountImg('http://evil.example/x.png')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-testid="prose-img-blocked"]').exists())
      .toBe(true)
  })

  it('blocks a protocol-relative URL', async () => {
    const wrapper = await mountImg('//evil.example/x.png')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('x.png')
    expect(wrapper.text()).toContain('evil.example')
  })

  it('blocks a backslash host smuggling attempt', async () => {
    const wrapper = await mountImg('/\\evil.example/x.png')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('evil.example')
  })

  it('blocks a host smuggled behind tab characters', async () => {
    const wrapper = await mountImg('/\t/evil.example/x.png')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('evil.example')
  })

  it('blocks a userinfo URL that only looks same-origin', async () => {
    const wrapper = await mountImg(
      `${window.location.origin}@evil.example/x.png`,
    )

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('evil.example')
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['blob', 'blob:https://evil.example/1234'],
    ['svg data', 'data:image/svg+xml,<svg onload=alert(1)></svg>'],
    ['html data', 'data:text/html,<script>alert(1)</script>'],
    ['ftp', 'ftp://evil.example/x.png'],
    ['empty', ''],
  ])('blocks a %s source without rendering an image or a button',
    async (_label, src) => {
      const wrapper = await mountImg(src)

      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find('button').exists()).toBe(false)
      expect(wrapper.find('[data-testid="prose-img-blocked"]').exists())
        .toBe(true)
      expect(wrapper.html()).not.toContain('alert(1)')
      expect(wrapper.html()).not.toContain('src=')
      expect(wrapper.html()).not.toContain('srcset')

      await wrapper.get('[data-testid="prose-img-blocked"]').trigger('click')

      expect(mocks.openResearchLink).not.toHaveBeenCalled()
    })

  it('does not forward undeclared attributes to an allowed image',
    async () => {
      const wrapper = await mountImgWithHostileAttributes('/files/a.png')
      const image = wrapper.get('[data-testid="prose-img"]')

      expect(image.element.tagName).toBe('IMG')
      expect(image.attributes('src')).toContain('/files/a.png')
      expect(image.attributes('alt')).toBe('diagram')

      for (const attributeName of Object.keys(HOSTILE_ATTRIBUTES)) {
        if (attributeName === 'srcset') {
          continue
        }

        expect(image.attributes(attributeName)).toBeUndefined()
      }

      expect(image.attributes('srcset') ?? '').not.toContain('evil.example')
      expect(wrapper.html()).not.toContain('evil.example')
      expect(wrapper.html()).not.toContain('alert(1)')
    })

  it('does not forward undeclared attributes to the blocked button',
    async () => {
      const wrapper = await mountImgWithHostileAttributes(EXFILTRATION_URL)
      const placeholder = wrapper.get('[data-testid="prose-img-blocked"]')

      expect(placeholder.element.tagName).toBe('BUTTON')

      for (const attributeName of Object.keys(HOSTILE_ATTRIBUTES)) {
        expect(placeholder.attributes(attributeName)).toBeUndefined()
      }

      expect(wrapper.html()).not.toContain('alert(1)')
      expect(wrapper.html()).not.toContain('background:url')
    })

  it('does not forward undeclared attributes to the blocked span',
    async () => {
      const wrapper = await mountImgWithHostileAttributes(
        'javascript:alert(1)',
      )
      const placeholder = wrapper.get('[data-testid="prose-img-blocked"]')

      expect(placeholder.element.tagName).toBe('SPAN')

      for (const attributeName of Object.keys(HOSTILE_ATTRIBUTES)) {
        expect(placeholder.attributes(attributeName)).toBeUndefined()
      }

      expect(wrapper.html()).not.toContain('evil.example')
    })

  it('blocks a missing source', async () => {
    const wrapper = await mountImg(undefined)

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-testid="prose-img-blocked"]').exists())
      .toBe(true)
  })

  it('opens the confirmation flow with the full URL on click', async () => {
    const wrapper = await mountImg(EXFILTRATION_URL)

    await wrapper.get('[data-testid="prose-img-blocked"]').trigger('click')

    expect(mocks.openResearchLink).toHaveBeenCalledTimes(1)
    expect(mocks.openResearchLink).toHaveBeenCalledWith(EXFILTRATION_URL)
  })

  it('does not put the full URL in any attribute of the placeholder',
    async () => {
      const wrapper = await mountImg(EXFILTRATION_URL)
      const placeholder = wrapper.get('[data-testid="prose-img-blocked"]')

      for (const attribute of Object.values(placeholder.attributes())) {
        expect(attribute).not.toContain('secret')
        expect(attribute).not.toContain('evil.example/p')
      }
    })
})
