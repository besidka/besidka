import type { Experimental_DecisionModel } from 'ai'
import {
  JEV_SEND_PATH_MAX_TURN_CHARS,
  JEV_SEND_PATH_TIMEOUT_MS,
} from '#shared/utils/jev-policy'
import { jevDecide } from '~~/server/utils/jev/client'
import type { JevDecideResult, JevQuestions } from '~~/server/utils/jev/client'
import { redactNeverStore } from '~~/server/utils/memory/compliance'

export type SendPathTurnRole = 'user' | 'assistant'

export type SendPathTurn = {
  role: SendPathTurnRole
  text: string
}

export type SendPathJevState = {
  message: string
  recent_turns: SendPathTurn[]
}

interface SendPathMessage {
  role: string
  parts: ReadonlyArray<{ type: string, text?: string }> | null | undefined
}

function isSendPathTurnRole(role: string): role is SendPathTurnRole {
  return role === 'user' || role === 'assistant'
}

function readTextParts(parts: SendPathMessage['parts']): string {
  return (parts ?? [])
    .flatMap((part) => {
      return part.type === 'text' && typeof part.text === 'string'
        ? [part.text]
        : []
    })
    .join('\n')
    .trim()
}

function prepareTurnText(text: string): string {
  return redactNeverStore(text).text.slice(0, JEV_SEND_PATH_MAX_TURN_CHARS)
}

/**
 * The last `limit` user and assistant turns that carry text, oldest first,
 * as plain text. Pass the persisted messages before the one being sent.
 */
export function readSendPathTurns(
  messages: readonly SendPathMessage[],
  limit: number,
): SendPathTurn[] {
  const turns: SendPathTurn[] = []

  for (const message of messages) {
    const text = readTextParts(message.parts)

    if (isSendPathTurnRole(message.role) && text) {
      turns.push({ role: message.role, text })
    }
  }

  return limit > 0 ? turns.slice(-limit) : []
}

/**
 * The Jev state every send-path role shares: `message` and `recent_turns`,
 * the keys the role wordings refer to. Never-store values are removed from
 * every text before it can leave Besidka, and each text is capped at
 * `JEV_SEND_PATH_MAX_TURN_CHARS`.
 */
export function buildSendPathJevState(input: {
  messageText: string
  recentTurns: readonly SendPathTurn[]
}): SendPathJevState {
  return {
    message: prepareTurnText(input.messageText),
    recent_turns: input.recentTurns.map((turn) => {
      return { role: turn.role, text: prepareTurnText(turn.text) }
    }),
  }
}

/**
 * One Jev call on the send path for any set of questions, so roles that
 * read the same message (Auto web search, past-chat retrieval) can share a
 * single round trip by merging their question maps. Never throws.
 */
export async function decideSendPathJev(input: {
  model: Experimental_DecisionModel
  state: SendPathJevState
  questions: JevQuestions
  abortSignal?: AbortSignal
}): Promise<JevDecideResult> {
  return await jevDecide({
    model: input.model,
    state: input.state,
    questions: input.questions,
    timeoutMs: JEV_SEND_PATH_TIMEOUT_MS,
    abortSignal: input.abortSignal,
  })
}
