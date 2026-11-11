// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMenu,
  createShell,
} from '~~/workers/artifacts-runtime/src/kit/chrome'
import type { KitMenu } from '~~/workers/artifacts-runtime/src/kit/chrome'

const ITEMS = [
  { action: 'one', label: 'One', icon: 'code' },
  { action: 'two', label: 'Two', icon: 'image' },
  { action: 'three', label: 'Three', icon: 'workflow' },
] as const

type Action = typeof ITEMS[number]['action']

function pressKey(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
  }))
}

function pressPointer(target: Element) {
  target.dispatchEvent(new Event('pointerdown', {
    bubbles: true,
    composed: true,
  }))
}

function readItems(menu: KitMenu): HTMLButtonElement[] {
  return Array.from(menu.panel.querySelectorAll('[role="menuitem"]'))
}

describe('kit dropdown menu', () => {
  let host: HTMLElement
  let shadow: ShadowRoot
  let selected: Action[]
  let first: KitMenu
  let second: KitMenu

  function createTestMenu(testId: string): KitMenu {
    return createMenu<Action>(testId, 'copy', 'Copy', [...ITEMS], (action) => {
      selected.push(action)
    })
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    shadow = host.attachShadow({ mode: 'open' })
    document.body.append(host)

    const shell = createShell(shadow, 'test')

    selected = []
    first = createTestMenu('first')
    second = createTestMenu('second')
    shell.actions.append(first.element, second.element)
  })

  afterEach(() => {
    first.close()
    second.close()
  })

  it('is closed at first and exposes menu semantics', () => {
    expect(first.panel.hidden).toBe(true)
    expect(first.trigger.element.getAttribute('aria-haspopup')).toBe('menu')
    expect(first.trigger.element.getAttribute('aria-expanded')).toBe('false')
    expect(first.panel.querySelector('[role="menu"]')).not.toBeNull()
    expect(readItems(first).map(item => item.textContent))
      .toEqual(['One', 'Two', 'Three'])
    expect(readItems(first).every(item => item.querySelector('svg')))
      .toBe(true)
  })

  it('opens below the trigger on click and closes on a second click', () => {
    first.trigger.element.click()

    expect(first.panel.hidden).toBe(false)
    expect(first.trigger.element.getAttribute('aria-expanded')).toBe('true')

    first.trigger.element.click()

    expect(first.panel.hidden).toBe(true)
    expect(first.trigger.element.getAttribute('aria-expanded')).toBe('false')
  })

  it('focuses the first item after a pointer click, as after a keyboard open', () => {
    first.trigger.element.dispatchEvent(new MouseEvent('click', {
      detail: 1,
      bubbles: true,
      composed: true,
    }))

    expect(first.panel.hidden).toBe(false)
    expect(shadow.activeElement).toBe(readItems(first)[0])

    pressKey(readItems(first)[0]!, 'ArrowDown')

    expect(shadow.activeElement).toBe(readItems(first)[1])
  })

  it('opens on the arrow keys and focuses the first or last item', () => {
    pressKey(first.trigger.element, 'ArrowDown')

    expect(first.panel.hidden).toBe(false)
    expect(shadow.activeElement).toBe(readItems(first)[0])

    first.close()
    pressKey(first.trigger.element, 'ArrowUp')

    expect(shadow.activeElement).toBe(readItems(first)[2])
  })

  it('moves with the arrows, wraps, and jumps with Home and End', () => {
    pressKey(first.trigger.element, 'ArrowDown')

    const items = readItems(first)

    pressKey(items[0]!, 'ArrowDown')
    expect(shadow.activeElement).toBe(items[1])
    pressKey(items[1]!, 'End')
    expect(shadow.activeElement).toBe(items[2])
    pressKey(items[2]!, 'ArrowDown')
    expect(shadow.activeElement).toBe(items[0])
    pressKey(items[0]!, 'ArrowUp')
    expect(shadow.activeElement).toBe(items[2])
    pressKey(items[2]!, 'Home')
    expect(shadow.activeElement).toBe(items[0])
  })

  it('closes on Escape from an item and returns focus to the trigger', () => {
    pressKey(first.trigger.element, 'ArrowDown')
    pressKey(readItems(first)[0]!, 'Escape')

    expect(first.panel.hidden).toBe(true)
    expect(shadow.activeElement).toBe(first.trigger.element)
  })

  it('closes on Escape pressed on the trigger', () => {
    first.trigger.element.click()
    pressKey(first.trigger.element, 'Escape')

    expect(first.panel.hidden).toBe(true)
  })

  it('closes on Escape when focus is not in the menu', () => {
    first.trigger.element.click()
    pressKey(document.body, 'Escape')

    expect(first.panel.hidden).toBe(true)
  })

  it('closes on Tab', () => {
    pressKey(first.trigger.element, 'ArrowDown')
    pressKey(readItems(first)[0]!, 'Tab')

    expect(first.panel.hidden).toBe(true)
  })

  it('closes on a pointer press outside, through the shadow boundary', () => {
    first.trigger.element.click()
    pressPointer(document.body)

    expect(first.panel.hidden).toBe(true)
  })

  it('stays open for a pointer press inside the menu', () => {
    first.trigger.element.click()
    pressPointer(readItems(first)[1]!)

    expect(first.panel.hidden).toBe(false)
  })

  it('keeps one menu open at a time', () => {
    first.trigger.element.click()
    second.trigger.element.click()

    expect(first.panel.hidden).toBe(true)
    expect(second.panel.hidden).toBe(false)
  })

  it('runs the action with the click event, closes and refocuses', () => {
    const onSelect = vi.fn()
    const menu = createMenu<Action>('third', 'copy', 'Copy', [...ITEMS], onSelect)

    shadow.append(menu.element)
    menu.trigger.element.click()
    readItems(menu)[1]!.click()

    expect(onSelect).toHaveBeenCalledWith('two', expect.any(MouseEvent))
    expect(menu.panel.hidden).toBe(true)
    expect(shadow.activeElement).toBe(menu.trigger.element)
  })

  it('keeps the testids the host specs rely on', () => {
    expect(first.trigger.element.dataset.testid).toBe('first')
    expect(first.panel.dataset.testid).toBe('first-menu')
    expect(readItems(first).map(item => item.dataset.testid))
      .toEqual(['first-one', 'first-two', 'first-three'])
  })
})
