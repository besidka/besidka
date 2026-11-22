import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isFeatureActive,
  isFeatureKillSwitched,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'

export interface BackgroundFeatureCheckInput {
  flag: string
  db: ReturnType<typeof useDb>
  kv: FeatureKv
  config?: FeatureEvaluationConfig
  logger?: LoggerLike
}

export interface BackgroundFeatureCheck {
  isKillSwitched: boolean
  isActiveForUser: (userId: number) => Promise<boolean>
}

/**
 * Feature evaluation for work that runs without a request: a cron or a
 * queue. It uses the same evaluator and the same "active" rule as
 * `requireFeature` (the flag and its parents resolved for the user, and the
 * user's Labs toggle on). The rules load from KV or D1 on the first user
 * only, and each user is evaluated at most once per check, so a job pays one
 * D1 batch per account it actually looks at. `isKillSwitched` is known up
 * front, so a job can stop before it reads anything.
 */
export function createBackgroundFeatureCheck(
  input: BackgroundFeatureCheckInput,
): BackgroundFeatureCheck {
  const config = input.config ?? getFeatureEvaluationConfig()
  const verdicts = new Map<number, boolean>()
  let rulesPromise: ReturnType<typeof loadFeatureRules> | undefined

  async function isActiveForUser(userId: number): Promise<boolean> {
    const cached = verdicts.get(userId)

    if (cached !== undefined) {
      return cached
    }

    rulesPromise ??= loadFeatureRules(input.kv, input.db, input.logger)

    const [rules, userState] = await Promise.all([
      rulesPromise,
      loadUserFeatureState(input.db, userId),
    ])
    const resolution = await evaluateFeature(input.flag, {
      rules,
      userState,
      config,
    })
    const verdict = isFeatureActive(input.flag, resolution, userState)

    verdicts.set(userId, verdict)

    return verdict
  }

  return {
    isKillSwitched: isFeatureKillSwitched(input.flag, config),
    isActiveForUser,
  }
}
