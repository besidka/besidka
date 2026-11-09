import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_DOCK_MIN_VIEWPORT,
  SIDE_PANEL_MIN_CHAT_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_WIDTH_STORAGE_KEY,
  clampSidePanelWidth,
  getNextSidePanelWidthPreset,
  getSidePanelMaxWidth,
  useSidePanel,
  useSidePanelLayout,
} from '../../../app/composables/side-panel'
import type { SidePanelView } from '../../../app/composables/side-panel'

function createStorageShim(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    clear: () => {
      entries.clear()
    },
  } as Storage
}

function createView(viewKey: string): SidePanelView {
  return { viewKey, title: `Title ${viewKey}` }
}

function resetSidePanelState() {
  const { close } = useSidePanel()

  close()
  useState<number | null>('side-panel:preferred-width').value = null
  usePreferenceStorage().removeItem(SIDE_PANEL_WIDTH_STORAGE_KEY)
}

function stubViewport(innerWidth: number) {
  vi.stubGlobal('innerWidth', innerWidth)
  window.innerWidth = innerWidth
}

describe('side-panel width helpers', () => {
  describe('getSidePanelMaxWidth', () => {
    it('uses 60 percent of the viewport on very wide screens', () => {
      expect(getSidePanelMaxWidth(3000)).toBe(1800)
    })

    it('keeps 768px for the chat when 60 percent would eat into it', () => {
      expect(getSidePanelMaxWidth(1440)).toBe(672)
      expect(getSidePanelMaxWidth(1280)).toBe(512)
    })

    it('reaches the minimum width exactly where docking starts', () => {
      expect(getSidePanelMaxWidth(SIDE_PANEL_DOCK_MIN_VIEWPORT))
        .toBe(SIDE_PANEL_MIN_WIDTH)
      expect(SIDE_PANEL_DOCK_MIN_VIEWPORT).toBe(1128)
    })

    it('never drops below the minimum width', () => {
      expect(getSidePanelMaxWidth(900)).toBe(SIDE_PANEL_MIN_WIDTH)
      expect(getSidePanelMaxWidth(300)).toBe(SIDE_PANEL_MIN_WIDTH)
    })
  })

  describe('clampSidePanelWidth', () => {
    it('raises a width below the minimum to 360', () => {
      expect(clampSidePanelWidth(100, 1440)).toBe(360)
    })

    it('lowers a width above the maximum to the viewport limit', () => {
      expect(clampSidePanelWidth(2000, 1440)).toBe(672)
      expect(clampSidePanelWidth(2000, 1280)).toBe(512)
    })

    it('keeps a width inside the range and rounds it', () => {
      expect(clampSidePanelWidth(500, 1440)).toBe(500)
      expect(clampSidePanelWidth(500.6, 1440)).toBe(501)
    })

    it('replaces a non-finite width with the clamped default', () => {
      expect(clampSidePanelWidth(Number.NaN, 1440))
        .toBe(SIDE_PANEL_DEFAULT_WIDTH)
      expect(clampSidePanelWidth(Number.POSITIVE_INFINITY, 1440))
        .toBe(SIDE_PANEL_DEFAULT_WIDTH)
      expect(clampSidePanelWidth(Number.NEGATIVE_INFINITY, 1440))
        .toBe(SIDE_PANEL_DEFAULT_WIDTH)
    })

    it('clamps the default itself on a narrow viewport', () => {
      expect(clampSidePanelWidth(Number.NaN, 700)).toBe(SIDE_PANEL_MIN_WIDTH)
    })
  })

  describe('getNextSidePanelWidthPreset', () => {
    it('cycles 360, 480, 640 and back to 360 at 1440', () => {
      expect(getNextSidePanelWidthPreset(360, 1440)).toBe(480)
      expect(getNextSidePanelWidthPreset(480, 1440)).toBe(640)
      expect(getNextSidePanelWidthPreset(640, 1440)).toBe(360)
    })

    it('moves to the next preset above an off-preset width', () => {
      expect(getNextSidePanelWidthPreset(500, 1440)).toBe(640)
      expect(getNextSidePanelWidthPreset(700, 1440)).toBe(360)
      expect(getNextSidePanelWidthPreset(100, 1440)).toBe(360)
    })

    it('dedupes presets that clamp to the same width on small viewports', () => {
      expect(getSidePanelMaxWidth(1280)).toBe(512)
      expect(getNextSidePanelWidthPreset(360, 1280)).toBe(480)
      expect(getNextSidePanelWidthPreset(480, 1280)).toBe(512)
      expect(getNextSidePanelWidthPreset(512, 1280)).toBe(360)

      expect(getNextSidePanelWidthPreset(360, 1200)).toBe(432)
      expect(getNextSidePanelWidthPreset(432, 1200)).toBe(360)
    })

    it('collapses to a single preset when the viewport only fits the minimum', () => {
      expect(getNextSidePanelWidthPreset(360, 900)).toBe(360)
      expect(getNextSidePanelWidthPreset(500, 900)).toBe(360)
    })
  })
})

describe('useSidePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageShim())
    stubViewport(1440)
    resetSidePanelState()
  })

  afterEach(() => {
    resetSidePanelState()
    vi.unstubAllGlobals()
  })

  describe('view stack', () => {
    it('starts closed with no view', () => {
      const panel = useSidePanel()

      expect(panel.isOpen.value).toBe(false)
      expect(panel.currentView.value).toBeNull()
      expect(panel.mode.value).toBeNull()
      expect(panel.title.value).toBe('')
      expect(panel.viewKey.value).toBeNull()
      expect(panel.canGoBack.value).toBe(false)
    })

    it('open replaces the stack with one view', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.push(createView('second'))
      panel.open(createView('third'))

      expect(panel.stack.value.map(view => view.viewKey)).toEqual(['third'])
      expect(panel.isOpen.value).toBe(true)
      expect(panel.canGoBack.value).toBe(false)
    })

    it('exposes the top view, defaulting the mode to detail', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))

      expect(panel.viewKey.value).toBe('first')
      expect(panel.title.value).toBe('Title first')
      expect(panel.mode.value).toBe('detail')

      panel.push({ ...createView('second'), mode: 'context' })

      expect(panel.mode.value).toBe('context')
    })

    it('push appends a view and enables going back', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.push(createView('second'))

      expect(panel.stack.value.map(view => view.viewKey))
        .toEqual(['first', 'second'])
      expect(panel.viewKey.value).toBe('second')
      expect(panel.canGoBack.value).toBe(true)
    })

    it('push of the current view key replaces it instead of stacking', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.push({ ...createView('first'), title: 'Updated' })

      expect(panel.stack.value).toHaveLength(1)
      expect(panel.title.value).toBe('Updated')
      expect(panel.canGoBack.value).toBe(false)
    })

    it('push on a closed panel opens it', () => {
      const panel = useSidePanel()

      panel.push(createView('first'))

      expect(panel.isOpen.value).toBe(true)
      expect(panel.viewKey.value).toBe('first')
    })

    it('back pops the top view', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.push(createView('second'))
      panel.back()

      expect(panel.viewKey.value).toBe('first')
      expect(panel.isOpen.value).toBe(true)
    })

    it('back on the last view closes the panel', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.back()

      expect(panel.isOpen.value).toBe(false)
      expect(panel.stack.value).toEqual([])
    })

    it('back on a closed panel stays closed', () => {
      const panel = useSidePanel()

      panel.back()

      expect(panel.isOpen.value).toBe(false)
    })

    it('close clears every view', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.push(createView('second'))
      panel.close()

      expect(panel.stack.value).toEqual([])
      expect(panel.currentView.value).toBeNull()
    })

    it('toggle opens a view, then closes it when it is already current', () => {
      const panel = useSidePanel()

      panel.toggle(createView('first'))

      expect(panel.viewKey.value).toBe('first')

      panel.toggle(createView('first'))

      expect(panel.isOpen.value).toBe(false)
    })

    it('toggle with another view key switches to it', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.push(createView('second'))
      panel.toggle(createView('third'))

      expect(panel.stack.value.map(view => view.viewKey)).toEqual(['third'])
    })

    it('keeps component references non-reactive', () => {
      const panel = useSidePanel()
      const component = { render: () => null }

      panel.open({ ...createView('first'), component })

      expect(isReactive(panel.currentView.value?.component)).toBe(false)
    })

    it('shares one stack between callers', () => {
      useSidePanel().open(createView('shared'))

      expect(useSidePanel().viewKey.value).toBe('shared')
    })
  })

  describe('full width', () => {
    it('toggleFullWidth flips the flag', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))

      expect(panel.isFullWidth.value).toBe(false)

      panel.toggleFullWidth()

      expect(panel.isFullWidth.value).toBe(true)

      panel.toggleFullWidth()

      expect(panel.isFullWidth.value).toBe(false)
    })

    it('close resets full width', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.toggleFullWidth()
      panel.close()

      expect(panel.isFullWidth.value).toBe(false)
    })

    it('back on the last view resets full width through close', () => {
      const panel = useSidePanel()

      panel.open(createView('first'))
      panel.toggleFullWidth()
      panel.back()

      expect(panel.isFullWidth.value).toBe(false)
    })

    it('toggle off resets full width', () => {
      const panel = useSidePanel()

      panel.toggle(createView('first'))
      panel.toggleFullWidth()
      panel.toggle(createView('first'))

      expect(panel.isFullWidth.value).toBe(false)
    })
  })

  describe('width', () => {
    it('defaults to 480 when nothing is stored', () => {
      expect(useSidePanel().width.value).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    })

    it('reads the width from preference storage', () => {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, '612')

      expect(useSidePanel().width.value).toBe(612)
    })

    it('falls back to the default for an unparsable stored width', () => {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, 'wide')

      expect(useSidePanel().width.value).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    })

    it('uses the storage key besidka:side-panel-width', () => {
      expect(SIDE_PANEL_WIDTH_STORAGE_KEY).toBe('besidka:side-panel-width')
    })

    it('setWidth clamps, remembers the value and does not persist it', () => {
      const panel = useSidePanel()
      const clamped = panel.setWidth(5000)

      expect(clamped).toBe(672)
      expect(panel.width.value).toBe(672)
      expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
        .toBeNull()
    })

    it('setWidth with persist writes the clamped value to storage', () => {
      const panel = useSidePanel()

      panel.setWidth(555, { persist: true })

      expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
        .toBe('555')
    })

    it('setWidth clamps against the current viewport', () => {
      stubViewport(1280)

      const panel = useSidePanel()

      expect(panel.setWidth(900, { persist: true })).toBe(512)
      expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
        .toBe('512')
    })

    it('persistWidth writes the current width', () => {
      const panel = useSidePanel()

      panel.setWidth(420)
      panel.persistWidth()

      expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
        .toBe('420')
    })

    it('prefers the in-session width over the stored one', () => {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, '612')

      const panel = useSidePanel()

      panel.setWidth(400)

      expect(panel.width.value).toBe(400)
    })

    it('does not throw when the storage rejects writes', () => {
      vi.stubGlobal('localStorage', {
        ...createStorageShim(),
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      })

      const panel = useSidePanel()

      expect(() => panel.setWidth(555, { persist: true })).not.toThrow()
      expect(panel.width.value).toBe(555)
    })

    it('keeps the default width when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined)

      const panel = useSidePanel()

      expect(panel.width.value).toBe(SIDE_PANEL_DEFAULT_WIDTH)
      expect(() => panel.setWidth(555, { persist: true })).not.toThrow()
      expect(panel.width.value).toBe(555)
    })

    it('keeps the default width when touching localStorage throws', () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        window,
        'localStorage',
      )

      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => {
          throw new Error('SecurityError')
        },
      })

      try {
        const panel = useSidePanel()

        expect(() => panel.width.value).not.toThrow()
        expect(panel.width.value).toBe(SIDE_PANEL_DEFAULT_WIDTH)
        expect(() => panel.setWidth(555, { persist: true })).not.toThrow()
        expect(panel.width.value).toBe(555)
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(window, 'localStorage', originalDescriptor)
        } else {
          Reflect.deleteProperty(window, 'localStorage')
        }
      }
    })
  })
})

describe('useSidePanelLayout', () => {
  let viewportWidth = 1440
  const changeListeners = new Set<() => void>()

  function matchesQuery(query: string): boolean {
    const [, amount, unit] = /min-width:\s*([\d.]+)(rem|px)/.exec(query) ?? []
    const minWidth = Number(amount) * (unit === 'rem' ? 16 : 1)

    return viewportWidth >= minWidth
  }

  function stubMatchMedia() {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const listenersByHandler = new Map<() => void, () => void>()

      return {
        matches: matchesQuery(query),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (
          _type: string,
          listener: (event: { matches: boolean }) => void,
        ) => {
          const notify = () => {
            listener({ matches: matchesQuery(query) })
          }

          listenersByHandler.set(listener as () => void, notify)
          changeListeners.add(notify)
        },
        removeEventListener: (
          _type: string,
          listener: (event: { matches: boolean }) => void,
        ) => {
          const notify = listenersByHandler.get(listener as () => void)

          if (notify) {
            changeListeners.delete(notify)
          }
        },
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList
    })
  }

  function resizeViewport(nextWidth: number) {
    viewportWidth = nextWidth
    changeListeners.forEach(listener => listener())
  }

  beforeEach(() => {
    viewportWidth = 1440
    changeListeners.clear()
    stubMatchMedia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('docks at 1128px and wider', () => {
    viewportWidth = 1128

    expect(useSidePanelLayout().value).toBe('docked')

    viewportWidth = 1280

    expect(useSidePanelLayout().value).toBe('docked')
  })

  it('overlays between 48rem and 1128px', () => {
    viewportWidth = 1127

    expect(useSidePanelLayout().value).toBe('overlay')

    viewportWidth = 1024

    expect(useSidePanelLayout().value).toBe('overlay')

    viewportWidth = 768

    expect(useSidePanelLayout().value).toBe('overlay')
  })

  it('docks exactly when the chat keeps 768px beside the clamped panel',
    () => {
      const savedWidths = [0, 360, 480, 640, 864, 2000]

      for (let width = 768; width <= 1700; width += 7) {
        viewportWidth = width

        const isDocked = useSidePanelLayout().value === 'docked'

        for (const savedWidth of savedWidths) {
          const chatWidth = width - clampSidePanelWidth(savedWidth, width)

          expect(isDocked).toBe(chatWidth >= SIDE_PANEL_MIN_CHAT_WIDTH)
        }
      }
    })

  it('uses a sheet below 48rem', () => {
    viewportWidth = 767

    expect(useSidePanelLayout().value).toBe('sheet')
  })

  it('follows viewport changes', async () => {
    const layout = useSidePanelLayout()

    expect(layout.value).toBe('docked')

    resizeViewport(900)
    await nextTick()

    expect(layout.value).toBe('overlay')

    resizeViewport(400)
    await nextTick()

    expect(layout.value).toBe('sheet')

    resizeViewport(1280)
    await nextTick()

    expect(layout.value).toBe('docked')

    resizeViewport(1127)
    await nextTick()

    expect(layout.value).toBe('overlay')

    resizeViewport(1128)
    await nextTick()

    expect(layout.value).toBe('docked')
  })
})
