import { createError } from 'evlog'
import { GOOGLE_DRIVE_CALLS_PER_MESSAGE } from '#shared/utils/google-drive-tools'
import type { LoggerLike } from '~~/server/utils/files/logger'

/**
 * The pacing of every Google tool call of one send: calls run one at a
 * time, and at most `GOOGLE_DRIVE_CALLS_PER_MESSAGE` count for one message
 * across its rounds and approvals (`priorCalls` are the Google calls the
 * reply already holds). One guard serves every Google tool builder of a
 * send, so the Drive tools and the bring-your-own tools share one chain and
 * one count; two builders with their own would run in parallel and double
 * the cap.
 */
export interface GoogleSendGuard {
  serialized: <Result>(run: () => Promise<Result>) => Promise<Result>
  consumeCall: () => void
}

export function createGoogleSendGuard(input: {
  priorCalls: number
  logger: LoggerLike
}): GoogleSendGuard {
  let callsThisSend = 0
  let chain: Promise<unknown> = Promise.resolve()

  return {
    serialized<Result>(run: () => Promise<Result>): Promise<Result> {
      const next = chain.then(run, run)

      chain = next.catch(() => undefined)

      return next
    },
    consumeCall(): void {
      if (input.priorCalls + callsThisSend >= GOOGLE_DRIVE_CALLS_PER_MESSAGE) {
        input.logger.set({
          attributes: { googleTools: { callCapReached: true } },
        })

        throw createError({
          message: 'The limit of Google tool calls for this message was '
            + `reached (${GOOGLE_DRIVE_CALLS_PER_MESSAGE}). Tell the user `
            + 'what you have done so far and that they can send a new '
            + 'message to go on.',
          status: 429,
          why: 'The Google tool call cap of one message was reached.',
          fix: 'Tell the user what happened in plain words.',
        })
      }

      callsThisSend += 1
    },
  }
}
