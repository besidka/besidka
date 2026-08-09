import { createGateway, type GatewayProvider } from '@ai-sdk/gateway'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  findGatewayCatalogModel,
  getCachedGatewayCatalog,
} from './catalog'
import type { GatewayChatResult } from './index'
import { keyProviderIdForGateway } from './index'

const GENERATION_INFO_RETRY_DELAY_MS = 1500

export async function useVercelGateway(
  userId: string,
  model: string,
): Promise<GatewayChatResult> {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: keyProviderIdForGateway('vercel'),
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Vercel AI Gateway API key not found. Please set it up in the settings.',
    })
  }

  const client = createGateway({
    apiKey: await useDecryptText(data.apiKey),
  })
  const catalogModel = await findGatewayCatalogModel(
    () => getCachedGatewayCatalog('vercel'),
    model,
  )

  function getInstance() {
    return client(model)
  }

  async function generateChatTitle(message: string) {
    return catalogModel?.maxOutputTokens === undefined
      ? await useChatTitle(getInstance(), message)
      : await useChatTitle(
        getInstance(),
        message,
        catalogModel.maxOutputTokens,
      )
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: {},
    providerOptions: {},
    client,
    maxOutputTokens: catalogModel?.maxOutputTokens,
  }
}

async function fetchGenerationInfoWithRetry(
  client: GatewayProvider,
  generationId: string,
) {
  try {
    return await client.getGenerationInfo({ id: generationId })
  } catch {
    await new Promise((resolve) => {
      setTimeout(resolve, GENERATION_INFO_RETRY_DELAY_MS)
    })

    return await client.getGenerationInfo({ id: generationId })
  }
}

/**
 * Vercel AI Gateway only exposes the real generation cost through a
 * follow-up `getGenerationInfo()` call, keyed by a generation id that is
 * itself only known once the stream finishes — so this always runs after
 * the assistant message row already exists, as background work (see the
 * `scheduleBackgroundWork` caller in `index.post.ts`), updating the
 * already-persisted `usage` JSON column in place. A single retry after a
 * short delay covers the generation record not being immediately available;
 * any failure past that is logged as non-fatal context, never thrown — a
 * missing cost must never surface as a chat error this long after the
 * response already streamed to the user. `db` is passed in explicitly
 * rather than resolved via `useDb()` here, since this runs as a detached
 * background job outside the request lifecycle.
 */
export async function persistVercelGenerationCost(input: {
  db: ReturnType<typeof useDb>
  client: GatewayProvider
  generationId: string
  publicId: string
  logger: { set: (fields: Record<string, unknown>) => void }
}): Promise<void> {
  try {
    const generationInfo = await fetchGenerationInfoWithRetry(
      input.client,
      input.generationId,
    )

    const existing = await input.db.query.messages.findFirst({
      where: { publicId: input.publicId },
      columns: { usage: true },
    })

    if (!existing?.usage) {
      return
    }

    await input.db.update(schema.messages)
      .set({
        usage: {
          ...existing.usage,
          totalCost: generationInfo.totalCost,
        },
      })
      .where(eq(schema.messages.publicId, input.publicId))
  } catch (exception) {
    input.logger.set({
      attributes: {
        vercelGenerationCost: {
          error: exceptionMessage(exception),
        },
      },
    })
  }
}
