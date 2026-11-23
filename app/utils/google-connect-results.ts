import type { GoogleConnectResult } from '#shared/utils/google-connections'
import type { GoogleClientMode } from '#shared/utils/google-scopes'

export interface GoogleConnectResultMessage {
  type: 'success' | 'info' | 'error'
  title: string
  description?: string
}

type GoogleConnectResultMessages
  = Record<GoogleConnectResult, GoogleConnectResultMessage>

export const GOOGLE_CONNECT_RESULT_MESSAGES: Readonly<
  Record<GoogleClientMode, GoogleConnectResultMessages>
> = {
  besidka: {
    connected: { type: 'success', title: 'Google Drive connected' },
    partial: {
      type: 'info',
      title: 'Google Drive connected with less access',
      description: 'Only what Google granted is listed here.',
    },
    denied: {
      type: 'info',
      title: 'Google Drive was not connected',
      description: 'You canceled on the Google page.',
    },
    missing_scope: {
      type: 'error',
      title: 'Google Drive was not connected',
      description: 'Allow access to the files you pick, then try again.',
    },
    expired: {
      type: 'error',
      title: 'The connection timed out',
      description: 'Start again from here.',
    },
    error: {
      type: 'error',
      title: 'Google Drive could not be connected',
      description: 'Try again in a moment.',
    },
  },
  byo: {
    connected: { type: 'success', title: 'Google connected with your client' },
    partial: {
      type: 'info',
      title: 'Google granted only part of the access',
      description: 'Only what Google granted is listed here.',
    },
    denied: {
      type: 'info',
      title: 'Google was not connected',
      description: 'You canceled on the Google page.',
    },
    missing_scope: {
      type: 'error',
      title: 'Google was not connected',
      description: 'Google granted none of the access you asked for.',
    },
    expired: {
      type: 'error',
      title: 'The connection timed out',
      description: 'Start again from here.',
    },
    error: {
      type: 'error',
      title: 'Google could not be connected',
      description: 'Check the client id, secret and redirect URI, then try '
        + 'again.',
    },
  },
}

export function getGoogleConnectResultMessage(
  clientMode: GoogleClientMode,
  result: GoogleConnectResult,
): GoogleConnectResultMessage {
  return GOOGLE_CONNECT_RESULT_MESSAGES[clientMode][result]
}

export function reportGoogleConnectResult(
  clientMode: GoogleClientMode,
  result: GoogleConnectResult,
) {
  const message = getGoogleConnectResultMessage(clientMode, result)

  if (message.type === 'success') {
    useSuccessMessage(message.title, message.description)

    return
  }

  if (message.type === 'info') {
    useInfoMessage(message.title, message.description)

    return
  }

  useErrorMessage(message.title, message.description)
}
