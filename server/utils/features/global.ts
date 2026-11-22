import type { RequestEvent } from 'nuxt/server'
import type { FeatureEvaluationContext } from '~~/server/utils/features/provider'
import { getFeatureDefinition } from '#shared/utils/features/registry'
import { useFeatureContext } from '~~/server/utils/features/context'
import { evaluateFeature } from '~~/server/utils/features/evaluate'
import { createFeatureUnavailableError } from '~~/server/utils/features/guards'

type GlobalFeatureContext = Pick<
  FeatureEvaluationContext,
  'rules' | 'config' | 'hasBinding'
>

const GLOBALLY_ENABLED_REASON = 'ANONYMOUS'

/**
 * True when `flag` and every parent pass the steps that apply to everyone
 * (available, env kill switch, host mode, bindings, the admin rule's
 * `enabled`), evaluated as an anonymous caller so no grant, role or opt-in
 * can switch it on. Public surfaces that anonymous viewers reach use this
 * instead of the viewer's own flag, which always resolves to the default.
 */
export async function isFeatureGloballyEnabled(
  flag: string,
  context: GlobalFeatureContext,
): Promise<boolean> {
  let definition = getFeatureDefinition(flag)

  if (!definition) {
    return false
  }

  while (definition) {
    const resolution = await evaluateFeature(definition.key, {
      ...context,
      userState: null,
    })

    if (resolution.reason !== GLOBALLY_ENABLED_REASON) {
      return false
    }

    definition = definition.parent
      ? getFeatureDefinition(definition.parent)
      : undefined
  }

  return true
}

export async function isFeatureGloballyEnabledForEvent(
  event: Pick<RequestEvent, 'context'>,
  flag: string,
): Promise<boolean> {
  const { rules, config } = await useFeatureContext(event)

  return isFeatureGloballyEnabled(flag, { rules, config })
}

/**
 * Throws the same 404 as `requireFeature` when `flag` is off for everyone.
 */
export async function requireGlobalFeature(
  event: Pick<RequestEvent, 'context'>,
  flag: string,
): Promise<void> {
  if (await isFeatureGloballyEnabledForEvent(event, flag)) {
    return
  }

  throw createFeatureUnavailableError()
}
