export const persistedMessageRoles = ['user', 'assistant'] as const

export type PersistedMessageRole = typeof persistedMessageRoles[number]

export function isPersistedMessageRole(
  role: string,
): role is PersistedMessageRole {
  return persistedMessageRoles.includes(
    role as PersistedMessageRole,
  )
}
