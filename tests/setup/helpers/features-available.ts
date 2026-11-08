import type { FeatureDefinition } from '#shared/utils/features/registry'

/**
 * Specs that exercise the generic evaluator against the real registry use
 * unreleased flags such as `artifacts` as examples. A registry entry is off
 * everywhere until its code ships (`available`), so those specs mark every
 * entry available. The registry is imported dynamically so a spec that calls
 * `vi.resetModules()` can mark the fresh module instance again.
 */
export async function markAllFeaturesAvailable() {
  const { FEATURE_REGISTRY } = await import('#shared/utils/features/registry')

  for (const definition of Object.values(FEATURE_REGISTRY)) {
    (definition as FeatureDefinition).available = true
  }

  return FEATURE_REGISTRY
}
