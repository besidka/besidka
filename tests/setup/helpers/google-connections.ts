import { vi } from 'vitest'

export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
export const GOOGLE_CLIENT_SECRET = 'test-client-secret'
export const GOOGLE_SUBJECT = '108000000000000000001'
export const GOOGLE_EMAIL = 'person@example.test'
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const GRANTED_SCOPE_STRING = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  DRIVE_FILE_SCOPE,
].join(' ')

export interface FakeGoogleReply {
  status: number
  body: Record<string, unknown> | string
}

export interface FakeGoogleRequest {
  url: string
  method: string
  form: URLSearchParams
  redirect: RequestRedirect | undefined
}

export interface FakeGoogleOptions {
  token?: (form: URLSearchParams) => FakeGoogleReply
  revoke?: (form: URLSearchParams) => FakeGoogleReply
}

function encodeSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function makeIdToken(claims: Record<string, unknown> = {}): string {
  return [
    encodeSegment({ alg: 'RS256', typ: 'JWT' }),
    encodeSegment({
      iss: 'https://accounts.google.com',
      aud: GOOGLE_CLIENT_ID,
      sub: GOOGLE_SUBJECT,
      email: GOOGLE_EMAIL,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
    'signature',
  ].join('.')
}

export function defaultTokenReply(form: URLSearchParams): FakeGoogleReply {
  if (form.get('grant_type') === 'refresh_token') {
    return {
      status: 200,
      body: {
        access_token: `access-refreshed-${Math.random()}`,
        expires_in: 3599,
        token_type: 'Bearer',
        scope: GRANTED_SCOPE_STRING,
      },
    }
  }

  return {
    status: 200,
    body: {
      access_token: 'access-initial',
      refresh_token: 'refresh-initial',
      expires_in: 3599,
      token_type: 'Bearer',
      scope: GRANTED_SCOPE_STRING,
      id_token: makeIdToken(),
    },
  }
}

/**
 * A stand-in for Google's token and revoke endpoints. Tests never reach
 * Google: every request lands here and is recorded with its form body.
 */
export function createFakeGoogle(options: FakeGoogleOptions = {}) {
  const requests: FakeGoogleRequest[] = []
  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const form = new URLSearchParams(String(init.body ?? ''))

    requests.push({
      url: url.toString(),
      method: init.method ?? 'GET',
      form,
      redirect: init.redirect,
    })

    let reply: FakeGoogleReply

    if (url.pathname === '/token') {
      reply = (options.token ?? defaultTokenReply)(form)
    } else if (url.pathname === '/revoke') {
      reply = options.revoke?.(form) ?? { status: 200, body: {} }
    } else {
      reply = { status: 404, body: { error: 'not_found' } }
    }

    return new Response(
      typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      },
    )
  })

  return {
    fetch,
    requests,
    tokenRequests: () => requests.filter((request) => {
      return request.url.endsWith('/token')
    }),
    revokeRequests: () => requests.filter((request) => {
      return request.url.endsWith('/revoke')
    }),
  }
}

export type FakeGoogle = ReturnType<typeof createFakeGoogle>

/**
 * Server code reads the shared runtime config object of the node test
 * setup, not a global, so the Google client values are written onto it and
 * the returned function puts the previous values back.
 */
export async function useGoogleRuntimeConfig(): Promise<() => void> {
  const runtimeConfig = (await import('#app/nuxt')).useRuntimeConfig() as
    unknown as Record<string, unknown>
  const previous = {
    googleClientId: runtimeConfig.googleClientId,
    googleClientSecret: runtimeConfig.googleClientSecret,
  }

  runtimeConfig.googleClientId = GOOGLE_CLIENT_ID
  runtimeConfig.googleClientSecret = GOOGLE_CLIENT_SECRET

  return () => {
    Object.assign(runtimeConfig, previous)
  }
}

export function createFakeBucket() {
  const deletedBatches: string[][] = []

  return {
    deletedBatches,
    delete: vi.fn(async (keys: string | string[]) => {
      deletedBatches.push(Array.isArray(keys) ? [...keys] : [keys])
    }),
  }
}

export type FakeBucket = ReturnType<typeof createFakeBucket>
