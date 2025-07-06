export function getProviders(): {
  providers: Providers
} {
  const { providers } = useRuntimeConfig().public

  return {
    providers: providers as Providers,
  }
}
