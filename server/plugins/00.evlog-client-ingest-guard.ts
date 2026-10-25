import { confineClientIngestEvent } from '~~/server/utils/evlog-drains'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:enrich', (context) => {
    confineClientIngestEvent(context.event)
  })
})
