import { initLog } from 'evlog/client'

export default defineNuxtPlugin({
  name: 'evlog-client-init',
  enforce: 'pre',
  setup() {
    initLog({
      service: 'web',
      transport: {
        enabled: true,
        endpoint: '/api/_evlog/ingest',
      },
    })
  },
})
