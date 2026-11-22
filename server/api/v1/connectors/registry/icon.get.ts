import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { z } from 'zod'
import { REGISTRY_NAME_MAX_LENGTH } from '#shared/utils/connectors-policy'
import { CONNECTOR_ICON_BUSY } from '~~/server/utils/connectors/icon'
import {
  ICON_BUSY_CACHE_SECONDS,
  iconImageResponse,
  iconMissResponse,
} from '~~/server/utils/connectors/icon-response'
import {
  REGISTRY_ICON_NOT_FOUND,
  resolveRegistryEntryIcon,
} from '~~/server/utils/connectors/registry-icon'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const MAX_ID_LENGTH = REGISTRY_NAME_MAX_LENGTH + 40

const querySchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
})

/**
 * The icon of one directory entry, for its card. The browser never loads a
 * remote image: this route serves the copy Besidka kept (the registry's own
 * `icons`, or the favicon of the entry's host) from the app's own origin. It
 * takes only a registry id and looks the host up in the local registry copy,
 * so the client cannot name a host to fetch. A missing icon answers 404 and
 * the card shows a letter.
 */
export default defineEventHandler(async (event) => {
  await requireConnectorAccess(event, { write: false, icon: true })
  await requireFeature(event, 'connectors.registry')

  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid directory entry',
      status: 400,
      why: 'The id is missing or too long',
      fix: 'Pick an entry from the directory',
    })
  }

  const image = await resolveRegistryEntryIcon(
    useDb(),
    useKV(),
    query.data.id,
    { logger: useRequestLogger(event) },
  )

  if (image === CONNECTOR_ICON_BUSY) {
    return iconMissResponse(ICON_BUSY_CACHE_SECONDS)
  }

  if (image === REGISTRY_ICON_NOT_FOUND || !image) {
    return iconMissResponse()
  }

  return iconImageResponse(image)
})
