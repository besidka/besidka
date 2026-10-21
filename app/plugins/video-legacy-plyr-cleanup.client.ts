import { removeLegacyPlyrPreferences } from '~/composables/video-player-preferences'

export default defineNuxtPlugin((): void => {
  removeLegacyPlyrPreferences()
})
