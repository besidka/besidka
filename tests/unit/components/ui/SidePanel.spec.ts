import type { Component } from 'vue'
import { computed, defineComponent, h } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UiSidePanel from '../../../../app/components/ui/SidePanel.client.vue'
import {
  SIDE_PANEL_WIDTH_STORAGE_KEY,
  useSidePanel,
} from '../../../../app/composables/side-panel'
import type { SidePanelView } from '../../../../app/composables/side-panel'

const pillState = vi.hoisted(() => ({
  isPinned: { value: false },
  isDesktop: { value: true },
}))

mockNuxtImport('useUserSetting', () => {
  return () => ({
    sidebarPinned: computed(() => pillState.isPinned.value),
  })
})

mockNuxtImport('useDevice', () => {
  return () => ({
    isDesktop: pillState.isDesktop.value,
  })
})

enableAutoUnmount(afterEach)

const SEPARATOR = '[data-testid="side-panel-separator"]'
const PANEL = '[data-testid="side-panel"]'
const SCRIM = '[data-testid="side-panel-scrim"]'
const SHEET = '[data-testid="side-panel-sheet"]'
const SWIPE_AREA = '[data-testid="side-panel-swipe-area"]'
const WIDTH_PRESET = '[data-testid="side-panel-width-preset"]'
const FULL_WIDTH = '[data-testid="side-panel-full-width"]'
const CLOSE = '[data-testid="side-panel-close"]'
const BACK = '[data-testid="side-panel-back"]'

const DesktopBody = defineComponent({
  render: () => h('p', 'Body'),
})

const FieldBody = defineComponent({
  render: () => h('input', { 'type': 'text', 'data-testid': 'body-input' }),
})

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

function stubViewport(innerWidth: number) {
  window.innerWidth = innerWidth

  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const [, amount, unit] = /min-width:\s*([\d.]+)(rem|px)/.exec(query) ?? []
    const minWidth = Number(amount) * (unit === 'rem' ? 16 : 1)

    return {
      matches: innerWidth >= minWidth,
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

function createView(component: Component = DesktopBody): SidePanelView {
  return {
    viewKey: 'test-view',
    title: 'Test panel',
    component,
  }
}

function mountPanel() {
  return mountSuspended(UiSidePanel, { attachTo: document.body })
}

async function openPanel(component?: Component) {
  useSidePanel().open(createView(component))
  await flushPromises()
}

function pressEscape() {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })

  document.dispatchEvent(event)

  return flushPromises()
}

function readRootInset(): string {
  return document.documentElement.style.getPropertyValue('--side-panel-width')
}

function dispatchPointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientY: number,
) {
  element.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientY,
  }))
}

function resetSidePanelState() {
  const { close } = useSidePanel()

  close()
  useState<number | null>('side-panel:preferred-width').value = null
  usePreferenceStorage().removeItem(SIDE_PANEL_WIDTH_STORAGE_KEY)
}

describe('ui/SidePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageShim())
    resetSidePanelState()
    stubViewport(1440)
  })

  afterEach(() => {
    pillState.isPinned.value = false
    pillState.isDesktop.value = true
    resetSidePanelState()
    document.querySelectorAll('dialog[data-test-extra]').forEach((dialog) => {
      dialog.remove()
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('closed', () => {
    it('renders nothing while no view is open', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.find(PANEL).exists()).toBe(false)
      expect(wrapper.find(SCRIM).exists()).toBe(false)
    })

    it('publishes a zero inset on the document root', async () => {
      await mountPanel()

      expect(readRootInset()).toBe('0px')
    })
  })

  describe('docked layout', () => {
    it('renders an aside with the view title and body', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const panel = wrapper.get(PANEL)

      expect(panel.element.tagName).toBe('ASIDE')
      expect(panel.attributes('data-layout')).toBe('docked')
      expect(panel.attributes('aria-label')).toBe('Test panel')
      expect(wrapper.get('[data-testid="side-panel-title"]').text())
        .toBe('Test panel')
      expect(wrapper.get('[data-testid="side-panel-body"]').text())
        .toBe('Body')
    })

    it('sizes the aside to the stored width', async () => {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, '560')

      const wrapper = await mountPanel()

      await openPanel()

      expect(wrapper.get(PANEL).attributes('style')).toContain('width: 560px')
    })

    it('exposes the seam as a vertical separator with value limits', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const separator = wrapper.get(SEPARATOR)

      expect(separator.attributes('role')).toBe('separator')
      expect(separator.attributes('aria-orientation')).toBe('vertical')
      expect(separator.attributes('aria-label')).toBe('Resize panel')
      expect(separator.attributes('tabindex')).toBe('0')
      expect(separator.attributes('aria-valuenow')).toBe('480')
      expect(separator.attributes('aria-valuemin')).toBe('360')
      expect(separator.attributes('aria-valuemax')).toBe('672')
      expect(separator.attributes('aria-controls'))
        .toBe(wrapper.get(PANEL).attributes('id'))
    })

    it('publishes the panel width on the document root while open', async () => {
      await mountPanel()

      await openPanel()

      expect(readRootInset()).toBe('480px')

      useSidePanel().close()
      await flushPromises()

      expect(readRootInset()).toBe('0px')
    })

    it('removes the root inset when the panel unmounts', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      expect(readRootInset()).toBe('480px')

      wrapper.unmount()

      expect(readRootInset()).toBe('')
    })

    it('moves focus into the panel on open and back to the opener on close', async () => {
      const opener = document.createElement('button')

      document.body.append(opener)
      opener.focus()

      const wrapper = await mountPanel()

      await openPanel()

      expect(document.activeElement).toBe(wrapper.get(PANEL).element)

      useSidePanel().close()
      await flushPromises()

      expect(document.activeElement).toBe(opener)

      opener.remove()
    })

    it('leaves focus where it is when the view asks to preserve it',
      async () => {
        const composer = document.createElement('textarea')

        document.body.append(composer)
        composer.focus()

        const wrapper = await mountPanel()

        useSidePanel().open({ ...createView(), preserveFocus: true })
        await flushPromises()

        expect(wrapper.find(PANEL).exists()).toBe(true)
        expect(document.activeElement).toBe(composer)

        composer.remove()
      })

    it('shows back only when the stack has more than one view', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      expect(wrapper.find(BACK).exists()).toBe(false)

      useSidePanel().push({ viewKey: 'second', title: 'Second' })
      await flushPromises()

      expect(wrapper.find(BACK).exists()).toBe(true)

      await wrapper.get(BACK).trigger('click')

      expect(useSidePanel().viewKey.value).toBe('test-view')
    })

    it('closes from the close button', async () => {
      const wrapper = await mountPanel()

      await openPanel()
      await wrapper.get(CLOSE).trigger('click')

      expect(useSidePanel().isOpen.value).toBe(false)
      expect(wrapper.find(PANEL).exists()).toBe(false)
    })

    it('has no scrim', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      expect(wrapper.find(SCRIM).exists()).toBe(false)
    })

    describe('keyboard resize', () => {
      it('ArrowLeft widens by 24px and updates aria-valuenow and the root inset', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowLeft' })

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('504')
        expect(readRootInset()).toBe('504px')
        expect(wrapper.get(PANEL).attributes('style'))
          .toContain('width: 504px')
      })

      it('ArrowRight narrows by 24px', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowRight' })
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowRight' })

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('432')
        expect(readRootInset()).toBe('432px')
      })

      it('Home jumps to the minimum and End to the viewport maximum', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'Home' })

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('360')

        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'End' })

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('672')
      })

      it('stops at the limits', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'End' })
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowLeft' })

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('672')

        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'Home' })
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowRight' })

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('360')
      })

      it('persists the width and prevents the default key action', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        const event = new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        })

        wrapper.get(SEPARATOR).element.dispatchEvent(event)
        await flushPromises()

        expect(event.defaultPrevented).toBe(true)
        expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
          .toBe('504')
      })

      it('keeps a wider stored width when a key press changes nothing', async () => {
        stubViewport(1300)
        window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, '640')

        const wrapper = await mountPanel()

        await openPanel()

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('532')

        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowLeft' })
        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'End' })

        expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
          .toBe('640')

        await wrapper.get(SEPARATOR).trigger('keydown', { key: 'ArrowRight' })

        expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
          .toBe('508')
      })

      it('keeps a wider stored width when a drag ends where it began', async () => {
        stubViewport(1300)
        window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, '640')
        HTMLElement.prototype.setPointerCapture = () => {}
        HTMLElement.prototype.hasPointerCapture = () => false
        HTMLElement.prototype.releasePointerCapture = () => {}

        const wrapper = await mountPanel()

        await openPanel()

        const seam = wrapper.get(SEPARATOR).element
        const startClientX = 1300 - 532

        function dispatchSeamPointer(type: string, clientX: number) {
          seam.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX,
          }))
        }

        dispatchSeamPointer('pointerdown', startClientX)
        dispatchSeamPointer('pointermove', startClientX - 40)
        dispatchSeamPointer('pointerup', startClientX)
        await flushPromises()

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('532')
        expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
          .toBe('640')
        expect(useSidePanel().width.value).toBe(640)
      })

      it('ignores unrelated keys', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        const event = new KeyboardEvent('keydown', {
          key: 'a',
          bubbles: true,
          cancelable: true,
        })

        wrapper.get(SEPARATOR).element.dispatchEvent(event)
        await flushPromises()

        expect(event.defaultPrevented).toBe(false)
        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('480')
        expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
          .toBeNull()
      })
    })

    describe('width preset button', () => {
      it('cycles 480, 640, 360 and persists each step', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        await wrapper.get(WIDTH_PRESET).trigger('click')

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('640')
        expect(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY))
          .toBe('640')

        await wrapper.get(WIDTH_PRESET).trigger('click')

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('360')

        await wrapper.get(WIDTH_PRESET).trigger('click')

        expect(wrapper.get(SEPARATOR).attributes('aria-valuenow'))
          .toBe('480')
        expect(readRootInset()).toBe('480px')
      })

      it('describes the current width in its label', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        expect(wrapper.get(WIDTH_PRESET).attributes('aria-label'))
          .toBe('Panel width 480px, click to change')
      })
    })

    describe('escape', () => {
      it('closes the panel', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await pressEscape()

        expect(useSidePanel().isOpen.value).toBe(false)
        expect(wrapper.find(PANEL).exists()).toBe(false)
      })

      it('does nothing while the panel is closed', async () => {
        await mountPanel()

        await pressEscape()

        expect(useSidePanel().isOpen.value).toBe(false)
      })

      it('is ignored when another dialog is open', async () => {
        await mountPanel()
        await openPanel()

        const otherDialog = document.createElement('dialog')

        otherDialog.setAttribute('open', '')
        otherDialog.setAttribute('data-test-extra', '')
        document.body.append(otherDialog)

        await pressEscape()

        expect(useSidePanel().isOpen.value).toBe(true)

        otherDialog.remove()
        await pressEscape()

        expect(useSidePanel().isOpen.value).toBe(false)
      })

      it('is ignored when the event was already handled', async () => {
        await mountPanel()
        await openPanel()

        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })

        event.preventDefault()
        document.dispatchEvent(event)
        await flushPromises()

        expect(useSidePanel().isOpen.value).toBe(true)
      })
    })

    describe('full width', () => {
      it('is not a dialog and has no focus trap until expanded', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        const panel = wrapper.get(PANEL)

        expect(panel.attributes('role')).toBeUndefined()
        expect(panel.attributes('aria-modal')).toBeUndefined()
        expect(panel.attributes('data-full-width')).toBeUndefined()
      })

      it('becomes a modal dialog without the seam or preset button', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')

        const panel = wrapper.get(PANEL)

        expect(panel.attributes('role')).toBe('dialog')
        expect(panel.attributes('aria-modal')).toBe('true')
        expect(panel.attributes('data-full-width')).toBe('true')
        expect(panel.attributes('style') ?? '').not.toContain('width')
        expect(wrapper.find(SEPARATOR).exists()).toBe(false)
        expect(wrapper.find(WIDTH_PRESET).exists()).toBe(false)
      })

      it('gives the content the full width while the pill only peeks',
        async () => {
          const wrapper = await mountPanel()

          await openPanel()
          await wrapper.get(FULL_WIDTH).trigger('click')

          const classes = wrapper.get(PANEL).classes()

          expect(classes).toContain('left-0')
          expect(classes).not.toContain('pr-20')
        })

      it('reserves the pill gutter while the sidebar is pinned', async () => {
        pillState.isPinned.value = true

        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')

        expect(wrapper.get(PANEL).classes()).toContain('pr-20')
      })

      it('reserves the pill gutter on a device without hover', async () => {
        pillState.isDesktop.value = false

        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')

        expect(wrapper.get(PANEL).classes()).toContain('pr-20')
      })

      it('keeps the docked inset so the chat behind does not reflow', async () => {
        await mountPanel()
        await openPanel()
        useSidePanel().toggleFullWidth()
        await flushPromises()

        expect(readRootInset()).toBe('480px')
      })

      it('labels the full width toggle for its current state', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        expect(wrapper.get(FULL_WIDTH).attributes('aria-label'))
          .toBe('Expand panel')

        await wrapper.get(FULL_WIDTH).trigger('click')

        expect(wrapper.get(FULL_WIDTH).attributes('aria-label'))
          .toBe('Collapse panel')
      })

      it('escape collapses first, then closes', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')

        expect(useSidePanel().isFullWidth.value).toBe(true)

        await pressEscape()

        expect(useSidePanel().isOpen.value).toBe(true)
        expect(useSidePanel().isFullWidth.value).toBe(false)
        expect(wrapper.get(PANEL).attributes('role')).toBeUndefined()
        expect(wrapper.find(SEPARATOR).exists()).toBe(true)

        await pressEscape()

        expect(useSidePanel().isOpen.value).toBe(false)
      })

      it('wraps Tab from the last control to the first', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')

        const firstControl = wrapper.get(FULL_WIDTH).element
        const lastControl = wrapper.get(CLOSE).element

        lastControl.focus()

        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        })

        lastControl.dispatchEvent(event)

        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(firstControl)
      })

      it('wraps Shift+Tab from the first control to the last', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')

        const firstControl = wrapper.get(FULL_WIDTH).element
        const lastControl = wrapper.get(CLOSE).element

        firstControl.focus()

        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })

        firstControl.dispatchEvent(event)

        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(lastControl)
      })

      it('does not trap Tab while docked at normal width', async () => {
        const wrapper = await mountPanel()

        await openPanel()

        const lastControl = wrapper.get(CLOSE).element

        lastControl.focus()

        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        })

        lastControl.dispatchEvent(event)

        expect(event.defaultPrevented).toBe(false)
      })

      it('resets when the panel closes', async () => {
        const wrapper = await mountPanel()

        await openPanel()
        await wrapper.get(FULL_WIDTH).trigger('click')
        await wrapper.get(CLOSE).trigger('click')
        await openPanel()

        expect(wrapper.get(PANEL).attributes('role')).toBeUndefined()
        expect(wrapper.find(SEPARATOR).exists()).toBe(true)
      })
    })
  })

  describe('collapsing while a message menu is open', () => {
    function selectMessage(messageId: string | null) {
      return useNuxtApp().callHook('chat:message-selected', messageId)
    }

    async function settleExpand() {
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
      await flushPromises()
    }

    it('hides the docked panel, zeroes the inset and keeps the mounted '
      + 'body', async () => {
      const wrapper = await mountPanel()

      await openPanel(FieldBody)

      const body = wrapper.get('[data-testid="body-input"]').element

      expect(readRootInset()).toBe('480px')

      await selectMessage('message-1')
      await flushPromises()

      const panel = wrapper.get(PANEL)

      expect(panel.attributes('data-collapsed')).toBe('true')
      expect(panel.classes()).toContain('side-panel-collapsed')
      expect(panel.attributes('inert')).toBeDefined()
      expect(readRootInset()).toBe('0px')
      expect(useSidePanel().isOpen.value).toBe(true)
      expect(wrapper.get('[data-testid="body-input"]').element).toBe(body)
    })

    it('brings back the same panel and width when the menu closes',
      async () => {
        const wrapper = await mountPanel()

        await openPanel(FieldBody)

        const body = wrapper.get('[data-testid="body-input"]').element

        await selectMessage('message-1')
        await flushPromises()
        await selectMessage(null)
        await settleExpand()

        const panel = wrapper.get(PANEL)

        expect(panel.attributes('data-collapsed')).toBeUndefined()
        expect(panel.attributes('inert')).toBeUndefined()
        expect(readRootInset()).toBe('480px')
        expect(wrapper.get('[data-testid="body-input"]').element).toBe(body)
      })

    it('ignores the Escape that closes the menu', async () => {
      const closeMenuOnEscape = () => {
        selectMessage(null)
      }

      stubViewport(900)
      document.addEventListener('keydown', closeMenuOnEscape, { once: true })
      await mountPanel()
      await openPanel()
      await selectMessage('message-1')
      await flushPromises()
      await pressEscape()
      await settleExpand()

      expect(useSidePanel().isOpen.value).toBe(true)
    })

    it('keeps the timer from expanding a re-selected message', async () => {
      const wrapper = await mountPanel()

      await openPanel()
      await selectMessage('message-1')
      await selectMessage(null)
      await selectMessage('message-2')
      await settleExpand()

      expect(wrapper.get(PANEL).attributes('data-collapsed')).toBe('true')
      expect(useSidePanel().isCollapsed.value).toBe(true)
    })

    it('releases the focus trap while the overlay is collapsed', async () => {
      stubViewport(900)

      const content = document.createElement('div')

      content.className = 'side-panel-inset'
      document.body.appendChild(content)
      await mountPanel()
      await openPanel()

      expect(content.inert).toBe(true)

      await selectMessage('message-1')
      await flushPromises()

      expect(content.inert).toBe(false)

      await selectMessage(null)
      await settleExpand()

      expect(content.inert).toBe(true)
      content.remove()
    })
  })

  describe('overlay layout', () => {
    beforeEach(() => {
      stubViewport(900)
    })

    it('renders a modal aside without a seam, with the root inset at zero', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const panel = wrapper.get(PANEL)

      expect(panel.attributes('data-layout')).toBe('overlay')
      expect(panel.attributes('role')).toBe('dialog')
      expect(panel.attributes('aria-modal')).toBe('true')
      expect(wrapper.find(SEPARATOR).exists()).toBe(false)
      expect(wrapper.find(WIDTH_PRESET).exists()).toBe(false)
      expect(wrapper.find(FULL_WIDTH).exists()).toBe(false)
      expect(readRootInset()).toBe('0px')
    })

    it('keeps the 70vw width below lg', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const panel = wrapper.get(PANEL)

      expect(panel.classes()).toContain('w-[70vw]')
      expect(panel.attributes('style') ?? '').not.toContain('width')
    })

    it('opens as an overlay with the saved width above lg when docking '
      + 'would leave less than 768px for the chat', async () => {
      stubViewport(1440)
      useSidePanel().setWidth(480)
      stubViewport(1100)

      const wrapper = await mountPanel()

      await openPanel()

      const panel = wrapper.get(PANEL)

      expect(panel.attributes('data-layout')).toBe('overlay')
      expect(panel.classes()).not.toContain('w-[70vw]')
      expect(panel.attributes('style')).toContain('width: 480px')
      expect(wrapper.find(SCRIM).exists()).toBe(true)
      expect(wrapper.find(SEPARATOR).exists()).toBe(false)
      expect(readRootInset()).toBe('0px')
    })

    it('docks again from 1128px and publishes the inset', async () => {
      stubViewport(1128)

      const wrapper = await mountPanel()

      await openPanel()

      expect(wrapper.get(PANEL).attributes('data-layout')).toBe('docked')
      expect(wrapper.find(SCRIM).exists()).toBe(false)
      expect(readRootInset()).toBe('360px')
    })

    it('renders a scrim that closes the panel when clicked', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const scrim = wrapper.get(SCRIM)

      expect(scrim.attributes('aria-hidden')).toBe('true')

      await scrim.trigger('click')

      expect(useSidePanel().isOpen.value).toBe(false)
      expect(wrapper.find(SCRIM).exists()).toBe(false)
      expect(wrapper.find(PANEL).exists()).toBe(false)
    })

    it('has no scrim while closed', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.find(SCRIM).exists()).toBe(false)
    })

    it('closes on escape', async () => {
      await mountPanel()
      await openPanel()
      await pressEscape()

      expect(useSidePanel().isOpen.value).toBe(false)
    })

    it('traps Tab inside the panel', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const lastControl = wrapper.get(CLOSE).element

      lastControl.focus()

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      })

      lastControl.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(lastControl)
    })
  })

  describe('sheet layout', () => {
    let showModal: ReturnType<typeof vi.spyOn>
    let closeDialog: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      stubViewport(600)

      showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
        .mockImplementation(function (this: HTMLDialogElement) {
          this.setAttribute('open', '')
          this.querySelector<HTMLElement>('input')?.focus()
        })
      closeDialog = vi.spyOn(HTMLDialogElement.prototype, 'close')
        .mockImplementation(function (this: HTMLDialogElement) {
          this.removeAttribute('open')
        })

      if (!HTMLElement.prototype.setPointerCapture) {
        HTMLElement.prototype.setPointerCapture = () => {}
      }
    })

    it('renders a bottom-sheet dialog instead of an aside', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const sheet = wrapper.get(SHEET)

      expect(sheet.element.tagName).toBe('DIALOG')
      expect(sheet.classes()).toContain('modal-bottom')
      expect(wrapper.find('aside').exists()).toBe(false)
      expect(wrapper.get(PANEL).attributes('data-layout')).toBe('sheet')
      expect(wrapper.find(SEPARATOR).exists()).toBe(false)
      expect(wrapper.find(WIDTH_PRESET).exists()).toBe(false)
      expect(wrapper.find(FULL_WIDTH).exists()).toBe(false)
      expect(readRootInset()).toBe('0px')
    })

    it('does not open the dialog while the panel is closed', async () => {
      const wrapper = await mountPanel()

      await flushPromises()

      expect(wrapper.find(SHEET).exists()).toBe(true)
      expect(showModal).not.toHaveBeenCalled()
      expect(wrapper.find(PANEL).exists()).toBe(false)
    })

    it('calls showModal once on open', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      expect(showModal).toHaveBeenCalledOnce()
      expect(wrapper.get(SHEET).attributes('open')).toBeDefined()
    })

    it('focuses the modal box even when the browser focused a field first', async () => {
      const wrapper = await mountPanel()

      await openPanel(FieldBody)

      const modalBox = wrapper.get(PANEL).element

      expect(showModal).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(modalBox)
      expect(document.activeElement)
        .not.toBe(wrapper.get('[data-testid="body-input"]').element)
    })

    it('hides the dialog while collapsed without closing the panel',
      async () => {
        const wrapper = await mountPanel()

        await openPanel(FieldBody)

        const body = wrapper.get('[data-testid="body-input"]').element

        useSidePanel().collapse()
        await flushPromises()

        expect(closeDialog).toHaveBeenCalledOnce()
        expect(wrapper.get(SHEET).attributes('open')).toBeUndefined()

        wrapper.get(SHEET).element.dispatchEvent(new Event('close'))
        await flushPromises()

        expect(useSidePanel().isOpen.value).toBe(true)

        useSidePanel().expand()
        await flushPromises()

        expect(showModal).toHaveBeenCalledTimes(2)
        expect(wrapper.get(SHEET).attributes('open')).toBeDefined()
        expect(wrapper.get('[data-testid="body-input"]').element).toBe(body)
      })

    it('restores the sheet scroll after a collapse and drops it when the '
      + 'panel closes while collapsed', async () => {
      const wrapper = await mountPanel()

      await openPanel(FieldBody)

      const sheetBody = wrapper.get('[data-testid="side-panel-body"]').element

      sheetBody.scrollTop = 120
      useSidePanel().collapse()
      await flushPromises()
      sheetBody.scrollTop = 0
      useSidePanel().expand()
      await flushPromises()

      expect(sheetBody.scrollTop).toBe(120)

      useSidePanel().collapse()
      await flushPromises()
      useSidePanel().close()
      await flushPromises()
      await openPanel(FieldBody)

      expect(wrapper.get('[data-testid="side-panel-body"]').element.scrollTop)
        .toBe(0)
    })

    it('closes the dialog when the panel closes', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      useSidePanel().close()
      await flushPromises()

      expect(closeDialog).toHaveBeenCalledOnce()
      expect(wrapper.get(SHEET).attributes('open')).toBeUndefined()
      expect(wrapper.find(PANEL).exists()).toBe(false)
    })

    it('closes the panel from the header close button', async () => {
      const wrapper = await mountPanel()

      await openPanel()
      await wrapper.get(CLOSE).trigger('click')

      expect(useSidePanel().isOpen.value).toBe(false)
    })

    it('closes the panel from the backdrop button', async () => {
      const wrapper = await mountPanel()

      await openPanel()
      await wrapper.get('.modal-backdrop button').trigger('click')

      expect(useSidePanel().isOpen.value).toBe(false)
    })

    it('closes the panel on the native cancel event', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const cancelEvent = new Event('cancel', { cancelable: true })

      wrapper.get(SHEET).element.dispatchEvent(cancelEvent)
      await flushPromises()

      expect(cancelEvent.defaultPrevented).toBe(true)
      expect(useSidePanel().isOpen.value).toBe(false)
    })

    it('leaves escape to the native dialog', async () => {
      await mountPanel()
      await openPanel()
      await pressEscape()

      expect(useSidePanel().isOpen.value).toBe(true)
    })

    it('closes after a swipe down past the distance threshold', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const swipeArea = wrapper.get(SWIPE_AREA).element

      dispatchPointer(swipeArea, 'pointerdown', 100)
      dispatchPointer(swipeArea, 'pointermove', 220)
      await flushPromises()

      expect(wrapper.get(PANEL).attributes('style'))
        .toContain('translateY(120px)')

      dispatchPointer(swipeArea, 'pointerup', 300)
      await flushPromises()

      expect(useSidePanel().isOpen.value).toBe(false)
    })

    it('springs back after a short slow swipe', async () => {
      let now = 0

      vi.spyOn(performance, 'now').mockImplementation(() => now)

      const wrapper = await mountPanel()

      await openPanel()

      const swipeArea = wrapper.get(SWIPE_AREA).element

      dispatchPointer(swipeArea, 'pointerdown', 100)
      dispatchPointer(swipeArea, 'pointermove', 130)
      now = 10_000
      dispatchPointer(swipeArea, 'pointerup', 130)
      await flushPromises()

      expect(useSidePanel().isOpen.value).toBe(true)
      expect(wrapper.get(PANEL).attributes('style') ?? '')
        .not.toContain('translateY')
    })

    it('ignores a swipe that starts on a header button', async () => {
      const wrapper = await mountPanel()

      await openPanel()

      const closeButton = wrapper.get(CLOSE).element

      dispatchPointer(closeButton, 'pointerdown', 100)
      dispatchPointer(closeButton, 'pointermove', 400)
      await flushPromises()

      expect(wrapper.get(PANEL).attributes('style') ?? '')
        .not.toContain('translateY')
    })

    it('keeps the dialog closed in the docked layout', async () => {
      stubViewport(1440)

      const wrapper = await mountPanel()

      await openPanel()

      expect(wrapper.find('aside').exists()).toBe(true)
      expect(showModal).not.toHaveBeenCalled()
    })
  })
})
