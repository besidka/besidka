import { computed } from 'vue'
import { useState, useRuntimeConfig } from '#imports'
import type { CookieConsentView } from '../types/module'
import { useCookieConsent } from './consent'

// Browser-only module scope — resets per page load, never touched during SSR.
let autoShowScheduled = false
let triggerElement: HTMLElement | null = null

export function useCookieConsentUi() {
  const consent = useCookieConsent()

  const view = useState<CookieConsentView>(
    'cookie-consent:view',
    () => 'hidden',
  )

  const draft = useState<Record<string, boolean>>(
    'cookie-consent:draft',
    () => ({}),
  )

  function initDraft(): void {
    const next: Record<string, boolean> = {}

    for (const category of consent.categories) {
      next[category.id] = consent.isAllowed(category.id)
    }

    draft.value = next
  }

  function openPopup(trigger?: HTMLElement | null): void {
    if (import.meta.client) {
      triggerElement = trigger ?? (document.activeElement as HTMLElement | null)
    }

    initDraft()
    view.value = 'popup'
  }

  function expand(): void {
    if (view.value === 'hidden') {
      initDraft()
    }

    view.value = 'modal'
  }

  function isTriggerNode(node: Node | null): boolean {
    if (
      !node
      || !triggerElement
      || triggerElement === document.body
      || triggerElement === document.documentElement
    ) {
      return false
    }

    return triggerElement === node || triggerElement.contains(node)
  }

  function close(): void {
    view.value = 'hidden'

    const target = triggerElement

    triggerElement = null
    draft.value = {}

    if (!import.meta.client) {
      return
    }

    if (target && document.contains(target)) {
      target.focus()
    } else {
      const focused = document.activeElement as HTMLElement | null

      if (focused && focused !== document.body) {
        focused.blur()
      }

      document.body.focus()
    }
  }

  function toggleDraft(categoryId: string): void {
    const category = consent.categories.find(
      cat => cat.id === categoryId,
    )

    if (category?.required) {
      return
    }

    draft.value = {
      ...draft.value,
      [categoryId]: !draft.value[categoryId],
    }
  }

  function commitDraft(): void {
    const enabledIds = Object.entries(draft.value)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id)

    consent.allow(enabledIds)
    close()
  }

  function allowAll(): void {
    consent.allowAll()
    close()
  }

  function withdrawAll(): void {
    consent.withdrawAll()
    close()
  }

  function scheduleAutoShow(): void {
    if (autoShowScheduled) {
      return
    }

    autoShowScheduled = true

    if (consent.isDecided.value) {
      return
    }

    const runtimeConfig = useRuntimeConfig()
    const options = runtimeConfig.public.cookieConsent as { showDelay: number }
    const delay = options?.showDelay ?? 1200

    setTimeout(() => {
      if (!consent.isDecided.value) {
        openPopup()
      }
    }, delay)
  }

  function switchProps(categoryId: string): {
    'role': 'switch'
    'aria-checked': boolean
    'disabled': boolean
  } {
    const category = consent.categories.find(
      cat => cat.id === categoryId,
    )
    const isRequired = category?.required === true

    return {
      'role': 'switch' as const,
      'aria-checked': draft.value[categoryId] ?? false,
      'disabled': isRequired,
    }
  }

  const readonlyView = computed(() => view.value)

  return {
    view: readonlyView,
    draft,
    toggleDraft,
    commitDraft,
    allowAll,
    withdrawAll,
    openPopup,
    expand,
    close,
    isTriggerNode,
    scheduleAutoShow,
    switchProps,
  }
}
