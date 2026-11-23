import type { KVNamespace } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import { GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR } from '#shared/utils/google-tool-catalog'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  claimApproval,
  markClaimDone,
  markClaimFailed,
} from '~~/server/utils/tool-approval/claims'
import type { ToolApprovalClaimOwner } from '~~/server/utils/tool-approval/claims'

type DbClient = ReturnType<typeof useDb>

const EXECUTION_ID_PREFIX = 'exec_'
const HOUR_MS = 60 * 60 * 1000
const KV_KEY_PREFIX = 'google-always-allow-writes'
const KV_KEY_TTL_SECONDS = 2 * 60 * 60
const KV_MIN_WRITE_SPACING_MS = 1100

export const GOOGLE_RUN_ALREADY_CLAIMED_TEXT = 'This Google call was already '
  + 'started once, so it did not run again. It may or may not have finished: '
  + 'tell the user to check Google before asking for it again.'

export const GOOGLE_RUN_HOURLY_CAP_TEXT = 'Always allow has reached its '
  + `limit of ${GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR} Google write calls an `
  + 'hour, so this call did not run. Stop calling Google write tools now. '
  + 'Tell the user what is done and that the rest can continue in the next '
  + 'hour.'

export const GOOGLE_RUN_UNAVAILABLE_TEXT = 'Besidka could not check the '
  + 'limit of Google write calls without asking, so this call did not run. '
  + 'Tell the user and stop calling Google write tools.'

export const GOOGLE_RUN_NO_GATE_TEXT = 'Besidka could not record this Google '
  + 'write, so it did not run. Tell the user the action did not happen.'

/**
 * One Google write that runs because the user set its tool to Always allow.
 * `executionId` is what the write derives its retry key from, in place of
 * the approval id it does not have; `settle` records the result on the
 * claim.
 */
export interface GoogleRun {
  executionId: string
  settle: (isError: boolean) => Promise<void>
}

export interface GoogleRunGate {
  begin: (toolCallId: string) => Promise<GoogleRun>
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * The server-derived identity of one always-allowed write: a SHA-256 of the
 * user, chat, message and the provider's tool call id, so the same call can
 * only ever claim one id and a call in another chat or message never
 * shares it. It is never read from the model's input.
 */
export async function buildGoogleExecutionId(
  owner: ToolApprovalClaimOwner,
  toolCallId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode([
      'google-always-allow',
      owner.userId,
      owner.chatPublicId,
      owner.messagePublicId,
      toolCallId,
    ].join(':')),
  )

  return `${EXECUTION_ID_PREFIX}${toBase64Url(new Uint8Array(digest))}`
}

function refusal(message: string, why: string) {
  return createError({
    message,
    status: 429,
    why,
    fix: 'Tell the user what happened in plain words.',
  })
}

/**
 * The hourly write budget of a user: a KV counter per clock hour, written
 * at most once every 1.1 seconds because KV takes about one write a second
 * per key. A flood guard rather than exact accounting. Fails closed: a KV
 * error refuses the write.
 */
function createHourlyWriteBudget(input: {
  kv: KVNamespace
  userId: number
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}): () => Promise<'granted' | 'exhausted' | 'unavailable'> {
  let lastWriteAt = 0

  return async () => {
    const hour = Math.floor(input.now() / HOUR_MS)
    const key = `${KV_KEY_PREFIX}:${input.userId}:${hour}`

    try {
      const stored = Number(await input.kv.get(key))
      const count = Number.isFinite(stored) && stored > 0 ? stored : 0

      if (count >= GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR) {
        return 'exhausted'
      }

      const wait = lastWriteAt + KV_MIN_WRITE_SPACING_MS - input.now()

      if (wait > 0) {
        await input.sleep(wait)
      }

      lastWriteAt = input.now()
      await input.kv.put(key, String(count + 1), {
        expirationTtl: KV_KEY_TTL_SECONDS,
      })

      return 'granted'
    } catch {
      return 'unavailable'
    }
  }
}

/**
 * The gate every Google write that runs without asking passes first. It
 * claims the call in the same `tool_approval_claims` table that gives "one
 * approval, one write" (the claim id is the execution id), so the same tool
 * call can never run twice, then takes one write from the user's hourly
 * budget. A lost claim, a spent budget or an unreadable counter refuses the
 * call with a sentence the model can read and records nothing else; the
 * caller settles the claim after the write ran.
 */
export function createGoogleRunGate(input: {
  db: DbClient
  kv: KVNamespace
  owner: ToolApprovalClaimOwner
  logger: LoggerLike
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}): GoogleRunGate {
  const { db, owner, logger } = input
  const takeHourlyWrite = createHourlyWriteBudget({
    kv: input.kv,
    userId: owner.userId,
    now: input.now ?? Date.now,
    sleep: input.sleep ?? (milliseconds => new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    })),
  })

  async function recordResult(
    executionId: string,
    isError: boolean,
  ): Promise<void> {
    try {
      if (isError) {
        await markClaimFailed(db, executionId, owner.userId)
      } else {
        await markClaimDone(db, executionId, owner.userId)
      }
    } catch (exception) {
      logger.set({
        attributes: {
          googleAlwaysAllow: {
            claimFinish: 'failed',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  return {
    begin: async (toolCallId) => {
      const executionId = await buildGoogleExecutionId(owner, toolCallId)
      const isClaimed = await claimApproval(db, executionId, owner)

      if (!isClaimed) {
        logger.set({
          attributes: { googleAlwaysAllow: { claim: 'already-claimed' } },
        })

        throw refusal(
          GOOGLE_RUN_ALREADY_CLAIMED_TEXT,
          'The same tool call id was already claimed.',
        )
      }

      const budget = await takeHourlyWrite()

      if (budget !== 'granted') {
        await recordResult(executionId, true)
        logger.set({
          attributes: { googleAlwaysAllow: { hourlyWrites: budget } },
        })

        throw refusal(
          budget === 'exhausted'
            ? GOOGLE_RUN_HOURLY_CAP_TEXT
            : GOOGLE_RUN_UNAVAILABLE_TEXT,
          budget === 'exhausted'
            ? 'The hourly limit of Always allow writes was reached.'
            : 'The hourly counter could not be read or written.',
        )
      }

      return {
        executionId,
        settle: isError => recordResult(executionId, isError),
      }
    },
  }
}
