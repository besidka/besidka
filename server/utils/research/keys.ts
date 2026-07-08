import type { ResearchProviderId } from '#shared/types/research.d'

export async function getDecryptedProviderKey(
  userId: number,
  provider: ResearchProviderId,
): Promise<string | null> {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId,
      provider,
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    return null
  }

  return await useDecryptText(data.apiKey)
}
