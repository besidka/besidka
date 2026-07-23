export type AuthSession = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof useServerAuth>['api']['getSession']>
  >
>

declare module 'h3' {
  interface H3EventContext {
    authSession?: AuthSession
  }
}
