import {
  computed,
  readonly,
  getCurrentScope,
  onScopeDispose,
} from 'vue'
import {
  useNuxtApp,
  useRuntimeConfig,
  useState,
  useCookie,
} from '#imports'
import type {
  CookieCategoryDeclaration,
  CookieConsentChangedPayload,
  ConsentCookie,
} from '../types/module'
import { cleanupEntry } from '../utils/cleanup'

function getRequiredIds(
  categories: CookieCategoryDeclaration[],
): string[] {
  return categories
    .filter(category => category.required === true)
    .map(category => category.id)
}

function dedupeAndAddRequired(
  ids: string[],
  requiredIds: string[],
): string[] {
  const set = new Set([...requiredIds, ...ids])

  return Array.from(set)
}

function generateConsentId(): string {
  if (
    typeof crypto !== 'undefined'
    && typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useCookieConsent() {
  const config = useRuntimeConfig()
  const options = config.public.cookieConsent as unknown as {
    cookieName: string
    cookieMaxAge: number
    revision: number
    categories: CookieCategoryDeclaration[]
  }

  const categories = options.categories as CookieCategoryDeclaration[]
  const requiredIds = getRequiredIds(categories)

  const consentCookie = useCookie<ConsentCookie | null>(
    options.cookieName,
    {
      default: () => null,
      maxAge: options.cookieMaxAge,
      sameSite: 'lax',
    },
  )

  const initialGranted: string[] = (() => {
    const raw = consentCookie.value

    if (
      raw
      && typeof raw === 'object'
      && raw.v === options.revision
      && Array.isArray(raw.granted)
    ) {
      return dedupeAndAddRequired(raw.granted, requiredIds)
    }

    return [...requiredIds]
  })()

  const granted = useState<string[]>(
    'cookie-consent:granted',
    () => initialGranted,
  )

  const decidedState = useState<boolean>(
    'cookie-consent:decided',
    () => {
      const raw = consentCookie.value

      return (
        !!raw
        && typeof raw === 'object'
        && raw.v === options.revision
      )
    },
  )

  const consentIdState = useState<string | null>(
    'cookie-consent:id',
    () => {
      const raw = consentCookie.value

      if (
        raw
        && typeof raw === 'object'
        && raw.v === options.revision
        && typeof raw.id === 'string'
      ) {
        return raw.id
      }

      return null
    },
  )

  const consentDateState = useState<string | null>(
    'cookie-consent:date',
    () => {
      const raw = consentCookie.value

      if (
        raw
        && typeof raw === 'object'
        && raw.v === options.revision
        && typeof raw.date === 'string'
      ) {
        return raw.date
      }

      return null
    },
  )

  const isDecided = computed(() => decidedState.value)
  const consentId = readonly(consentIdState)
  const consentDate = readonly(consentDateState)

  function isAllowed(categoryId: string): boolean {
    return granted.value.includes(categoryId)
  }

  function allow(categoryIds: string[]): void {
    const nuxtApp = useNuxtApp()
    const previousGranted = [...granted.value]
    const nextGranted = dedupeAndAddRequired(categoryIds, requiredIds)
    const newId = generateConsentId()
    const newDate = new Date().toISOString()

    granted.value = nextGranted
    decidedState.value = true
    consentIdState.value = newId
    consentDateState.value = newDate

    consentCookie.value = {
      v: options.revision,
      granted: nextGranted,
      id: newId,
      date: newDate,
    }

    const allIds = categories.map(category => category.id)
    const denied = allIds.filter(id => !nextGranted.includes(id))

    const changed = allIds.filter((id) => {
      const wasGranted = previousGranted.includes(id)
      const nowGranted = nextGranted.includes(id)

      return wasGranted !== nowGranted
    })

    const payload: CookieConsentChangedPayload = {
      granted: nextGranted,
      denied,
      changed,
    }

    nuxtApp.callHook('cookie-consent:changed', payload)

    if (import.meta.client) {
      for (const category of categories) {
        if (nextGranted.includes(category.id)) {
          continue
        }

        for (const entry of category.entries ?? []) {
          try {
            cleanupEntry(entry)
          } catch {
            // best-effort cleanup
          }
        }
      }
    }
  }

  function allowAll(): void {
    allow(categories.map(category => category.id))
  }

  function withdrawAll(): void {
    allow(requiredIds)
  }

  function onConsentChange(
    cb: (payload: CookieConsentChangedPayload) => void,
    options?: { immediate?: boolean },
  ): () => void {
    const nuxtApp = useNuxtApp()

    const unsubscribe = nuxtApp.hook(
      'cookie-consent:changed',
      cb,
    )

    if (options?.immediate && isDecided.value) {
      const allIds = categories.map(category => category.id)
      const currentGranted = granted.value
      const denied = allIds.filter(id => !currentGranted.includes(id))

      cb({ granted: currentGranted, denied, changed: [] })
    }

    const scope = getCurrentScope()

    if (scope) {
      onScopeDispose(unsubscribe)
    }

    return unsubscribe
  }

  return {
    categories,
    granted: readonly(granted),
    isDecided,
    consentId,
    consentDate,
    isAllowed,
    allow,
    allowAll,
    withdrawAll,
    onConsentChange,
  }
}
