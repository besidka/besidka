import type { KVNamespace } from '@cloudflare/workers-types'
import type { RequestLogger } from 'evlog'
import {
  GENERATION_GUARD_HEARTBEAT_INTERVAL_MS,
  GENERATION_GUARD_LEASE_TTL_SECONDS,
  GENERATION_GUARD_STOP_WAIT_MS,
} from '~~/server/utils/ai/generation-guard'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const GENERATION_STOP_KEY_PREFIX = 'chat-generation-stop'

export const GENERATION_STOP_TTL_SECONDS = 300
export const GENERATION_STOP_CHECK_INTERVAL_MS = 10_000
export const GENERATION_LEASE_READ_CACHE_TTL_SECONDS = 30
export const GENERATION_LEASE_STALE_MS = GENERATION_GUARD_HEARTBEAT_INTERVAL_MS
  + GENERATION_STOP_CHECK_INTERVAL_MS
  + GENERATION_LEASE_READ_CACHE_TTL_SECONDS * 1000
  + 20_000
export const GENERATION_STOPPED_REASON = 'stopped-by-user'
export const GENERATION_TAKEOVER_SETTLE_MS = 300

const LEASE_READ_OPTIONS = {
  cacheTtl: GENERATION_LEASE_READ_CACHE_TTL_SECONDS,
} as const
const ENDED_RUNS_KEPT = 200
const endedRunIds = new Set<string>()

/**
 * Remembers, in this isolate, a run that ended (stopped, disconnected or
 * finished). A retry served by the same isolate takes over its lease at
 * once, even when its KV read still comes from a cache that has not seen
 * the lease deleted or the stop marker written. Other isolates rely on KV.
 */
export function rememberEndedRun(runId: string): void {
  endedRunIds.delete(runId)
  endedRunIds.add(runId)

  if (endedRunIds.size <= ENDED_RUNS_KEPT) {
    return
  }

  const oldest = endedRunIds.values().next().value

  if (oldest !== undefined) {
    endedRunIds.delete(oldest)
  }
}

export function forgetEndedRunsForTests(): void {
  endedRunIds.clear()
}

type LeaseKv = Pick<KVNamespace, 'get' | 'put' | 'delete'>
type LeaseLogger = Pick<RequestLogger, 'set'>

/**
 * The value of a generation lease: which run holds it and when it last
 * renewed it. A lease written before runs had ids reads as `legacy`.
 */
export interface GenerationLease {
  runId: string
  renewedAt: number
}

export type GenerationLeaseState
  = | { state: 'free' }
    | { state: 'live', lease: GenerationLease | null }
    | { state: 'stopped' | 'stale', lease: GenerationLease }

export type GenerationRunState = 'current' | 'stopped' | 'taken-over'
export type GenerationStopReason = Exclude<GenerationRunState, 'current'>

export function generationStopKvKey(runId: string): string {
  return `${GENERATION_STOP_KEY_PREFIX}:${runId}`
}

export function createGenerationRunId(): string {
  return crypto.randomUUID()
}

export function serializeGenerationLease(lease: GenerationLease): string {
  return JSON.stringify(lease)
}

/**
 * The lease stored under a generation key: the run and its last renewal,
 * `null` for an older lease without a run id (it still blocks), or
 * `undefined` when nothing holds the key.
 */
export function parseGenerationLease(
  raw: string | null,
): GenerationLease | null | undefined {
  if (raw === null) {
    return undefined
  }

  try {
    const value: unknown = JSON.parse(raw)

    if (
      typeof value === 'object'
      && value !== null
      && typeof (value as GenerationLease).runId === 'string'
      && typeof (value as GenerationLease).renewedAt === 'number'
    ) {
      return value as GenerationLease
    }
  } catch {
    return null
  }

  return null
}

/**
 * Whether a send for the same message may start: `free` (no lease),
 * `stopped` (the user stopped the run that holds it) or `stale` (its holder
 * missed its heartbeat window, so its Worker is gone) may take over; `live`
 * must wait. A concurrent tab that really generates renews at least every
 * 40 s, so it stays `live` and is never taken over. `stoppedRunId` is the
 * run the stop route answered to this client: a lease that names it counts
 * as stopped without the stop marker, whose read may still come from a KV
 * cache that has not seen the marker yet.
 */
export async function readGenerationLeaseState(
  kv: Pick<KVNamespace, 'get'>,
  key: string,
  options: { now?: number, stoppedRunId?: string } = {},
): Promise<GenerationLeaseState> {
  const now = options.now ?? Date.now()
  const lease = parseGenerationLease(await kv.get(key, LEASE_READ_OPTIONS))

  if (lease === undefined) {
    return { state: 'free' }
  }

  if (lease === null) {
    return { state: 'live', lease: null }
  }

  if (
    endedRunIds.has(lease.runId)
    || (options.stoppedRunId && lease.runId === options.stoppedRunId)
  ) {
    return { state: 'stopped', lease }
  }

  if (await kv.get(generationStopKvKey(lease.runId), LEASE_READ_OPTIONS)) {
    return { state: 'stopped', lease }
  }

  return now - lease.renewedAt > GENERATION_LEASE_STALE_MS
    ? { state: 'stale', lease }
    : { state: 'live', lease }
}

export async function putGenerationLease(
  kv: Pick<KVNamespace, 'put'>,
  key: string,
  runId: string,
  logger: LeaseLogger,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    await kv.put(key, serializeGenerationLease({ runId, renewedAt: now }), {
      expirationTtl: GENERATION_GUARD_LEASE_TTL_SECONDS,
    })

    return true
  } catch (exception) {
    logger.set({
      attributes: {
        generationGuard: {
          operation: 'put',
          error: exceptionMessage(exception),
        },
      },
    })

    return false
  }
}

/**
 * For a run that took over a stopped or stale lease: after writing its own
 * lease it waits `settleMs` and reads the lease back. KV has no
 * compare-and-set, so two retries that both saw the old run stopped (two
 * tabs, a double click) both write; the one whose write landed last keeps
 * the lease, and the other gives way before it calls the provider. If both
 * read the other's write through a cache, both give way and the client's
 * resend a few seconds later goes through. A failed read lets the run go
 * on, as before.
 */
export async function confirmLeaseHolder(input: {
  kv: Pick<KVNamespace, 'get'>
  key: string
  runId: string
  logger: LeaseLogger
  settleMs?: number
}): Promise<boolean> {
  await new Promise((resolve) => {
    setTimeout(resolve, input.settleMs ?? GENERATION_TAKEOVER_SETTLE_MS)
  })

  try {
    const lease = parseGenerationLease(
      await input.kv.get(input.key, LEASE_READ_OPTIONS),
    )

    return lease?.runId === input.runId
  } catch (exception) {
    input.logger.set({
      attributes: {
        generationGuard: {
          operation: 'confirm-holder',
          error: exceptionMessage(exception),
        },
      },
    })

    return true
  }
}

/**
 * Stops the run that holds a generation lease, for the stop route: marks
 * that run stopped (it notices within `GENERATION_STOP_CHECK_INTERVAL_MS`,
 * aborts and stores its partial reply as stopped) and deletes the lease, so
 * a retry of the same message starts at once. The delete runs even when the
 * read found nothing, because that read can come from a stale KV cache; a
 * run whose lease disappears treats that as a stop too. An older lease
 * without a run id is only deleted. Returns the run it stopped, which the
 * client sends back with its retry.
 */
export async function stopGenerationLease(
  kv: LeaseKv,
  key: string,
): Promise<{ hadLease: boolean, runId: string | null }> {
  const lease = parseGenerationLease(await kv.get(key, LEASE_READ_OPTIONS))

  if (lease) {
    await kv.put(generationStopKvKey(lease.runId), '1', {
      expirationTtl: GENERATION_STOP_TTL_SECONDS,
    })
  }

  await kv.delete(key)

  return { hadLease: lease !== undefined, runId: lease?.runId ?? null }
}

export interface DisconnectedRunEnd {
  leaseReleased: boolean
  error?: string
}

/**
 * Ends the run whose client stopped reading its reply. Workers cancel the
 * invocation soon after a client disconnect, so the run's own `finally`
 * that deletes the lease never runs and a retry of the same message was
 * told "still generating" until the lease turned stale (up to 90 s plus
 * the 30 s read cache). This writes the run's stop marker and deletes the
 * lease while it still names this run (never a successor's), so a retry
 * need not wait for the stale window; a retry whose read comes from a cache
 * that has not seen either write yet waits at most one cache lifetime. The
 * route also ends a run that is still alive in-process (`markStopped`), so
 * it stores what it has as a stopped reply, as after the stop route.
 */
export async function endDisconnectedRun(input: {
  kv: LeaseKv
  key: string
  runId: string
}): Promise<DisconnectedRunEnd> {
  rememberEndedRun(input.runId)

  try {
    await input.kv.put(generationStopKvKey(input.runId), '1', {
      expirationTtl: GENERATION_STOP_TTL_SECONDS,
    })

    const lease = parseGenerationLease(
      await input.kv.get(input.key, LEASE_READ_OPTIONS),
    )

    if (lease?.runId !== input.runId) {
      return { leaseReleased: false }
    }

    await input.kv.delete(input.key)

    return { leaseReleased: true }
  } catch (exception) {
    return { leaseReleased: false, error: exceptionMessage(exception) }
  }
}

export interface GenerationRun {
  readonly runId: string
  isStopped: () => boolean
  markStopped: () => void
  confirmState: () => Promise<GenerationRunState>
  stop: () => Promise<void>
  release: () => Promise<void>
  getRenewalCount: () => number
}

/**
 * Keeps one run's lease alive and watches for a stop. Every
 * `GENERATION_STOP_CHECK_INTERVAL_MS` it reads the lease and the run's stop
 * marker. A lease that now names another run (a retry took over) ends the
 * run as `taken-over`; a stop marker, or its own lease gone after it was
 * seen once (the stop route deletes it), ends it as `stopped`. Either calls
 * `onStopped` once and the run never renews again. Otherwise it renews the
 * lease every `GENERATION_GUARD_HEARTBEAT_INTERVAL_MS`.
 *
 * `confirmState` checks the lease and the stop marker once more right
 * before the run stores its reply: `current` stores it as usual, `stopped`
 * stores it marked as stopped, `taken-over` stores nothing because a retry
 * answers instead (a run stopped earlier reads the lease again, because a
 * retry may have taken over since). A missing lease counts as a stop only
 * while the run's own renewals are recent; a lease that expired because KV
 * writes failed for two minutes does not end the run.
 *
 * `markStopped` ends the run as `stopped` in this invocation, without a KV
 * read: the disconnect hook uses it so the reply is stored as stopped even
 * while cached reads still show the lease and no marker.
 *
 * `supersededRunId` is the run this one took over. If that run is still
 * alive and missed its stop (a cached KV read), its renewal can overwrite
 * this run's lease once before it sees the takeover; this run then writes
 * its own lease back at once instead of ending itself. `release` stops the
 * timer and deletes the lease only while this run still holds it, so a run
 * that was taken over never deletes its successor's lease.
 */
export function startGenerationRun(input: {
  kv: LeaseKv
  key: string
  runId: string
  logger: LeaseLogger
  onStopped: (reason: GenerationStopReason) => void
  supersededRunId?: string
  now?: () => number
}): GenerationRun {
  const now = input.now ?? Date.now
  let state: GenerationRunState = 'current'
  let hasSeenOwnLease = false
  let renewalCount = 0
  let lastRenewedAt = now()
  let inFlight: Promise<void> | null = null

  function markStopped(reason: GenerationStopReason) {
    if (state !== 'current') {
      return
    }

    state = reason
    clearInterval(timer)
    rememberEndedRun(input.runId)
    input.logger.set({ attributes: { generationGuard: { stopped: reason } } })
    input.onStopped(reason)
  }

  async function readStopReason(): Promise<
    GenerationStopReason | 'superseded-renewal' | null
  > {
    const lease = parseGenerationLease(
      await input.kv.get(input.key, LEASE_READ_OPTIONS),
    )

    if (lease && lease.runId === input.supersededRunId) {
      return 'superseded-renewal'
    }

    if (lease && lease.runId !== input.runId) {
      return 'taken-over'
    }

    if (lease?.runId === input.runId) {
      hasSeenOwnLease = true
    }

    if (await input.kv.get(
      generationStopKvKey(input.runId),
      LEASE_READ_OPTIONS,
    )) {
      return 'stopped'
    }

    const couldHaveExpired = now() - lastRenewedAt
      >= GENERATION_GUARD_LEASE_TTL_SECONDS * 1000

    return lease === undefined && hasSeenOwnLease && !couldHaveExpired
      ? 'stopped'
      : null
  }

  async function renew(): Promise<void> {
    if (await putGenerationLease(
      input.kv,
      input.key,
      input.runId,
      input.logger,
      now(),
    )) {
      renewalCount += 1
      lastRenewedAt = now()
    }
  }

  async function check(): Promise<void> {
    try {
      const reason = await readStopReason()

      if (reason === 'superseded-renewal') {
        input.logger.set({
          attributes: { generationGuard: { supersededRenewal: true } },
        })
        await renew()

        return
      }

      if (reason) {
        markStopped(reason)

        return
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          generationGuard: {
            operation: 'check',
            error: exceptionMessage(exception),
          },
        },
      })
    }

    if (now() - lastRenewedAt < GENERATION_GUARD_HEARTBEAT_INTERVAL_MS) {
      return
    }

    await renew()
  }

  const timer = setInterval(() => {
    if (inFlight || state !== 'current') {
      return
    }

    inFlight = check().finally(() => {
      inFlight = null
    })
  }, GENERATION_STOP_CHECK_INTERVAL_MS)

  async function stop(): Promise<void> {
    clearInterval(timer)

    if (!inFlight) {
      return
    }

    let waitTimer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<void>((resolve) => {
      waitTimer = setTimeout(resolve, GENERATION_GUARD_STOP_WAIT_MS)
    })

    await Promise.race([inFlight, waited])
    clearTimeout(waitTimer)
  }

  async function release(): Promise<void> {
    rememberEndedRun(input.runId)
    await stop()

    try {
      const lease = parseGenerationLease(
        await input.kv.get(input.key, LEASE_READ_OPTIONS),
      )

      if (lease && lease.runId === input.runId) {
        await input.kv.delete(input.key)
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          generationGuard: {
            operation: 'delete',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  async function readTakeoverAfterStop(): Promise<void> {
    try {
      const lease = parseGenerationLease(
        await input.kv.get(input.key, LEASE_READ_OPTIONS),
      )

      if (lease && lease.runId !== input.runId) {
        state = 'taken-over'
        input.logger.set({
          attributes: { generationGuard: { stopped: state } },
        })
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          generationGuard: {
            operation: 'confirm',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  async function confirmState(): Promise<GenerationRunState> {
    if (state === 'current') {
      await (inFlight ?? check())
    }

    if (state === 'stopped') {
      await readTakeoverAfterStop()
    }

    return state
  }

  return {
    runId: input.runId,
    isStopped: () => state !== 'current',
    markStopped: () => markStopped('stopped'),
    confirmState,
    stop,
    release,
    getRenewalCount: () => renewalCount,
  }
}
