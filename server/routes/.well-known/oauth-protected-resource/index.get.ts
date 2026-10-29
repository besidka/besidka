import { defineEventHandler } from 'nuxt/server'
import { withOriginResource } from '~~/server/utils/oauth/protected-resource-metadata'

const DEFAULT_SITE_URL = 'https://besidka.com'

export default defineEventHandler(async (event) => {
  const response = await useServerAuth().handler(event.req)
  const contentType = response.headers.get('content-type') || ''

  if (response.status !== 200 || !contentType.includes('application/json')) {
    return response
  }

  let metadata: unknown

  try {
    metadata = await response.clone().json()
  } catch {
    return response
  }

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return response
  }

  const { baseUrl } = useRuntimeConfig().public
  const origin = new URL((baseUrl as string) || DEFAULT_SITE_URL).origin
  const headers = new Headers(response.headers)

  headers.delete('content-length')

  return new Response(
    JSON.stringify(
      withOriginResource(metadata as Record<string, unknown>, origin),
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  )
})
