import type { FeatureKey } from '#shared/utils/features/registry'

/**
 * The one writer of a Labs opt-in, shared by the Labs page and every other
 * switch for the same flag. It saves through the opt-in route and refreshes
 * the client feature state; a failure is thrown for the caller to report.
 */
export function useFeatureOptIn() {
  const { refreshFeatures } = useFeatures()

  async function setFeatureOptIn(key: FeatureKey, optedIn: boolean) {
    await $fetch(`/api/v1/profiles/features/${key}/opt-in`, {
      method: 'POST',
      body: { optedIn },
    })
    await refreshFeatures()
  }

  return { setFeatureOptIn }
}
