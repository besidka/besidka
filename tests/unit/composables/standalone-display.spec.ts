import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useStandaloneDisplay } from '../../../app/composables/standalone-display'

function stubDisplayMode(isStandalone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    return {
      matches: query === '(display-mode: standalone)' && isStandalone,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList
  })
}

async function mountProbe() {
  let result: ReturnType<typeof useStandaloneDisplay> | undefined

  await mountSuspended(defineComponent({
    setup() {
      result = useStandaloneDisplay()

      return () => h('div')
    },
  }))

  return result!
}

describe('useStandaloneDisplay', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'standalone')
  })

  it('is false in a normal browser tab', async () => {
    stubDisplayMode(false)

    const { isStandalone } = await mountProbe()

    expect(isStandalone.value).toBe(false)
  })

  it('is true when the display mode is standalone', async () => {
    stubDisplayMode(true)

    const { isStandalone } = await mountProbe()

    expect(isStandalone.value).toBe(true)
  })

  it('is true for iOS navigator.standalone', async () => {
    stubDisplayMode(false)
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    })

    const { isStandalone } = await mountProbe()

    expect(isStandalone.value).toBe(true)
  })
})
