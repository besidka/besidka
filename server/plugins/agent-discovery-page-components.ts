import { replaceMinimarkComponents } from '~~/server/utils/content/minimark'
import type { MinimarkNode } from '~~/server/utils/content/minimark'
import { createPageComponentRenderers } from '~~/server/utils/mcp/pages'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:document', (event, page) => {
    const document = page as { body?: { value?: MinimarkNode[] } }

    if (!Array.isArray(document.body?.value)) {
      return
    }

    const { privacyEmail } = useRuntimeConfig(event).public

    document.body.value = replaceMinimarkComponents(
      document.body.value,
      createPageComponentRenderers(String(privacyEmail ?? '')),
    )
  })
})
