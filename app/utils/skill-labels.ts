import type { SkillLicenseClass } from '#shared/utils/skills-policy'
import type { SkillVersionSummary } from '#shared/types/skills.d'
import { formatGithubSourceVersion } from '#shared/utils/skills/release'

const LICENSE_LABELS: Record<SkillLicenseClass, string> = {
  open: 'Open license',
  custom: 'Custom license',
  none: 'No license stated',
  restricted: 'Restricted license',
  authored: 'Written by you',
}

export function getSkillLicenseLabel(licenseClass: SkillLicenseClass): string {
  return LICENSE_LABELS[licenseClass]
}

function shortSha(
  version: Pick<
    SkillVersionSummary,
    'sourceKind' | 'sourceRef' | 'sourceVersion'
  >,
): string {
  const label = version.sourceKind === 'github'
    ? formatGithubSourceVersion(version)
    : null

  return label ? ` @${label}` : ''
}

/**
 * How a version came to be, in the words of the Versions list: "Edited in
 * Besidka", "Imported @abc1234", "From a connected app, pending".
 */
export function describeSkillVersionOrigin(
  version: Pick<
    SkillVersionSummary,
    'origin' | 'sourceKind' | 'sourceRef' | 'sourceVersion' | 'isPending'
  >,
): string {
  const suffix = version.isPending ? ', pending' : ''

  switch (version.origin) {
    case 'import':
      return `Imported${shortSha(version)}${suffix}`
    case 'update':
      return `Updated from the source${shortSha(version)}${suffix}`
    case 'editor':
      return `Edited in Besidka${suffix}`
    case 'template':
      return `Created from a template${suffix}`
    case 'mcp':
      return `From a connected app${suffix}`
    case 'rename':
      return `Renamed${suffix}`
    case 'restore':
      return `Restored from an older version${suffix}`
    case 'share':
      return `From a shared link${suffix}`
  }
}

const UPSTREAM_ORIGINS: readonly string[] = ['import', 'update']
const LOCAL_EDIT_ORIGINS: readonly string[] = [
  'editor',
  'template',
  'mcp',
  'rename',
  'restore',
]

/**
 * The versions newer than the last import or update that are local edits, the
 * same rule the server applies when it checks GitHub: accepting an update
 * replaces those edits, so the review warns about them.
 */
export function findLocalEditsSinceImport(
  versions: Array<Pick<SkillVersionSummary, 'version' | 'origin' | 'isPending'>>,
): Array<{ version: number, origin: string }> {
  const settled = versions.filter(version => !version.isPending)
  const lastUpstream = Math.max(
    0,
    ...settled
      .filter(version => UPSTREAM_ORIGINS.includes(version.origin))
      .map(version => version.version),
  )

  return settled
    .filter((version) => {
      return version.version > lastUpstream
        && LOCAL_EDIT_ORIGINS.includes(version.origin)
    })
    .sort((left, right) => left.version - right.version)
    .map((version) => {
      return { version: version.version, origin: version.origin }
    })
}
