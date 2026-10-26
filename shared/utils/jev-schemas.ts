import { z } from 'zod'

const roleSwitch = z.boolean().optional()

export const jevRoleSettingsPatchSchema = z.object({
  memoryChecks: roleSwitch,
  autoWebSearch: roleSwitch,
  extractionPrefilter: roleSwitch,
  injectionScreening: roleSwitch,
  rerank: roleSwitch,
  sharePiiCheck: roleSwitch,
  pastChatRetrieval: roleSwitch,
}).strict().refine((value) => {
  return Object.keys(value).length > 0
}, { message: 'Send at least one TypeSafe AI role' })
