import {
  removeLegacyLegalNoticeDismissals,
} from '~/composables/legal-notice-banner'

export default defineNuxtPlugin((): void => {
  removeLegacyLegalNoticeDismissals()
})
