import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'
import type { ArtifactSharePublicView } from '#shared/utils/artifacts'
import ArtifactSharePage from '../../../../app/pages/a/index.vue'

enableAutoUnmount(afterEach)

const TOKEN = 'pageShareToken_0123456789abcdefghijklmnopqr'
const OTHER_TOKEN = 'otherShareToken_0123456789abcdefghijklmnopq'
const RETURN_STORAGE_KEY = 'artifacts:share-return'
const SHARE_HEADER = 'x-besidka-artifact-share'

const mocks = vi.hoisted(() => ({
  useFetch: vi.fn(),
  execute: vi.fn(),
  clear: vi.fn(),
  frameProps: [] as Array<Record<string, unknown>>,
  modalProps: [] as Array<Record<string, unknown>>,
}))

const loggedIn = ref<boolean>(false)
const data = ref<ArtifactSharePublicView | null>(null) as Ref<
  ArtifactSharePublicView | null
>
const error = ref<unknown>(null)
const status = ref<string>('idle')
const response = {
  data: null as ArtifactSharePublicView | null,
  error: null as unknown,
  status: 'success',
}
let replaceSpy: ReturnType<typeof vi.fn>
const mountedWrappers: Array<{ unmount: () => void }> = []

mockNuxtImport('useFetch', () => mocks.useFetch)
mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})

mockComponent('ChatArtifactFrame', () => {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      mocks.frameProps.push(attrs)

      return () => h('div', { 'data-testid': 'frame-stub' })
    },
  })
})

mockComponent('ArtifactReportModal', () => {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => {
        mocks.modalProps.push({ ...attrs })

        return h('div', {
          'data-testid': 'report-modal-stub',
          'data-open': String(attrs.open),
        })
      }
    },
  })
})

function createShare(
  overrides: Partial<ArtifactSharePublicView> = {},
): ArtifactSharePublicView {
  return {
    shareId: 'sh_1',
    artifactId: 'ArtifactPublicId1',
    title: 'Capitals quiz',
    kind: 'html',
    version: 3,
    pinned: false,
    content: '<p>Quiz</p>',
    createdAt: '2026-11-09T10:00:00.000Z',
    expiresAt: null,
    capabilities: { storageAllowed: false, bridgeAllowed: false },
    ...overrides,
  }
}

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

function setLocation(url: string) {
  window.history.replaceState(null, '', url)
}

function readFetchOptions() {
  return mocks.useFetch.mock.calls[0]![1]
}

function readSentTokens(): string[] {
  return mocks.execute.mock.results.map((result) => {
    return result.value as string
  })
}

function sendShareRequest(): string {
  data.value = response.data
  error.value = response.error
  status.value = response.status

  return readFetchOptions().headers.value[SHARE_HEADER]
}

function clearShareData() {
  data.value = null
  error.value = null
  status.value = 'idle'
}

async function changeHash(url: string) {
  setLocation(url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await flushPromises()
}

async function mountPage() {
  const wrapper = await mountSuspended(ArtifactSharePage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: defineComponent({
          props: { to: { type: [String, Object], required: true } },
          setup(props, { slots }) {
            return () => h('a', {
              'data-to': JSON.stringify(props.to),
            }, slots.default?.())
          },
        }),
      },
    },
  })

  mountedWrappers.push(wrapper)
  await flushPromises()

  return wrapper
}

function readShareReplaceCalls(): unknown[] {
  return replaceSpy.mock.calls
    .map(call => call[0])
    .filter((target) => {
      return typeof target === 'object'
    })
}

function readPageSource(): string {
  return readFileSync(
    join(process.cwd(), 'app/pages/a/index.vue'),
    'utf-8',
  )
}

describe('pages/a/index', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    setLocation(`/a#${TOKEN}`)
    window.sessionStorage.clear()
    loggedIn.value = false
    data.value = null
    error.value = null
    status.value = 'idle'
    response.data = createShare()
    response.error = null
    response.status = 'success'
    mocks.frameProps.length = 0
    mocks.modalProps.length = 0
    mocks.clear.mockReset().mockImplementation(clearShareData)
    replaceSpy = vi.spyOn(useRouter(), 'replace')
      .mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>
    mocks.useFetch.mockReset().mockImplementation(() => {
      mocks.execute.mockReset().mockImplementation(sendShareRequest)

      return {
        data,
        error,
        status,
        execute: mocks.execute,
        clear: mocks.clear,
      }
    })
  })

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      try {
        wrapper.unmount()
      } catch {
        continue
      }
    }

    replaceSpy.mockRestore()
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
    setLocation('/')
  })

  it('reads the token from the fragment and sends it only in a header',
    async () => {
      await mountPage()

      const [url, options] = mocks.useFetch.mock.calls[0]!

      expect(url).toBe('/api/v1/artifact-shares/current')
      expect(options.server).toBe(false)
      expect(options.immediate).toBe(false)
      expect(options.watch).toBe(false)
      expect(options.headers.value).toEqual({ [SHARE_HEADER]: TOKEN })
      expect(readSentTokens()).toEqual([TOKEN])
    })

  it('never puts the token in a request URL, query or cache key',
    async () => {
      await mountPage()

      const [url, options] = mocks.useFetch.mock.calls[0]!
      const { headers, ...requestOptions } = options

      expect(JSON.stringify(url)).not.toContain(TOKEN)
      expect(JSON.stringify(requestOptions)).not.toContain(TOKEN)
      expect(String(options.key)).not.toContain(TOKEN)
      expect(headers.value[SHARE_HEADER]).toBe(TOKEN)
      expect(readShareReplaceCalls()).toEqual([])
    })

  it.each([
    ['an empty fragment', '/a'],
    ['a short token', '/a#abc'],
    ['a token with other characters', `/a#${TOKEN.slice(0, 42)}!`],
    ['a token that is too long', `/a#${TOKEN}x`],
  ])('shows "not available" for %s without a request', async (_label, url) => {
    setLocation(url)

    const wrapper = await mountPage()

    expect(wrapper.get(byTestId('artifact-share-not-found')).text())
      .toContain('This link is not available')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.frameProps).toHaveLength(0)
  })

  it('refetches and remounts the frame when the fragment changes',
    async () => {
      await mountPage()

      expect(mocks.frameProps.at(-1)!['share-token']).toBe(TOKEN)

      await changeHash(`/a#${OTHER_TOKEN}`)

      expect(readSentTokens()).toEqual([TOKEN, OTHER_TOKEN])
      expect(mocks.frameProps.at(-1)!['share-token']).toBe(OTHER_TOKEN)
    })

  it('shows "not available" when the fragment changes to an invalid one',
    async () => {
      const wrapper = await mountPage()

      await changeHash('/a#nope')

      expect(wrapper.find(byTestId('artifact-share-not-found')).exists())
        .toBe(true)
      expect(wrapper.find(byTestId('frame-stub')).exists()).toBe(false)
      expect(readSentTokens()).toEqual([TOKEN])
    })

  it('stops listening for fragment changes when it unmounts', async () => {
    const wrapper = await mountPage()
    const requestCount = mocks.execute.mock.calls.length

    wrapper.unmount()
    await changeHash(`/a#${OTHER_TOKEN}`)

    expect(mocks.execute).toHaveBeenCalledTimes(requestCount)
    expect(readSentTokens()).not.toContain(OTHER_TOKEN)
  })

  it('is noindex, marked AI-generated and keeps the global canonical',
    () => {
      const source = readPageSource()

      expect(source).toMatch(/robots:\s*'noindex,\s*nofollow'/)
      expect(source).toMatch(
        /name:\s*'ai-generated',\s*content:\s*'true'/,
      )
      expect(source).toMatch(/share\.value\?\.title \|\| 'Shared artifact'/)
      expect(source).not.toMatch(/canonical/)
      expect(source).toMatch(/layout:\s*'artifact-share'/)
    })

  it('keeps the token out of the title and every head tag', async () => {
    await mountPage()

    expect(document.title).not.toContain(TOKEN)
    expect(document.head.innerHTML).not.toContain(TOKEN)
  })

  it('lifts the layout above the fixed page background', () => {
    const layout = readFileSync(
      join(process.cwd(), 'app/layouts/artifact-share.vue'),
      'utf-8',
    )

    expect(layout).toMatch(/class="relative /)
  })

  it('shows the AI banner as a labelled region with a Report button',
    async () => {
      const wrapper = await mountPage()
      const banner = wrapper.get(byTestId('artifact-share-banner'))

      expect(banner.attributes('role')).toBe('region')
      expect(banner.attributes('aria-label')).toBe('About this artifact')
      expect(banner.classes()).toEqual(expect.arrayContaining([
        'alert',
        'alert-info',
        'alert-soft',
      ]))
      expect(banner.text()).toContain(
        'AI-generated by a Besidka user, not reviewed by Besidka.',
      )
      expect(banner.text()).toContain(
        'Never enter passwords or payment details here.',
      )
      expect(wrapper.get(byTestId('artifact-share-title')).text())
        .toBe('Capitals quiz')

      const report = wrapper.get(byTestId('artifact-share-report'))

      expect(report.element.tagName).toBe('BUTTON')
      expect(report.classes()).toContain('min-h-6')
    })

  it('puts a skip link to the report button before the frame', async () => {
    const wrapper = await mountPage()
    const skip = wrapper.get(byTestId('artifact-share-skip-to-report'))
    const html = wrapper.html()

    expect(skip.classes()).toContain('sr-only')
    expect(html.indexOf('artifact-share-skip-to-report'))
      .toBeLessThan(html.indexOf('frame-stub'))

    await skip.trigger('click')

    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('artifact-share-report')
  })

  it('renders the frame in full-screen mode with the share token',
    async () => {
      response.data = createShare({
        capabilities: { storageAllowed: true, bridgeAllowed: false },
      })

      await mountPage()

      const props = mocks.frameProps.at(-1)!

      expect(props).toMatchObject({
        'source': 'public-share',
        'share-token': TOKEN,
        'artifact-id': 'ArtifactPublicId1',
        'version': 3,
        'display-mode-override': 'fullscreen',
        'share-capabilities': { storageAllowed: true, bridgeAllowed: false },
      })
      expect(props.result).toEqual({
        kind: 'html',
        title: 'Capitals quiz',
        content: '<p>Quiz</p>',
        artifactId: 'ArtifactPublicId1',
        version: 3,
      })
    })

  it('opens the report modal with the share endpoint and header',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get(byTestId('artifact-share-report')).trigger('click')

      const props = mocks.modalProps.at(-1)!

      expect(props.open).toBe(true)
      expect(props.endpoint).toBe('/api/v1/artifact-shares/current/report')
      expect(props.headers).toEqual({ [SHARE_HEADER]: TOKEN })
    })

  describe('sign-in caption', () => {
    it('signs in with next=/a and keeps the token in sessionStorage only',
      async () => {
        response.data = createShare({
          capabilities: { storageAllowed: true, bridgeAllowed: false },
        })

        const wrapper = await mountPage()
        const caption = wrapper.get(byTestId('artifact-share-sign-in'))
        const link = caption.get('a')

        expect(caption.text()).toBe('Sign in to save your progress')
        expect(JSON.parse(link.attributes('data-to')!)).toEqual({
          path: '/signin',
          query: { next: '/a' },
        })
        expect(link.attributes('data-to')).not.toContain(TOKEN)

        await link.trigger('click')

        expect(window.sessionStorage.getItem(RETURN_STORAGE_KEY))
          .toBe(TOKEN)
      })

    it('still navigates when sessionStorage throws', async () => {
      response.data = createShare({
        capabilities: { storageAllowed: true, bridgeAllowed: false },
      })

      const setItem = vi.spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('blocked')
        })
      const wrapper = await mountPage()

      await expect(
        wrapper.get(byTestId('artifact-share-sign-in')).get('a')
          .trigger('click'),
      ).resolves.toBeUndefined()

      setItem.mockRestore()
    })

    it('is hidden when the link does not save progress', async () => {
      const wrapper = await mountPage()

      expect(wrapper.find(byTestId('artifact-share-sign-in')).exists())
        .toBe(false)
    })

    it('is hidden for a signed-in viewer', async () => {
      loggedIn.value = true
      response.data = createShare({
        capabilities: { storageAllowed: true, bridgeAllowed: true },
      })

      const wrapper = await mountPage()

      expect(wrapper.find(byTestId('artifact-share-sign-in')).exists())
        .toBe(false)
    })
  })

  describe('return from sign-in', () => {
    it('restores the token once and puts it back in the fragment',
      async () => {
        setLocation('/a')
        window.sessionStorage.setItem(RETURN_STORAGE_KEY, TOKEN)

        await mountPage()

        expect(window.sessionStorage.getItem(RETURN_STORAGE_KEY)).toBeNull()
        expect(readShareReplaceCalls()).toEqual([{
          path: '/a',
          hash: `#${TOKEN}`,
        }])
        expect(readSentTokens()).toEqual([TOKEN])
      })

    it('drops an invalid stored token and shows "not available"',
      async () => {
        setLocation('/a')
        window.sessionStorage.setItem(RETURN_STORAGE_KEY, 'not-a-token')

        const wrapper = await mountPage()

        expect(window.sessionStorage.getItem(RETURN_STORAGE_KEY)).toBeNull()
        expect(readShareReplaceCalls()).toEqual([])
        expect(mocks.execute).not.toHaveBeenCalled()
        expect(wrapper.find(byTestId('artifact-share-not-found')).exists())
          .toBe(true)
      })

    it('prefers the fragment and clears a leftover stored token',
      async () => {
        window.sessionStorage.setItem(RETURN_STORAGE_KEY, OTHER_TOKEN)

        await mountPage()

        expect(window.sessionStorage.getItem(RETURN_STORAGE_KEY)).toBeNull()
        expect(readShareReplaceCalls()).toEqual([])
        expect(readSentTokens()).toEqual([TOKEN])
      })
  })

  describe('states', () => {
    it('shows a skeleton while loading', async () => {
      response.data = null
      response.status = 'pending'

      const wrapper = await mountPage()
      const loading = wrapper.get(byTestId('artifact-share-loading'))

      expect(loading.attributes('aria-busy')).toBe('true')
      expect(loading.find('.skeleton.skeleton--default').exists()).toBe(true)
      expect(mocks.frameProps).toHaveLength(0)
    })

    it('renders an unavailable link inside the page', async () => {
      response.data = null
      response.status = 'error'
      response.error = { statusCode: 404 }

      const wrapper = await mountPage()

      expect(wrapper.get(byTestId('artifact-share-not-found')).text())
        .toContain('This link is not available')
      expect(mocks.frameProps).toHaveLength(0)
    })

    it('explains a takedown with a link to the Privacy Policy', async () => {
      response.data = null
      response.status = 'error'
      response.error = { statusCode: 410, data: { data: { takenDown: true } } }

      const wrapper = await mountPage()
      const state = wrapper.get(byTestId('artifact-share-taken-down'))

      expect(state.text()).toContain('This artifact was removed after a report')
      const link = wrapper.get(byTestId('artifact-share-takedown-link'))

      expect(JSON.parse(link.attributes('data-to')!))
        .toBe('/privacy-policy#reports-and-notices-about-content')
      expect(link.text()).toBe('How reports and removals work')
    })

    it('offers Retry for any other error', async () => {
      response.data = null
      response.status = 'error'
      response.error = { statusCode: 500 }

      const wrapper = await mountPage()

      expect(wrapper.get(byTestId('artifact-share-error')).text())
        .toContain('The artifact did not load')

      await wrapper.get(byTestId('artifact-share-retry')).trigger('click')

      expect(mocks.execute).toHaveBeenCalledTimes(2)
    })
  })
})
