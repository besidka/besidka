import type { NitroRuntimeHooks } from 'nitropack/types'

type BeforeResponseHookEvent = Parameters<
  NitroRuntimeHooks['beforeResponse']
>[0]

const MARKDOWN_CONTENT_TYPE = 'text/markdown'
const MARKDOWN_TWIN_SUFFIX = '.md'
const RAW_TWIN_PREFIX = '/raw/'
const REVALIDATE_ALWAYS = 'no-cache'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', pinNegotiatedMarkdownRevalidation)
})

export function pinNegotiatedMarkdownRevalidation(
  event: BeforeResponseHookEvent,
): void {
  const contentType = event.node.res.getHeader('content-type')

  if (
    typeof contentType !== 'string'
    || !contentType.toLowerCase().startsWith(MARKDOWN_CONTENT_TYPE)
  ) {
    return
  }

  const pathname = event.path.split('?')[0]

  if (
    pathname.endsWith(MARKDOWN_TWIN_SUFFIX)
    || pathname.startsWith(RAW_TWIN_PREFIX)
  ) {
    return
  }

  event.node.res.setHeader('cache-control', REVALIDATE_ALWAYS)
}
