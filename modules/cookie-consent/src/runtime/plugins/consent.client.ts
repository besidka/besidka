import { defineNuxtPlugin } from '#imports'
import { useCookieConsent } from '../composables/consent'
import { cleanupEntry } from '../utils/cleanup'

export default defineNuxtPlugin(() => {
  const consent = useCookieConsent()

  if (!consent.isDecided.value) {
    return
  }

  for (const category of consent.categories) {
    if (consent.isAllowed(category.id)) {
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
})
