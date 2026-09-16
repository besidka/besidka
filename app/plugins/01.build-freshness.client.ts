import type { NuxtAppManifestMeta } from '#app'
import { buildAssetsURL } from '#internal/nuxt/paths'

export default defineNuxtPlugin({
  name: 'build-freshness',
  parallel: true,
  setup() {
    if (import.meta.test) {
      return
    }

    const currentBuildId = useRuntimeConfig().app.buildId

    if (!currentBuildId) {
      return
    }

    reloadWhenBuildIsOutdated(currentBuildId)
  },
})

export async function reloadWhenBuildIsOutdated(
  currentBuildId: string,
): Promise<void> {
  try {
    const latestManifest = await fetchBuildAsset<NuxtAppManifestMeta>(
      'builds/latest.json',
    )

    if (!latestManifest.id || latestManifest.id === currentBuildId) {
      return
    }

    const currentManifest = await getAppManifest().catch(() => undefined)

    if (
      typeof currentManifest?.timestamp === 'number'
      && typeof latestManifest.timestamp === 'number'
      && latestManifest.timestamp <= currentManifest.timestamp
    ) {
      return
    }

    await fetchBuildAsset(`builds/meta/${latestManifest.id}.json`)

    reloadNuxtApp()
  } catch {
    return
  }
}

function fetchBuildAsset<T = unknown>(path: string): Promise<T> {
  return $fetch<T>(`${buildAssetsURL(path)}?${Date.now()}`, {
    cache: 'no-store',
  })
}
