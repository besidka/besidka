import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGRAM_COPY_MENU_ITEMS,
  DIAGRAM_DOWNLOAD_MENU_ITEMS,
  DIAGRAM_EXPORT_ACTIONS,
  IMAGE_COPY_ACTION,
  isImageClipboardSupported,
} from '@besidka/artifacts-protocol'

describe('diagram menu items', () => {
  it('only name export actions the bridge accepts', () => {
    const actions = [
      ...DIAGRAM_COPY_MENU_ITEMS,
      ...DIAGRAM_DOWNLOAD_MENU_ITEMS,
    ].map(item => item.action)

    expect([...actions].sort()).toEqual([...DIAGRAM_EXPORT_ACTIONS].sort())
  })

  it('puts the PNG copy item between SVG and draw.io', () => {
    expect(DIAGRAM_COPY_MENU_ITEMS.map(item => item.action)).toEqual([
      'copy-source',
      'copy-markdown',
      'copy-svg',
      IMAGE_COPY_ACTION,
      'copy-drawio',
    ])
  })
})

describe('isImageClipboardSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('needs ClipboardItem and clipboard.write', () => {
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { clipboard: { write: () => {} } })
    expect(isImageClipboardSupported()).toBe(false)

    vi.stubGlobal('ClipboardItem', { supports: undefined })
    vi.stubGlobal('navigator', { clipboard: {} })
    expect(isImageClipboardSupported()).toBe(false)

    vi.stubGlobal('navigator', { clipboard: { write: () => {} } })
    expect(isImageClipboardSupported()).toBe(true)
  })

  it('follows ClipboardItem.supports when the browser has it', () => {
    vi.stubGlobal('navigator', { clipboard: { write: () => {} } })
    vi.stubGlobal('ClipboardItem', { supports: () => false })
    expect(isImageClipboardSupported()).toBe(false)

    vi.stubGlobal('ClipboardItem', {
      supports: (type: string) => type === 'image/png',
    })
    expect(isImageClipboardSupported()).toBe(true)
  })
})
