import type { McpAuthContext } from '~~/server/utils/mcp/auth'
import type { FeatureRequestContext } from '~~/server/utils/features/context'

export type AuthSession = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof useServerAuth>['api']['getSession']>
  >
>

declare module 'h3' {
  interface H3EventContext {
    authSession?: AuthSession
    mcpAuth?: McpAuthContext
    features?: Promise<FeatureRequestContext>
  }
}
