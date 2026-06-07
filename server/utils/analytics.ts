// @ts-ignore
import { env } from 'cloudflare:workers'

export function useAnalytics(): AnalyticsEngineDataset | null {
  const analytics = (env as unknown as Record<string, unknown>).ANALYTICS

  if (!analytics) {
    return null
  }

  return analytics as AnalyticsEngineDataset
}
