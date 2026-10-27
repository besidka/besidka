import { afterEach, describe, expect, it } from 'vitest'
import {
  isFocusLost,
  restoreToolsMenuFocus,
} from '../../../app/composables/tools-menu-focus-rescue'

function buildMenu() {
  document.body.innerHTML = `
    <div class="js-tools-content">
      <section data-section="search">
        <input type="radio" name="provider" checked id="provider">
        <div id="reveal">
          <input type="radio" name="depth" checked id="depth">
        </div>
      </section>
      <section data-section="reasoning">
        <fieldset class="js-reasoning-level-group">
          <input type="radio" name="level" checked id="level">
        </fieldset>
      </section>
    </div>
  `

  const element = (id: string) => document.getElementById(id) as HTMLElement

  return {
    content: document.querySelector('.js-tools-content') as HTMLElement,
    provider: element('provider'),
    depth: element('depth'),
    level: element('level'),
    reveal: element('reveal'),
  }
}

describe('isFocusLost', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is lost when the document body holds focus', () => {
    document.body.focus()

    expect(isFocusLost()).toBe(true)
  })

  it('is lost when a dialog is the active element', () => {
    document.body.innerHTML = '<dialog tabindex="-1" id="sheet"></dialog>'

    const dialog = document.getElementById('sheet') as HTMLDialogElement

    dialog.focus()

    expect(document.activeElement).toBe(dialog)
    expect(isFocusLost()).toBe(true)
  })

  it('is lost when the active element left the document', () => {
    document.body.innerHTML = '<input id="field">'

    const field = document.getElementById('field') as HTMLInputElement

    field.remove()
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => field,
    })

    try {
      expect(field.isConnected).toBe(false)
      expect(isFocusLost()).toBe(true)
    } finally {
      Reflect.deleteProperty(document, 'activeElement')
    }
  })

  it('is not lost while a control holds focus', () => {
    document.body.innerHTML = '<input id="field">'
    ;(document.getElementById('field') as HTMLInputElement).focus()

    expect(isFocusLost()).toBe(false)
  })
})

describe('restoreToolsMenuFocus', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('prefers the checked radio of the section the vanishing element '
    + 'belongs to', async () => {
    const { content, provider, depth, reveal } = buildMenu()

    depth.focus()
    reveal.setAttribute('inert', '')

    await restoreToolsMenuFocus(content, { force: true, near: reveal })

    expect(document.activeElement).toBe(provider)
  })

  it('falls back to the level group when the section has no other checked '
    + 'radio', async () => {
    const { content, depth, level, provider, reveal } = buildMenu()

    provider.remove()
    depth.focus()

    await restoreToolsMenuFocus(content, { force: true, near: reveal })

    expect(document.activeElement).toBe(level)
  })

  it('uses the level group when no neighbour is given', async () => {
    const { content, depth, level } = buildMenu()

    depth.focus()

    await restoreToolsMenuFocus(content, { force: true })

    expect(document.activeElement).toBe(level)
  })

  it('skips radios inside an inert subtree', async () => {
    const { content, provider, level, reveal } = buildMenu()

    provider.closest('section')?.setAttribute('inert', '')
    ;(document.getElementById('depth') as HTMLElement).focus()

    await restoreToolsMenuFocus(content, { force: true, near: reveal })

    expect(document.activeElement).toBe(level)
  })

  it('does nothing without force while focus is still on a control',
    async () => {
      const { content, provider, level } = buildMenu()

      provider.focus()

      await restoreToolsMenuFocus(content)

      expect(document.activeElement).toBe(provider)
      expect(document.activeElement).not.toBe(level)
    })

  it('restores focus without force once it fell to the body', async () => {
    const { content, level, reveal } = buildMenu()

    document.body.focus()

    await restoreToolsMenuFocus(content, { near: reveal })

    expect(document.activeElement?.id).toBe('provider')
    expect(level.isConnected).toBe(true)
  })

  it('does nothing when the menu content is gone', async () => {
    const { content } = buildMenu()

    content.remove()
    document.body.focus()

    await restoreToolsMenuFocus(content, { force: true })

    expect(document.activeElement).toBe(document.body)
  })
})
