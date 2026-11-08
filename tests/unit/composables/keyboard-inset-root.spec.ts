import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computed, effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import {
  useKeyboardInsetRoot,
} from '../../../app/composables/keyboard-inset-root'

const bottomInset = shallowRef<number>(0)
const viewportHeight = shallowRef<number>(714)
const isKeyboardOpen = computed<boolean>(() => bottomInset.value >= 120)

mockNuxtImport('useVisualViewportInset', () => () => ({
  bottomInset,
  viewportHeight,
  isKeyboardOpen,
  update: () => {},
}))

function getRootStyle(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

function hasKeyboardAttribute(): boolean {
  return document.documentElement.hasAttribute('data-keyboard-open')
}

describe('useKeyboardInsetRoot', () => {
  let scope: EffectScope | null = null

  function install(): EffectScope {
    scope = effectScope()
    scope.run(() => {
      useKeyboardInsetRoot()
    })

    return scope
  }

  beforeEach(() => {
    bottomInset.value = 0
    viewportHeight.value = 714
  })

  afterEach(() => {
    scope?.stop()
    scope = null
    document.documentElement.style.removeProperty('--keyboard-inset')
    document.documentElement.style.removeProperty('--visible-height')
    document.documentElement.removeAttribute('data-keyboard-open')
  })

  it('starts with a zero inset and no visible height', () => {
    install()

    expect(getRootStyle('--keyboard-inset')).toBe('0px')
    expect(getRootStyle('--visible-height')).toBe('')
    expect(hasKeyboardAttribute()).toBe(false)
  })

  it('mirrors the inset and visible height while the keyboard is open',
    async () => {
      install()

      viewportHeight.value = 318
      bottomInset.value = 396
      await nextTick()

      expect(getRootStyle('--keyboard-inset')).toBe('396px')
      expect(getRootStyle('--visible-height')).toBe('318px')
      expect(hasKeyboardAttribute()).toBe(true)
    })

  it('follows the inset while the keyboard stays open', async () => {
    install()

    viewportHeight.value = 380
    bottomInset.value = 330
    await nextTick()
    viewportHeight.value = 318
    bottomInset.value = 396
    await nextTick()

    expect(getRootStyle('--keyboard-inset')).toBe('396px')
    expect(getRootStyle('--visible-height')).toBe('318px')
  })

  it('clears the visible height and the attribute when the keyboard closes',
    async () => {
      install()

      viewportHeight.value = 318
      bottomInset.value = 396
      await nextTick()

      viewportHeight.value = 714
      bottomInset.value = 0
      await nextTick()

      expect(getRootStyle('--keyboard-inset')).toBe('0px')
      expect(getRootStyle('--visible-height')).toBe('')
      expect(hasKeyboardAttribute()).toBe(false)
    })

  it('treats an inset below the keyboard threshold as closed', async () => {
    install()

    bottomInset.value = 68
    await nextTick()

    expect(getRootStyle('--keyboard-inset')).toBe('0px')
    expect(getRootStyle('--visible-height')).toBe('')
    expect(hasKeyboardAttribute()).toBe(false)
  })

  it('removes everything it set when its scope stops', async () => {
    const installedScope = install()

    viewportHeight.value = 318
    bottomInset.value = 396
    await nextTick()

    installedScope.stop()

    expect(getRootStyle('--keyboard-inset')).toBe('')
    expect(getRootStyle('--visible-height')).toBe('')
    expect(hasKeyboardAttribute()).toBe(false)
  })
})
