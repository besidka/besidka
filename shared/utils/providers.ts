import type { Providers } from '#shared/types/providers.d'

export function getProviders(): {
  providers: Providers
} {
  const { providers } = useRuntimeConfig().public

  return {
    providers: providers as Providers,
  }
}
