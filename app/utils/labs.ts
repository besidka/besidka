import type { LabsFeature } from '#shared/types/features.d'
import type {
  FeatureKeyKind,
  FeatureSpend,
  FeatureStage,
} from '#shared/utils/features/registry'
import type { UserKeyStatus } from '~/composables/user-keys'
import { providerMeta } from '#shared/utils/provider-meta'

export interface LabsFeatureGroup {
  feature: LabsFeature
  children: LabsFeature[]
}

export const LABS_DEFAULT_ICON = 'lucide:flask-conical'

const labsFeatureIcons: Record<string, string> = {
  'artifacts': 'lucide:app-window',
  'documents': 'lucide:file-text',
  'code-execution': 'lucide:square-terminal',
  'research.custom': 'lucide:telescope',
  'research.export': 'lucide:file-down',
  'connectors': 'lucide:cable',
  'google.drive': 'lucide:hard-drive',
  'skills': 'lucide:wand-sparkles',
  'ui.side-panel-demo': 'lucide:panel-right',
}

const stageLabels: Record<FeatureStage, string> = {
  internal: 'Internal',
  beta: 'Beta',
  ga: 'Available',
}

const keyKindsSatisfiedBy: Record<FeatureKeyKind, FeatureKeyKind[]> = {
  'provider': ['provider', 'gateway'],
  'search': ['search'],
  'gateway': ['gateway'],
  'memory-check': ['memory-check'],
}

export function getLabsFeatureIcon(key: string): string {
  return labsFeatureIcons[key] ?? LABS_DEFAULT_ICON
}

export function getLabsStageLabel(stage: FeatureStage): string {
  return stageLabels[stage]
}

export function getLabsSpendNote(spend: FeatureSpend): string | null {
  if (spend === 'background') {
    return 'Uses your API keys, also in the background'
  }

  if (spend === 'foreground') {
    return 'Uses your API keys'
  }

  return null
}

/**
 * Nests every feature under its top-level ancestor, keeping registry order.
 * A child whose parent is not in the list (it never is, because a child is
 * off whenever its parent is off) is shown as a top-level feature rather
 * than dropped.
 */
export function groupLabsFeatures(
  features: readonly LabsFeature[],
): LabsFeatureGroup[] {
  const featuresByKey = new Map(features.map((feature) => {
    return [feature.key, feature]
  }))
  const groups = new Map<string, LabsFeatureGroup>()

  function findRootKey(feature: LabsFeature): string {
    let current = feature

    while (current.parent && featuresByKey.has(current.parent)) {
      current = featuresByKey.get(current.parent) ?? current
    }

    return current.key
  }

  for (const feature of features) {
    const rootKey = findRootKey(feature)

    if (rootKey === feature.key) {
      groups.set(feature.key, { feature, children: [] })
    }
  }

  for (const feature of features) {
    const rootKey = findRootKey(feature)

    if (rootKey !== feature.key) {
      groups.get(rootKey)?.children.push(feature)
    }
  }

  return [...groups.values()]
}

export function getProviderIdsForKeyKind(kind: FeatureKeyKind): string[] {
  const kinds = keyKindsSatisfiedBy[kind]

  return Object.values(providerMeta)
    .filter((meta) => {
      return kinds.includes(meta.kind)
    })
    .map((meta) => {
      return meta.id
    })
}

export function describeMissingKeyKind(kind: FeatureKeyKind): string {
  if (kind === 'provider') {
    return 'Needs an API key for a model provider or gateway'
  }

  const labels = getProviderIdsForKeyKind(kind).map((providerId) => {
    const meta = providerMeta[providerId]

    return meta?.shortLabel ?? meta?.label ?? providerId
  })

  if (labels.length === 0) {
    return 'Needs an API key'
  }

  const lastLabel = labels.at(-1)
  const joined = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} or ${lastLabel}`
    : lastLabel

  return `Needs a ${joined} key`
}

/**
 * The key kinds a feature needs that the user has no saved key for. A kind
 * counts as missing only when every provider of that kind reports
 * `missing`, so nothing shows while the key summary is still loading.
 */
export function findMissingKeyKinds(
  feature: Pick<LabsFeature, 'requires'>,
  keyStatus: (providerId: string) => UserKeyStatus,
): FeatureKeyKind[] {
  return feature.requires.keyKinds.filter((kind) => {
    const providerIds = getProviderIdsForKeyKind(kind)

    return providerIds.length > 0 && providerIds.every((providerId) => {
      return keyStatus(providerId) === 'missing'
    })
  })
}
