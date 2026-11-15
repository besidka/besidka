import { parseError } from 'evlog'
import type { SkillFinding } from '#shared/utils/skills/findings'
import type {
  SkillJevMark,
  SkillJevRange,
} from '#shared/utils/skills/jev-findings'

export type SkillJevScreenTarget
  = | { kind: 'stage', stageId: string }
    | { kind: 'version', skillId: string, version: number }

export interface SkillJevScreenView {
  kind: 'hidden' | 'checking' | 'still-checking' | 'finished' | 'failed'
  marks: SkillJevMark[]
  unchecked: SkillJevRange[]
  isKeyRejected: boolean
  message: string
  callsLeft: number
  canCheckRest: boolean
  isBusy: boolean
}

export const SKILL_JEV_POLL_LIMIT = 5
export const SKILL_JEV_POLL_DELAY_MS = 2000

function requestScreen(target: SkillJevScreenTarget, rest: boolean) {
  const body = rest ? { rest: true } : {}

  if (target.kind === 'stage') {
    return $fetch(`/api/v1/skills/import/${target.stageId}/screen`, {
      method: 'POST',
      body,
    })
  }

  return $fetch(
    `/api/v1/skills/${target.skillId}/versions/${target.version}/screen`,
    { method: 'POST', body },
  )
}

type ScreenResponse = Awaited<ReturnType<typeof requestScreen>>

function readScreenResponse(value: unknown): ScreenResponse | null {
  const candidate = value as Partial<ScreenResponse> | null | undefined

  if (
    typeof candidate !== 'object'
    || candidate === null
    || typeof candidate.state !== 'string'
    || !Array.isArray(candidate.marks)
    || !Array.isArray(candidate.unchecked)
  ) {
    return null
  }

  return candidate as ScreenResponse
}

function getTargetKey(target: SkillJevScreenTarget | null): string {
  if (!target) {
    return ''
  }

  return target.kind === 'stage'
    ? `stage:${target.stageId}`
    : `version:${target.skillId}:${target.version}`
}

/**
 * The optional TypeSafe AI check of a skill under review. It runs once when
 * a target appears (the review screen opens), POSTs `{}`, retries briefly
 * while another request holds the check, and never blocks anything: the
 * review is usable in every state. "Check the rest" is the only way to
 * spend more, and it is the user's click. Responses that arrive after the
 * target changed or the screen closed are dropped.
 */
export function useSkillJevScreen(
  getTarget: () => SkillJevScreenTarget | null,
) {
  const phase = shallowRef<
    'idle' | 'checking' | 'still-checking' | 'finished' | 'failed'
  >('idle')
  const response = shallowRef<ScreenResponse | null>(null)
  const failureMessage = shallowRef<string>('')
  const isBusy = shallowRef<boolean>(false)
  let generation = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function wait(): Promise<void> {
    return new Promise((resolve) => {
      pollTimer = setTimeout(resolve, SKILL_JEV_POLL_DELAY_MS)
    })
  }

  function reset() {
    generation += 1
    stopPolling()
    phase.value = 'idle'
    response.value = null
    failureMessage.value = ''
    isBusy.value = false
  }

  async function run(rest: boolean = false) {
    const target = getTarget()

    if (!import.meta.client || !target || isBusy.value) {
      return
    }

    const current = ++generation

    isBusy.value = true
    phase.value = 'checking'
    failureMessage.value = ''

    try {
      for (let attempt = 0; attempt <= SKILL_JEV_POLL_LIMIT; attempt++) {
        const value = readScreenResponse(await requestScreen(target, rest))

        if (current !== generation) {
          return
        }

        response.value = value

        if (!value || value.state === 'unavailable') {
          phase.value = 'idle'

          return
        }

        if (value.state === 'screened') {
          phase.value = value.status === 'ok' ? 'finished' : 'failed'

          return
        }

        if (attempt === SKILL_JEV_POLL_LIMIT) {
          phase.value = 'still-checking'

          return
        }

        await wait()

        if (current !== generation) {
          return
        }
      }
    } catch (exception) {
      if (current !== generation) {
        return
      }

      const parsedException = parseError(exception)

      failureMessage.value = parsedException.message
        || 'The check could not run.'
      phase.value = 'failed'
    } finally {
      if (current === generation) {
        isBusy.value = false
      }
    }
  }

  const view = computed<SkillJevScreenView>(() => {
    const value = response.value
    const status = value?.status ?? 'ok'

    return {
      kind: phase.value === 'idle' ? 'hidden' : phase.value,
      marks: value?.marks ?? [],
      unchecked: value?.unchecked ?? [],
      isKeyRejected: status === 'key-error',
      message: failureMessage.value,
      callsLeft: value?.callsLeft ?? 0,
      canCheckRest: phase.value === 'finished'
        && (value?.unchecked.length ?? 0) > 0
        && (value?.callsLeft ?? 0) > 0,
      isBusy: isBusy.value,
    }
  })

  const findings = computed<SkillFinding[]>(() => {
    if (phase.value === 'idle') {
      return []
    }

    return (response.value?.findings ?? []) as SkillFinding[]
  })

  watch(
    () => getTargetKey(getTarget()),
    async (key) => {
      reset()

      if (key) {
        await run()
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    generation += 1
    stopPolling()
  })

  return {
    view,
    findings,
    run,
    checkRest: () => run(true),
  }
}
