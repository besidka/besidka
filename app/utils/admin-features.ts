import type { FeatureRole } from '#shared/utils/features/registry'

export interface AdminFeatureRuleView {
  enabled: boolean
  rolloutBps: number
  allowRoles: string[] | null
  variants: { key: string, weightBps: number }[] | null
}

export interface AdminFeatureView {
  key: string
  default: boolean
  allowRoles: FeatureRole[]
  killSwitched: boolean
  rule: AdminFeatureRuleView | null
}

export interface AdminSearchUser {
  id: number
  name: string
  email: string
  roles: { id: number, role: string }[]
  isEnvAdmin: boolean
}

export interface AdminFeatureState {
  label: string
  tone: 'off' | 'limited' | 'on'
}

const roleLabels: Record<string, string> = {
  admin: 'Admins',
  tester: 'Testers',
}

export function formatBasisPoints(basisPoints: number): string {
  return `${Number((basisPoints / 100).toFixed(2))}%`
}

export function describeAllowedRoles(roles: readonly string[]): string {
  if (!roles.length) {
    return 'Grants only'
  }

  return roles
    .map((role) => {
      return roleLabels[role] ?? role
    })
    .join(', ')
}

export function getAdminFeatureState(
  feature: AdminFeatureView,
  options: { rolloutEnabled: boolean, hostMode: string },
): AdminFeatureState {
  if (feature.killSwitched) {
    return { label: 'Off (env)', tone: 'off' }
  }

  if (options.hostMode === 'off') {
    return { label: 'Off (host)', tone: 'off' }
  }

  if (feature.rule && !feature.rule.enabled) {
    return { label: 'Off', tone: 'off' }
  }

  if (feature.default) {
    return { label: 'On', tone: 'on' }
  }

  const roles = describeAllowedRoles(
    feature.rule?.allowRoles ?? feature.allowRoles,
  )
  const rolloutBps = feature.rule?.rolloutBps ?? 0

  if (options.rolloutEnabled && rolloutBps > 0) {
    return {
      label: `${roles} + rollout ${formatBasisPoints(rolloutBps)}`,
      tone: 'limited',
    }
  }

  return { label: roles, tone: 'limited' }
}

export function formatAuditSnapshot(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }

  return JSON.stringify(value)
}
