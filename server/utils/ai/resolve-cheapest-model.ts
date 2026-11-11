import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import type { SupportedProviderId } from '#shared/types/providers.d'
import { createError } from 'evlog'
import { providers } from '~~/providers'
import type { LegalConsentRecord } from '~~/server/utils/legal/consent'
import { withoutUnconsentedTransferProviders } from '~~/server/utils/legal/consent'
import { isUsableMemoryCatalogModel } from '~~/server/utils/memory/catalog-usability'

type DbClient = ReturnType<typeof useDb>

export const DIRECT_MODEL_PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'qwen',
  'deepseek',
  'google',
  'moonshotai',
  'xai',
] as const

export type DirectModelReasoning = 'low' | 'medium' | 'high' | undefined

export type DirectModelProviderOptions = Record<
  string,
  SharedV2ProviderOptions
>

export interface DirectModelInstance {
  model: LanguageModel
  reasoning: DirectModelReasoning
  providerOptions: DirectModelProviderOptions
}

export interface DirectModelCandidate {
  providerId: SupportedProviderId
  modelId: string
  modelName: string
}

export function isDirectModelProvider(
  providerId: string,
): providerId is SupportedProviderId {
  return (DIRECT_MODEL_PROVIDER_ORDER as readonly string[])
    .includes(providerId)
}

/**
 * The key-provider ids the user saved a key for, minus the providers whose
 * cross-border transfer the user has not consented to. Gateway keys stay in
 * the set under their own key-provider id; callers that need a direct
 * provider check `isDirectModelProvider` themselves.
 */
export async function readAvailableKeys(
  userId: number,
  db: DbClient,
  legalConsent: LegalConsentRecord,
): Promise<Set<string>> {
  const savedKeys = await db.query.keys.findMany({
    where: { userId },
    columns: {
      provider: true,
    },
  })

  const providerIds = new Set<string>(savedKeys.map((key) => {
    return key.provider
  }))

  return withoutUnconsentedTransferProviders(providerIds, legalConsent)
}

/**
 * The cheap default for background-style work on the user's own key: the
 * first provider in `DIRECT_MODEL_PROVIDER_ORDER` with a usable key and a
 * catalog model flagged `forProjectMemory`. `null` when no direct key fits.
 */
export function resolveCheapestDirectModel(
  availableKeys: ReadonlySet<string>,
): DirectModelCandidate | null {
  for (const providerId of DIRECT_MODEL_PROVIDER_ORDER) {
    if (!availableKeys.has(providerId)) {
      continue
    }

    const provider = providers.find((candidate) => {
      return candidate.id === providerId
    })
    const cheapModel = provider?.models.find((model) => {
      return model.forProjectMemory && isUsableMemoryCatalogModel(model)
    })

    if (!cheapModel) {
      continue
    }

    return {
      providerId,
      modelId: cheapModel.id,
      modelName: cheapModel.name,
    }
  }

  return null
}

function toProviderOptions(
  providerId: SupportedProviderId,
  providerOptions: SharedV2ProviderOptions,
): DirectModelProviderOptions {
  return { [providerId]: providerOptions }
}

/**
 * Builds a text model on the user's own direct provider key with reasoning
 * kept minimal (OpenAI `low`, every other provider `off`), no files and no
 * gateway. Transfer consent must be checked by the caller first.
 */
export async function instantiateDirectModel(
  providerId: string | null,
  modelId: string,
  userId: number,
): Promise<DirectModelInstance> {
  const userIdValue = userId.toString()

  if (providerId === 'google') {
    const { instance, reasoning, providerOptions } = await useGoogle(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'openai') {
    const { instance, reasoning, providerOptions } = await useOpenAI(
      userIdValue,
      modelId,
      [],
      'low',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'anthropic') {
    const { instance, reasoning, providerOptions } = await useAnthropic(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'xai') {
    const { instance, reasoning, providerOptions } = await useXai(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'deepseek') {
    const { instance, reasoning, providerOptions } = await useDeepSeek(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'moonshotai') {
    const { instance, reasoning, providerOptions } = await useMoonshotAi(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'qwen') {
    const { instance, reasoning, providerOptions } = await useQwen(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  throw createError({
    message: 'Unsupported memory provider',
    status: 400,
    why: `Provider ${providerId} is not supported for memory.`,
  })
}
