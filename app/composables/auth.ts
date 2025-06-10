import { createAuthClient } from 'better-auth/vue'

let _authClient: ReturnType<typeof createAuthClient> | null = null

export function useClientAuth(): ReturnType<typeof createAuthClient> {
  if (_authClient) {
    return _authClient
  }

  _authClient = createAuthClient()

  return _authClient
}
