import {
  getLegalNoticeById,
  parseNoticeEffectiveInstant,
} from '#shared/utils/legal-notices'

export const FEATURES_ROLLOUT_NOTICE_ID = '2026-11-experimental-features'

export type FeatureRolloutOverride = 'auto' | 'on' | 'off'

export type FeatureRolloutGateReason
  = | 'override_on'
    | 'override_off'
    | 'notice_in_force'
    | 'notice_pending'
    | 'notice_unknown'

export interface FeatureRolloutGate {
  open: boolean
  reason: FeatureRolloutGateReason
  override: FeatureRolloutOverride
  noticeId: string
  effectiveAt: string | null
  effectiveAtMs: number | null
}

const OVERRIDE_ON_VALUES = new Set(['on', 'true', '1'])
const OVERRIDE_OFF_VALUES = new Set(['off', 'false', '0'])

/**
 * Reads `NUXT_FEATURES_ROLLOUT_ENABLED`. `on`, `true` and `1` force the gate
 * open (self-host), `off`, `false` and `0` force it closed, anything else
 * (an empty value included) leaves it to the Privacy notice date.
 */
export function parseFeatureRolloutOverride(
  value: unknown,
): FeatureRolloutOverride {
  if (value === true) {
    return 'on'
  }

  if (value === false) {
    return 'off'
  }

  const normalised = String(value ?? '').trim().toLowerCase()

  if (OVERRIDE_ON_VALUES.has(normalised)) {
    return 'on'
  }

  if (OVERRIDE_OFF_VALUES.has(normalised)) {
    return 'off'
  }

  return 'auto'
}

/**
 * Gradual rollouts and variants run only when the environment does not force
 * them off and the Privacy notice that announces them is in force
 * (`effectiveAt <= now`). A notice id missing from the registry keeps the
 * gate closed.
 */
export function computeFeatureRolloutGate(
  override: unknown,
  now: Date,
  noticeId: string = FEATURES_ROLLOUT_NOTICE_ID,
): FeatureRolloutGate {
  const parsedOverride = parseFeatureRolloutOverride(override)
  const notice = getLegalNoticeById(noticeId)
  const effectiveAtMs = notice
    ? parseNoticeEffectiveInstant(notice.effectiveAt)
    : null
  const base = {
    override: parsedOverride,
    noticeId,
    effectiveAt: notice?.effectiveAt ?? null,
    effectiveAtMs,
  }

  if (parsedOverride === 'on') {
    return { ...base, open: true, reason: 'override_on' }
  }

  if (parsedOverride === 'off') {
    return { ...base, open: false, reason: 'override_off' }
  }

  if (effectiveAtMs === null) {
    return { ...base, open: false, reason: 'notice_unknown' }
  }

  return effectiveAtMs <= now.getTime()
    ? { ...base, open: true, reason: 'notice_in_force' }
    : { ...base, open: false, reason: 'notice_pending' }
}

export function describeFeatureRolloutGate(gate: FeatureRolloutGate): string {
  switch (gate.reason) {
    case 'override_on':
      return 'Open: forced on by NUXT_FEATURES_ROLLOUT_ENABLED.'
    case 'override_off':
      return 'Closed: forced off by NUXT_FEATURES_ROLLOUT_ENABLED.'
    case 'notice_in_force':
      return `Open: the Privacy notice ${gate.noticeId} is in force since `
        + `${gate.effectiveAt}.`
    case 'notice_pending':
      return `Closed until the Privacy notice ${gate.noticeId} takes effect `
        + `on ${gate.effectiveAt}.`
    default:
      return `Closed: the notice ${gate.noticeId} is not in the registry.`
  }
}
